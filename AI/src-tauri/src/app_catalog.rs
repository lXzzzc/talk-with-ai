use crate::app_discovery::{discover_applications, discover_path_application};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const CATALOG_VERSION: u32 = 1;
const MAX_QUERY_CHARS: usize = 100;
const MAX_RESULTS: usize = 8;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LaunchKind {
    Executable,
    Shortcut,
    Uri,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub launch_kind: LaunchKind,
    pub launch_target: String,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogFile {
    version: u32,
    generated_at: u64,
    applications: Vec<CatalogEntry>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationSummary {
    pub id: String,
    pub name: String,
    pub source: String,
}

impl From<&CatalogEntry> for ApplicationSummary {
    fn from(value: &CatalogEntry) -> Self {
        Self {
            id: value.id.clone(),
            name: value.name.clone(),
            source: value.source.clone(),
        }
    }
}

pub(crate) fn stable_id(target: &str) -> String {
    // FNV-1a 的输出跨运行稳定，适合把本机路径转换成不暴露路径的前端 ID。
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in target.to_lowercase().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("app-{hash:016x}")
}

pub(crate) fn merge_entries(entries: Vec<CatalogEntry>) -> Vec<CatalogEntry> {
    let mut merged: HashMap<String, CatalogEntry> = HashMap::new();

    for mut entry in entries {
        entry.aliases.push(entry.name.clone());
        entry.aliases.sort_by_key(|value| value.to_lowercase());
        entry
            .aliases
            .dedup_by(|left, right| left.eq_ignore_ascii_case(right));

        let key = entry.launch_target.to_lowercase();
        if let Some(existing) = merged.get_mut(&key) {
            existing.aliases.extend(entry.aliases);
            existing.aliases.push(entry.name.clone());
            existing.aliases.sort_by_key(|value| value.to_lowercase());
            existing
                .aliases
                .dedup_by(|left, right| left.eq_ignore_ascii_case(right));
            if source_priority(&entry.source) > source_priority(&existing.source) {
                existing.name = entry.name;
                existing.source = entry.source;
            }
        } else {
            merged.insert(key, entry);
        }
    }

    let mut applications: Vec<_> = merged.into_values().collect();
    applications.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    applications
}

fn source_priority(source: &str) -> u8 {
    match source {
        "manual" => 5,
        "start_menu" => 4,
        "registry" => 3,
        "system" => 2,
        "path" => 1,
        _ => 0,
    }
}

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("applications.json"))
        .map_err(|error| format!("无法确定软件目录缓存位置：{error}"))
}

fn read_catalog(path: &Path) -> Option<Vec<CatalogEntry>> {
    let content = fs::read_to_string(path).ok()?;
    let catalog: CatalogFile = serde_json::from_str(&content).ok()?;
    if catalog.version != CATALOG_VERSION {
        return None;
    }
    Some(
        catalog
            .applications
            .into_iter()
            .filter(entry_is_available)
            .collect(),
    )
}

fn write_catalog(
    path: &Path,
    applications: Vec<CatalogEntry>,
) -> Result<Vec<CatalogEntry>, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建软件目录缓存：{error}"))?;
    }

    let catalog = CatalogFile {
        version: CATALOG_VERSION,
        generated_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        applications: merge_entries(applications),
    };
    let content = serde_json::to_vec_pretty(&catalog)
        .map_err(|error| format!("无法序列化软件目录：{error}"))?;
    fs::write(path, content).map_err(|error| format!("无法保存软件目录缓存：{error}"))?;
    Ok(catalog.applications)
}

fn entry_is_available(entry: &CatalogEntry) -> bool {
    if entry.id != stable_id(&entry.launch_target) {
        return false;
    }
    match entry.launch_kind {
        LaunchKind::Executable => has_existing_extension(&entry.launch_target, "exe"),
        LaunchKind::Shortcut => has_existing_extension(&entry.launch_target, "lnk"),
        LaunchKind::Uri => {
            entry.launch_target.starts_with("ms-settings:")
                && !entry.launch_target.chars().any(char::is_control)
        }
    }
}

fn has_existing_extension(target: &str, expected: &str) -> bool {
    let path = Path::new(target);
    path.is_file()
        && path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case(expected))
}

pub(crate) fn load_catalog(app: &AppHandle) -> Result<Vec<CatalogEntry>, String> {
    let path = catalog_path(app)?;
    if let Some(applications) = read_catalog(&path) {
        if !applications.is_empty() {
            return Ok(applications);
        }
    }
    refresh_catalog(app)
}

fn refresh_catalog(app: &AppHandle) -> Result<Vec<CatalogEntry>, String> {
    let path = catalog_path(app)?;
    let manual_entries = read_catalog(&path)
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| entry.source == "manual")
        .collect::<Vec<_>>();
    let mut applications = discover_applications();
    applications.extend(manual_entries);
    write_catalog(&path, applications)
}

