use nextleek_kernel::{CreatorError, CreatorWorkspace, Manifest};
use std::fs;

fn template(id: &str) -> Manifest {
    Manifest::parse(&format!(r#"{{"id":"{id}","name":"Draft","version":"0.1.0","entry":"ui/index.html","minCreatorVersion":"0.1.0","capabilities":["notes.read"],"permissions":["storage:local"]}}"#)).unwrap()
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
fn validates_and_builds_a_reproducible_real_package() {
    let root = tempfile::tempdir().unwrap();
    let creator =
        CreatorWorkspace::new(root.path().join("drafts"), root.path().join("installed")).unwrap();
    creator
        .create("safe", &template("com.example.safe"))
        .unwrap();
    creator
        .write_file("safe", "ui/index.html", b"<main>safe</main>")
        .unwrap();
    creator
        .write_file("safe", "ui/main.js", b"document.body.dataset.ready = 'yes'")
        .unwrap();
    assert!(creator.validate("safe").unwrap().valid);

    let first = creator.package("safe").unwrap();
    let first_bytes = fs::read(&first.path).unwrap();
    let second = creator.package("safe").unwrap();
    assert_eq!(first.sha256, second.sha256);
    assert_eq!(first_bytes, fs::read(&second.path).unwrap());
    assert_eq!(
        first.files,
        ["manifest.json", "ui/index.html", "ui/main.js"]
    );
    assert!(first.path.extension().is_some_and(|value| value == "nlplugin"));
}

#[test]
fn validation_requires_the_declared_entry_file() {
    let root = tempfile::tempdir().unwrap();
    let creator =
        CreatorWorkspace::new(root.path().join("drafts"), root.path().join("installed")).unwrap();
    creator
        .create("missing", &template("com.example.missing"))
        .unwrap();
    let report = creator.validate("missing").unwrap();
    assert!(!report.valid);
    assert_eq!(report.errors, ["PLUGIN_ENTRY_MISSING"]);
}
