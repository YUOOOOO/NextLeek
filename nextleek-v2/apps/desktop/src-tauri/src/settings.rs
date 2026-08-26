use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_MARKET_URL: &str =
    "https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/index.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
}

fn default_enabled() -> bool { true }
fn default_base_url() -> String { "https://api.openai.com/v1".into() }
fn default_model() -> String { "gpt-4.1-mini".into() }
fn default_temperature() -> f32 { 0.2 }

impl Default for AiSettings {
    fn default() -> Self {
        Self { enabled: true, base_url: "https://api.openai.com/v1".into(), api_key: String::new(), model: "gpt-4.1-mini".into(), temperature: 0.2 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub market_url: String,
    #[serde(default)]
    pub trusted_plugins: BTreeSet<String>,
    #[serde(default)]
    pub ai: AiSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self { market_url: DEFAULT_MARKET_URL.into(), trusted_plugins: BTreeSet::new(), ai: AiSettings::default() }
    }
}

pub struct SettingsStore { path: PathBuf, value: Settings }

impl SettingsStore {
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = root.join("settings.json");
        let value = if path.exists() {
            serde_json::from_slice(&fs::read(&path).map_err(|error| error.to_string())?)
                .map_err(|error| format!("SETTINGS_INVALID: {error}"))?
        } else { Settings::default() };
        Ok(Self { path, value })
    }
    pub fn value(&self) -> Settings { self.value.clone() }
    pub fn set_market_url(&mut self, url: String) -> Result<Settings, String> {
        let parsed = url::Url::parse(&url).map_err(|_| "MARKET_INDEX_INVALID".to_string())?;
        if parsed.scheme() != "https" { return Err("MARKET_INDEX_INVALID: HTTPS required".into()); }
        self.value.market_url = url; self.save()?; Ok(self.value())
    }
    pub fn set_ai(&mut self, ai: AiSettings) -> Result<Settings, String> {
        validate_ai(&ai)?; self.value.ai = ai; self.save()?; Ok(self.value())
    }
    pub fn set_trusted(&mut self, plugin_id: &str, trusted: bool) -> Result<Settings, String> {
        if trusted { self.value.trusted_plugins.insert(plugin_id.to_string()); } else { self.value.trusted_plugins.remove(plugin_id); }
        self.save()?; Ok(self.value())
    }
    pub fn is_trusted(&self, plugin_id: &str) -> bool { self.value.trusted_plugins.contains(plugin_id) }
    pub fn remove_plugin(&mut self, plugin_id: &str) -> Result<(), String> {
        if self.value.trusted_plugins.remove(plugin_id) { self.save()?; } Ok(())
    }
    fn save(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(&self.value).map_err(|error| error.to_string())?;
        let temporary = self.path.with_extension("tmp");
        fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
        if self.path.exists() { fs::remove_file(&self.path).map_err(|error| error.to_string())?; }
        fs::rename(temporary, &self.path).map_err(|error| error.to_string())
    }
}

pub fn validate_ai(ai: &AiSettings) -> Result<(), String> {
    let parsed = url::Url::parse(&ai.base_url).map_err(|_| "AI_CONFIG_INVALID: base URL".to_string())?;
    let local_http = parsed.scheme() == "http"
        && parsed.host_str().is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "::1"));
    let secure_remote = parsed.scheme() == "https";
    if !(secure_remote || local_http)
        || ai.base_url.len() > 2048
        || ai.model.trim().is_empty()
        || ai.model.len() > 256
        || ai.api_key.len() > 4096
        || !ai.temperature.is_finite()
        || !(0.0..=2.0).contains(&ai.temperature)
    {
        return Err("AI_CONFIG_INVALID".into());
    }
    Ok(())
}