fn normalize_name(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn match_score(entry: &CatalogEntry, query: &str) -> usize {
    entry
        .aliases
        .iter()
        .chain(std::iter::once(&entry.name))
        .map(|alias| normalize_name(alias))
        .filter(|alias| !alias.is_empty())
        .map(|alias| {
            if alias == query {
                10_000
            } else if alias.starts_with(query) {
                8_000_usize.saturating_sub(alias.len().saturating_sub(query.len()))
            } else if alias.contains(query) {
                6_000_usize.saturating_sub(alias.len().saturating_sub(query.len()))
            } else if query.len() >= 2 && query.contains(&alias) {
                4_000_usize.saturating_sub(query.len().saturating_sub(alias.len()))
            } else {
                0
            }
        })
        .max()
        .unwrap_or_default()
}

fn search_catalog(applications: &[CatalogEntry], query: &str) -> Vec<ApplicationSummary> {
    let normalized_query = normalize_name(query);
    if normalized_query.is_empty() {
        return Vec::new();
    }

    let mut matches = applications
        .iter()
        .filter_map(|entry| {
            let score = match_score(entry, &normalized_query);
            (score > 0).then_some((score, entry))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|(left_score, left), (right_score, right)| {
        right_score
            .cmp(left_score)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    if matches.first().is_some_and(|(score, _)| *score == 10_000) {
        matches.retain(|(score, _)| *score == 10_000);
    }
    matches
        .into_iter()
        .take(MAX_RESULTS)
        .map(|(_, entry)| ApplicationSummary::from(entry))
        .collect()
}

fn validate_query(query: &str) -> Result<(), String> {
    if query.trim().is_empty() {
        return Err("软件名称不能为空".to_string());
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(format!("软件名称不能超过 {MAX_QUERY_CHARS} 个字符"));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_installed_applications(
    app: AppHandle,
) -> Result<Vec<ApplicationSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_catalog(&app)
            .map(|applications| applications.iter().map(ApplicationSummary::from).collect())
    })
    .await
    .map_err(|error| format!("读取软件目录任务失败：{error}"))?
}

#[tauri::command]
pub async fn refresh_application_catalog(
    app: AppHandle,
) -> Result<Vec<ApplicationSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        refresh_catalog(&app)
            .map(|applications| applications.iter().map(ApplicationSummary::from).collect())
    })
    .await
    .map_err(|error| format!("刷新软件目录任务失败：{error}"))?
}

#[tauri::command]
pub async fn search_applications(
    app: AppHandle,
    query: String,
) -> Result<Vec<ApplicationSummary>, String> {
    validate_query(&query)?;
    tauri::async_runtime::spawn_blocking(move || {
        let applications = load_catalog(&app)?;
        let matches = search_catalog(&applications, &query);
        if !matches.is_empty() {
            return Ok(matches);
        }
        // 缓存中没有匹配项时自动重新发现一次，以识别刚安装的软件。
        let mut refreshed = refresh_catalog(&app)?;
        let matches = search_catalog(&refreshed, &query);
        if !matches.is_empty() {
            return Ok(matches);
        }

        // PATH 不做全量遍历；仅在常规来源没有命中时检查精确文件名。
        let path_matches = discover_path_application(&query);
        if path_matches.is_empty() {
            return Ok(Vec::new());
        }
        refreshed.extend(path_matches);
        let catalog_file = catalog_path(&app)?;
        let refreshed = write_catalog(&catalog_file, refreshed)?;
        Ok(search_catalog(&refreshed, &query))
    })
    .await
    .map_err(|error| format!("搜索软件目录任务失败：{error}"))?
}

#[tauri::command]
pub async fn register_application(
    app: AppHandle,
    path: String,
    alias: String,
) -> Result<ApplicationSummary, String> {
    validate_query(&alias)?;
    tauri::async_runtime::spawn_blocking(move || {
        let requested = PathBuf::from(path.trim());
        let extension = requested
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let launch_kind = match extension.as_str() {
            "exe" => LaunchKind::Executable,
            "lnk" => LaunchKind::Shortcut,
            _ => return Err("只能添加 Windows 可执行文件（.exe）或快捷方式（.lnk）".to_string()),
        };
        let canonical = requested
            .canonicalize()
            .map_err(|_| "选择的软件文件不存在或无法访问".to_string())?;
        let launch_target = canonical.to_string_lossy().into_owned();
        let name = alias.trim().to_string();
        let entry = CatalogEntry {
            id: stable_id(&launch_target),
            name: name.clone(),
            aliases: vec![name],
            launch_kind,
            launch_target,
            source: "manual".to_string(),
        };

        let catalog_file = catalog_path(&app)?;
        let mut applications = load_catalog(&app)?;
        applications.push(entry.clone());
        write_catalog(&catalog_file, applications)?;
        Ok(ApplicationSummary::from(&entry))
    })
    .await
    .map_err(|error| format!("添加软件任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, aliases: &[&str], target: &str) -> CatalogEntry {
        CatalogEntry {
            id: stable_id(target),
            name: name.to_string(),
            aliases: aliases.iter().map(|value| value.to_string()).collect(),
            launch_kind: LaunchKind::Executable,
            launch_target: target.to_string(),
            source: "registry".to_string(),
        }
    }

    #[test]
    fn exact_alias_is_preferred_over_partial_matches() {
        let applications = vec![
            entry("微信开发者工具", &["微信开发工具"], "C:\\devtools.exe"),
            entry("微信", &["wechat", "微信"], "C:\\wechat.exe"),
        ];
        let matches = search_catalog(&applications, "微信");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].name, "微信");
    }

    #[test]
    fn stable_ids_do_not_expose_the_install_path() {
        let id = stable_id("C:\\Program Files\\Example\\example.exe");
        assert!(id.starts_with("app-"));
        assert!(!id.contains("Program Files"));
    }

    #[test]
    fn matching_ignores_spaces_and_letter_case() {
        let applications = vec![entry("Visual Studio Code", &["VS Code"], "C:\\Code.exe")];
        assert_eq!(search_catalog(&applications, "vs code").len(), 1);
        assert_eq!(search_catalog(&applications, "VISUALSTUDIO").len(), 1);
    }

    #[test]
    fn discovers_a_searchable_catalog_on_the_current_windows_machine() {
        let applications = discover_applications();
        println!("discovered {} launchable applications", applications.len());
        assert!(!applications.is_empty());
        assert_eq!(search_catalog(&applications, "Windows 设置").len(), 1);
    }
}
