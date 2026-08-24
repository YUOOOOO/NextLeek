use nextleek_kernel::Manifest;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

const MAX_RUNTIME_TEXT: u64 = 5 * 1024 * 1024;
const MAX_NETWORK_TEXT: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLaunch {
    pub token: String,
    pub manifest: Manifest,
    pub entry_html: String,
    pub text_assets: BTreeMap<String, String>,
    pub trusted: bool,
}

struct RuntimeSession {
    manifest: Manifest,
    data_root: PathBuf,
}

#[derive(Default)]
pub struct RuntimeManager {
    sessions: HashMap<String, RuntimeSession>,
}

impl RuntimeManager {
    pub fn launch(
        &mut self,
        manifest: Manifest,
        files: BTreeMap<String, Vec<u8>>,
        trusted: bool,
        data_root: PathBuf,
    ) -> Result<RuntimeLaunch, String> {
        let entry_html = files
            .get(&manifest.entry)
            .ok_or_else(|| "PLUGIN_ENTRY_MISSING".to_string())?;
        let entry_html = String::from_utf8(entry_html.clone())
            .map_err(|_| "PLUGIN_RUNTIME_FAILED: entry must be UTF-8".to_string())?;
        let mut text_assets = BTreeMap::new();
        for (path, bytes) in files {
            if bytes.len() as u64 > MAX_RUNTIME_TEXT {
                return Err("PLUGIN_RUNTIME_FAILED: runtime asset too large".into());
            }
            if let Ok(text) = String::from_utf8(bytes) {
                text_assets.insert(path, text);
            }
        }
        let token = Uuid::new_v4().to_string();
        self.sessions.insert(
            token.clone(),
            RuntimeSession {
                manifest: manifest.clone(),
                data_root,
            },
        );
        Ok(RuntimeLaunch {
            token,
            manifest,
            entry_html,
            text_assets,
            trusted,
        })
    }

    pub fn close(&mut self, token: &str) -> Result<(), String> {
        self.sessions
            .remove(token)
            .map(|_| ())
            .ok_or_else(|| "RUNTIME_TOKEN_INVALID".into())
    }

    pub fn call(
        &self,
        token: &str,
        method: &str,
        params: Value,
        currently_trusted: bool,
    ) -> Result<Value, String> {
        let session = self
            .sessions
            .get(token)
            .ok_or_else(|| "RUNTIME_TOKEN_INVALID".to_string())?;
        match method {
            "storage.get" => {
                require_permission(&session.manifest, "storage:local")?;
                let key = string_param(&params, "key")?;
                let path = storage_path(session, key)?;
                if !path.exists() {
                    return Ok(Value::Null);
                }
                let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
                serde_json::from_str(&text).map_err(|error| error.to_string())
            }
            "storage.set" => {
                require_permission(&session.manifest, "storage:local")?;
                let key = string_param(&params, "key")?;
                let value = params.get("value").cloned().unwrap_or(Value::Null);
                let path = storage_path(session, key)?;
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::write(path, serde_json::to_vec(&value).map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
                Ok(json!({"saved": true}))
            }
            "storage.delete" => {
                require_permission(&session.manifest, "storage:local")?;
                let key = string_param(&params, "key")?;
                let path = storage_path(session, key)?;
                if path.exists() {
                    fs::remove_file(path).map_err(|error| error.to_string())?;
                }
                Ok(json!({"deleted": true}))
            }
            method if method.starts_with("fs.") => {
                require_trusted(currently_trusted)?;
                require_permission(&session.manifest, "filesystem:trusted")?;
                filesystem_call(method, params)
            }
            "network.fetchHttps" => {
                require_trusted(currently_trusted)?;
                require_permission(&session.manifest, "network:https")?;
                fetch_https(&params)
            }
            _ => Err("PERMISSION_DENIED: unsupported SDK method".into()),
        }
    }

    pub fn plugin_id(&self, token: &str) -> Result<&str, String> {
        self.sessions
            .get(token)
            .map(|session| session.manifest.id.as_str())
            .ok_or_else(|| "RUNTIME_TOKEN_INVALID".to_string())
    }
}

pub fn load_text_plugin(root: &Path, manifest: &Manifest) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut files = BTreeMap::new();
    collect_runtime_files(root, root, &mut files)?;
    if !files.contains_key(&manifest.entry) {
        return Err("PLUGIN_ENTRY_MISSING".into());
    }
    Ok(files)
}

