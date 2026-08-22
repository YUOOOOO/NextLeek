use nextleek_desktop::{
    create_draft, list_plugins, package_draft, runtime_summary, validate_draft, AppState,
};
use nextleek_kernel::Manifest;

fn builtins() -> Vec<Manifest> {
    [
    r#"{"id":"com.nextleek.notes","name":"Notes","version":"1.0.0","entry":"ui/index.html","capabilities":["notes.read"],"permissions":["storage:local"]}"#,
    r#"{"id":"com.nextleek.stocks","name":"Stocks","version":"1.0.0","entry":"ui/index.html","capabilities":["stocks.quote.read"],"permissions":["network:https"]}"#,
  ].iter().map(|json| Manifest::parse(json).unwrap()).collect()
}

#[test]
fn commands_expose_runtime_plugins_and_creator_flow() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::new(root.path(), builtins()).unwrap();
    assert_eq!(runtime_summary(&state).unwrap().plugin_count, 2);
    assert_eq!(list_plugins(&state).unwrap().len(), 2);
    create_draft(&state, "my-notes".into(), builtins()[0].clone()).unwrap();
    assert!(validate_draft(&state, "my-notes".into()).unwrap().valid);
    assert_eq!(
        package_draft(&state, "my-notes".into()).unwrap().plugin_id,
        "com.nextleek.notes"
    );
}

#[test]
fn command_bridge_does_not_accept_traversal() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::new(root.path(), builtins()).unwrap();
    assert!(create_draft(&state, "../escape".into(), builtins()[0].clone()).is_err());
}
