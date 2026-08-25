mod marketplace;
mod runtime;
mod settings;

use marketplace::{download_package, fetch_catalog, MarketCatalog, MarketPlugin};
use nextleek_kernel::{
    inspect_package_bytes, CreatorWorkspace, Manifest, PackageArtifact, PluginStore, ValidationReport,
};
use runtime::{load_text_plugin, RuntimeLaunch, RuntimeManager};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use settings::{AiSettings, Settings, SettingsStore};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;
pub const CREATOR_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDraftInput { pub manifest: Manifest, pub files: BTreeMap<String, String> }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePluginRequest { pub instruction: String, pub current_draft: PluginDraftInput, #[serde(default)] pub validation_errors: Vec<String> }
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePluginResponse { pub manifest: Manifest, pub files: BTreeMap<String, String>, pub explanation: String }


#[derive(Clone)]
struct BuiltinPlugin {
    manifest: Manifest,
    files: BTreeMap<String, Vec<u8>>,
}

pub struct AppState {
    root: PathBuf,
    creator: CreatorWorkspace,
    store: PluginStore,
    builtins: BTreeMap<String, BuiltinPlugin>,
    settings: Mutex<SettingsStore>,
    runtime: Mutex<RuntimeManager>,
}

impl AppState {
    pub fn new(root: &Path, plugins: Vec<Manifest>) -> Result<Self, String> {
        let builtins = plugins
            .into_iter()
            .map(|manifest| {
                let files = BTreeMap::from([(
                    manifest.entry.clone(),
                    format!("<main><h1>{}</h1></main>", manifest.name).into_bytes(),
                )]);
                (manifest.id.clone(), BuiltinPlugin { manifest, files })
            })
            .collect();
        Self::with_builtins(root, builtins)
    }

    fn with_builtins(
        root: &Path,
        builtins: BTreeMap<String, BuiltinPlugin>,
    ) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
        Ok(Self {
            root: root.to_path_buf(),
            creator: CreatorWorkspace::new(root.join("creator-drafts"), root.join("installed-plugins")).map_err(|error| error.to_string())?,
            store: PluginStore::new(root.join("installed-plugins")).map_err(|error| error.to_string())?,
            builtins,
            settings: Mutex::new(SettingsStore::load(root)?),
            runtime: Mutex::new(RuntimeManager::default()),
        })
    }

    fn with_editable_dashboard(root: &Path, dashboard: BuiltinPlugin) -> Result<Self, String> {
        let state = Self::with_builtins(root, BTreeMap::new())?;
        if state.store.active_plugin(&dashboard.manifest.id).is_err() {
            state.store.install_files(&dashboard.manifest, &dashboard.files).map_err(|error| error.to_string())?;
        }
        Ok(state)
    }

    fn remote_is_active(&self, plugin_id: &str) -> bool {
        self.store.active_plugin(plugin_id).is_ok()
    }

    fn is_trusted(&self, plugin_id: &str) -> Result<bool, String> {
        if self.builtins.contains_key(plugin_id) && !self.remote_is_active(plugin_id) {
            return Ok(true);
        }
        self.settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())
            .map(|settings| settings.is_trusted(plugin_id))
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSummary {
    pub plugin_count: usize,
    pub mode: &'static str,
    pub version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginState {
    pub manifest: Manifest,
    pub builtin: bool,
    pub trusted: bool,
    pub source: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub settings: Settings,
    pub version: &'static str,
    pub data_dir: PathBuf,
}

pub fn runtime_summary(state: &AppState) -> Result<RuntimeSummary, String> {
    Ok(RuntimeSummary {
        plugin_count: list_plugin_states(state)?.len(),
        mode: "dual-trust",
        version: CREATOR_VERSION,
    })
}

pub fn list_plugins(state: &AppState) -> Result<Vec<Manifest>, String> {
    Ok(list_plugin_states(state)?
        .into_iter()
        .map(|plugin| plugin.manifest)
        .collect())
}

pub fn list_plugin_states(state: &AppState) -> Result<Vec<PluginState>, String> {
    let mut plugins: BTreeMap<String, PluginState> = state
        .builtins
        .values()
        .map(|builtin| {
            (
                builtin.manifest.id.clone(),
                PluginState {
                    manifest: builtin.manifest.clone(),
                    builtin: true,
                    trusted: true,
                    source: "builtin",
                },
            )
        })
        .collect();
    let trusted = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?
        .value()
        .trusted_plugins;
    for installed in state.store.list_installed().map_err(|error| error.to_string())? {
        let plugin_id = installed.manifest.id.clone();
        plugins.insert(
            plugin_id.clone(),
            PluginState {
                manifest: installed.manifest,
                builtin: false,
                trusted: trusted.contains(&plugin_id) || plugin_id == "com.nextleek.dashboard",
                source: if plugin_id == "com.nextleek.dashboard" { "user-created" } else { "official-market" },
            },
        );
    }
    Ok(plugins.into_values().collect())
}

pub fn create_draft(state: &AppState, draft_id: String, manifest: Manifest) -> Result<(), String> {
    state
        .creator
        .create(&draft_id, &manifest)
        .map_err(|error| error.to_string())?;
    state
        .creator
        .write_file(
            &draft_id,
            "ui/index.html",
            b"<!doctype html><html><head><link rel=\"stylesheet\" href=\"style.css\"></head><body><main><h1>My Plugin</h1><button id=\"hello\">Run</button></main><script src=\"main.js\"></script></body></html>",
        )
        .map_err(|error| error.to_string())?;
    state
        .creator
        .write_file(
            &draft_id,
            "ui/main.js",
            b"document.querySelector('#hello').addEventListener('click',()=>alert('Hello NextLeek'))",
        )
        .map_err(|error| error.to_string())?;
    state
        .creator
        .write_file(
            &draft_id,
            "ui/style.css",
            b"body{font-family:system-ui;background:#0a1712;color:#e9f3ee;padding:32px}",
        )
        .map_err(|error| error.to_string())
}

pub fn write_draft_file(
    state: &AppState,
    draft_id: String,
    relative: String,
    content: String,
) -> Result<(), String> {
    state
        .creator
        .write_file(&draft_id, &relative, content.as_bytes())
        .map_err(|error| error.to_string())
}

pub fn validate_draft(state: &AppState, draft_id: String) -> Result<ValidationReport, String> {
    state
        .creator
        .validate(&draft_id)
        .map_err(|error| error.to_string())
}

pub fn package_draft(state: &AppState, draft_id: String) -> Result<PackageArtifact, String> {
    state
        .creator
        .package(&draft_id)
        .map_err(|error| error.to_string())
}

pub fn refresh_market(state: &AppState) -> Result<MarketCatalog, String> {
    let url = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?
        .value()
        .market_url;
    fetch_catalog(&url, CREATOR_VERSION)
}

pub fn install_market_plugin(state: &AppState, plugin: MarketPlugin) -> Result<PluginState, String> {
    let bytes = download_package(&plugin)?;
    let inspected = inspect_package_bytes(&bytes, Some(&plugin.sha256), CREATOR_VERSION)
        .map_err(|error| error.to_string())?;
    if inspected.manifest.id != plugin.id
        || inspected.manifest.name != plugin.name
        || inspected.manifest.version != plugin.version
        || inspected.manifest.min_creator_version != plugin.min_creator_version
        || inspected.manifest.permissions != plugin.permissions
    {
        return Err("MARKET_INDEX_INVALID: package metadata mismatch".into());
    }
    let installed = state
        .store
        .install_package(&bytes, Some(&plugin.sha256), CREATOR_VERSION)
        .map_err(|error| error.to_string())?;
    Ok(PluginState {
        manifest: installed.manifest,
        builtin: false,
        trusted: state.is_trusted(&plugin.id)?,
        source: "official-market",
    })
}

pub fn install_local_package(state: &AppState, bytes: Vec<u8>) -> Result<PluginState, String> {
    let installed = state
        .store
        .install_package(&bytes, None, CREATOR_VERSION)
        .map_err(|error| error.to_string())?;
    Ok(PluginState {
        trusted: state.is_trusted(&installed.manifest.id)?,
        builtin: false,
        manifest: installed.manifest,
        source: "local-import",
    })
}

pub fn uninstall_plugin(state: &AppState, plugin_id: String) -> Result<(), String> {
    if state.store.active_plugin(&plugin_id).is_err() && state.builtins.contains_key(&plugin_id) {
        return Err("built-in plugins cannot be uninstalled".into());
    }
    state
        .store
        .uninstall(&plugin_id)
        .map_err(|error| error.to_string())?;
    let storage = state.root.join("plugin-storage").join(&plugin_id);
    if storage.exists() {
        fs::remove_dir_all(storage).map_err(|error| error.to_string())?;
    }
    state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?
        .remove_plugin(&plugin_id)
}

pub fn read_settings(state: &AppState) -> Result<SettingsView, String> {
    Ok(SettingsView {
        settings: state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?
            .value(),
        version: CREATOR_VERSION,
        data_dir: state.root.clone(),
    })
}

pub fn set_market_url(state: &AppState, url: String) -> Result<SettingsView, String> {
    state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?
        .set_market_url(url)?;
    read_settings(state)
}

pub fn set_plugin_trust(state: &AppState, plugin_id: String, trusted: bool) -> Result<SettingsView, String> {
    if !state.remote_is_active(&plugin_id) { return Err("only installed market plugins have configurable trust".into()); }
    state.settings.lock().map_err(|_| "settings lock poisoned".to_string())?.set_trusted(&plugin_id, trusted)?;
    read_settings(state)
}

pub fn set_ai_settings(state: &AppState, ai: AiSettings) -> Result<SettingsView, String> {
    state.settings.lock().map_err(|_| "settings lock poisoned".to_string())?.set_ai(ai)?;
    read_settings(state)
}

pub fn generate_plugin(state: &AppState, request: GeneratePluginRequest) -> Result<GeneratePluginResponse, String> {
    if request.instruction.trim().is_empty() { return Err("AI_REQUEST_FAILED: instruction required".into()); }
    let ai = state.settings.lock().map_err(|_| "settings lock poisoned".to_string())?.value().ai;
    if !ai.enabled { return Err("AI_DISABLED".into()); }
    settings::validate_ai(&ai)?;
    let endpoint = format!("{}/chat/completions", ai.base_url.trim_end_matches('/'));
    let prompt = format!("You are the NextLeek plugin generator. Return only JSON with manifest, files, explanation. Required files: ui/index.html, ui/main.js, ui/style.css. Never use native code, shell, external scripts, or path traversal. User request: {}", request.instruction);
    let body = serde_json::json!({"model":ai.model,"temperature":ai.temperature,"messages":[{"role":"system","content":prompt},{"role":"user","content":serde_json::to_string(&request.current_draft).unwrap_or_default()}]});
    let response = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(|_| "AI_REQUEST_FAILED".to_string())?.post(endpoint).bearer_auth(ai.api_key).json(&body).send().map_err(|error| if error.is_timeout() { "AI_TIMEOUT".to_string() } else { "AI_REQUEST_FAILED".to_string() })?;
    if !response.status().is_success() { return Err("AI_REQUEST_FAILED".into()); }
    const MAX_AI_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
    let response_bytes = response.bytes().map_err(|_| "AI_RESPONSE_INVALID".to_string())?;
    if response_bytes.len() > MAX_AI_RESPONSE_BYTES { return Err("AI_RESPONSE_TOO_LARGE".into()); }
    let envelope: Value = serde_json::from_slice(&response_bytes).map_err(|_| "AI_RESPONSE_INVALID".to_string())?;
    let content = envelope["choices"][0]["message"]["content"].as_str().ok_or_else(|| "AI_RESPONSE_INVALID".to_string())?;
    let generated: GeneratePluginResponse = serde_json::from_str(content.trim().trim_start_matches("```json").trim_end_matches("```").trim()).map_err(|_| "AI_RESPONSE_INVALID".to_string())?;
    generated.manifest.validate().map_err(|_| "AI_PLUGIN_INVALID".to_string())?;
    let generated_size: usize = generated.files.values().map(|file| file.len()).sum();
    if generated_size > MAX_AI_RESPONSE_BYTES { return Err("AI_RESPONSE_TOO_LARGE".into()); }
    for path in generated.files.keys() { if !path.starts_with("ui/") || path.contains("..") || path.contains('\\') { return Err("AI_PLUGIN_INVALID".into()); } }
    for required in ["ui/index.html", "ui/main.js", "ui/style.css"] { if !generated.files.contains_key(required) { return Err("AI_PLUGIN_INVALID".into()); } }
    Ok(generated)
}

pub fn launch_plugin(state: &AppState, plugin_id: String) -> Result<RuntimeLaunch, String> {
    let (manifest, files, builtin_active) = if let Ok(installed) = state.store.active_plugin(&plugin_id)
    {
        let files = load_text_plugin(&installed.root, &installed.manifest)?;
        (installed.manifest, files, false)
    } else {
        let builtin = state
            .builtins
            .get(&plugin_id)
            .ok_or_else(|| "PLUGIN_NOT_INSTALLED".to_string())?;
        (builtin.manifest.clone(), builtin.files.clone(), true)
    };
    let trusted = builtin_active || state.is_trusted(&plugin_id)?;
    state
        .runtime
        .lock()
        .map_err(|_| "runtime lock poisoned".to_string())?
        .launch(manifest, files, trusted, state.root.clone())
}

pub fn plugin_sdk_call(
    state: &AppState,
    token: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "runtime lock poisoned".to_string())?;
    let plugin_id = runtime.plugin_id(&token)?.to_string();
    let trusted = state.is_trusted(&plugin_id)?;
    runtime.call(&token, &method, params, trusted)
}

pub fn close_plugin(state: &AppState, token: String) -> Result<(), String> {
    state
        .runtime
        .lock()
        .map_err(|_| "runtime lock poisoned".to_string())?
        .close(&token)
}

#[tauri::command]
fn runtime_summary_command(state: State<'_, AppState>) -> Result<RuntimeSummary, String> {
    runtime_summary(&state)
}

#[tauri::command]
fn list_plugins_command(state: State<'_, AppState>) -> Result<Vec<PluginState>, String> {
    list_plugin_states(&state)
}

#[tauri::command]
fn create_draft_command(
    state: State<'_, AppState>,
    draft_id: String,
    manifest: Manifest,
) -> Result<(), String> {
    create_draft(&state, draft_id, manifest)
}

#[tauri::command]
fn write_draft_file_command(
    state: State<'_, AppState>,
    draft_id: String,
    relative: String,
    content: String,
) -> Result<(), String> {
    write_draft_file(&state, draft_id, relative, content)
}

#[tauri::command]
fn validate_draft_command(
    state: State<'_, AppState>,
    draft_id: String,
) -> Result<ValidationReport, String> {
    validate_draft(&state, draft_id)
}

#[tauri::command]
fn package_draft_command(
    state: State<'_, AppState>,
    draft_id: String,
) -> Result<PackageArtifact, String> {
    package_draft(&state, draft_id)
}

#[tauri::command]
fn refresh_market_command(state: State<'_, AppState>) -> Result<MarketCatalog, String> {
    refresh_market(&state)
}

#[tauri::command]
fn install_market_plugin_command(
    state: State<'_, AppState>,
    plugin: MarketPlugin,
) -> Result<PluginState, String> {
    install_market_plugin(&state, plugin)
}

#[tauri::command]
fn install_local_package_command(
    state: State<'_, AppState>,
    bytes: Vec<u8>,
) -> Result<PluginState, String> {
    install_local_package(&state, bytes)
}

#[tauri::command]
fn uninstall_plugin_command(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    uninstall_plugin(&state, plugin_id)
}

#[tauri::command]
fn read_settings_command(state: State<'_, AppState>) -> Result<SettingsView, String> {
    read_settings(&state)
}

#[tauri::command]
fn set_market_url_command(
    state: State<'_, AppState>,
    url: String,
) -> Result<SettingsView, String> {
    set_market_url(&state, url)
}

#[tauri::command]
fn set_plugin_trust_command(
    state: State<'_, AppState>,
    plugin_id: String,
    trusted: bool,
) -> Result<SettingsView, String> {
    set_plugin_trust(&state, plugin_id, trusted)
}
#[tauri::command]
fn set_ai_settings_command(state: State<'_, AppState>, settings: AiSettings) -> Result<SettingsView, String> { set_ai_settings(&state, settings) }

#[tauri::command]
fn generate_plugin_command(state: State<'_, AppState>, request: GeneratePluginRequest) -> Result<GeneratePluginResponse, String> { generate_plugin(&state, request) }

#[tauri::command]
fn launch_plugin_command(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<RuntimeLaunch, String> {
    launch_plugin(&state, plugin_id)
}

#[tauri::command]
fn plugin_sdk_call_command(
    state: State<'_, AppState>,
    token: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    plugin_sdk_call(&state, token, method, params)
}

#[tauri::command]
fn close_plugin_command(state: State<'_, AppState>, token: String) -> Result<(), String> {
    close_plugin(&state, token)
}

fn builtin_plugins() -> BTreeMap<String, BuiltinPlugin> {
    let dashboard = builtin_plugin(
        include_str!("../../../../plugins/builtin/dashboard/manifest.json"),
        [
            ("ui/index.html", include_bytes!("../../../../plugins/builtin/dashboard/ui/index.html").as_slice()),
            ("ui/main.js", include_bytes!("../../../../plugins/builtin/dashboard/ui/main.js").as_slice()),
            ("ui/style.css", include_bytes!("../../../../plugins/builtin/dashboard/ui/style.css").as_slice()),
        ],
    );
    [(dashboard.manifest.id.clone(), dashboard)].into_iter().collect()
}

fn builtin_plugin<const N: usize>(
    manifest_json: &str,
    files: [(&str, &[u8]); N],
) -> BuiltinPlugin {
    BuiltinPlugin {
        manifest: Manifest::parse(manifest_json).expect("bundled manifest must be valid"),
        files: files
            .into_iter()
            .map(|(path, bytes)| (path.to_string(), bytes.to_vec()))
            .collect(),
    }
}

pub fn run() {
    let executable = std::env::current_exe().expect("resolve executable path");
    let portable_root = executable.parent().expect("executable parent").join("Data");
    let dashboard = builtin_plugins().remove("com.nextleek.dashboard").expect("bundled dashboard must exist");
    let state = AppState::with_editable_dashboard(&portable_root, dashboard).expect("initialize NextLeek");

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            runtime_summary_command,
            list_plugins_command,
            create_draft_command,
            write_draft_file_command,
            validate_draft_command,
            package_draft_command,
            refresh_market_command,
            install_market_plugin_command,
            install_local_package_command,
            uninstall_plugin_command,
            read_settings_command,
            set_market_url_command,
            set_plugin_trust_command,
            set_ai_settings_command,
            generate_plugin_command,
            launch_plugin_command,
            plugin_sdk_call_command,
            close_plugin_command
        ])
        .run(tauri::generate_context!())
        .expect("run NextLeek desktop");
}
