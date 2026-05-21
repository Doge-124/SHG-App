//! License management — activation + per-launch validation.
//!
//! Storage: `%APPDATA%/com.shg.manager/license.json`. Contains the license key
//! plus the most recent validation result (used as offline cache for up to 7
//! days).
//!
//! Flow:
//!   - On launch, frontend calls `get_license_status()`. Returns `not_activated`
//!     if no key stored. App shows activation gate.
//!   - User enters key, frontend calls `activate_license(key)`. Server binds
//!     it to this installation. Result cached.
//!   - On subsequent launches, frontend calls `validate_license()` which
//!     re-checks with the server, with offline fallback.

use std::path::PathBuf;
use std::time::Duration;
use serde::{Serialize, Deserialize};
use crate::installation;

const OFFLINE_GRACE_MS: i64 = 7 * 86_400_000; // 7 days
const LICENSE_KEY_PATTERN: &str = r"^SHG-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredLicense {
    pub license_key: String,
    pub bound_installation_id: String,
    pub last_validated_at: i64,       // unix ms
    pub last_status: String,          // "active" | "expired" | "revoked" | ...
    pub expires_at: Option<i64>,
    pub grace_period_ends_at: Option<i64>,
    pub grace_period_days: i64,
    pub customer_name: Option<String>,
    pub revoked_reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    /// One of: "not_activated", "active", "expired", "revoked", "wrong_machine",
    ///         "suspended", "offline_grace_expired", "network_unreachable"
    pub status: String,
    pub license_key: Option<String>,
    pub customer_name: Option<String>,
    pub expires_at: Option<i64>,
    pub grace_period_ends_at: Option<i64>,
    pub days_until_expiry: Option<i64>,
    pub days_in_grace_remaining: Option<i64>,
    pub revoked_reason: Option<String>,
    pub last_validated_at: Option<i64>,
    pub offline_validation: bool,    // true = used cached result, not live
    pub message: Option<String>,
}

fn file_path() -> Option<PathBuf> {
    let dir = dirs::data_dir()?.join("com.shg.manager");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).ok()?;
    }
    Some(dir.join("license.json"))
}

fn load_stored() -> Option<StoredLicense> {
    let path = file_path()?;
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str::<StoredLicense>(&content).ok()
}

