use super::support::*;
use super::*;

// TEST_SCENARIO: the controller sends a machine's registry credential on its spec so a private image can be fetched. It reaches crane alone, through a DOCKER_CONFIG directory only the runner can read that is gone once the fetch ends: never the stored spec, the share the guest mounts, or the runtime.
#[tokio::test(flavor = "multi_thread")]
async fn a_registry_credential_reaches_crane_alone() {
    let h = Harness::new("pull-auth");
    crate::testdir::exec_script(&h.dir.join("crane"), PRIVATE_CRANE);
    h.server.put("m1", with_credential(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    let log = fs::read_to_string(h.dir.join("auth.log")).unwrap();
    for op in ["config", "export"] {
        let line = log
            .lines()
            .find(|l| l.starts_with(&format!("{op} ")))
            .unwrap_or_else(|| panic!("crane {op} ran without the credential: {log}"));
        let fields: Vec<&str> = line.splitn(4, ' ').collect();
        assert_eq!(fields[1], "700", "{line}");
        assert_eq!(fields[3], CREDENTIAL);
        assert!(
            !Path::new(fields[2]).exists(),
            "{} was left behind",
            fields[2]
        );
    }
    for file in files_under(&h.dir.join("machines")) {
        let body = fs::read(&file).unwrap_or_default();
        assert!(
            !String::from_utf8_lossy(&body).contains("c2VjcmV0"),
            "the credential reached {}",
            file.display()
        );
    }
}

// TEST_SCENARIO: a cached private tree is named by its digest, and the staged-image lookup turns a reference into a file name before the cache checks any credential. A machine with no credential that names the digest as a bare reference, in any spelling that maps onto the entry's name, is refused, and never boots the tree another machine fetched with its credential.
#[tokio::test(flavor = "multi_thread")]
async fn a_bare_digest_reference_cannot_boot_a_cached_private_tree() {
    let h = Harness::new("bare-digest");
    crate::testdir::exec_script(&h.dir.join("crane"), PRIVATE_CRANE);
    h.server.put("m1", with_credential(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let hex = "f".repeat(64);
    for (id, image) in [
        ("m2", format!("sha256:{hex}")),
        ("m3", format!("sha256_{hex}")),
        ("m4", format!("SHA256@{hex}")),
        ("m5", format!("sha256/{hex}")),
    ] {
        let bare = MachineSpec {
            image: image.clone(),
            ..spec(true)
        };
        assert_eq!(h.server.put(id, bare).unwrap_err().status, 400, "{image}");
        assert!(!locked(&h.fake.created).contains_key(id), "{image} booted");
    }
}

// TEST_SCENARIO: a pod lists several pull Secrets and the kubelet tries each, so when an Agent's own credential for a registry has gone stale, the install default for that registry still pulls. The runner tries them in the order they were sent: the stale one is refused, the next one reads the config, and the layers are fetched with the one that worked.
#[tokio::test(flavor = "multi_thread")]
async fn a_stale_credential_does_not_hide_a_good_one_listed_after_it() {
    let h = Harness::new("pull-auth-fallback");
    crate::testdir::exec_script(&h.dir.join("crane"), PRIVATE_CRANE);
    let spec = MachineSpec {
        pull_auths: vec![STALE.into(), CREDENTIAL.into()],
        ..spec(true)
    };
    h.server.put("m1", spec).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    let log = fs::read_to_string(h.dir.join("auth.log")).unwrap();
    let with = |op: &str| -> Vec<String> {
        log.lines()
            .filter(|l| l.starts_with(&format!("{op} ")))
            .map(|l| l.splitn(4, ' ').nth(3).unwrap_or_default().to_string())
            .collect()
    };
    assert_eq!(with("config"), [STALE, CREDENTIAL], "{log}");
    assert_eq!(with("export"), [CREDENTIAL], "{log}");
}
