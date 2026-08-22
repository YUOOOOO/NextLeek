use nextleek_kernel::load_manifests_from_dir;

#[test]
fn loads_notes_and_stocks_through_the_same_discovery_path() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/builtin");
    let plugins = load_manifests_from_dir(&root).unwrap();
    assert_eq!(
        plugins.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
        ["com.nextleek.notes", "com.nextleek.stocks"]
    );
}
