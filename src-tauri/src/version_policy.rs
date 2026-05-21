//! Force-update gate. Fetches the server's `min_supported_version` and
//! reports whether the running build is allowed.
//!
//! Failure modes:
//!   - Server unreachable / no endpoint configured → returns `allowed=true`
//!     (don't lock customers out on a flaky network).
//!   - Server returns null/empty minimum → `allowed=true` (no gate enforced).
//!   - Current version below minimum → `allowed=false`, app shows the gate.

use std::time::Duration;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionPolicy {
    pub current_version: String,
    /// May be null when no minimum is set or when the server couldn't be
    /// reached. `allowed=true` in both cases.
    pub min_supported_version: Option<String>,
    pub allowed: bool,
    pub message: Option<String>,
}

#[derive(Deserialize)]
struct PolicyResponse {
    ok: bool,
    #[serde(rename = "minSupportedVersion")]
    min_supported_version: Option<String>,
}

fn endpoint() -> Option<String> {
    let url = option_env!("TELEMETRY_ENDPOINT_URL").unwrap_or("").trim();
    if url.is_empty() { None } else { Some(url.trim_end_matches('/').to_string()) }
}

/// Parse "1.2.3" → (1,2,3). Ignores any pre-release suffix after '-'.
/// Returns None on malformed input.
fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let stem = v.split('-').next().unwrap_or(v);
    let mut parts = stem.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next()?.parse().ok()?;
    let patch: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() { return None; }
    Some((major, minor, patch))
}

/// Returns true if `current` >= `min`. If either is unparseable, returns true
/// (fail-open — don't lock users out over a malformed version string).
fn version_meets(current: &str, min: &str) -> bool {
    let (Some(c), Some(m)) = (parse_version(current), parse_version(min)) else {
        return true;
    };
    c >= m
}

pub async fn fetch() -> VersionPolicy {
    let current = env!("CARGO_PKG_VERSION").to_string();

    let Some(base) = endpoint() else {
        return VersionPolicy {
            current_version: current,
            min_supported_version: None,
            allowed: true,
            message: None,
        };
    };

    let url = format!("{}/version-policy", base);
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return VersionPolicy {
            current_version: current,
            min_supported_version: None,
            allowed: true,
            message: None,
        },
    };

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("version_policy: fetch failed ({e}); fail-open");
            return VersionPolicy {
                current_version: current,
                min_supported_version: None,
                allowed: true,
                message: None,
            };
        }
    };

    let body: PolicyResponse = match resp.json().await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("version_policy: decode failed ({e}); fail-open");
            return VersionPolicy {
                current_version: current,
                min_supported_version: None,
                allowed: true,
                message: None,
            };
        }
    };

    if !body.ok {
        return VersionPolicy {
            current_version: current,
            min_supported_version: None,
            allowed: true,
            message: None,
        };
    }

    let min = body.min_supported_version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let allowed = match &min {
        Some(m) => version_meets(&current, m),
        None    => true,
    };

    let message = if !allowed {
        Some(format!(
            "This version of SHG Manager is no longer supported. Please update to v{} or later.",
            min.as_deref().unwrap_or("?"),
        ))
    } else {
        None
    };

    VersionPolicy {
        current_version: current,
        min_supported_version: min,
        allowed,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic() {
        assert_eq!(parse_version("1.0.17"), Some((1, 0, 17)));
        assert_eq!(parse_version("0.9.0-alpha"), Some((0, 9, 0)));
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("garbage"), None);
    }

    #[test]
    fn version_compare() {
        assert!(version_meets("1.0.17", "1.0.10"));
        assert!(version_meets("1.0.10", "1.0.10"));
        assert!(!version_meets("1.0.9", "1.0.10"));
        assert!(!version_meets("0.9.99", "1.0.0"));
        // fail-open on garbage
        assert!(version_meets("garbage", "1.0.0"));
        assert!(version_meets("1.0.0", "garbage"));
    }
}
