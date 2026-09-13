use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, WebviewWindowBuilder};

use crate::shared::{GoogleOAuthConfig, UserSession, millis};

fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_pair() -> (String, String) {
    let mut rng = rand::thread_rng();
    let verifier: Vec<u8> = (0..64).map(|_| rng.gen_range(b'A'..=b'Z')).collect();
    let verifier = String::from_utf8(verifier).unwrap();
    let digest = Sha256::digest(verifier.as_bytes());
    (verifier, b64url(&digest))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAuthParams {
    pub provider_id: String,
    pub client_id: Option<String>,
    pub scopes: Vec<String>,
    pub hint: Option<String>,
}

pub struct AuthManager {
    pub app: AppHandle,
    pub cfg: std::sync::Mutex<GoogleOAuthConfig>,
}

impl AuthManager {
    pub fn new(app: AppHandle, cfg: GoogleOAuthConfig) -> Self {
        AuthManager { app, cfg: std::sync::Mutex::new(cfg) }
    }

    pub fn set_config(&self, cfg: GoogleOAuthConfig) {
        *self.cfg.lock().unwrap() = cfg;
    }

    pub fn get_config(&self) -> GoogleOAuthConfig {
        self.cfg.lock().unwrap().clone()
    }

    fn auth_url(&self, params: &GoogleAuthParams) -> String {
        let cfg = self.cfg.lock().unwrap();
        let client_id = params
            .client_id
            .clone()
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| cfg.client_id.clone());
        let (verifier, challenge) = pkce_pair();
        let _ = verifier;
        let mut u = format!(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id={client_id}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope={}",
            params.scopes.join("+")
        );
        u.push_str(&format!("&code_challenge={challenge}&code_challenge_method=S256&access_type=offline&include_granted_scopes=true"));
        if let Some(h) = &params.hint {
            u.push_str(&format!("&login_hint={}", urlencode(h)));
            u.push_str("&prompt=select_account");
        }
        u
    }

    /// open popup, poll `document.title` for a `__pq__` prefix payload
    async fn popup_and_poll(&self, url: &str, init_script: &str, timeout_ms: u64) -> Result<String, String> {
        let label = format!("pq-oauth-{}", millis());
        let parsed_url = tauri::Url::parse(url).map_err(|e| e.to_string())?;
        let popup = WebviewWindowBuilder::new(
            &self.app,
            &label,
            tauri::WebviewUrl::External(parsed_url),
        )
        .title("Sign in with Google")
        .inner_size(460.0, 620.0)
        .initialization_script(init_script)
        .build()
        .map_err(|e| e.to_string())?;

        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        let mut seen_title = String::new();
        while std::time::Instant::now() < deadline {
            // WebviewWindow can be closed by the user
            match popup.title() {
                Ok(t) => seen_title = t.to_string(),
                Err(_) => {
                    return Err("window closed".into());
                }
            }
            if seen_title.starts_with("__pq__") {
                let payload = seen_title.trim_start_matches("__pq__").to_string();
                let _ = popup.close();
                return Ok(payload);
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        let _ = popup.close();
        Err("timed out".into())
    }

    /// fetch the AccountChooser identity list (no clientId needed)
    pub async fn list_accounts(&self, hint: Option<&str>) -> Result<Vec<String>, String> {
        let mut url = "https://accounts.google.com/ListAccounts".to_string();
        if let Some(h) = hint {
            url.push_str(&format!("?hl={}", urlencode(h)));
        }
        let script = r#"
(function(){
  function grab(){
    var emails=[];
    try{
      var gaia=window.gaia_odos||window.gaia_odcl||{};
      for(var k in gaia){ emails.push(k); }
    }catch(e){}
    if(!emails.length){
      var boxes=document.querySelectorAll('ul.KaVR3d li div');
      for(var i=0;i<boxes.length;i++){ emails.push(boxes[i].innerText.trim()); }
    }
    document.title="__pq__"+JSON.stringify({emails:emails});
  }
  if(document.readyState==="complete"){ grab(); } else { window.addEventListener("load",grab); }
  setTimeout(grab,3000);
})();
"#;
        let payload = self.popup_and_poll(&url, script, 30_000).await?;
        let json = serde_json::from_str::<serde_json::Value>(&payload).unwrap_or_default();
        let emails = json
            .get("emails")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();
        Ok(emails)
    }

    /// full OAuth code flow; returns whatever the popup captured
    pub async fn oauth_flow(&self, params: &GoogleAuthParams) -> Result<serde_json::Value, String> {
        let url = self.auth_url(params);
        let script = r#"
(function(){
  function grab(){
    var href=location.href;
    var code=null;
    try{ var m=href.match(/[?&]code=([^&]+)/); if(m){ code=m[1]; } }catch(e){}
    var err=null;
    try{ var e=href.match(/[?&]error=([^&]+)/); if(e){ err=e[1]; } }catch(e2){}
    if(code||err){
      document.title="__pq__"+JSON.stringify({code:code,error:err,url:href});
    }
  }
  if(document.readyState==="complete"){ grab(); } else { window.addEventListener("load",grab); }
  setInterval(grab,500);
})();
"#;
        let payload = self.popup_and_poll(&url, script, 10 * 60 * 1000).await?;
        Ok(serde_json::from_str(&payload).unwrap_or_default())
    }
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// build a fresh UserSession placeholder (renderer fills the rest)
#[allow(dead_code)]
pub fn blank_session(email: &str) -> UserSession {
    UserSession {
        email: email.to_string(),
        name: email.to_string(),
        picture: None,
        provider: crate::shared::AuthProvider::Google,
        signed_in_at: millis(),
    }
}