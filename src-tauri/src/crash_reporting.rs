//! Sentry crash reporting setup.
//!
//! Activates only if `SENTRY_DSN` is set at build time. Without it, the app
//! works normally with zero network calls to Sentry.
//!
//! Respects the per-installation `crash_reporting_enabled` flag at runtime
//! via Sentry's `before_send` hook — no restart required to opt out.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use sentry::ClientInitGuard;
use crate::installation;

/// Initialise Sentry. Returns a guard that flushes pending events on drop.
/// Returns `None` if no DSN is configured (no-op build).
pub fn init() -> Option<ClientInitGuard> {
    let dsn = option_env!("SENTRY_DSN").unwrap_or("").trim();
    if dsn.is_empty() {
        log::info!("Crash reporting: disabled (no SENTRY_DSN at build time)");
        return None;
    }

    log::info!("Crash reporting: initialising Sentry");

    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some(env!("CARGO_PKG_VERSION").into()),
            environment: Some(
                if cfg!(debug_assertions) { "development" } else { "production" }.into(),
            ),
            sample_rate: 1.0,
            attach_stacktrace: true,
            send_default_pii: false, // never send IP, username, etc.
            max_breadcrumbs: 50,
            before_send: Some(Arc::new(|event| {
                // Honour the user's runtime opt-out — read each time so toggling
                // in Settings takes effect without restart.
                if !installation::CRASH_REPORTING_ENABLED.load(Ordering::Relaxed) {
                    return None;
                }
                Some(scrub_event(event))
            })),
            ..Default::default()
        },
    ));

    // Initial tagging — installation ID etc. will be added once available.
    sentry::configure_scope(|scope| {
        scope.set_tag("os", std::env::consts::OS);
        scope.set_tag("arch", std::env::consts::ARCH);
    });

    Some(guard)
}

/// Set the installation ID on the Sentry scope so all subsequent events
/// are correlated with this customer. Call after `installation::bootstrap()`.
pub fn set_installation_id(id: &str) {
    sentry::configure_scope(|scope| {
        scope.set_user(Some(sentry::User {
            id: Some(id.to_string()),
            ..Default::default()
        }));
        scope.set_tag("installation_id", id);
    });
}

/// Light PII scrubbing — keeps Sentry's defaults and additionally blanks
/// anything that looks like a phone number in the event message.
fn scrub_event(mut event: sentry::protocol::Event<'static>) -> sentry::protocol::Event<'static> {
    if let Some(msg) = event.message.as_mut() {
        *msg = scrub_string(msg);
    }
    for exc in event.exception.values.iter_mut() {
        exc.value = exc.value.as_ref().map(|v| scrub_string(v));
    }
    event
}

fn scrub_string(s: &str) -> String {
    // Replace any run of 10+ digits with [REDACTED_PHONE].
    let mut out = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            let run = &chars[start..i];
            if run.len() >= 10 {
                out.push_str("[REDACTED_PHONE]");
            } else {
                for c in run { out.push(*c); }
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}
