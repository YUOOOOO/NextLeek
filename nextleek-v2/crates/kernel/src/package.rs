use crate::Manifest;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

pub const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
pub const MAX_TOTAL_SIZE: u64 = 25 * 1024 * 1024;
pub const MAX_PACKAGE_SIZE: u64 = 25 * 1024 * 1024;
pub const MAX_FILES: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageArtifact {
    pub plugin_id: String,
    pub version: String,
    pub path: PathBuf,
    pub sha256: String,
    pub size: u64,
    pub files: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct InspectedPackage {
    pub manifest: Manifest,
    pub sha256: String,
    pub size: u64,
    pub files: Vec<String>,
    entries: Vec<(String, Vec<u8>)>,
}

#[derive(Debug, Error)]
pub enum PackageError {
    #[error("PACKAGE_INVALID: {0}")]
    Invalid(String),
    #[error("PACKAGE_TOO_LARGE: {0}")]
    TooLarge(String),
    #[error("HASH_MISMATCH")]
    HashMismatch,
    #[error("INCOMPATIBLE_VERSION")]
    IncompatibleVersion,
    #[error("I/O error: {0}")]
    Io(String),
}

pub fn build_package(source: &Path, output: &Path) -> Result<PackageArtifact, PackageError> {
    let entries = collect_source_files(source)?;
    let manifest_bytes = entries
        .iter()
        .find(|(name, _)| name == "manifest.json")
        .map(|(_, bytes)| bytes)
        .ok_or_else(|| PackageError::Invalid("manifest.json is required".into()))?;
    let manifest = Manifest::parse(std::str::from_utf8(manifest_bytes).map_err(|_| {
        PackageError::Invalid("manifest.json must be UTF-8".into())
    })?)
    .map_err(|error| PackageError::Invalid(error.to_string()))?;
    require_entry(&manifest, &entries)?;

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut archive = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .last_modified_time(DateTime::default())
            .unix_permissions(0o644);
        for (name, bytes) in &entries {
            archive
                .start_file(name, options)
                .map_err(|error| PackageError::Io(error.to_string()))?;
            archive
                .write_all(bytes)
                .map_err(|error| PackageError::Io(error.to_string()))?;
        }
        archive
            .finish()
            .map_err(|error| PackageError::Io(error.to_string()))?;
    }
    let bytes = cursor.into_inner();
    if bytes.len() as u64 > MAX_PACKAGE_SIZE {
        return Err(PackageError::TooLarge("compressed package exceeds 25 MiB".into()));
    }
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| PackageError::Io(error.to_string()))?;
    }
    let temporary = output.with_extension("nlplugin.tmp");
    fs::write(&temporary, &bytes).map_err(|error| PackageError::Io(error.to_string()))?;
    if output.exists() {
        fs::remove_file(output).map_err(|error| PackageError::Io(error.to_string()))?;
    }
    fs::rename(&temporary, output).map_err(|error| PackageError::Io(error.to_string()))?;

    Ok(PackageArtifact {
        plugin_id: manifest.id,
        version: manifest.version,
        path: output.to_path_buf(),
        sha256: digest(&bytes),
        size: bytes.len() as u64,
        files: entries.into_iter().map(|(name, _)| name).collect(),
    })
}

pub fn inspect_package_bytes(
    bytes: &[u8],
    expected_sha256: Option<&str>,
    creator_version: &str,
) -> Result<InspectedPackage, PackageError> {
    if bytes.len() as u64 > MAX_PACKAGE_SIZE {
        return Err(PackageError::TooLarge("package exceeds 25 MiB".into()));
    }
    let sha256 = digest(bytes);
    if expected_sha256.is_some_and(|expected| !expected.eq_ignore_ascii_case(&sha256)) {
        return Err(PackageError::HashMismatch);
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| PackageError::Invalid(error.to_string()))?;
    if archive.len() > MAX_FILES {
        return Err(PackageError::TooLarge("package contains more than 500 files".into()));
    }
    let mut total = 0_u64;
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| PackageError::Invalid(error.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(PackageError::Invalid("symbolic links are forbidden".into()));
        }
        let name = normalize_archive_name(entry.name())?;
        if entries.iter().any(|(existing, _)| existing == &name) {
            return Err(PackageError::Invalid("duplicate normalized path".into()));
        }
        if entry.size() > MAX_FILE_SIZE {
            return Err(PackageError::TooLarge(format!("{name} exceeds 5 MiB")));
        }
        total = total.saturating_add(entry.size());
        if total > MAX_TOTAL_SIZE {
            return Err(PackageError::TooLarge("uncompressed package exceeds 25 MiB".into()));
        }
        let mut content = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut content)
            .map_err(|error| PackageError::Invalid(error.to_string()))?;
        entries.push((name, content));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    let manifest_bytes = entries
        .iter()
        .find(|(name, _)| name == "manifest.json")
        .map(|(_, bytes)| bytes)
        .ok_or_else(|| PackageError::Invalid("manifest.json is required".into()))?;
    let manifest = Manifest::parse(std::str::from_utf8(manifest_bytes).map_err(|_| {
        PackageError::Invalid("manifest.json must be UTF-8".into())
    })?)
    .map_err(|error| PackageError::Invalid(error.to_string()))?;
    require_entry(&manifest, &entries)?;
    let current = Version::parse(creator_version)
        .map_err(|_| PackageError::Invalid("invalid Creator version".into()))?;
    let minimum = Version::parse(&manifest.min_creator_version)
        .map_err(|_| PackageError::Invalid("invalid minimum Creator version".into()))?;
    if current < minimum {
        return Err(PackageError::IncompatibleVersion);
    }
    Ok(InspectedPackage {
        manifest,
        sha256,
        size: bytes.len() as u64,
        files: entries.iter().map(|(name, _)| name.clone()).collect(),
        entries,
    })
}

