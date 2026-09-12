//! Auth sketch — Electron `src/main/auth.ts` port target (Phase 6).
//!
//! Phase 1–2: compiling types + PKCE helpers only. No BrowserWindow / OAuth HTTP yet.
//! Electron remains production for `signInWithGoogleAccount` / AccountChooser.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::store::{AuthProvider, GoogleOAuthConfig, UserSession};

/// Default OAuth redirect / loopback sketch (not bound yet).
pub const OAUTH_LOOPBACK_HOST: &str = "127.0.0.1";

/// Sketch of a Google PKCE sign-in request (no network).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PkceChallenge {
    pub code_verifier: String,
    pub code_challenge: String,
    /// Always `S256` for this sketch.
    pub code_challenge_method: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthIdentity {
    pub email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("oauth not wired in Phase 1 stub: {0}")]
    NotWired(String),
    #[error("invalid identity: {0}")]
    InvalidIdentity(String),
}

/// Build a deterministic PKCE sketch from opaque seeds (tests / docs — not crypto-secure).
/// Production must use OS CSPRNG (`randomBytes` twin).
pub fn pkce_challenge_from_seeds(verifier_seed: &str, state_seed: &str) -> PkceChallenge {
    let code_verifier = b64url_lite(verifier_seed.as_bytes());
    let code_challenge = b64url_lite(&simple_sha256_stub(code_verifier.as_bytes()));
    PkceChallenge {
        code_verifier,
        code_challenge,
        code_challenge_method: "S256".into(),
        state: b64url_lite(state_seed.as_bytes()),
    }
}

/// Map a scraped identity into a [`UserSession`] (store twin).
pub fn session_from_identity(id: &AuthIdentity, signed_in_at: i64) -> Result<UserSession, AuthError> {
    let email = id.email.trim().to_lowercase();
    if !email.contains('@') || email.len() < 5 {
        return Err(AuthError::InvalidIdentity(email));
    }
    Ok(UserSession {
        email,
        name: id
            .name
            .clone()
            .unwrap_or_else(|| "Google".into()),
        picture: id.picture.clone(),
        provider: AuthProvider::Google,
        signed_in_at,
    })
}

/// Stub entry: documents the Electron flow; always errors until host owns OAuth.
pub fn sign_in_with_google_stub(_cfg: &GoogleOAuthConfig) -> Result<UserSession, AuthError> {
    Err(AuthError::NotWired(
        "use Electron auth.ts until pq-work owns BrowserWindow + PKCE callback".into(),
    ))
}

fn b64url_lite(bytes: &[u8]) -> String {
    // Minimal url-safe base64 without padding (not a full encoder — fine for sketch/tests).
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i] as u32;
        let b1 = if i + 1 < bytes.len() {
            bytes[i + 1] as u32
        } else {
            0
        };
        let b2 = if i + 2 < bytes.len() {
            bytes[i + 2] as u32
        } else {
            0
        };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((triple >> 18) & 63) as usize] as char);
        out.push(T[((triple >> 12) & 63) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(T[((triple >> 6) & 63) as usize] as char);
        }
        if i + 2 < bytes.len() {
            out.push(T[(triple & 63) as usize] as char);
        }
        i += 3;
    }
    out
}

/// Not real SHA-256 — placeholder so PKCE types compile without a crypto crate.
fn simple_sha256_stub(input: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, b) in input.iter().enumerate() {
        out[i % 32] ^= b.wrapping_add(i as u8);
        out[(i * 7) % 32] = out[(i * 7) % 32].wrapping_add(b.rotate_left(1));
    }
    out[0] ^= input.len() as u8;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_sketch_is_s256() {
        let p = pkce_challenge_from_seeds("verifier-seed", "state-seed");
        assert_eq!(p.code_challenge_method, "S256");
        assert!(!p.code_verifier.is_empty());
        assert!(!p.code_challenge.is_empty());
        assert!(!p.state.is_empty());
    }

    #[test]
    fn session_from_identity_ok() {
        let id = AuthIdentity {
            email: "User@Example.com".into(),
            name: Some("Ada".into()),
            picture: None,
        };
        let s = session_from_identity(&id, 1_700_000_000).unwrap();
        assert_eq!(s.email, "user@example.com");
        assert_eq!(s.provider, AuthProvider::Google);
    }

    #[test]
    fn google_stub_not_wired() {
        let err = sign_in_with_google_stub(&GoogleOAuthConfig::default()).unwrap_err();
        assert!(matches!(err, AuthError::NotWired(_)));
    }
}
