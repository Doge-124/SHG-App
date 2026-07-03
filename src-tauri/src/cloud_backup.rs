//! Automatic cloud backup over the user's own SMTP account.
//!
//! The user supplies their SMTP host/port + email + app password (stored in the
//! SQLCipher-encrypted DB). We email the SQLCipher-encrypted database file to a
//! configured recipient — safe in transit and at rest, since restoring still
//! requires the app and the user's PIN. Sending uses lettre's blocking transport
//! over rustls, so it must be called off the DB lock / UI thread.

use chrono::{DateTime, Duration, Utc};
use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};

use crate::error::AppError;
use crate::types::CloudBackupSettings;

/// The From address actually used (falls back to the SMTP username).
fn effective_from(cfg: &CloudBackupSettings) -> String {
    if cfg.from_email.trim().is_empty() {
        cfg.username.trim().to_string()
    } else {
        cfg.from_email.trim().to_string()
    }
}

/// The recipient actually used (falls back to the SMTP username).
fn effective_recipient(cfg: &CloudBackupSettings) -> String {
    if cfg.recipient.trim().is_empty() {
        cfg.username.trim().to_string()
    } else {
        cfg.recipient.trim().to_string()
    }
}

/// Validate that the config has everything needed to send. Returns a friendly
/// error naming the first missing field.
pub fn validate(cfg: &CloudBackupSettings) -> Result<(), AppError> {
    if cfg.smtp_host.trim().is_empty() {
        return Err(AppError::validation("SMTP host is required"));
    }
    if cfg.smtp_port == 0 {
        return Err(AppError::validation("SMTP port is required"));
    }
    if cfg.username.trim().is_empty() {
        return Err(AppError::validation("Sender email (SMTP username) is required"));
    }
    if cfg.app_password.is_empty() {
        return Err(AppError::validation("App password is required"));
    }
    if effective_recipient(cfg).trim().is_empty() {
        return Err(AppError::validation("Recipient email is required"));
    }
    Ok(())
}

/// Whether a scheduled backup is due now, given the config and current time.
/// False unless enabled and minimally configured.
pub fn is_due(cfg: &CloudBackupSettings, now: DateTime<Utc>) -> bool {
    if !cfg.enabled || validate(cfg).is_err() {
        return false;
    }
    let interval = match cfg.frequency.as_str() {
        "weekly" => Duration::days(7),
        "monthly" => Duration::days(30),
        _ => Duration::days(1), // daily (default)
    };
    match &cfg.last_backup_at {
        None => true,
        Some(s) => match DateTime::parse_from_rfc3339(s) {
            Ok(last) => now.signed_duration_since(last.with_timezone(&Utc)) >= interval,
            Err(_) => true, // unparseable → treat as overdue
        },
    }
}

/// Build the SMTP transport for the given config. Port 465 → implicit TLS,
/// anything else (e.g. 587) → STARTTLS.
fn build_transport(cfg: &CloudBackupSettings) -> Result<SmtpTransport, AppError> {
    let host = cfg.smtp_host.trim();
    let builder = if cfg.smtp_port == 465 {
        SmtpTransport::relay(host)
    } else {
        SmtpTransport::starttls_relay(host)
    }
    .map_err(|e| AppError::business(format!("SMTP setup failed: {e}")))?;

    Ok(builder
        .port(cfg.smtp_port)
        .credentials(Credentials::new(
            cfg.username.trim().to_string(),
            cfg.app_password.clone(),
        ))
        .build())
}

/// Send an email with the given subject/body and an optional attachment.
fn send_email(
    cfg: &CloudBackupSettings,
    subject: &str,
    body: String,
    attachment: Option<(String, Vec<u8>)>,
) -> Result<(), AppError> {
    validate(cfg)?;

    let from = effective_from(cfg);
    let to = effective_recipient(cfg);
    let from_mbox = from
        .parse()
        .map_err(|_| AppError::validation(format!("Invalid sender email: {from}")))?;
    let to_mbox = to
        .parse()
        .map_err(|_| AppError::validation(format!("Invalid recipient email: {to}")))?;

    let builder = Message::builder()
        .from(from_mbox)
        .to(to_mbox)
        .subject(subject);

    let email = match attachment {
        Some((name, bytes)) => builder
            .multipart(
                MultiPart::mixed()
                    .singlepart(SinglePart::plain(body))
                    .singlepart(Attachment::new(name).body(
                        bytes,
                        ContentType::parse("application/octet-stream")
                            .map_err(|e| AppError::business(format!("attachment type: {e}")))?,
                    )),
            )
            .map_err(|e| AppError::business(format!("Failed to build email: {e}")))?,
        None => builder
            .header(ContentType::TEXT_PLAIN)
            .body(body)
            .map_err(|e| AppError::business(format!("Failed to build email: {e}")))?,
    };

    let mailer = build_transport(cfg)?;
    mailer
        .send(&email)
        .map_err(|e| AppError::business(format!("Failed to send email: {e}")))?;
    Ok(())
}

/// Send a small test message (no attachment) to verify credentials end-to-end.
pub fn send_test_email(cfg: &CloudBackupSettings) -> Result<(), AppError> {
    send_email(
        cfg,
        "SHG Manager — test email",
        "This is a test email from SHG Manager. Your cloud backup email settings are working.".to_string(),
        None,
    )
}

/// Email an encrypted database backup as an attachment.
pub fn send_backup_email(
    cfg: &CloudBackupSettings,
    file_name: &str,
    bytes: Vec<u8>,
) -> Result<(), AppError> {
    let when = Utc::now().format("%Y-%m-%d %H:%M UTC").to_string();
    let body = format!(
        "Automatic encrypted backup from SHG Manager.\n\n\
         File: {file_name}\nCreated: {when}\n\n\
         This database is encrypted; restoring it requires the SHG Manager app and your PIN."
    );
    send_email(
        cfg,
        &format!("SHG Manager backup — {when}"),
        body,
        Some((file_name.to_string(), bytes)),
    )
}