fn save_stored(s: &StoredLicense) -> Result<(), String> {
    let path = file_path().ok_or_else(|| "no app data dir".to_string())?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_stored() -> Result<(), String> {
    let path = file_path().ok_or_else(|| "no app data dir".to_string())?;
    if path.exists() { std::fs::remove_file(&path).map_err(|e| e.to_string())?; }
    Ok(())
}

fn telemetry_endpoint() -> Option<String> {
    let url = option_env!("TELEMETRY_ENDPOINT_URL").unwrap_or("").trim();
    if url.is_empty() { None } else { Some(url.trim_end_matches('/').to_string()) }
}

fn is_valid_key(key: &str) -> bool {
    use regex::Regex;
    Regex::new(LICENSE_KEY_PATTERN).map(|re| re.is_match(key)).unwrap_or(false)
}

// ─── Server response shapes ──────────────────────────────────────────────
#[derive(Deserialize)]
struct ActivateResponse {
    ok: bool,
    status: Option<String>,
    error: Option<String>,
    message: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<i64>,
    #[serde(rename = "gracePeriodDays")]
    grace_period_days: Option<i64>,
    #[serde(rename = "customerName")]
    customer_name: Option<String>,
}

#[derive(Deserialize)]
struct ValidateResponse {
    ok: bool,
    status: Option<String>,
    error: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<i64>,
    #[serde(rename = "gracePeriodEndsAt")]
    grace_period_ends_at: Option<i64>,
    #[serde(rename = "gracePeriodDays")]
    grace_period_days: Option<i64>,
    #[serde(rename = "revokedReason")]
    revoked_reason: Option<String>,
    #[serde(rename = "customerName")]
    customer_name: Option<String>,
}

// ─── Public API ──────────────────────────────────────────────────────────

/// Returns the current license status. Performs a live server check if the
/// cached result is older than 1 hour; otherwise returns the cache.
/// Falls back to cache on network failure (up to OFFLINE_GRACE_MS).
pub async fn get_status() -> LicenseStatus {
    let stored = load_stored();
    let Some(stored) = stored else {
        return LicenseStatus {
            status: "not_activated".to_string(),
            license_key: None, customer_name: None, expires_at: None,
            grace_period_ends_at: None, days_until_expiry: None,
            days_in_grace_remaining: None, revoked_reason: None,
            last_validated_at: None, offline_validation: false,
            message: Some("No license stored. Please activate.".to_string()),
        };
    };

    // Always do a live check on launch — server side is cheap.
    let live = validate_with_server(&stored.license_key).await;

    match live {
        Ok(s) => {
            let _ = save_stored(&s);
            build_status(&s, false)
        }
        // Server explicitly rejected the license (admin unbound it, deleted it,
        // etc.). The cache is now stale and misleading — wipe it and force the
        // customer to re-activate.
        Err(ValidationError::Authoritative(reason)) => {
            log::warn!("license: server rejected ({reason}); wiping cache and forcing re-activation");
            let _ = delete_stored();
            LicenseStatus {
                status: "not_activated".to_string(),
                license_key: None, customer_name: None, expires_at: None,
                grace_period_ends_at: None, days_until_expiry: None,
                days_in_grace_remaining: None, revoked_reason: None,
                last_validated_at: None, offline_validation: false,
                message: Some(authoritative_reject_message(&reason)),
            }
        }
        // True network failure — fall back to cache up to the offline-grace window.
        Err(ValidationError::Network(e)) => {
            let age_ms = chrono::Utc::now().timestamp_millis() - stored.last_validated_at;
            log::warn!("license: live check failed ({e}); falling back to cache (age {}d)", age_ms / 86_400_000);
            if age_ms > OFFLINE_GRACE_MS {
                return LicenseStatus {
                    status: "offline_grace_expired".to_string(),
                    license_key: Some(stored.license_key),
                    customer_name: stored.customer_name,
                    expires_at: stored.expires_at,
                    grace_period_ends_at: stored.grace_period_ends_at,
                    days_until_expiry: None,
                    days_in_grace_remaining: None,
                    revoked_reason: None,
                    last_validated_at: Some(stored.last_validated_at),
                    offline_validation: true,
                    message: Some(format!(
                        "Cannot reach license server and last successful check was {} days ago. \
                         Connect to the internet to verify your license.",
                        age_ms / 86_400_000,
                    )),
                };
            }
            build_status(&stored, true)
        }
    }
}

fn authoritative_reject_message(reason: &str) -> String {
    match reason {
        "not_activated" => "Your license has been unbound from this machine. \
                            Please activate again with your license key.".to_string(),
        "license_not_found" => "Your license key is no longer on file. Contact support.".to_string(),
        "invalid_license_key_format" => "Stored license key is malformed. Please activate again.".to_string(),
        "invalid_installation_id" => "Installation ID is invalid. Contact support.".to_string(),
        other => format!("License rejected by server: {other}. Please activate again."),
    }
}

/// Activate a license key for this installation. Returns Ok with the status,
/// or Err with a user-facing reason string.
pub async fn activate(license_key: &str) -> Result<LicenseStatus, String> {
    let key = license_key.trim().to_uppercase();
    if !is_valid_key(&key) {
        return Err("Invalid license key format. Expected SHG-XXXX-XXXX-XXXX-XXXX.".to_string());
    }

    let endpoint = telemetry_endpoint().ok_or_else(||
        "Licensing is not configured in this build.".to_string())?;
    let installation_id = installation::get_or_create_pre_app_for_telemetry()
        .map_err(|e| format!("Cannot read installation ID: {e}"))?
        .installation_id;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let url = format!("{}/license/activate", endpoint);
    let resp = client.post(&url)
        .json(&serde_json::json!({
            "licenseKey": key,
            "installationId": installation_id,
        }))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}. Check your internet connection."))?;

    let body: ActivateResponse = resp.json().await.map_err(|e| format!("Bad response: {e}"))?;

    if !body.ok {
        let err = body.error.as_deref().unwrap_or("unknown");
        let msg = body.message.unwrap_or_else(|| match err {
            "license_not_found" => "License key not found.".to_string(),
            "license_revoked"   => "This license has been revoked.".to_string(),
            "license_suspended" => "This license is suspended.".to_string(),
            "license_bound_to_other_machine" => "This license is already activated on another machine. \
                                                 Contact support to transfer.".to_string(),
            _ => format!("Activation failed: {err}"),
        });
        return Err(msg);
    }

    let now = chrono::Utc::now().timestamp_millis();
    let stored = StoredLicense {
        license_key: key.clone(),
        bound_installation_id: installation_id,
        last_validated_at: now,
        last_status: body.status.unwrap_or_else(|| "active".to_string()),
        expires_at: body.expires_at,
        grace_period_ends_at: None,
        grace_period_days: body.grace_period_days.unwrap_or(14),
        customer_name: body.customer_name,
        revoked_reason: None,
    };
    save_stored(&stored)?;

    Ok(build_status(&stored, false))
}

