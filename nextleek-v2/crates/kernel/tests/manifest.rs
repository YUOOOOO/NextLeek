use nextleek_kernel::{Manifest, ManifestError};

fn valid_json() -> &'static str {
    r#"{"id":"com.nextleek.notes","name":"Notes","version":"1.0.0","entry":"ui/index.html","capabilities":["notes.read","notes.write"],"permissions":["storage:local"]}"#
}

#[test]
fn parses_a_valid_declarative_manifest() {
    let manifest = Manifest::parse(valid_json()).unwrap();
    assert_eq!(manifest.id, "com.nextleek.notes");
}

#[test]
fn rejects_invalid_ids_versions_paths_duplicates_and_permissions() {
    let cases = [
        (
            valid_json().replace("com.nextleek.notes", "Notes"),
            ManifestError::InvalidId,
        ),
        (
            valid_json().replace("1.0.0", "latest"),
            ManifestError::InvalidVersion,
        ),
        (
            valid_json().replace("ui/index.html", "../evil.exe"),
            ManifestError::UnsafeEntry,
        ),
        (
            valid_json().replace(
                "\"notes.read\",\"notes.write\"",
                "\"notes.read\",\"notes.read\"",
            ),
            ManifestError::DuplicateCapability,
        ),
        (
            valid_json().replace("storage:local", "process:spawn"),
            ManifestError::UndeclaredPermission,
        ),
    ];
    for (json, expected) in cases {
        assert_eq!(Manifest::parse(&json).unwrap_err(), expected);
    }
}
