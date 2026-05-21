//! Telemetry: send a heartbeat to the backend on app launch.
//!
//! Activates only if `TELEMETRY_ENDPOINT_URL` is set at build time. Without it,
//! the heartbeat is a no-op (zero network calls).
//!
//! Best-effort: failures are logged but never propagate to the rest of the app.
//! We never block startup waiting for a heartbeat.

use std::time::Duration;
use serde::Serialize;
use crate::installation::InstallationInfo;

#[derive(Debug, Serialize)]
struct HeartbeatPayload<'a> {
    #[serde(rename = "installationId")]
    installation_id: &'a str,
    version: &'a str,
    os: &'a str,
    arch: &'a str,
}

/// Send a single heartbeat. Best-effort, fire-and-forget — does NOT block.
/// Spawns a Tokio task that runs the HTTP call in the background.
pub fn fire_async(info: &InstallationInfo) {
    let endpoint = option_env!("TELEMETRY_ENDPOINT_URL").unwrap_or("").trim();
    if endpoint.is_empty() {
        log::debug!("Telemetry: disabled (no TELEMETRY_ENDPOINT_URL at build time)");
        return;
    }

    let payload = HeartbeatPayload {
        installation_id: &info.installation_id,
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    };

    // Serialize on the calling thread (fast), then move ownership to the task.
    let body = match serde_json::to_vec(&payload) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Telemetry: serialize failed: {e}");
            return;
        }
    };

    let url = format!("{}/heartbeat", endpoint.trim_end_matches('/'));

    // Spawn the actual HTTP call so app startup isn't blocked.
    // Uses a short timeout so even a misconfigured backend doesn't hang.
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                log::warn!("Telemetry: tokio runtime failed: {e}");
                return;
            }
        };

        rt.block_on(async move {
            let client = match reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
            {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("Telemetry: http client failed: {e}");
                    return;
                }
            };

            match client
                .post(&url)
                .header("content-type", "application/json")
                .body(body)
                .send()
                .await
            {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        log::info!("Telemetry: heartbeat ok ({status})");
                    } else {
                        log::warn!("Telemetry: heartbeat returned {status}");
                    }
                }
                Err(e) => {
                    // Network errors, DNS failures, etc. — never fatal.
                    log::warn!("Telemetry: heartbeat failed: {e}");
                }
            }
        });
    });
}
