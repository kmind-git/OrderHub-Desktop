mod commands;
mod config;
mod crypto;
mod decimal;
mod diagnostics;
mod dto;
mod error;
mod grpc;
mod requests;
mod session;
mod state;
mod storage;
mod update;
mod validation;

use crate::config::{load_config, locate_config_dir};
use crate::diagnostics::DiagnosticStore;
use crate::dto::{AppInfo, ErrorCategory, IpcError};
use crate::requests::RequestStore;
use crate::state::AppState;
use crate::update::UpdateManager;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Mutex, RwLock};
use tauri::Manager;

fn app_info(app: &tauri::AppHandle) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        profile: if cfg!(debug_assertions) {
            "debug".into()
        } else {
            "release".into()
        },
        demo_mode: false,
    }
}

/// Resolve the local data directory without requiring an `AppHandle`.
///
/// This must be available before Tauri creates the first window because
/// WebView2 needs a writable user-data directory at that point. On this
/// Windows profile the implicit directory under `%LOCALAPPDATA%` was missing
/// and WebView2 failed with `0x8000FFFF`/access denied; creating it and
/// pointing `WEBVIEW2_USER_DATA_FOLDER` at it fixes window creation.
pub fn resolved_data_dir() -> PathBuf {
    if let Ok(explicit) = std::env::var("ORDERHUB_DATA_DIR") {
        let path = PathBuf::from(explicit);
        if path.is_absolute() {
            return path;
        }
        if let Ok(cwd) = std::env::current_dir() {
            return cwd.join(path);
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local).join("com.orderhub.desktop");
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("orderhub-desktop-data")
}

/// Create the WebView2 user-data directory and pin it before any window is
/// created. Must run from `main` before `run()`.
pub fn prepare_webview_data_dir() {
    let data_dir = resolved_data_dir();
    let webview_dir = data_dir.join("webview2");
    if let Err(error) = std::fs::create_dir_all(&webview_dir) {
        eprintln!(
            "orderhub: failed to create WebView2 data directory {}: {error}",
            webview_dir.display()
        );
        return;
    }
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let config_dir = locate_config_dir();
            let loaded = load_config(config_dir.clone());
            let data_dir = resolved_data_dir();
            std::fs::create_dir_all(&data_dir).map_err(|error| {
                std::io::Error::other(format!(
                    "create data dir {} failed: {error}",
                    data_dir.display()
                ))
            })?;
            if std::env::var("ORDERHUB_SKIP_ACL").is_err() {
                if let Err(error) = storage::harden_directory_acl(&data_dir) {
                    eprintln!("orderhub: data directory ACL hardening skipped: {error}");
                }
            }
            let installation_id =
                storage::load_or_create_installation_id(&data_dir).map_err(|error| {
                    std::io::Error::other(format!("installation id failed: {error}"))
                })?;
            let version = app.package_info().version.to_string();
            let requests = RequestStore::open(&data_dir)
                .map_err(|error| std::io::Error::other(format!("request store failed: {error}")))?;
            let diagnostics = DiagnosticStore::new();
            for error in requests.load_errors() {
                diagnostics.record(&IpcError::new(
                    ErrorCategory::Storage,
                    "REQUEST_RECORD_LOAD_FAILED",
                    error,
                ));
            }
            let update = UpdateManager::new(
                data_dir.clone(),
                installation_id,
                version,
                loaded.update.clone(),
            );
            let info = app_info(app.handle());
            let state = AppState {
                config_dir,
                data_dir,
                config: RwLock::new(loaded),
                session: Mutex::new(None),
                generation: AtomicU64::new(0),
                requests,
                update,
                diagnostics,
                app_info: info,
                maintenance: AtomicBool::new(false),
                write_gate: tokio::sync::RwLock::new(()),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap_state,
            commands::get_config_summary,
            commands::reload_config,
            commands::connect,
            commands::disconnect,
            commands::ack_checkpoint,
            commands::lookup_order,
            commands::submit_order,
            commands::cancel_order,
            commands::lookup_session_request,
            commands::list_requests,
            commands::check_update,
            commands::download_update,
            commands::install_update,
            commands::get_update_state,
            commands::confirm_startup,
            commands::get_diagnostics,
            commands::export_diagnostics,
            commands::get_app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OrderHub Desktop");
}
