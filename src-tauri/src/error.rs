//! Application-wide error type for the SHG financial backend.
//!
//! This wraps lower-level errors (database, IO, crypto) and provides
//! semantically meaningful variants for validation failures and
//! financial invariants (e.g. insufficient balance).

use thiserror::Error;

/// Unified error type for backend operations.
#[derive(Debug, Error)]
pub enum AppError {
    /// Errors coming from the SQLite / SQLCipher layer.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// IO and filesystem issues (e.g. security.json, DB path).
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// Errors from key derivation / cryptographic primitives.
    #[error("crypto error: {0}")]
    Crypto(String),

    /// Invalid input data (failed validation).
    #[error("validation error: {0}")]
    Validation(String),

    /// Invariants for financial safety, such as insufficient balance.
    #[error("business rule violation: {0}")]
    BusinessRule(String),

    /// JSON serialization/deserialization errors.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    pub fn validation<T: Into<String>>(msg: T) -> Self {
        AppError::Validation(msg.into())
    }

    pub fn business<T: Into<String>>(msg: T) -> Self {
        AppError::BusinessRule(msg.into())
    }

    pub fn database<T: Into<String>>(msg: T) -> Self {
        AppError::Validation(msg.into())
    }
}

