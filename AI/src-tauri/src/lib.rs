use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{PermissionKind, PermissionResponse},
    Manager, WindowEvent,
};

mod app_catalog;
mod app_discovery;
mod app_launcher;
mod screen_capture;

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
async fn open_voice_call(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    if conversation_id.is_empty()
        || conversation_id.len() > 128
        || !conversation_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("无效的通话会话".into());
    }
    if let Some(window) = app.get_webview_window("voice-call") {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "voice-call",
        tauri::WebviewUrl::App(
            format!("index.html?view=voice-call&conversationId={conversation_id}").into(),
        ),
    )
    .title("与昔涟通话")
    .inner_size(345.0, 595.0)
    .min_inner_size(320.0, 520.0)
    .center()
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .on_permission_request(|webview, kind| {
            if (webview.label() == "main" || webview.label() == "voice-call")
                && kind == PermissionKind::Microphone
            {
                PermissionResponse::Allow
            } else {
                PermissionResponse::Default
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_launcher::open_application,
            app_catalog::list_installed_applications,
            app_catalog::refresh_application_catalog,
            app_catalog::search_applications,
            app_catalog::register_application,
            screen_capture::capture_active_window,
            open_voice_call
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .expect("application icon missing")
                        .clone(),
                )
                .tooltip("昔涟 AI")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 通话窗口关闭必须销毁 WebView，确保麦克风与连接随窗口释放。
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Talk with AI desktop client");
}
