use nextleek_kernel::package::MAX_PACKAGE_SIZE;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;

const MAX_INDEX_SIZE: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarketCatalog {
    pub schema_version: u32,
    pub updated_at: String,
    pub plugins: Vec<MarketPlugin>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarketPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    pub package_url: String,
    pub sha256: String,
    pub min_creator_version: String,
    #[serde(default)]
    pub permissions: Vec<String>,
}

pub fn fetch_catalog(url: &str, creator_version: &str) -> Result<MarketCatalog, String> {
    require_https(url)?;
    let bytes = fetch_bounded(url, MAX_INDEX_SIZE)?;
    let mut catalog: MarketCatalog =
        serde_json::from_slice(&bytes).map_err(|error| format!("MARKET_INDEX_INVALID: {error}"))?;
    if catalog.schema_version != 1 {
        return Err("MARKET_INDEX_INVALID: unsupported schema version".into());
    }
    let creator = Version::parse(creator_version).map_err(|_| "invalid Creator version")?;
    for plugin in &catalog.plugins {
        require_https(&plugin.package_url)?;
        Version::parse(&plugin.version)
            .map_err(|_| "MARKET_INDEX_INVALID: invalid plugin version".to_string())?;
        let minimum = Version::parse(&plugin.min_creator_version)
            .map_err(|_| "MARKET_INDEX_INVALID: invalid minimum Creator version".to_string())?;
        if plugin.sha256.len() != 64
            || !plugin.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("MARKET_INDEX_INVALID: invalid SHA-256".into());
        }
        if creator < minimum {
            continue;
        }
    }
    catalog.plugins.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(catalog)
}

pub fn download_package(plugin: &MarketPlugin) -> Result<Vec<u8>, String> {
    require_https(&plugin.package_url)?;
    fetch_bounded(&plugin.package_url, MAX_PACKAGE_SIZE)
        .map_err(|error| format!("DOWNLOAD_FAILED: {error}"))
}

fn fetch_bounded(url: &str, limit: u64) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(3))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "NextLeek/0.1")
        .send()
        .map_err(|error| format!("MARKET_UNAVAILABLE: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("MARKET_UNAVAILABLE: HTTP {}", response.status()));
    }
    if response.content_length().is_some_and(|size| size > limit) {
        return Err("response exceeds size limit".into());
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("response exceeds size limit".into());
    }
    Ok(bytes)
}

fn require_https(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "MARKET_INDEX_INVALID: invalid URL")?;
    if parsed.scheme() != "https" {
        return Err("MARKET_INDEX_INVALID: HTTPS required".into());
    }
    Ok(())
}
