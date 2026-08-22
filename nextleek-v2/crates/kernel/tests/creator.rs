use nextleek_kernel::{CreatorError, CreatorWorkspace, Manifest};
use std::fs;

fn template(id: &str) -> Manifest {
    Manifest::parse(&format!(r#"{{"id":"{id}","name":"Draft","version":"0.1.0","entry":"ui/index.html","capabilities":["notes.read"],"permissions":["storage:local"]}}"#)).unwrap()
}

#[test]
fn creates_isolated_draft_and_never_writes_installed_directory() {
    let root = tempfile::tempdir().unwrap();
    let installed = root.path().join("installed");
    let creator = CreatorWorkspace::new(root.path().join("drafts"), installed.clone()).unwrap();
    let draft = creator
        .create("first-draft", &template("com.example.first"))
        .unwrap();
    assert!(draft.join("manifest.json").is_file());
    assert!(!installed.exists());
}

#[test]
fn rejects_traversal_and_native_or_sidecar_files() {
    let root = tempfile::tempdir().unwrap();
    let creator =
        CreatorWorkspace::new(root.path().join("drafts"), root.path().join("installed")).unwrap();
    assert_eq!(
        creator
            .create("../escape", &template("com.example.bad"))
            .unwrap_err(),
        CreatorError::UnsafeDraftId
    );
    creator
        .create("safe", &template("com.example.safe"))
        .unwrap();
    assert_eq!(
        creator
            .write_file("safe", "bin/tool.exe", b"bad")
            .unwrap_err(),
        CreatorError::ForbiddenArtifact
    );
    assert_eq!(
        creator
            .write_file("safe", "sidecar.json", b"bad")
            .unwrap_err(),
        CreatorError::ForbiddenArtifact
    );
}

#[test]
fn validates_draft_and_returns_sorted_package_inventory() {
    let root = tempfile::tempdir().unwrap();
    let creator =
        CreatorWorkspace::new(root.path().join("drafts"), root.path().join("installed")).unwrap();
    creator
        .create("safe", &template("com.example.safe"))
        .unwrap();
    creator
        .write_file("safe", "ui/index.html", b"<main>safe</main>")
        .unwrap();
    let report = creator.validate("safe").unwrap();
    assert!(report.valid);
    let inventory = creator.package_inventory("safe").unwrap();
    assert_eq!(inventory.files, ["manifest.json", "ui/index.html"]);
    assert_eq!(
        fs::read_to_string(root.path().join("drafts/safe/manifest.json"))
            .unwrap()
            .contains("com.example.safe"),
        true
    );
}
