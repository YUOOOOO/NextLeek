use nextleek_kernel::{CreatorWorkspace, Manifest, PluginStore, StoreError};
use std::fs;

fn manifest(version: &str) -> Manifest {
    Manifest::parse(&format!(
        r#"{{"id":"com.example.notes","name":"Notes","version":"{version}","entry":"ui/index.html","minCreatorVersion":"0.1.0","capabilities":[],"permissions":["storage:local"]}}"#
    ))
    .unwrap()
}

fn package(root: &std::path::Path, version: &str, body: &str) -> Vec<u8> {
    let creator = CreatorWorkspace::new(root.join("drafts"), root.join("unused-installed")).unwrap();
    creator.create("notes", &manifest(version)).unwrap();
    creator
        .write_file("notes", "ui/index.html", body.as_bytes())
        .unwrap();
    let artifact = creator.package("notes").unwrap();
    fs::read(artifact.path).unwrap()
}

#[test]
fn installs_lists_activates_and_uninstalls_a_package() {
    let root = tempfile::tempdir().unwrap();
    let store = PluginStore::new(root.path().join("installed")).unwrap();
    let bytes = package(root.path(), "1.0.0", "<main>one</main>");

    let installed = store
        .install_package(&bytes, None, "0.1.0")
        .unwrap();
    assert_eq!(installed.manifest.version, "1.0.0");
    assert_eq!(store.list_installed().unwrap().len(), 1);
    assert_eq!(
        store
            .read_resource("com.example.notes", "ui/index.html")
            .unwrap(),
        b"<main>one</main>"
    );

    store.uninstall("com.example.notes").unwrap();
    assert!(matches!(
        store.active_plugin("com.example.notes"),
        Err(StoreError::NotInstalled)
    ));
}

#[test]
fn rejects_hash_mismatch_without_replacing_the_active_version() {
    let root = tempfile::tempdir().unwrap();
    let store = PluginStore::new(root.path().join("installed")).unwrap();
    let first = package(root.path(), "1.0.0", "<main>one</main>");
    store.install_package(&first, None, "0.1.0").unwrap();
    let second = package(root.path(), "2.0.0", "<main>two</main>");

    assert!(store
        .install_package(&second, Some(&"0".repeat(64)), "0.1.0")
        .is_err());
    assert_eq!(
        store.active_plugin("com.example.notes").unwrap().manifest.version,
        "1.0.0"
    );
}

#[test]
fn activates_a_complete_new_version_only_after_validation() {
    let root = tempfile::tempdir().unwrap();
    let store = PluginStore::new(root.path().join("installed")).unwrap();
    let first = package(root.path(), "1.0.0", "<main>one</main>");
    let second = package(root.path(), "2.0.0", "<main>two</main>");
    store.install_package(&first, None, "0.1.0").unwrap();
    store.install_package(&second, None, "0.1.0").unwrap();

    assert_eq!(
        store.active_plugin("com.example.notes").unwrap().manifest.version,
        "2.0.0"
    );
    assert_eq!(
        store
            .read_resource("com.example.notes", "ui/index.html")
            .unwrap(),
        b"<main>two</main>"
    );
}
