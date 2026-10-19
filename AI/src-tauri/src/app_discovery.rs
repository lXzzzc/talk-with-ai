use crate::app_catalog::{merge_entries, stable_id, CatalogEntry, LaunchKind};
use std::{
    env,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
use winreg::{
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY},
    RegKey,
};

const MAX_DISCOVERED_FILES: usize = 5_000;

pub(crate) fn discover_applications() -> Vec<CatalogEntry> {
    let mut entries = Vec::new();
    entries.extend(system_applications());
    entries.extend(start_menu_applications());
    entries.extend(registry_applications());
    merge_entries(entries)
}

pub(crate) fn discover_path_application(query: &str) -> Vec<CatalogEntry> {
    let executable_name = query.trim().trim_end_matches(".exe");
    if executable_name.is_empty()
        || executable_name.len() > 100
        || !executable_name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        || is_blocked_path_executable(executable_name)
    {
        return Vec::new();
    }

    let Some(path) = env::var_os("PATH") else {
        return Vec::new();
    };
    let file_name = format!("{executable_name}.exe");
    env::split_paths(&path)
        .filter_map(|directory| {
            let path = directory.join(&file_name);
            if !path.is_file() || !is_gui_executable(&path) {
                return None;
            }
            let target = path.to_string_lossy().into_owned();
            Some(entry(
                executable_name,
                vec![executable_name.to_string(), file_name.clone()],
                LaunchKind::Executable,
                target,
                "path",
            ))
        })
        .collect()
}

fn entry(
    name: impl Into<String>,
    aliases: Vec<String>,
    launch_kind: LaunchKind,
    launch_target: String,
    source: &str,
) -> CatalogEntry {
    CatalogEntry {
        id: stable_id(&launch_target),
        name: name.into(),
        aliases,
        launch_kind,
        launch_target,
        source: source.to_string(),
    }
}

fn system_applications() -> Vec<CatalogEntry> {
    let mut entries = Vec::new();
    let Some(windows_root) = env::var_os("SystemRoot").or_else(|| env::var_os("WINDIR")) else {
        return entries;
    };
    let system32 = PathBuf::from(windows_root).join("System32");
    let applications = [
        ("记事本", "notepad.exe", &["记事本", "notepad"][..]),
        ("计算器", "calc.exe", &["计算器", "calc", "calculator"][..]),
        (
            "文件资源管理器",
            "explorer.exe",
            &["文件资源管理器", "资源管理器", "文件管理器", "explorer"][..],
        ),
        (
            "画图",
            "mspaint.exe",
            &["画图", "画图工具", "mspaint", "paint"][..],
        ),
        (
            "任务管理器",
            "taskmgr.exe",
            &["任务管理器", "taskmgr", "task manager"][..],
        ),
    ];

    for (name, executable, aliases) in applications {
        let path = system32.join(executable);
        if path.is_file() {
            let target = path.to_string_lossy().into_owned();
            entries.push(entry(
                name,
                aliases.iter().map(|value| (*value).to_string()).collect(),
                LaunchKind::Executable,
                target,
                "system",
            ));
        }
    }

    entries.push(entry(
        "Windows 设置",
        vec![
            "设置".to_string(),
            "系统设置".to_string(),
            "Windows 设置".to_string(),
            "settings".to_string(),
        ],
        LaunchKind::Uri,
        "ms-settings:".to_string(),
        "system",
    ));
    entries
}

