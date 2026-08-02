#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cloud_backup;
mod commands;
mod crash_reporting;
mod db;
mod error;
mod events;
mod installation;
mod license;
mod security;
mod state;
mod support_inbox;
mod telemetry;
mod types;
mod version_policy;

use state::AppState;

fn main() {
    // Must run before Sentry init so crash-reporting flag is loaded from disk.
    let _ = installation::bootstrap();

    // Sentry init returns a guard that flushes on drop (kept alive for whole program).
    let _sentry_guard = crash_reporting::init();

    // Fire a telemetry heartbeat in the background. Non-blocking, best-effort.
    // Only sends if TELEMETRY_ENDPOINT_URL was set at build time.
    if let Ok(info) = installation::get_or_create_pre_app_for_telemetry() {
        crate::telemetry::fire_async(&info);
        crash_reporting::set_installation_id(&info.installation_id);
        // Track app launch — gives daily-active-user signal in the dashboard.
        crate::events::track("app.launched", None);
    }

    // Start the background event flusher (best-effort, batches every 5 min).
    crate::events::start_flusher();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000) // 5 MB per log file
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            Ok(())
        })
        .manage(std::sync::Mutex::new(AppState {
            db: Option::<rusqlite::Connection>::None,
            db_key: None,
            integrity_warning: None,
        }))
        .invoke_handler(tauri::generate_handler![
            commands::auth::unlock_db,
            commands::auth::get_integrity_warning,
            commands::auth::setup_db,
            commands::auth::reset_pin,
            commands::auth::has_security,
            commands::auth::verify_master_password,
            commands::auth::change_admin_pin,
            commands::audit::get_audit_log,
            commands::members::add_member,
            commands::members::add_member_auto,
            commands::members::get_member,
            commands::members::update_member,
            commands::members::list_members,
            commands::members::member_balance,
            commands::members::set_member_opening_data,
            commands::members::get_member_profile,
            commands::members::list_members_by_type_cmd,
            commands::members::update_member_type,
            commands::members::set_member_active,
            commands::members::get_member_passbook,
            commands::members::get_member_loan_passbook,
            commands::members::get_member_chit_passbook,
            commands::members::get_total_members,
            commands::members::get_total_loans_outstanding,
            commands::members::get_active_chit_groups,
            commands::contributions::record_weekly_contribution_cmd,
            commands::contributions::payout_member_savings_cmd,
            commands::contributions::record_past_member_payout_cmd,
            commands::contributions::get_savings_payout_history_cmd,
            commands::contributions::get_installment_status_cmd,
            commands::contributions::set_installment_number_cmd,
            commands::contributions::get_weekly_contribution_amount_cmd,
            commands::contributions::set_weekly_contribution_amount_cmd,
            commands::contributions::get_weekly_contribution_status_cmd,
            commands::loans::record_past_loan,
            commands::loans::get_all_loans,
            commands::loans::get_member_loans,
            commands::loans::get_loan,
            commands::loans::get_loan_repayments,
            commands::loans::issue_member_loan,
            commands::loans::record_member_payment,
            commands::loans::preview_loan_payment,
            commands::loans::prepay_loan_interest,
            commands::loans::preview_prepay_interest,
            commands::loans::get_loan_repayment_schedule,
            commands::chits::get_chit_group,
            commands::chits::get_chit_groups,
            commands::chits::get_chit_members,
            commands::chits::set_chit_passbook_number,
            commands::chits::get_chit_cycles,
            commands::chits::get_chit_payments,
            commands::chits::create_chit_group,
            commands::chits::add_member_to_chit,
            commands::chits::create_chit_cycle,
            commands::chits::record_chit_payment,
            commands::chits::payout_chit_winner,
            commands::chits::get_current_cycle_with_summary,
            commands::chits::advance_to_next_cycle,
            commands::chits::update_chit_cycle_date,
            commands::chits::set_cycle_collection_discount,
            commands::chits::record_member_payment_with_discount,
            commands::chits::get_chit_pending_dues,
            commands::chits::get_member_chit_ledger,
            commands::chits::record_chit_late_payment,
            commands::chits::record_chit_late_payments_batch,
            commands::chits::get_chit_closing_info,
            commands::chits::pay_closing_members,
            commands::chits::close_chit,
            commands::chits::process_winner_payout,
            commands::chits::get_member_chit_groups,
            commands::chits::record_past_chit_cycle,
            commands::chits::record_bulk_past_chit_cycles,
            commands::chits::get_member_payment_status,
            commands::chits::get_chit_cycles_with_details,
            commands::chits::get_chit_migration_status,
            commands::chits::get_cycle_eligibility,
            commands::chits::override_member_eligibility,
            commands::chits::process_chit_cycle_winners,
            commands::chits::get_chit_cycle_winners,
            commands::ledger::record_receipt,
            commands::ledger::record_voucher,
            commands::ledger::get_shg_balances,
            commands::ledger::get_receipts,
            commands::ledger::get_vouchers,
            commands::reports::daily_transactions,
            commands::reports::weekly_transactions,
            commands::reports::monthly_transactions,
            commands::reports::get_recent_transactions,
            commands::daybook::get_day_book,
            commands::daybook::get_day_book_for_date,
            commands::daybook::export_day_book_csv,
            commands::daybook::get_cash_book,
            commands::daybook::get_bank_book,
            commands::daybook::get_bank_transaction_ids,
            commands::trial_balance::get_trial_balance_cmd,
            commands::trial_balance::get_available_financial_years_cmd,
            commands::trial_balance::get_balance_sheet_cmd,
            commands::trial_balance::get_income_expenditure_cmd,
            commands::trial_balance::get_income_ledger_cmd,
            commands::trial_balance::get_general_ledger_cmd,
            commands::settings::get_general_settings,
            commands::settings::save_general_settings,
            commands::settings::get_notification_settings,
            commands::settings::save_notification_settings,
            commands::settings::get_data_settings,
            commands::settings::save_data_settings,
            commands::settings::get_appearance_settings,
            commands::settings::save_appearance_settings,
            commands::settings::get_all_settings,
            commands::settings::save_all_settings,
            commands::settings::debug_settings_json,
            commands::settings::force_migrate_settings,
            commands::settings::change_database_password,
            commands::settings::create_backup,
            commands::settings::restore_backup,
            commands::settings::restore_backup_from_file,
            commands::settings::get_backup_list,
            commands::assets::list_assets,
            commands::assets::get_asset_summary,
            commands::assets::add_asset,
            commands::assets::update_asset,
            commands::assets::dispose_asset,
            commands::settings::get_cloud_backup_settings,
            commands::settings::save_cloud_backup_settings,
            commands::settings::send_cloud_test_email,
            commands::settings::run_cloud_backup_now,
            commands::settings::run_cloud_backup_if_due,
            commands::settings::clear_all_data,
            commands::settings::clear_data_keep_members,
            commands::settings::get_past_data_lock_status,
            commands::settings::lock_past_data_entry,
            commands::settings::unlock_past_data_entry,
            commands::settings::get_shg_opening_status,
            commands::settings::set_shg_opening_balance,
            commands::support::get_diagnostic_report,
            commands::support::get_log_dir,
            commands::support::check_db_integrity,
            commands::support::rebuild_balances,
            commands::support::get_installation_id,
            commands::support::get_schema_info,
            commands::support::set_crash_reporting_enabled,
            commands::support::get_crash_reporting_status,
            commands::support::send_test_crash_event,
            commands::support::track_event,
            commands::license::get_license_status,
            commands::license::activate_license,
            commands::license::deactivate_license_local,
            commands::version_policy::get_version_policy,
            commands::support_inbox::run_support_inbox,
            commands::past_edit::edit_member_opening_data,
            commands::past_edit::delete_past_loan,
            commands::past_edit::delete_past_chit_cycle,
            commands::past_edit::cancel_shg_transaction,
            commands::printing::silent_print_pdf,
            commands::guarantors::set_loan_guarantors,
            commands::guarantors::get_loan_guarantors,
            commands::guarantors::set_chit_member_guarantors,
            commands::guarantors::get_chit_member_guarantors,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
