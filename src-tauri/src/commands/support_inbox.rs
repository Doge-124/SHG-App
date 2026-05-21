//! Tauri command for the support inbox poller.

use std::sync::Mutex;
use tauri::State;

use crate::state::AppState;
use crate::support_inbox::{self, SupportRunReport};

/// Poll the backend for pending support commands, execute any that arrive,
/// and upload results. Returns a small summary the frontend can log.
/// Safe to call any time post-auth; idempotent over no-pending-work.
#[tauri::command]
pub async fn run_support_inbox(
    state: State<'_, Mutex<AppState>>,
) -> Result<SupportRunReport, String> {
    support_inbox::run(state.inner()).await
}
