//! Re-export of key-derivation helpers for the database layer.
//!
//! The actual implementation lives in `crate::security::key`, but the
//! `db` module exposes it here for a cohesive database API surface.

pub use crate::security::key::*;