fn collect_runtime_files(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("PLUGIN_RUNTIME_FAILED: symbolic link".into());
        }
        if metadata.is_dir() {
            collect_runtime_files(root, &path, files)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            files.insert(relative, fs::read(path).map_err(|error| error.to_string())?);
        }
    }
    Ok(())
}

fn require_permission(manifest: &Manifest, permission: &str) -> Result<(), String> {
    if manifest.permissions.iter().any(|value| value == permission) {
        Ok(())
    } else {
        Err(format!("PERMISSION_DENIED: {permission} not declared"))
    }
}

fn require_trusted(trusted: bool) -> Result<(), String> {
    if trusted {
        Ok(())
    } else {
        Err("PERMISSION_DENIED: trusted mode required".into())
    }
}

fn string_param<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("invalid parameter: {key}"))
}

fn storage_path(session: &RuntimeSession, key: &str) -> Result<PathBuf, String> {
    if key.is_empty()
        || Path::new(key).is_absolute()
        || key.contains('\\')
        || Path::new(key)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("PERMISSION_DENIED: unsafe storage key".into());
    }
    Ok(session
        .data_root
        .join("plugin-storage")
        .join(&session.manifest.id)
        .join(format!("{key}.json")))
}

fn filesystem_call(method: &str, params: Value) -> Result<Value, String> {
    let path = PathBuf::from(string_param(&params, "path")?);
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("PERMISSION_DENIED: trusted filesystem path must be absolute".into());
    }
    match method {
        "fs.readText" => {
            let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
            if metadata.len() > MAX_RUNTIME_TEXT {
                return Err("file exceeds 5 MiB".into());
            }
            Ok(Value::String(
                fs::read_to_string(path).map_err(|error| error.to_string())?,
            ))
        }
        "fs.writeText" => {
            let text = string_param(&params, "text")?;
            if text.len() as u64 > MAX_RUNTIME_TEXT {
                return Err("file exceeds 5 MiB".into());
            }
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(path, text).map_err(|error| error.to_string())?;
            Ok(json!({"written": true}))
        }
        "fs.listDir" => {
            let mut names = fs::read_dir(path)
                .map_err(|error| error.to_string())?
                .map(|entry| {
                    entry
                        .map(|value| value.file_name().to_string_lossy().to_string())
                        .map_err(|error| error.to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            names.sort();
            Ok(json!(names))
        }
        "fs.createDir" => {
            fs::create_dir_all(path).map_err(|error| error.to_string())?;
            Ok(json!({"created": true}))
        }
        "fs.remove" => {
            if path.is_dir() {
                fs::remove_dir_all(path).map_err(|error| error.to_string())?;
            } else if path.exists() {
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
            Ok(json!({"removed": true}))
        }
        _ => Err("PERMISSION_DENIED: unsupported filesystem method".into()),
    }
}

fn fetch_https(params: &Value) -> Result<Value, String> {
    let url = string_param(params, "url")?;
    let parsed = url::Url::parse(url).map_err(|_| "invalid URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("PERMISSION_DENIED: HTTPS required".into());
    }
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(3))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(parsed)
        .header(reqwest::header::USER_AGENT, "NextLeek-Plugin/0.1")
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let status = response.status().as_u16();
    let mut body = String::new();
    response
        .take(MAX_NETWORK_TEXT + 1)
        .read_to_string(&mut body)
        .map_err(|error| error.to_string())?;
    if body.len() as u64 > MAX_NETWORK_TEXT {
        return Err("network response exceeds 1 MiB".into());
    }
    Ok(json!({"status": status, "body": body}))
}
