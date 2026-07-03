//! Type definitions for the SHG application.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct OpeningDataInput {
    pub member_id: i64,
    pub opening_balance: f64,
    pub payment_method: Option<String>,
    pub past_installments: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneralSettings {
    #[serde(rename = "groupName")]
    pub group_name: String,
    #[serde(rename = "registrationNumber")]
    pub registration_number: String,
    #[serde(rename = "address")]
    pub address: String,
    #[serde(rename = "contactPhone")]
    pub contact_phone: String,
    #[serde(rename = "contactEmail")]
    pub contact_email: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationSettings {
    #[serde(rename = "enableNotifications")]
    pub enable_notifications: bool,
    #[serde(rename = "enableEmailAlerts")]
    pub enable_email_alerts: bool,
    #[serde(rename = "loanDueReminders")]
    pub loan_due_reminders: bool,
    #[serde(rename = "chitCycleAlerts")]
    pub chit_cycle_alerts: bool,
    #[serde(rename = "newMemberRequests")]
    pub new_member_requests: bool,
    #[serde(rename = "paymentConfirmations")]
    pub payment_confirmations: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DataSettings {
    #[serde(rename = "autoBackup")]
    pub auto_backup: bool,
    #[serde(rename = "backupFrequency")]
    pub backup_frequency: String,
    #[serde(rename = "lastBackupDate")]
    pub last_backup_date: Option<String>,
}

/// Automatic cloud-backup-via-email configuration. The user supplies their own
/// SMTP credentials; the app emails the SQLCipher-encrypted DB on a schedule.
/// Stored as JSON in `settings.cloud_backup_settings` (encrypted at rest).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudBackupSettings {
    #[serde(rename = "enabled", default)]
    pub enabled: bool,
    #[serde(rename = "smtpHost", default = "default_smtp_host")]
    pub smtp_host: String,
    #[serde(rename = "smtpPort", default = "default_smtp_port")]
    pub smtp_port: u16,
    /// SMTP login (usually the sender's email address).
    #[serde(rename = "username", default)]
    pub username: String,
    /// App password / SMTP password. Sensitive — only stored in the encrypted DB.
    #[serde(rename = "appPassword", default)]
    pub app_password: String,
    /// From address shown on the email (defaults to `username` if blank).
    #[serde(rename = "fromEmail", default)]
    pub from_email: String,
    /// Where backups are sent (defaults to `username` if blank).
    #[serde(rename = "recipient", default)]
    pub recipient: String,
    /// daily | weekly | monthly
    #[serde(rename = "frequency", default = "default_backup_frequency")]
    pub frequency: String,
    /// RFC3339 timestamp of the last successful email backup (server-set).
    #[serde(rename = "lastBackupAt", default)]
    pub last_backup_at: Option<String>,
}

fn default_smtp_host() -> String { "smtp.gmail.com".to_string() }
fn default_smtp_port() -> u16 { 587 }
fn default_backup_frequency() -> String { "daily".to_string() }

impl Default for CloudBackupSettings {
    fn default() -> Self {
        CloudBackupSettings {
            enabled: false,
            smtp_host: default_smtp_host(),
            smtp_port: default_smtp_port(),
            username: String::new(),
            app_password: String::new(),
            from_email: String::new(),
            recipient: String::new(),
            frequency: default_backup_frequency(),
            last_backup_at: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppearanceSettings {
    #[serde(rename = "theme")]
    pub theme: String,
    #[serde(rename = "language")]
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(rename = "general")]
    pub general: GeneralSettings,
    #[serde(rename = "notifications")]
    pub notifications: NotificationSettings,
    #[serde(rename = "data")]
    pub data: DataSettings,
    #[serde(rename = "appearance")]
    pub appearance: AppearanceSettings,
}
