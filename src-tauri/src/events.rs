//! Event tracking — feature usage telemetry.
//!
//! Events are queued in `%APPDATA%/com.shg.manager/events.jsonl` (one JSON
//! object per line) and flushed in batches to the backend `/events` endpoint
//! every 5 minutes (and on next launch).
//!
//! Activates only if `TELEMETRY_ENDPOINT_URL` is baked in at build time;
//! otherwise `track_event` is a no-op.
//!
//! ## Privacy
//! Properties must contain NO PII (no member names, phone numbers, addresses,
//! or specific amounts). Use buckets / aggregates instead. Validated nowhere —
//! discipline is on the caller.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use serde::{Serialize, Deserialize};
use crate::installation;

/// Flush every 5 minutes while the app runs.
const FLUSH_INTERVAL_SECS: u64 = 300;
/// Cap on events kept locally — older events dropped if the queue grows beyond.
const MAX_QUEUED_EVENTS: usize = 5000;
/// Max events per /events POST.
const MAX_BATCH_SIZE: usize = 500;

static EVENT_FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize, Clone)]
struct QueuedEvent {
    #[serde(rename = "eventId")]
    event_id: String,
    name: String,
    props: Option<serde_json::Value>,
    #[serde(rename = "occurredAt")]
    occurred_at: i64,
}

#[derive(Debug, Serialize)]
struct EventBatch<'a> {
    #[serde(rename = "installationId")]
    installation_id: &'a str,
    #[serde(rename = "appVersion")]
    app_version: &'a str,
    events: &'a [QueuedEvent],
}

fn events_file_path() -> Option<PathBuf> {
    let dir = dirs::data_dir()?.join("com.shg.manager");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).ok()?;
    }
    Some(dir.join("events.jsonl"))
}

fn telemetry_enabled() -> bool {
    !option_env!("TELEMETRY_ENDPOINT_URL").unwrap_or("").trim().is_empty()
}

fn generate_uuid_v4() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

/// Append an event to the local queue. Always returns quickly (file I/O is small).
/// No-op if telemetry is disabled at build time.
pub fn track(name: &str, props: Option<serde_json::Value>) {
    if !telemetry_enabled() { return; }

    let event = QueuedEvent {
        event_id: generate_uuid_v4(),
        name: name.to_string(),
        props,
        occurred_at: chrono::Utc::now().timestamp_millis(),
    };

    let Some(path) = events_file_path() else { return; };
    let line = match serde_json::to_string(&event) {
        Ok(s) => s,
        Err(e) => { log::warn!("events: serialize failed: {e}"); return; }
    };

    let _guard = EVENT_FILE_LOCK.lock();
    match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut f) => {
            use std::io::Write;
            if let Err(e) = writeln!(f, "{line}") {
                log::warn!("events: append failed: {e}");
            }
        }
        Err(e) => log::warn!("events: open file failed: {e}"),
    }
}

/// Read all queued events from disk and return them (does NOT consume the file).
fn read_queue() -> Vec<QueuedEvent> {
    let Some(path) = events_file_path() else { return vec![]; };
    if !path.exists() { return vec![]; }

    let _guard = EVENT_FILE_LOCK.lock();
    let contents = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => { log::warn!("events: read failed: {e}"); return vec![]; }
    };

    let mut out = Vec::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        match serde_json::from_str::<QueuedEvent>(line) {
            Ok(e) => out.push(e),
            Err(e) => log::warn!("events: skipping malformed queue line: {e}"),
        }
    }

    // If queue grew too large (offline for weeks), keep only the newest N.
    if out.len() > MAX_QUEUED_EVENTS {
        let drop = out.len() - MAX_QUEUED_EVENTS;
        log::warn!("events: dropping {drop} oldest queued events (cap {MAX_QUEUED_EVENTS})");
        out.drain(..drop);
    }
    out
}

/// Rewrite the queue file with the given events (replaces atomically).
fn write_queue(events: &[QueuedEvent]) {
    let Some(path) = events_file_path() else { return; };
    let _guard = EVENT_FILE_LOCK.lock();
    let tmp = path.with_extension("jsonl.tmp");

    let mut content = String::new();
    for e in events {
        if let Ok(s) = serde_json::to_string(e) {
            content.push_str(&s);
            content.push('\n');
        }
    }

    if let Err(e) = std::fs::write(&tmp, &content) {
        log::warn!("events: tmp write failed: {e}");
        return;
    }
    if let Err(e) = std::fs::rename(&tmp, &path) {
        log::warn!("events: atomic rename failed: {e}");
    }
}

/// Send one batch to the backend. Returns Ok(()) if accepted (or queue empty),
/// Err if the network call failed (caller can retry later).
async fn send_batch(
    client: &reqwest::Client,
    endpoint: &str,
    installation_id: &str,
    events: &[QueuedEvent],
) -> Result<(), String> {
    if events.is_empty() { return Ok(()); }

    let batch = EventBatch {
        installation_id,
        app_version: env!("CARGO_PKG_VERSION"),
        events,
    };

    let url = format!("{}/events", endpoint.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&batch)
        .send()
        .await
        .map_err(|e| format!("post failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("server returned {status}"));
    }
    log::info!("events: flushed {} events ({status})", events.len());
    Ok(())
}

/// Flush all queued events. Called periodically by the spawned background task.
/// On success, clears the queue. On failure, leaves events on disk for next attempt.
async fn flush_once() {
    let endpoint = option_env!("TELEMETRY_ENDPOINT_URL").unwrap_or("").trim().to_string();
    if endpoint.is_empty() { return; }

    let queue = read_queue();
    if queue.is_empty() { return; }

    let info = match installation::get_or_create_pre_app_for_telemetry() {
        Ok(i) => i,
        Err(e) => { log::warn!("events: cannot read installation id: {e}"); return; }
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => { log::warn!("events: http client failed: {e}"); return; }
    };

    // Split into batches and track which succeeded.
    let mut remaining: Vec<QueuedEvent> = Vec::new();
    let chunks: Vec<&[QueuedEvent]> = queue.chunks(MAX_BATCH_SIZE).collect();

    for (i, chunk) in chunks.iter().enumerate() {
        match send_batch(&client, &endpoint, &info.installation_id, chunk).await {
            Ok(_) => { /* keep going */ }
            Err(e) => {
                log::warn!("events: batch {} failed ({e}); retaining {} events for next attempt",
                    i, chunks[i..].iter().map(|c| c.len()).sum::<usize>());
                // Retain this batch and all subsequent ones for later.
                for &c in &chunks[i..] { remaining.extend_from_slice(c); }
                break;
            }
        }
    }

    write_queue(&remaining);
}

/// Start a background flusher thread that periodically pushes queued events.
/// Spawned once from main(). Best-effort — never blocks the main thread.
pub fn start_flusher() {
    if !telemetry_enabled() {
        log::debug!("events: flusher disabled (no TELEMETRY_ENDPOINT_URL)");
        return;
    }

    std::thread::spawn(|| {
        let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(rt) => rt,
            Err(e) => { log::warn!("events: flusher tokio init failed: {e}"); return; }
        };

        rt.block_on(async {
            // Flush once at startup (catches anything queued offline last session).
            flush_once().await;

            loop {
                tokio::time::sleep(Duration::from_secs(FLUSH_INTERVAL_SECS)).await;
                flush_once().await;
            }
        });
    });
}
