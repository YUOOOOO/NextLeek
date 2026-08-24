use nextleek_desktop::{
    close_plugin, create_draft, launch_plugin, list_plugins, package_draft, plugin_sdk_call,
    runtime_summary, set_plugin_trust, validate_draft, AppState,
};
use nextleek_kernel::{CreatorWorkspace, Manifest};
use serde_json::json;
use std::fs;

fn builtins() -> Vec<Manifest> {
    [r#"{"id":"com.nextleek.dashboard","name":"仪表盘","version":"1.0.0","entry":"ui/index.html","minCreatorVersion":"0.1.0","capabilities":[],"permissions":[],"navigation":{"enabled":true,"label":"仪表盘","order":10}}"#]
        .iter()
        .map(|json| Manifest::parse(json).unwrap())
        .collect()
}

#[test]
fn commands_expose_builtins_and_real_creator_package() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::new(root.path(), builtins()).unwrap();
    assert_eq!(runtime_summary(&state).unwrap().plugin_count, 1);
    assert_eq!(list_plugins(&state).unwrap().len(), 1);

    create_draft(&state, "my-dashboard".into(), builtins()[0].clone()).unwrap();
    assert!(validate_draft(&state, "my-dashboard".into()).unwrap().valid);
    let package = package_draft(&state, "my-dashboard".into()).unwrap();
    assert_eq!(package.plugin_id, "com.nextleek.dashboard");
    assert!(package.path.is_file());
    assert_eq!(package.sha256.len(), 64);
}

#[test]
fn command_bridge_rejects_traversal() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::new(root.path(), builtins()).unwrap();
    assert!(create_draft(&state, "../escape".into(), builtins()[0].clone()).is_err());
}

#[test]
fn builtin_dashboard_launches_offline_and_closed_token_stops_working() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::new(root.path(), builtins()).unwrap();
    let launch = launch_plugin(&state, "com.nextleek.dashboard".into()).unwrap();
    assert!(launch.trusted);
    assert!(launch.entry_html.contains("仪表盘"));
    assert_ne!(launch.token, launch_plugin(&state, "com.nextleek.dashboard".into()).unwrap().token);

    close_plugin(&state, launch.token.clone()).unwrap();
    assert!(plugin_sdk_call(
        &state,
        launch.token,
        "runtime.summary".into(),
        json!({}),
    )
    .is_err());
}

#[test]
fn market_plugin_defaults_to_sandbox_and_trust_can_be_revoked() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::new(root.path(), builtins()).unwrap();
    let creator = CreatorWorkspace::new(
        root.path().join("external-drafts"),
        root.path().join("unused-installed"),
    )
    .unwrap();
    let manifest = Manifest::parse(
        r#"{"id":"com.example.files","name":"Files","version":"1.0.0","entry":"ui/index.html","minCreatorVersion":"0.1.0","capabilities":[],"permissions":["filesystem:trusted"]}"#,
    )
    .unwrap();
    creator.create("files", &manifest).unwrap();
    creator
        .write_file("files", "ui/index.html", b"<main>Files</main>")
        .unwrap();
    let bytes = fs::read(creator.package("files").unwrap().path).unwrap();
    nextleek_desktop::install_local_package(&state, bytes).unwrap();

    let sandbox = launch_plugin(&state, manifest.id.clone()).unwrap();
    assert!(!sandbox.trusted);
    assert!(plugin_sdk_call(
        &state,
        sandbox.token,
        "fs.listDir".into(),
        json!({"path": root.path()}),
    )
    .is_err());

    set_plugin_trust(&state, manifest.id.clone(), true).unwrap();
    let trusted = launch_plugin(&state, manifest.id.clone()).unwrap();
    assert!(trusted.trusted);
    assert!(plugin_sdk_call(
        &state,
        trusted.token.clone(),
        "fs.listDir".into(),
        json!({"path": root.path()}),
    )
    .is_ok());
    set_plugin_trust(&state, manifest.id, false).unwrap();
    assert!(plugin_sdk_call(
        &state,
        trusted.token,
        "fs.listDir".into(),
        json!({"path": root.path()}),
    )
    .is_err());
}
