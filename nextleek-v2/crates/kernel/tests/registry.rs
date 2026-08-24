use nextleek_kernel::{CapabilityRegistry, Manifest};

fn plugin(id: &str, version: &str, capability: &str) -> Manifest {
    Manifest::parse(&format!(r#"{{"id":"{id}","name":"Demo","version":"{version}","entry":"ui/index.html","minCreatorVersion":"0.1.0","capabilities":["{capability}"],"permissions":[]}}"#)).unwrap()
}

#[test]
fn indexes_providers_deterministically_and_filters_versions() {
    let mut registry = CapabilityRegistry::default();
    registry
        .register(plugin("com.example.zeta", "2.0.0", "quote.read"))
        .unwrap();
    registry
        .register(plugin("com.example.alpha", "1.2.0", "quote.read"))
        .unwrap();
    let providers = registry.providers("quote.read", ">=1.0,<2.0").unwrap();
    assert_eq!(
        providers.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
        ["com.example.alpha"]
    );
}

#[test]
fn rejects_duplicate_plugins_and_hides_disabled_plugins() {
    let p = plugin("com.example.notes", "1.0.0", "notes.read");
    let mut registry = CapabilityRegistry::default();
    registry.register(p.clone()).unwrap();
    assert!(registry.register(p).is_err());
    registry.set_enabled("com.example.notes", false).unwrap();
    assert!(registry.providers("notes.read", "*").unwrap().is_empty());
}