pub fn extract_inspected(package: &InspectedPackage, target: &Path) -> Result<(), PackageError> {
    if target.exists() {
        return Err(PackageError::Invalid("target version already exists".into()));
    }
    fs::create_dir_all(target).map_err(|error| PackageError::Io(error.to_string()))?;
    let result = (|| {
        for (name, content) in &package.entries {
            let output = target.join(name);
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| PackageError::Io(error.to_string()))?;
            }
            fs::write(output, content).map_err(|error| PackageError::Io(error.to_string()))?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(target);
    }
    result
}

fn collect_source_files(source: &Path) -> Result<Vec<(String, Vec<u8>)>, PackageError> {
    if !source.is_dir() {
        return Err(PackageError::Invalid("plugin source directory not found".into()));
    }
    let mut paths = Vec::new();
    collect_paths(source, source, &mut paths)?;
    if paths.len() > MAX_FILES {
        return Err(PackageError::TooLarge("plugin contains more than 500 files".into()));
    }
    paths.sort_by(|left, right| left.0.cmp(&right.0));
    let mut total = 0_u64;
    let mut entries = Vec::with_capacity(paths.len());
    for (name, path) in paths {
        let metadata = fs::symlink_metadata(&path).map_err(|error| PackageError::Io(error.to_string()))?;
        if metadata.file_type().is_symlink() {
            return Err(PackageError::Invalid("symbolic links are forbidden".into()));
        }
        if metadata.len() > MAX_FILE_SIZE {
            return Err(PackageError::TooLarge(format!("{name} exceeds 5 MiB")));
        }
        total = total.saturating_add(metadata.len());
        if total > MAX_TOTAL_SIZE {
            return Err(PackageError::TooLarge("plugin exceeds 25 MiB".into()));
        }
        let bytes = fs::read(path).map_err(|error| PackageError::Io(error.to_string()))?;
        entries.push((name, bytes));
    }
    Ok(entries)
}

fn collect_paths(
    root: &Path,
    directory: &Path,
    output: &mut Vec<(String, PathBuf)>,
) -> Result<(), PackageError> {
    for entry in fs::read_dir(directory).map_err(|error| PackageError::Io(error.to_string()))? {
        let entry = entry.map_err(|error| PackageError::Io(error.to_string()))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| PackageError::Io(error.to_string()))?;
        if metadata.file_type().is_symlink() {
            return Err(PackageError::Invalid("symbolic links are forbidden".into()));
        }
        if metadata.is_dir() {
            collect_paths(root, &path, output)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| PackageError::Invalid(error.to_string()))?;
            let name = relative
                .to_str()
                .ok_or_else(|| PackageError::Invalid("paths must be UTF-8".into()))?
                .replace('\\', "/");
            validate_package_path(&name)?;
            output.push((name, path));
        }
    }
    Ok(())
}

fn normalize_archive_name(name: &str) -> Result<String, PackageError> {
    if name.contains('\\') {
        return Err(PackageError::Invalid("backslash paths are forbidden".into()));
    }
    let path = Path::new(name);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PackageError::Invalid("unsafe archive path".into()));
    }
    validate_package_path(name)?;
    Ok(name.to_string())
}

fn validate_package_path(name: &str) -> Result<(), PackageError> {
    let first = name.split('/').next().unwrap_or_default();
    if name != "manifest.json" && first != "ui" && first != "assets" {
        return Err(PackageError::Invalid(format!("unsupported package path: {name}")));
    }
    let lower = name.to_ascii_lowercase();
    let extension = Path::new(&lower)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if matches!(
        extension,
        "exe" | "dll" | "so" | "dylib" | "bat" | "cmd" | "ps1" | "sh"
    ) || lower.contains("sidecar")
    {
        return Err(PackageError::Invalid("native and sidecar artifacts are forbidden".into()));
    }
    Ok(())
}

fn require_entry(manifest: &Manifest, entries: &[(String, Vec<u8>)]) -> Result<(), PackageError> {
    if entries.iter().any(|(name, _)| name == &manifest.entry) {
        Ok(())
    } else {
        Err(PackageError::Invalid("PLUGIN_ENTRY_MISSING".into()))
    }
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
