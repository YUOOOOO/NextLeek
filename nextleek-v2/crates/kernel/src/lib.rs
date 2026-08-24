pub mod package;
pub mod store;

pub use package::{build_package, inspect_package_bytes, PackageArtifact, PackageError};
pub use store::{InstalledPlugin, PluginStore, StoreError};

use regex::Regex;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub entry: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub min_creator_version: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ManifestError {
    #[error("invalid JSON: {0}")]
    Json(String),
    #[error("invalid plugin id")]
    InvalidId,
    #[error("invalid semantic version")]
    InvalidVersion,
    #[error("invalid minimum Creator version")]
    InvalidCreatorVersion,
    #[error("unsafe plugin resource path")]
    UnsafeEntry,
    #[error("duplicate capability")]
    DuplicateCapability,
    #[error("permission is not allowed")]
    UndeclaredPermission,
}

impl Manifest {
    pub fn parse(json: &str) -> Result<Self, ManifestError> {
        let value: Self =
            serde_json::from_str(json).map_err(|e| ManifestError::Json(e.to_string()))?;
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ManifestError> {
        let id_pattern =
            Regex::new(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){2,}$").expect("static regex");
        if !id_pattern.is_match(&self.id) {
            return Err(ManifestError::InvalidId);
        }
        if Version::parse(&self.version).is_err() {
            return Err(ManifestError::InvalidVersion);
        }
        if Version::parse(&self.min_creator_version).is_err() {
            return Err(ManifestError::InvalidCreatorVersion);
        }
        if !safe_resource_path(&self.entry) || !self.entry.starts_with("ui/") {
            return Err(ManifestError::UnsafeEntry);
        }
        if self.icon.as_deref().is_some_and(|icon| {
            !safe_resource_path(icon) || !icon.starts_with("assets/")
        }) {
            return Err(ManifestError::UnsafeEntry);
        }
        let unique: BTreeSet<_> = self.capabilities.iter().collect();
        if unique.len() != self.capabilities.len() {
            return Err(ManifestError::DuplicateCapability);
        }
        if self.permissions.iter().any(|permission| {
            !matches!(
                permission.as_str(),
                "storage:local" | "network:https" | "filesystem:trusted"
            )
        }) {
            return Err(ManifestError::UndeclaredPermission);
        }
        Ok(())
    }
}

fn safe_resource_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && !value.contains('\\')
        && !path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RegistryError {
    #[error("plugin already registered")]
    DuplicatePlugin,
    #[error("plugin not found")]
    NotFound,
    #[error("invalid version requirement")]
    InvalidRequirement,
}

#[derive(Default)]
pub struct CapabilityRegistry {
    plugins: BTreeMap<String, (Manifest, bool)>,
}

impl CapabilityRegistry {
    pub fn register(&mut self, manifest: Manifest) -> Result<(), RegistryError> {
        if self.plugins.contains_key(&manifest.id) {
            return Err(RegistryError::DuplicatePlugin);
        }
        self.plugins.insert(manifest.id.clone(), (manifest, true));
        Ok(())
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<(), RegistryError> {
        let plugin = self.plugins.get_mut(id).ok_or(RegistryError::NotFound)?;
        plugin.1 = enabled;
        Ok(())
    }

    pub fn providers(
        &self,
        capability: &str,
        requirement: &str,
    ) -> Result<Vec<&Manifest>, RegistryError> {
        let requirement =
            VersionReq::parse(requirement).map_err(|_| RegistryError::InvalidRequirement)?;
        Ok(self
            .plugins
            .values()
            .filter(|(manifest, enabled)| {
                *enabled
                    && manifest.capabilities.iter().any(|c| c == capability)
                    && Version::parse(&manifest.version).is_ok_and(|v| requirement.matches(&v))
            })
            .map(|(manifest, _)| manifest)
            .collect())
    }

    pub fn manifests(&self) -> Vec<&Manifest> {
        self.plugins
            .values()
            .map(|(manifest, _)| manifest)
            .collect()
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CreatorError {
    #[error("unsafe draft id or relative path")]
    UnsafeDraftId,
    #[error("native and sidecar artifacts are forbidden")]
    ForbiddenArtifact,
    #[error("draft not found")]
    NotFound,
    #[error("I/O error: {0}")]
    Io(String),
    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
}
pub struct CreatorWorkspace {
    drafts: PathBuf,
    installed: PathBuf,
    packages: PathBuf,
}

impl CreatorWorkspace {
    pub fn new(drafts: PathBuf, installed: PathBuf) -> Result<Self, CreatorError> {
        if drafts == installed || drafts.starts_with(&installed) || installed.starts_with(&drafts) {
            return Err(CreatorError::UnsafeDraftId);
        }
        let packages = drafts
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("creator-packages");
        fs::create_dir_all(&drafts).map_err(|error| CreatorError::Io(error.to_string()))?;
        fs::create_dir_all(&packages).map_err(|error| CreatorError::Io(error.to_string()))?;
        Ok(Self {
            drafts,
            installed,
            packages,
        })
    }

    fn safe_draft(&self, id: &str) -> Result<PathBuf, CreatorError> {
        let valid = Regex::new(r"^[a-z0-9][a-z0-9-]{0,63}$").expect("static regex");
        if !valid.is_match(id) {
            return Err(CreatorError::UnsafeDraftId);
        }
        let path = self.drafts.join(id);
        if path.starts_with(&self.installed) {
            return Err(CreatorError::UnsafeDraftId);
        }
        Ok(path)
    }

    pub fn create(&self, id: &str, manifest: &Manifest) -> Result<PathBuf, CreatorError> {
        manifest
            .validate()
            .map_err(|error| CreatorError::InvalidManifest(error.to_string()))?;
        let path = self.safe_draft(id)?;
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|error| CreatorError::Io(error.to_string()))?;
        }
        fs::create_dir(&path).map_err(|error| CreatorError::Io(error.to_string()))?;
        let bytes = serde_json::to_vec_pretty(manifest)
            .map_err(|error| CreatorError::Io(error.to_string()))?;
        atomic_write(&path.join("manifest.json"), &bytes)?;
        Ok(path)
    }

    pub fn write_file(
        &self,
        draft: &str,
        relative: &str,
        contents: &[u8],
    ) -> Result<(), CreatorError> {
        let root = self.safe_draft(draft)?;
        if !root.is_dir() {
            return Err(CreatorError::NotFound);
        }
        let relative_path = Path::new(relative);
        let unsafe_path = relative_path.is_absolute()
            || relative.contains('\\')
            || relative_path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)));
        let lower = relative.to_ascii_lowercase();
        let forbidden = [".exe", ".dll", ".so", ".dylib", ".bat", ".cmd", ".ps1", ".sh"]
            .iter()
            .any(|extension| lower.ends_with(extension))
            || lower.contains("sidecar");
        if unsafe_path {
            return Err(CreatorError::UnsafeDraftId);
        }
        if forbidden {
            return Err(CreatorError::ForbiddenArtifact);
        }
        let target = root.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| CreatorError::Io(error.to_string()))?;
        }
        atomic_write(&target, contents)
    }

    pub fn read_manifest(&self, draft: &str) -> Result<Manifest, CreatorError> {
        let bytes = fs::read_to_string(self.safe_draft(draft)?.join("manifest.json"))
            .map_err(|_| CreatorError::NotFound)?;
        Manifest::parse(&bytes).map_err(|error| CreatorError::InvalidManifest(error.to_string()))
    }

    pub fn validate(&self, draft: &str) -> Result<ValidationReport, CreatorError> {
        match self.read_manifest(draft) {
            Ok(manifest) if self.safe_draft(draft)?.join(&manifest.entry).is_file() => {
                Ok(ValidationReport {
                    valid: true,
                    errors: vec![],
                })
            }
            Ok(_) => Ok(ValidationReport {
                valid: false,
                errors: vec!["PLUGIN_ENTRY_MISSING".into()],
            }),
            Err(CreatorError::InvalidManifest(error)) => Ok(ValidationReport {
                valid: false,
                errors: vec![error],
            }),
            Err(error) => Err(error),
        }
    }

    pub fn package(&self, draft: &str) -> Result<PackageArtifact, CreatorError> {
        let root = self.safe_draft(draft)?;
        let manifest = self.read_manifest(draft)?;
        let output = self
            .packages
            .join(format!("{}-{}.nlplugin", manifest.id, manifest.version));
        build_package(&root, &output).map_err(|error| CreatorError::Io(error.to_string()))
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), CreatorError> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, contents).map_err(|e| CreatorError::Io(e.to_string()))?;
    fs::rename(&temporary, path).map_err(|e| CreatorError::Io(e.to_string()))
}


pub fn load_manifests_from_dir(root: &Path) -> Result<Vec<Manifest>, CreatorError> {
    let mut directories = fs::read_dir(root)
        .map_err(|e| CreatorError::Io(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| CreatorError::Io(e.to_string()))?;
    directories.sort_by_key(|entry| entry.file_name());
    directories
        .into_iter()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| {
            let json = fs::read_to_string(entry.path().join("manifest.json"))
                .map_err(|e| CreatorError::Io(e.to_string()))?;
            Manifest::parse(&json).map_err(|e| CreatorError::InvalidManifest(e.to_string()))
        })
        .collect()
}
