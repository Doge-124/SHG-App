//! Input validation helpers for financial operations.
//!
//! All user-controlled inputs that affect persistence must pass through
//! these helpers before any write is performed.

use crate::error::AppError;

/// Validate that a member code is syntactically valid.
pub fn validate_member_code(code: &str) -> Result<(), AppError> {
    if code.trim().is_empty() {
        return Err(AppError::validation("member_code must not be empty"));
    }
    Ok(())
}

/// Validate that a member name is present and non-whitespace.
pub fn validate_member_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::validation("member name must not be empty"));
    }
    Ok(())
}

/// Validate a money amount (must be strictly positive and finite).
pub fn validate_money_amount(amount: f64) -> Result<(), AppError> {
    if !amount.is_finite() || amount <= 0.0 {
        return Err(AppError::validation("amount must be > 0 and finite"));
    }
    Ok(())
}

/// Validate supported payment methods.
pub fn validate_payment_method(method: &str) -> Result<(), AppError> {
    match method {
        "CASH" | "BANK" => Ok(()),
        _ => Err(AppError::validation(
            "payment_method must be either 'CASH' or 'BANK'",
        )),
    }
}

/// Validate chit parameters before creating a group.
pub fn validate_chit_parameters(total_amount: f64, months: i64) -> Result<(), AppError> {
    if months <= 1 {
        return Err(AppError::validation("chit months must be > 1"));
    }
    if !total_amount.is_finite() || total_amount <= 0.0 {
        return Err(AppError::validation(
            "chit total_amount must be a positive finite value",
        ));
    }
    // Divisibility check with paisa-level tolerance. f64::EPSILON (~2e-16) is
    // far too tight at the magnitudes we work with — 100000/12 fails it even
    // though the chit is operationally fine.
    let monthly = total_amount / months as f64;
    let rounded = (monthly * 100.0).round() / 100.0;
    if (monthly - rounded).abs() > 0.005 {
        return Err(AppError::validation(
            "chit total_amount must divide into whole paise per month",
        ));
    }
    Ok(())
}


