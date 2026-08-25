use crate::package::{extract_inspected, inspect_package_bytes, PackageError};
use crate::Manifest;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: Manifest,
    pub root: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
struct ActiveVersion {
    version: String,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error(transparent)]
    Package(#[from] PackageError),
    #[error("PLUGIN_NOT_INSTALLED")]
    NotInstalled,
    #[error("unsafe plugin resource path")]
    UnsafePath,
    #[error("I/O error: {0}")]
    Io(String),
}

#[derive(Debug, Clone)]
pub struct PluginStore {
    root: PathBuf,
}

impl PluginStore {
    pub fn new(root: PathBuf) -> Result<Self, StoreError> {
        fs::create_dir_all(&root).map_err(|error| StoreError::Io(error.to_string()))?;
        Ok(Self { root })
    }

    pub fn install_package(
        &self,
        bytes: &[u8],
        expected_sha256: Option<&str>,
        creator_version: &str,
    ) -> Result<InstalledPlugin, StoreError> {
        let package = inspect_package_bytes(bytes, expected_sha256, creator_version)?;
        let plugin_root = self.root.join(&package.manifest.id);
        fs::create_dir_all(&plugin_root).map_err(|error| StoreError::Io(error.to_string()))?;
        let target = plugin_root.join(&package.manifest.version);
        if !target.exists() {
            let temporary = plugin_root.join(format!("{}.installing", package.manifest.version));
            if temporary.exists() {
                fs::remove_dir_all(&temporary)
                    .map_err(|error| StoreError::Io(error.to_string()))?;
            }
            extract_inspected(&package, &temporary)?;
            if let Err(error) = fs::rename(&temporary, &target) {
                let _ = fs::remove_dir_all(&temporary);
                return Err(StoreError::Io(error.to_string()));
            }
        }
        write_atomic_json(
            &plugin_root.join("active.json"),
            &ActiveVersion {
                version: package.manifest.version.clone(),
            },
        )?;
        Ok(InstalledPlugin {
            manifest: package.manifest,
            root: target,
        })
    }

    pub fn install_files(
        &self,
        manifest: &Manifest,
        files: &std::collections::BTreeMap<String, Vec<u8>>,
    ) -> Result<InstalledPlugin, StoreError> {
        let plugin_root = self.root.join(&manifest.id);
        fs::create_dir_all(&plugin_root).map_err(|error| StoreError::Io(error.to_string()))?;
        let target = plugin_root.join(&manifest.version);
        if !target.exists() {
            fs::create_dir_all(target.join("ui")).map_err(|error| StoreError::Io(error.to_string()))?;
            fs::write(target.join("manifest.json"), serde_json::to_vec_pretty(manifest).map_err(|error| StoreError::Io(error.to_string()))?)
                .map_err(|error| StoreError::Io(error.to_string()))?;
            for (relative, content) in files {
                let path = target.join(relative);
                if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| StoreError::Io(error.to_string()))?; }
                fs::write(path, content).map_err(|error| StoreError::Io(error.to_string()))?;
            }
        }
        write_atomic_json(&plugin_root.join("active.json"), &ActiveVersion { version: manifest.version.clone() })?;
        self.active_plugin(&manifest.id)
    }

    pub fn active_plugin(&self, id: &str) -> Result<InstalledPlugin, StoreError> {
        validate_plugin_id(id)?;
        let plugin_root = self.root.join(id);
        let active: ActiveVersion = serde_json::from_slice(
            &fs::read(plugin_root.join("active.json")).map_err(|_| StoreError::NotInstalled)?,
        )
        .map_err(|_| StoreError::NotInstalled)?;
        let root = plugin_root.join(&active.version);
        let manifest = Manifest::parse(
            &fs::read_to_string(root.join("manifest.json")).map_err(|_| StoreError::NotInstalled)?,
        )
        .map_err(|_| StoreError::NotInstalled)?;
        Ok(InstalledPlugin { manifest, root })
    }

    pub fn list_installed(&self) -> Result<Vec<InstalledPlugin>, StoreError> {
        let mut plugins = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|error| StoreError::Io(error.to_string()))? {
            let entry = entry.map_err(|error| StoreError::Io(error.to_string()))?;
            if entry.path().is_dir() {
                let id = entry.file_name().to_string_lossy().to_string();
                if let Ok(plugin) = self.active_plugin(&id) {
                    plugins.push(plugin);
                }
            }
        }
        plugins.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
        Ok(plugins)
    }

    pub fn uninstall(&self, id: &str) -> Result<(), StoreError> {
        validate_plugin_id(id)?;
        let target = self.root.join(id);
        if !target.exists() {
            return Err(StoreError::NotInstalled);
        }
        fs::remove_dir_all(target).map_err(|error| StoreError::Io(error.to_string()))
    }

    pub fn read_resource(&self, id: &str, relative: &str) -> Result<Vec<u8>, StoreError> {
        let plugin = self.active_plugin(id)?;
        let relative_path = Path::new(relative);
        if relative_path.is_absolute()
            || relative.contains('\\')
            || relative_path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(StoreError::UnsafePath);
        }
        let path = plugin.root.join(relative_path);
        if fs::symlink_metadata(&path)
            .map_err(|_| StoreError::NotInstalled)?
            .file_type()
            .is_symlink()
        {
            return Err(StoreError::UnsafePath);
        }
        fs::read(path).map_err(|error| StoreError::Io(error.to_string()))
    }
}

fn validate_plugin_id(id: &str) -> Result<(), StoreError> {
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || Path::new(id).is_absolute()
    {
        Err(StoreError::UnsafePath)
    } else {
        Ok(())
    }
}

fn write_atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), StoreError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| StoreError::Io(error.to_string()))?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(|error| StoreError::Io(error.to_string()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| StoreError::Io(error.to_string()))?;
    }
    fs::rename(temporary, path).map_err(|error| StoreError::Io(error.to_string()))
}