/// Wipes the local license file. Useful for testing or if a customer needs
/// to re-activate. The server-side binding remains (admin must `unbind`).
pub fn deactivate_local() -> Result<(), String> {
    delete_stored()
}

// ─── Internal helpers ────────────────────────────────────────────────────

/// Why a live validation didn't return a usable result. The distinction matters
/// because `Network` should fall back to cache (offline grace) while
/// `Authoritative` should wipe the cache (server explicitly rejected the key).
enum ValidationError {
    /// Server reached us and explicitly said no (license deleted, unbound, etc.).
    /// The cached state is now stale — caller should delete it.
    Authoritative(String),
    /// Couldn't reach the server, or got a malformed response. Caller should
    /// fall back to the offline cache.
    Network(String),
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Authoritative(s) => write!(f, "authoritative: {s}"),
            Self::Network(s)       => write!(f, "network: {s}"),
        }
    }
}

async fn validate_with_server(license_key: &str) -> Result<StoredLicense, ValidationError> {
    let endpoint = telemetry_endpoint().ok_or_else(||
        ValidationError::Network("Licensing not configured in this build.".to_string()))?;
    let installation_id = installation::get_or_create_pre_app_for_telemetry()
        .map_err(|e| ValidationError::Network(format!("Cannot read installation ID: {e}")))?
        .installation_id;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| ValidationError::Network(format!("HTTP client: {e}")))?;

    let url = format!("{}/license/validate", endpoint);
    let resp = client.post(&url)
        .json(&serde_json::json!({
            "licenseKey": license_key,
            "installationId": installation_id,
        }))
        .send()
        .await
        .map_err(|e| ValidationError::Network(format!("send: {e}")))?;

    // 5xx is server-side trouble — treat as network so we keep the cache.
    // 4xx is authoritative rejection (404/403/400) — we want to wipe.
    let http_status = resp.status();
    if http_status.is_server_error() {
        return Err(ValidationError::Network(format!("HTTP {}", http_status.as_u16())));
    }

    let body: ValidateResponse = resp.json().await
        .map_err(|e| ValidationError::Network(format!("decode: {e}")))?;

    if !body.ok {
        // Server reached us and said no — definitive answer.
        return Err(ValidationError::Authoritative(
            body.error.unwrap_or_else(|| "unknown".into())
        ));
    }

    let now = chrono::Utc::now().timestamp_millis();
    Ok(StoredLicense {
        license_key: license_key.to_string(),
        bound_installation_id: installation_id,
        last_validated_at: now,
        last_status: body.status.unwrap_or_else(|| "unknown".into()),
        expires_at: body.expires_at,
        grace_period_ends_at: body.grace_period_ends_at,
        grace_period_days: body.grace_period_days.unwrap_or(14),
        customer_name: body.customer_name,
        revoked_reason: body.revoked_reason,
    })
}

fn build_status(s: &StoredLicense, offline: bool) -> LicenseStatus {
    let now = chrono::Utc::now().timestamp_millis();
    let days_until_expiry = s.expires_at.map(|e| (e - now) / 86_400_000);
    let days_in_grace_remaining = s.grace_period_ends_at.map(|g| (g - now) / 86_400_000);

    let message = match s.last_status.as_str() {
        "active" => None,
        "expired" => Some(match days_in_grace_remaining {
            Some(d) if d >= 0 => format!(
                "Your license expired. You have {} day(s) to renew before the app locks.",
                d.max(0),
            ),
            _ => "Your license has expired and the grace period has ended.".to_string(),
        }),
        "revoked" => Some(s.revoked_reason.clone()
            .unwrap_or_else(|| "This license has been revoked. Contact support.".to_string())),
        "wrong_machine" => Some(
            "This license is bound to another machine. Contact support to transfer.".to_string()
        ),
        "suspended" => Some("This license has been suspended. Contact support.".to_string()),
        _ => None,
    };

    LicenseStatus {
        status: s.last_status.clone(),
        license_key: Some(s.license_key.clone()),
        customer_name: s.customer_name.clone(),
        expires_at: s.expires_at,
        grace_period_ends_at: s.grace_period_ends_at,
        days_until_expiry,
        days_in_grace_remaining,
        revoked_reason: s.revoked_reason.clone(),
        last_validated_at: Some(s.last_validated_at),
        offline_validation: offline,
        message,
    }
}
