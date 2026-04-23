//! Re-export of security metadata (salt) persistence helpers.
//!
//! The backing implementation lives in `crate::security::store`, but the
//! `db` module exposes it here so callers can treat all DB-related
//! concerns as part of a single namespace.

pub use crate::security::store::*;

