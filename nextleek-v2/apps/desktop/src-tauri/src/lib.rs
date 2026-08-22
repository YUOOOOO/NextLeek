use nextleek_kernel::{
    CapabilityRegistry, CreatorWorkspace, Manifest, PackageInventory, ValidationReport,
};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    registry: Mutex<CapabilityRegistry>,
    creator: CreatorWorkspace,
}

impl AppState {
    pub fn new(root: &Path, plugins: Vec<Manifest>) -> Result<Self, String> {
        let mut registry = CapabilityRegistry::default();
        for plugin in plugins {
            registry.register(plugin).map_err(|e| e.to_string())?;
        }
        let creator =
            CreatorWorkspace::new(root.join("creator-drafts"), root.join("installed-plugins"))
                .map_err(|e| e.to_string())?;
        Ok(Self {
            registry: Mutex::new(registry),
            creator,
        })
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RuntimeSummary {
    pub plugin_count: usize,
    pub mode: &'static str,
}

pub fn runtime_summary(state: &AppState) -> Result<RuntimeSummary, String> {
    let registry = state
        .registry
        .lock()
        .map_err(|_| "registry lock poisoned".to_string())?;
    Ok(RuntimeSummary {
        plugin_count: registry.manifests().len(),
        mode: "declarative-only",
    })
}

pub fn list_plugins(state: &AppState) -> Result<Vec<Manifest>, String> {
    let registry = state
        .registry
        .lock()
        .map_err(|_| "registry lock poisoned".to_string())?;
    Ok(registry.manifests().into_iter().cloned().collect())
}

pub fn create_draft(state: &AppState, draft_id: String, manifest: Manifest) -> Result<(), String> {
    state
        .creator
        .create(&draft_id, &manifest)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn read_draft(state: &AppState, draft_id: String) -> Result<Manifest, String> {
    state
        .creator
        .read_manifest(&draft_id)
        .map_err(|e| e.to_string())
}

pub fn write_draft_manifest(
    state: &AppState,
    draft_id: String,
    manifest: Manifest,
) -> Result<(), String> {
    manifest.validate().map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    state
        .creator
        .write_file(&draft_id, "manifest.json", &bytes)
        .map_err(|e| e.to_string())
}

pub fn validate_draft(state: &AppState, draft_id: String) -> Result<ValidationReport, String> {
    state.creator.validate(&draft_id).map_err(|e| e.to_string())
}

pub fn package_draft(state: &AppState, draft_id: String) -> Result<PackageInventory, String> {
    state
        .creator
        .package_inventory(&draft_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn runtime_summary_command(state: State<'_, AppState>) -> Result<RuntimeSummary, String> {
    runtime_summary(&state)
}

#[tauri::command]
fn list_plugins_command(state: State<'_, AppState>) -> Result<Vec<Manifest>, String> {
    list_plugins(&state)
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
) -> Result<PackageInventory, String> {
    package_draft(&state, draft_id)
}

fn builtin_manifests() -> Vec<Manifest> {
    [
        include_str!("../../../../plugins/builtin/notes/manifest.json"),
        include_str!("../../../../plugins/builtin/stocks/manifest.json"),
    ]
    .iter()
    .map(|json| Manifest::parse(json).expect("bundled manifest must be valid"))
    .collect()
}

pub fn run() {
    let executable = std::env::current_exe().expect("resolve executable path");
    let portable_root = executable.parent().expect("executable parent").join("Data");
    std::fs::create_dir_all(&portable_root).expect("create portable Data directory");
    let state = AppState::new(&portable_root, builtin_manifests()).expect("initialize kernel");

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            runtime_summary_command,
            list_plugins_command,
            create_draft_command,
            validate_draft_command,
            package_draft_command
        ])
        .run(tauri::generate_context!())
        .expect("run NextLeek desktop");
}
