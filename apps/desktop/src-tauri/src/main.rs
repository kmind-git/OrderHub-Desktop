#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Must happen before Tauri creates the first WebView2 window.
    orderhub_desktop_lib::prepare_webview_data_dir();
    orderhub_desktop_lib::run();
}
