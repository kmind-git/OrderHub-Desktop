use crate::config::LoadedConfig;
use crate::diagnostics::DiagnosticStore;
use crate::dto::AppInfo;
use crate::requests::RequestStore;
use crate::session::SessionShared;
use crate::update::UpdateManager;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, RwLock};

pub struct AppState {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub config: RwLock<LoadedConfig>,
    pub session: Mutex<Option<Arc<SessionShared>>>,
    pub generation: AtomicU64,
    pub requests: RequestStore,
    pub update: UpdateManager,
    pub diagnostics: DiagnosticStore,
    pub app_info: AppInfo,
    pub maintenance: AtomicBool,
    /// Read guards are held by in-flight submit/cancel commands. Installing an
    /// update takes the write guard so no write is cut in half.
    pub write_gate: tokio::sync::RwLock<()>,
}
