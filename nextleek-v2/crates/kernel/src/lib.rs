use regex::Regex;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub entry: String,
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
    #[error("unsafe entry path")]
    UnsafeEntry,
    #[error("duplicate capability")]
    DuplicateCapability,
    #[error("permission is not allowed in the declarative MVP")]
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
        let entry = Path::new(&self.entry);
        if entry.is_absolute()
            || self.entry.contains('\\')
            || entry.components().any(|part| {
                matches!(
                    part,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
            || !self.entry.starts_with("ui/")
        {
            return Err(ManifestError::UnsafeEntry);
        }
        let unique: BTreeSet<_> = self.capabilities.iter().collect();
        if unique.len() != self.capabilities.len() {
            return Err(ManifestError::DuplicateCapability);
        }
        if self
            .permissions
            .iter()
            .any(|p| !matches!(p.as_str(), "storage:local" | "network:https"))
        {
            return Err(ManifestError::UndeclaredPermission);
        }
        Ok(())
    }
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

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ValidationReport {
    pub valid: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackageInventory {
    pub plugin_id: String,
    pub version: String,
    pub files: Vec<String>,
}

pub struct CreatorWorkspace {
    drafts: PathBuf,
    installed: PathBuf,
}

impl CreatorWorkspace {
    pub fn new(drafts: PathBuf, installed: PathBuf) -> Result<Self, CreatorError> {
        if drafts == installed || drafts.starts_with(&installed) || installed.starts_with(&drafts) {
            return Err(CreatorError::UnsafeDraftId);
        }
        fs::create_dir_all(&drafts).map_err(|e| CreatorError::Io(e.to_string()))?;
        Ok(Self { drafts, installed })
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
            .map_err(|e| CreatorError::InvalidManifest(e.to_string()))?;
        let path = self.safe_draft(id)?;
        fs::create_dir(&path).map_err(|e| CreatorError::Io(e.to_string()))?;
        let bytes =
            serde_json::to_vec_pretty(manifest).map_err(|e| CreatorError::Io(e.to_string()))?;
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
            || relative_path
                .components()
                .any(|c| !matches!(c, Component::Normal(_)));
        let forbidden = relative.ends_with(".exe")
            || relative.ends_with(".dll")
            || relative.ends_with(".so")
            || relative.ends_with(".dylib")
            || relative.contains("sidecar");
        if unsafe_path {
            return Err(CreatorError::UnsafeDraftId);
        }
        if forbidden {
            return Err(CreatorError::ForbiddenArtifact);
        }
        let target = root.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| CreatorError::Io(e.to_string()))?;
        }
        atomic_write(&target, contents)
    }

    pub fn read_manifest(&self, draft: &str) -> Result<Manifest, CreatorError> {
        let bytes = fs::read_to_string(self.safe_draft(draft)?.join("manifest.json"))
            .map_err(|_| CreatorError::NotFound)?;
        Manifest::parse(&bytes).map_err(|e| CreatorError::InvalidManifest(e.to_string()))
    }

    pub fn validate(&self, draft: &str) -> Result<ValidationReport, CreatorError> {
        match self.read_manifest(draft) {
            Ok(_) => Ok(ValidationReport {
                valid: true,
                errors: vec![],
            }),
            Err(CreatorError::InvalidManifest(error)) => Ok(ValidationReport {
                valid: false,
                errors: vec![error],
            }),
            Err(error) => Err(error),
        }
    }

    pub fn package_inventory(&self, draft: &str) -> Result<PackageInventory, CreatorError> {
        let root = self.safe_draft(draft)?;
        let manifest = self.read_manifest(draft)?;
        let mut files = Vec::new();
        collect_files(&root, &root, &mut files)?;
        files.sort();
        if files
            .iter()
            .any(|file| file.ends_with(".exe") || file.contains("sidecar"))
        {
            return Err(CreatorError::ForbiddenArtifact);
        }
        Ok(PackageInventory {
            plugin_id: manifest.id,
            version: manifest.version,
            files,
        })
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), CreatorError> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, contents).map_err(|e| CreatorError::Io(e.to_string()))?;
    fs::rename(&temporary, path).map_err(|e| CreatorError::Io(e.to_string()))
}

fn collect_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), CreatorError> {
    for entry in fs::read_dir(directory).map_err(|e| CreatorError::Io(e.to_string()))? {
        let entry = entry.map_err(|e| CreatorError::Io(e.to_string()))?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, files)?;
        } else {
            let relative = path
                .strip_prefix(root)
                .map_err(|e| CreatorError::Io(e.to_string()))?;
            files.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
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