fn start_menu_applications() -> Vec<CatalogEntry> {
    let mut roots = Vec::new();
    if let Some(program_data) = env::var_os("ProgramData") {
        roots.push(PathBuf::from(program_data).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    if let Some(app_data) = env::var_os("APPDATA") {
        roots.push(PathBuf::from(app_data).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }

    let mut entries = Vec::new();
    let mut discovered = 0;
    for root in roots {
        collect_shortcuts(&root, 0, &mut discovered, &mut entries);
        if discovered >= MAX_DISCOVERED_FILES {
            break;
        }
    }
    entries
}

fn collect_shortcuts(
    directory: &Path,
    depth: usize,
    discovered: &mut usize,
    entries: &mut Vec<CatalogEntry>,
) {
    if depth > 8 || *discovered >= MAX_DISCOVERED_FILES {
        return;
    }
    let Ok(children) = fs::read_dir(directory) else {
        return;
    };

    for child in children.flatten() {
        if *discovered >= MAX_DISCOVERED_FILES {
            break;
        }
        let path = child.path();
        if path.is_dir() {
            collect_shortcuts(&path, depth + 1, discovered, entries);
            continue;
        }
        if !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
        {
            continue;
        }

        *discovered += 1;
        let name = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        if name.is_empty() || is_maintenance_entry(&name) {
            continue;
        }
        let target = path.to_string_lossy().into_owned();
        entries.push(entry(
            name.clone(),
            vec![name],
            LaunchKind::Shortcut,
            target,
            "start_menu",
        ));
    }
}

fn is_maintenance_entry(name: &str) -> bool {
    let normalized = name.to_lowercase();
    [
        "uninstall",
        "卸载",
        "remove",
        "readme",
        "帮助",
        "help",
        "documentation",
        "update",
        "更新程序",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

fn registry_applications() -> Vec<CatalogEntry> {
    let mut entries = Vec::new();
    let views = [KEY_READ | KEY_WOW64_64KEY, KEY_READ | KEY_WOW64_32KEY];
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let root = RegKey::predef(root);
        for flags in views {
            collect_app_paths(&root, flags, &mut entries);
            collect_uninstall_entries(&root, flags, &mut entries);
        }
    }
    entries
}

fn collect_app_paths(root: &RegKey, flags: u32, entries: &mut Vec<CatalogEntry>) {
    let Ok(app_paths) = root.open_subkey_with_flags(
        "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths",
        flags,
    ) else {
        return;
    };
    for key_name in app_paths.enum_keys().flatten() {
        let Ok(key) = app_paths.open_subkey_with_flags(&key_name, flags) else {
            continue;
        };
        let Ok(raw_target) = key.get_value::<String, _>("") else {
            continue;
        };
        let target = expand_environment_variables(raw_target.trim().trim_matches('"'));
        if !Path::new(&target).is_file() {
            continue;
        }
        let executable_name = Path::new(&target)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_else(|| key_name.trim_end_matches(".exe"))
            .to_string();
        entries.push(entry(
            executable_name.clone(),
            vec![
                executable_name,
                key_name.trim_end_matches(".exe").to_string(),
            ],
            LaunchKind::Executable,
            target,
            "registry",
        ));
    }
}

fn collect_uninstall_entries(root: &RegKey, flags: u32, entries: &mut Vec<CatalogEntry>) {
    let Ok(uninstall) = root.open_subkey_with_flags(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        flags,
    ) else {
        return;
    };
    for key_name in uninstall.enum_keys().flatten() {
        let Ok(key) = uninstall.open_subkey_with_flags(&key_name, flags) else {
            continue;
        };
        let Ok(display_name) = key.get_value::<String, _>("DisplayName") else {
            continue;
        };
        let Ok(display_icon) = key.get_value::<String, _>("DisplayIcon") else {
            continue;
        };
        let Some(target) = executable_from_display_icon(&display_icon) else {
            continue;
        };
        if !Path::new(&target).is_file() || is_maintenance_entry(&display_name) {
            continue;
        }
        let executable_name = Path::new(&target)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        entries.push(entry(
            display_name.clone(),
            vec![display_name, executable_name],
            LaunchKind::Executable,
            target,
            "registry",
        ));
    }
}

fn executable_from_display_icon(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let raw_path = if let Some(without_quote) = trimmed.strip_prefix('"') {
        without_quote.split('"').next().unwrap_or_default()
    } else {
        let lowercase = trimmed.to_lowercase();
        let end = lowercase.find(".exe")? + 4;
        &trimmed[..end]
    };
    let expanded = expand_environment_variables(raw_path.trim());
    (!expanded.is_empty()).then_some(expanded)
}

fn expand_environment_variables(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut remainder = value;
    while let Some(start) = remainder.find('%') {
        result.push_str(&remainder[..start]);
        let after_start = &remainder[start + 1..];
        let Some(end) = after_start.find('%') else {
            result.push_str(&remainder[start..]);
            return result;
        };
        let variable = &after_start[..end];
        if let Ok(replacement) = env::var(variable) {
            result.push_str(&replacement);
        } else {
            result.push('%');
            result.push_str(variable);
            result.push('%');
        }
        remainder = &after_start[end + 1..];
    }
    result.push_str(remainder);
    result
}

fn is_blocked_path_executable(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "cmd"
            | "powershell"
            | "pwsh"
            | "reg"
            | "regedit"
            | "rundll32"
            | "mshta"
            | "wscript"
            | "cscript"
            | "taskkill"
            | "shutdown"
            | "diskpart"
            | "format"
            | "bcdedit"
    )
}

fn is_gui_executable(path: &Path) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut dos_header = [0_u8; 64];
    if file.read_exact(&mut dos_header).is_err() || &dos_header[..2] != b"MZ" {
        return false;
    }
    let pe_offset = u32::from_le_bytes(dos_header[60..64].try_into().unwrap()) as u64;
    if file.seek(SeekFrom::Start(pe_offset)).is_err() {
        return false;
    }
    let mut pe_header = [0_u8; 96];
    if file.read_exact(&mut pe_header).is_err() || &pe_header[..4] != b"PE\0\0" {
        return false;
    }
    // PE32 与 PE32+ 的 Subsystem 字段都位于可选头起始位置后 68 字节。
    u16::from_le_bytes([pe_header[92], pe_header[93]]) == 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_and_indexed_display_icons() {
        assert_eq!(
            executable_from_display_icon("\"C:\\Program Files\\Demo\\demo.exe\",0"),
            Some("C:\\Program Files\\Demo\\demo.exe".to_string())
        );
        assert_eq!(
            executable_from_display_icon("C:\\Demo\\demo.exe,1"),
            Some("C:\\Demo\\demo.exe".to_string())
        );
    }

    #[test]
    fn blocks_command_interpreters_from_path_discovery() {
        assert!(is_blocked_path_executable("powershell"));
        assert!(is_blocked_path_executable("CMD"));
        assert!(!is_blocked_path_executable("Code"));
    }
}
