use rand::RngCore;

use crate::error::AppError;

const KEY_LEN: usize = 32;

/// Generate a cryptographically strong random salt for Argon2.
pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

/// XOR two equal-length byte arrays.
pub fn xor_keys(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = a[i] ^ b[i];
    }
    out
}

/// Derive a SQLCipher key using Argon2id from the user PIN and salt.
///
/// The derived key is never persisted; only the salt is stored in `security.json`.
pub fn derive_key(pin: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], AppError> {
    use argon2::Argon2;
    use argon2::password_hash::SaltString;

    let argon2 = Argon2::default();

    let salt_string = SaltString::encode_b64(salt)
        .map_err(|e| AppError::Crypto(format!("failed to encode salt: {e}")))?;

    let mut key = [0u8; KEY_LEN];

    // Derive into the key buffer directly so we don't need to keep the PHC string.
    argon2
        .hash_password_into(pin.as_bytes(), salt_string.as_str().as_bytes(), &mut key)
        .map_err(|e| AppError::Crypto(format!("argon2 derivation failed: {e}")))?;

    Ok(key)
}
