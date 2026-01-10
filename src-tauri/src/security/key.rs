use ring::pbkdf2;
use rand::RngCore;
use std::num::NonZeroU32;

const ITERATIONS: u32 = 600_000;
const KEY_LEN: usize = 32;

pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

pub fn derive_key(pin: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(ITERATIONS).unwrap(),
        salt,
        pin.as_bytes(),
        &mut key,
    );
    key
}
use ring::digest;

pub fn key_verifier(key: &[u8]) -> String {
    let hash = digest::digest(&digest::SHA256, key);
    hex::encode(hash)
}
