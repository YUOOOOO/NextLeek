use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_MARKET_URL: &str =
    "https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/index.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub market_url: String,
    #[serde(default)]
    pub trusted_plugins: BTreeSet<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            market_url: DEFAULT_MARKET_URL.into(),
            trusted_plugins: BTreeSet::new(),
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    value: Settings,
}

impl SettingsStore {
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = root.join("settings.json");
        let value = if path.exists() {
            serde_json::from_slice(&fs::read(&path).map_err(|error| error.to_string())?)
                .map_err(|error| format!("SETTINGS_INVALID: {error}"))?
        } else {
            Settings::default()
        };
        Ok(Self { path, value })
    }

    pub fn value(&self) -> Settings {
        self.value.clone()
    }

    pub fn set_market_url(&mut self, url: String) -> Result<Settings, String> {
        let parsed = url::Url::parse(&url).map_err(|_| "MARKET_INDEX_INVALID".to_string())?;
        if parsed.scheme() != "https" {
            return Err("MARKET_INDEX_INVALID: HTTPS required".into());
        }
        self.value.market_url = url;
        self.save()?;
        Ok(self.value())
    }

    pub fn set_trusted(&mut self, plugin_id: &str, trusted: bool) -> Result<Settings, String> {
        if trusted {
            self.value.trusted_plugins.insert(plugin_id.to_string());
        } else {
            self.value.trusted_plugins.remove(plugin_id);
        }
        self.save()?;
        Ok(self.value())
    }

    pub fn is_trusted(&self, plugin_id: &str) -> bool {
        self.value.trusted_plugins.contains(plugin_id)
    }

    pub fn remove_plugin(&mut self, plugin_id: &str) -> Result<(), String> {
        if self.value.trusted_plugins.remove(plugin_id) {
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(&self.value).map_err(|error| error.to_string())?;
        let temporary = self.path.with_extension("tmp");
        fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
        if self.path.exists() {
            fs::remove_file(&self.path).map_err(|error| error.to_string())?;
        }
        fs::rename(temporary, &self.path).map_err(|error| error.to_string())
    }
}
