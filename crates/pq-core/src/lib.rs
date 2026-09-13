//! Shared library for pq Rust migration (Phase 1-2).
//!
//! STT **intent** (desktop Rust / pq-voice): OpenAI Whisper Large v3 for Polish.
//! Model id: `openai/whisper-large-v3` (HF); local GGML: `ggml-large-v3.bin`.
//! This is a product **intent**, not a runtime lock — Electron production still uses
//! `Xenova/whisper-tiny` in `src/renderer/src/lib/voiceCommander.ts` via
//! `@huggingface/transformers`. Large v3 applies when the voice path is ported.
//! Android phone: system SpeechRecognizer only (see docs/ANDROID-STT.md).

pub mod auth;
pub mod board;
pub mod engines;
pub mod env;
pub mod ipc;
pub mod providers;
pub mod resolve_launch;
pub mod remote;
pub mod resume;
pub mod store;
pub mod stt;
pub mod trust;
pub mod sync;
pub mod updater;
pub mod usage;
pub mod version;

pub use auth::{
    build_authorize_url, is_chooser_url, pkce_challenge_from_seeds, session_from_identity,
    sign_in_with_google_stub, AuthError, AuthIdentity, GoogleUserInfo, OAuthAuthorizeParams,
    OAuthTokenExchange, PkceChallenge, ACCOUNT_CHOOSER_URL, GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL, OAUTH_CALLBACK_PATH, OAUTH_LOOPBACK_HOST, OAUTH_SCOPES,
};
pub use board::{
    board_md_path, board_path, compute_overlap_notes, empty_board, load_board, save_board,
    strip_ansi_basic, BoardHubStub, BoardNote, BoardPane, BoardRelation, BoardSnapshot,
    BOARD_MD_REL, BOARD_REL_PATH, FILE_STALE_MS,
};
pub use engines::{default_provider, merge_providers, spec_by_id, EngineSpec, ENGINE_SPECS};
pub use env::{
    appdata_roaming, prod_user_data_dir, product_name, running_dev, user_data_dir,
    user_data_dir_for,
};
pub use providers::{
    apply_email_match, auth_candidate_paths, emails_in, empty_probes, load_auth_texts_from_paths,
    merge_provider_probes, probe_auth_candidates, probe_from_auth_map, probe_from_auth_paths,
    probe_from_auth_texts, text_looks_authed, AuthFileReader, FsAuthReader, ProviderIoError,
    ProviderProbe,
};
pub use resolve_launch::{
    known_launch, known_launch_candidates, npm_dir, quote_arg, resolve_launch, sanitize_env_keys,
    yolo_env, FsExists, LaunchPlan, PathExists,
};
pub use ipc::{
    decode_line, encode_line, local_tcp_ipc_demo, named_pipe_loopback_demo, stub_loopback_demo,
    tcp_loopback_demo, voice_exe_candidates, Cancel, DuplexEndpoint, IpcError, IpcMessage, IpcSink,
    LocalTcpTransport, LocalWsTransport, MemoryChannelStub, NamedPipeTransport, StartListen, Status,
    StubVoiceServer, StubWorkClient, Transcript, Transport, VoiceHostSpawnPlan, VoiceIpcFlow,
    VoiceState, named_pipe_path, named_pipe_path_checked, sanitize_pipe_session_id, DEFAULT_TCP_ADDR,
    PIPE_NAME_PREFIX, PIPE_SESSION_ID_MAX, PROTOCOL_VERSION, VOICE_EXE_NAME,
};
pub use remote::{
    mime_for_ext, PairRateLimit, RemoteCommand, RemoteHubStub, RemoteInfo, RemotePersist,
    RemoteWsEvent, TunnelState, CLOUDFLARED_WINDOWS_AMD64_URL, DEFAULT_REMOTE_PORT,
};
pub use resume::{
    resume_flag, sessions_from_fixture, sessions_from_json, sessions_from_ndjson, sessions_from_path,
    sort_sessions_newest_first, write_sessions_to, ResumeCache, ResumeIoError, ResumeSlot, SessionRef,
};
pub use store::{
    empty_snapshot, exists_state, exists_state_at, load_state, load_state_from, save_state,
    save_state_to, state_path, state_path_in, touch_workspace, AppSnapshot, AuthProvider,
    GoogleOAuthConfig, ModelChoice, PaneState, ProviderInfo, StoreError, UserSession, Workspace,
};
pub use trust::{
    claude_already_trusted, claude_project_key, claude_trust_patch, codex_already_trusted,
    codex_trust_block, gemini_already_trusted, gemini_trust_key, grok_already_trusted,
    grok_trust_block, path_key, plan_trust_actions, trust_config_paths, trust_folder_set,
    unique_folders, TrustAction,
};
pub use sync::{order_sync_jobs, skip_sync_engine, sync_line, EngineSyncStub, SyncEvent};
pub use updater::{
    compare_semver, fetch_github_fixture, fetch_manifest, manifest_from_github_release,
    offer_from_manifest, CheckOnLaunchPlan, FileManifestFetch, GitHubReleaseAsset,
    GitHubReleaseFixture, ManifestFetch, MockManifestFetch, OfferUpdate, UpdateAsset,
    UpdateManifest, UpdaterError, STUB_REMOTE_LATEST,
};
pub use usage::{
    normalize_used_pct, offline_usage, window_label_hint, EngineUsage, UsageHubStub, UsageMap,
    UsageWindow,
};
pub use version::{PQ_CORE_VERSION, WORKSPACE_VERSION};
