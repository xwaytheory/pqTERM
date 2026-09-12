//! Auth sketch — Electron `src/main/auth.ts` port target (Phase 6).
//!
//! Phase 1–2: Electron-parity types + PKCE/URL helpers only. No BrowserWindow / OAuth HTTP yet.
//! Electron remains production for `signInWithGoogleAccount` / AccountChooser.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::store::{AuthProvider, GoogleOAuthConfig, UserSession};

/// Default OAuth redirect / loopback sketch (not bound yet).
pub const OAUTH_LOOPBACK_HOST: &str = "127.0.0.1";


/// OAuth authorize endpoint (Google).
pub const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
/// Token endpoint.
pub const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// OpenID userinfo endpoint.
pub const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
/// AccountChooser fallback when no client_id (Electron `signInWithGoogleAccount`).
pub const ACCOUNT_CHOOSER_URL: &str =
    "https://accounts.google.com/AccountChooser?hl=pl&continue=https%3A%2F%2Fmyaccount.google.com%2F";
/// Loopback callback path twin of Electron `pickPort` server.
pub const OAUTH_CALLBACK_PATH: &str = "/callback";
/// Space-joined scopes used by Electron PKCE flow.
pub const OAUTH_SCOPES: &str = "openid email profile";

/// Parameters for building the Google authorize URL (no network).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthAuthorizeParams {
    pub client_id: String,
    pub redirect_uri: String,
    pub code_challenge: String,
    pub code_challenge_method: String,
    pub scope: String,
    pub access_type: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

impl OAuthAuthorizeParams {
    pub fn from_pkce(
        client_id: impl Into<String>,
        redirect_uri: impl Into<String>,
        pkce: &PkceChallenge,
    ) -> Self {
        Self {
            client_id: client_id.into(),
            redirect_uri: redirect_uri.into(),
            code_challenge: pkce.code_challenge.clone(),
            code_challenge_method: pkce.code_challenge_method.clone(),
            scope: OAUTH_SCOPES.into(),
            access_type: "offline".into(),
            prompt: "select_account".into(),
            state: Some(pkce.state.clone()),
        }
    }
}

/// Token exchange body sketch (Electron `URLSearchParams` to token endpoint).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenExchange {
    pub client_id: String,
    pub code: String,
    pub code_verifier: String,
    pub grant_type: String,
    pub redirect_uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
}

impl OAuthTokenExchange {
    pub fn authorization_code(
        client_id: impl Into<String>,
        code: impl Into<String>,
        code_verifier: impl Into<String>,
        redirect_uri: impl Into<String>,
        client_secret: Option<String>,
    ) -> Self {
        Self {
            client_id: client_id.into(),
            code: code.into(),
            code_verifier: code_verifier.into(),
            grant_type: "authorization_code".into(),
            redirect_uri: redirect_uri.into(),
            client_secret,
        }
    }
}

/// Google userinfo JSON subset (Electron `oauth2/v3/userinfo`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleUserInfo {
    #[serde(default)]
    pub email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email_verified: Option<bool>,
}

/// Build authorize URL query (parity with Electron `signInWithGoogleOAuth` URL assembly).
pub fn build_authorize_url(p: &OAuthAuthorizeParams) -> String {
    let mut parts: Vec<String> = vec![
        format!("client_id={}", urlencode_lite(&p.client_id)),
        format!("redirect_uri={}", urlencode_lite(&p.redirect_uri)),
        "response_type=code".into(),
        format!("scope={}", urlencode_lite(&p.scope)),
        format!("code_challenge={}", urlencode_lite(&p.code_challenge)),
        format!(
            "code_challenge_method={}",
            urlencode_lite(&p.code_challenge_method)
        ),
        format!("access_type={}", urlencode_lite(&p.access_type)),
        format!("prompt={}", urlencode_lite(&p.prompt)),
    ];
    if let Some(state) = &p.state {
        parts.push(format!("state={}", urlencode_lite(state)));
    }
    format!("{GOOGLE_AUTH_URL}?{}", parts.join("&"))
}

/// Twin of Electron `isChooserUrl` — true while still on Google chooser / challenge pages.
/// Unparseable URLs return `true` (same as Electron `catch`).
pub fn is_chooser_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    let after_scheme = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"));
    let Some(rest) = after_scheme else {
        return true;
    };
    let host_path = rest.split('#').next().unwrap_or(rest);
    let (host, path_q) = match host_path.split_once('/') {
        Some((h, p)) => (h, p),
        None => (host_path, ""),
    };
    if host != "accounts.google.com" {
        return false;
    }
    let hay = path_q.to_string();
    const MARKERS: &[&str] = &[
        "accountchooser",
        "signin",
        "servicelogin",
        "identifier",
        "challenge",
        "rejected",
        "speedbump",
        "webauthn",
        "lifecycle",
        "recovery",
        "info/sessionid",
    ];
    MARKERS.iter().any(|m| hay.contains(m))
}

fn urlencode_lite(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}


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

    #[test]
    fn authorize_url_contains_pkce() {
        let pkce = pkce_challenge_from_seeds("v", "s");
        let p = OAuthAuthorizeParams::from_pkce(
            "client.apps.googleusercontent.com",
            "http://127.0.0.1:9/callback",
            &pkce,
        );
        let url = build_authorize_url(&p);
        assert!(url.starts_with(GOOGLE_AUTH_URL));
        assert!(url.contains("code_challenge="));
        assert!(url.contains("S256"));
        assert!(url.contains("openid"));
    }

    #[test]
    fn chooser_url_parity() {
        assert!(is_chooser_url(
            "https://accounts.google.com/AccountChooser?hl=pl"
        ));
        assert!(is_chooser_url("https://accounts.google.com/signin/v2"));
        assert!(!is_chooser_url("https://myaccount.google.com/"));
        assert!(is_chooser_url("not-a-url"));
    }

    #[test]
    fn userinfo_serde() {
        let raw = r#"{"email":"a@b.co","name":"A","email_verified":true}"#;
        let u: GoogleUserInfo = serde_json::from_str(raw).unwrap();
        assert_eq!(u.email, "a@b.co");
        assert_eq!(u.email_verified, Some(true));
    }

    #[test]
    fn token_exchange_shape() {
        let t = OAuthTokenExchange::authorization_code(
            "cid",
            "code",
            "verifier",
            "http://127.0.0.1:1/callback",
            None,
        );
        assert_eq!(t.grant_type, "authorization_code");
        let raw = serde_json::to_string(&t).unwrap();
        assert!(raw.contains("codeVerifier") || raw.contains("code_verifier") || raw.contains("code"));
    }
}
