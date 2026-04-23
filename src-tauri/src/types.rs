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
