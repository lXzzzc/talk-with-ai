use crate::app_catalog::{load_catalog, LaunchKind};
use std::{ffi::OsStr, iter, os::windows::ffi::OsStrExt, process::Command};
use tauri::AppHandle;
use windows_sys::Win32::{UI::Shell::ShellExecuteW, UI::WindowsAndMessaging::SW_SHOWNORMAL};

#[tauri::command]
pub fn open_application(app: AppHandle, application: String) -> Result<String, String> {
    let applications = load_catalog(&app)?;
    let target = applications
        .iter()
        .find(|candidate| candidate.id == application)
        .ok_or_else(|| "该软件不在本机软件目录中，请重新扫描或手动选择".to_string())?;

    match target.launch_kind {
        LaunchKind::Executable => {
            Command::new(&target.launch_target)
                .spawn()
                .map_err(|error| format!("无法打开{}：{}", target.name, error))?;
        }
        LaunchKind::Shortcut | LaunchKind::Uri => {
            shell_open(&target.launch_target)
                .map_err(|error| format!("无法打开{}：{}", target.name, error))?;
        }
    }

    Ok(format!("已打开{}", target.name))
}

fn shell_open(target: &str) -> Result<(), String> {
    let operation = wide("open");
    let target = wide(target);
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err(format!("Windows Shell 返回错误代码 {}", result as isize));
    }
    Ok(())
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(iter::once(0))
        .collect()
}
