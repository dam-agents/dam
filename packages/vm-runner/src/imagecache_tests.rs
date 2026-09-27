use std::os::unix::fs::PermissionsExt;

use super::*;
use crate::api::REASON_IMAGE_UNAVAILABLE;
use crate::cacheapi::{self, CacheClient};
use crate::fetch::failure_reason;

// TEST_OVERVIEW: the image cache's one writer — the node service, or a runner on its own claim. It resolves a reference to a digest, fetches that digest once for every caller, holds what callers name so eviction spares it, and on a shared cache serves a privately fetched entry only to a caller whose credentials read it. The node service reaches runners over a Unix socket, and the end-to-end tests drive that socket in-process.

// UNIT_BOUNDARY_DESCRIPTION: a crane that answers the four questions the cache asks — which digest a tag names, what an image says to run, what its manifest says it weighs, and what its filesystem holds — and logs each call. A tag's digest is a hash of its repository, the platform asked for and the contents of `moved`, so a test moves a tag by writing that file; `registry-down` makes every resolution fail. The manifest weighs what `size` says, an export waits while `hold-export` exists, and fails while `export-fails` does.
const PUBLIC_CRANE: &str = r#"#!/bin/sh
here="$(dirname "$0")"
echo "$@" >> "$here/crane.log"
case "$1" in
  digest)
    if [ -f "$here/registry-down" ]; then echo 'connection refused' >&2; exit 1; fi
    moved=$(cat "$here/moved" 2>/dev/null)
    printf 'sha256:%s\n' "$(printf '%s%s%s' "${2%@*}" "$4" "$moved" | sha256sum | cut -c1-64)"
    exit 0;;
  config) printf '{"config":{"Entrypoint":["/entry"],"Cmd":["serve"]}}'; exit 0;;
  manifest) printf '{"config":{"size":1},"layers":[{"size":%s}]}' "$(cat "$here/size" 2>/dev/null || echo 1)"; exit 0;;
esac
while [ -f "$here/hold-export" ]; do sleep 0.02; done
if [ -f "$here/export-fails" ]; then echo 'unexpected EOF' >&2; exit 1; fi
d=$(mktemp -d); echo rootfs > "$d/hello"; tar -cf - -C "$d" .; rm -rf "$d"
"#;

// UNIT_BOUNDARY_DESCRIPTION: three registries holding one private image. quay.io/x/vm answers only the credential `c2VjcmV0`, mirror.io/x/vm only `b3RoZXI=`, and attacker.io answers every manifest read from anyone with the image's digest, while holding none of its bytes.
const ORIGIN_CRANE: &str = r##"#!/bin/sh
here="$(dirname "$0")"
echo "$@" >> "$here/crane.log"
auth=$(cat "$DOCKER_CONFIG/config.json" 2>/dev/null)
case "$2" in
  quay.io/x/vm*) case "$auth" in *c2VjcmV0*) ;; *) echo UNAUTHORIZED >&2; exit 1;; esac;;
  mirror.io/x/vm*) case "$auth" in *b3RoZXI=*) ;; *) echo UNAUTHORIZED >&2; exit 1;; esac;;
  attacker.io/*) if [ "$1" = digest ]; then echo sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff; exit 0; fi; echo 'MANIFEST_UNKNOWN' >&2; exit 1;;
esac
case "$1" in
  digest) echo sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff; exit 0;;
  config) printf '{"config":{"Cmd":["serve"]}}'; exit 0;;
  manifest) exit 1;;
esac
d=$(mktemp -d); echo rootfs > "$d/hello"; tar -cf - -C "$d" .; rm -rf "$d"
"##;

// UNIT_BOUNDARY_DESCRIPTION: a registry that answers only a caller holding the credential `c2VjcmV0`, anonymous reads included.
const PRIVATE_CRANE: &str = r##"#!/bin/sh
here="$(dirname "$0")"
echo "$@" >> "$here/crane.log"
auth=""
if [ -n "$DOCKER_CONFIG" ]; then auth=$(cat "$DOCKER_CONFIG/config.json"); fi
case "$auth" in *c2VjcmV0*) ;; *) echo UNAUTHORIZED >&2; exit 1;; esac
case "$1" in
  digest) echo sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff; exit 0;;
  config) printf '{"config":{"Cmd":["serve"]}}'; exit 0;;
esac
d=$(mktemp -d); echo rootfs > "$d/hello"; tar -cf - -C "$d" .; rm -rf "$d"
"##;

const CREDENTIAL: &str = r#"{"auths":{"quay.io":{"auth":"c2VjcmV0"}}}"#;
const OTHER: &str = r#"{"auths":{"quay.io":{"auth":"b3RoZXI="}}}"#;
const IMAGE: &str = "quay.io/x/vm:1";

struct Fixture {
    dir: crate::testdir::TempDir,
}

impl Fixture {
    fn new(name: &str, crane: &str) -> Self {
        let this = Self {
            dir: crate::testdir::TempDir::new(&format!("imagecache-{name}")),
        };
        this.crane(crane);
        this
    }

    fn crane(&self, script: &str) {
        let path = self.dir.path().join("crane");
        fs::write(&path, script).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn cache(&self, tune: impl FnOnce(&mut CacheConfig)) -> ImageCache {
        let mut config = CacheConfig {
            dir: self.dir.path().join("images"),
            budget: 1 << 40,
            crane: self.dir.path().join("crane").to_string_lossy().into_owned(),
            pins: Vec::new(),
            lifetime: CancellationToken::new(),
            check_access: true,
            ref_fresh: Duration::from_secs(600),
            hold_lease: HOLD_LEASE,
            hold_grace: Duration::ZERO,
            fetch_ceiling: None,
        };
        tune(&mut config);
        ImageCache::open(config)
    }

    fn calls(&self, op: &str) -> usize {
        fs::read_to_string(self.dir.path().join("crane.log"))
            .unwrap_or_default()
            .lines()
            .filter(|l| l.starts_with(&format!("{op} ")))
            .count()
    }
}

fn resolved(lookup: Lookup) -> Resolved {
    lookup.resolved.expect("the image resolves")
}

// TEST_SCENARIO: the handful of images nearly every owner runs is fetched once per cache. The first resolve fetches and unpacks the image and says so; the second answers from the tree already there, with the same digest and launch, and runs no fetch.
#[test]
fn an_image_is_fetched_once_for_every_caller() {
    let f = Fixture::new("once", PUBLIC_CRANE);
    let cache = f.cache(|_| {});

    let first = cache.resolve(IMAGE, &[]);
    assert!(first.fetched.as_ref().is_some_and(|f| f.ok));
    let first = resolved(first);
    assert_eq!(first.launch.entrypoint, ["/entry"]);
    assert!(cache
        .digest_entry(&first.digest)
        .join(ROOTFS_DIR)
        .join("hello")
        .exists());

    let second = cache.resolve(IMAGE, &[]);
    assert!(second.fetched.is_none(), "a cached image was fetched again");
    assert_eq!(resolved(second).digest, first.digest);
    assert_eq!(f.calls("export"), 1);
    assert!(!fs::read_dir(cache.dir())
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().starts_with(PARTIAL_PREFIX)));
}

// TEST_SCENARIO: two runners creating machines of one uncached image at once must not download it twice. The second caller waits for the first fetch and then finds the tree cached.
#[test]
fn two_callers_after_one_missing_image_fetch_it_once() {
    let f = Fixture::new("concurrent", PUBLIC_CRANE);
    let cache = Arc::new(f.cache(|_| {}));
    let callers: Vec<_> = (0..2)
        .map(|_| {
            let cache = cache.clone();
            std::thread::spawn(move || cache.resolve(IMAGE, &[]).resolved.is_ok())
        })
        .collect();
    for caller in callers {
        assert!(caller.join().unwrap());
    }
    assert_eq!(f.calls("export"), 1);
}

// TEST_SCENARIO: a tag moved in the registry. Inside the freshness window the cache answers from memory without asking the registry; once the window has passed it asks again and fetches the new digest. When the registry is down, a tag it resolved before still boots the digest it last named, and nothing is fetched.
#[test]
fn a_tag_is_resolved_again_only_once_its_answer_is_stale() {
    let f = Fixture::new("moved", PUBLIC_CRANE);
    let fresh = f.cache(|_| {});
    let old = resolved(fresh.resolve(IMAGE, &[])).digest;
    fs::write(f.dir.path().join("moved"), "v2").unwrap();
    assert_eq!(resolved(fresh.resolve(IMAGE, &[])).digest, old);
    assert_eq!(f.calls("digest"), 1, "a fresh answer was asked again");

    let stale = f.cache(|c| c.ref_fresh = Duration::ZERO);
    let first = resolved(stale.resolve(IMAGE, &[])).digest;
    assert_ne!(first, old, "the moved tag booted its old image");
    fs::write(f.dir.path().join("registry-down"), "").unwrap();
    let exports = f.calls("export");
    assert_eq!(resolved(stale.resolve(IMAGE, &[])).digest, first);
    assert_eq!(f.calls("export"), exports);
}

// TEST_SCENARIO: a reference pinned by digest cannot move, so it is never resolved; its entry is the digest it names, fetched by that digest. A tag the registry cannot resolve, and never resolved before, is an image problem rather than a boot to retry.
#[test]
fn a_pinned_reference_is_never_resolved_and_an_unknown_tag_is_refused() {
    let f = Fixture::new("pinned", PUBLIC_CRANE);
    let cache = f.cache(|_| {});
    let digest = format!("sha256:{}", "a".repeat(64));
    let pinned = resolved(cache.resolve(&format!("quay.io/x/vm:1@{digest}"), &[]));
    assert_eq!(pinned.digest, digest);
    assert_eq!(f.calls("digest"), 0);
    let log = fs::read_to_string(f.dir.path().join("crane.log")).unwrap();
    assert!(
        log.lines().any(|l| l
            == format!(
                "export quay.io/x/vm@{digest} - --platform {}",
                fetch::host_platform()
            )),
        "{log}"
    );

    fs::write(f.dir.path().join("registry-down"), "").unwrap();
    let refused = cache
        .resolve("quay.io/x/never:1", &[])
        .resolved
        .unwrap_err();
    assert_eq!(failure_reason(&refused), REASON_IMAGE_UNAVAILABLE);
    let invalid = cache.resolve("../escape", &[]).resolved.unwrap_err();
    assert_eq!(failure_reason(&invalid), REASON_IMAGE_UNAVAILABLE);
}

fn digest_of(cache: &ImageCache, reference: &str) -> String {
    resolved(cache.resolve(reference, &[])).digest
}

// TEST_SCENARIO: an unpacked image is the root filesystem of every machine of it, so eviction takes only what nobody holds. A resolve holds its entry for the caller at once, a hold is kept while it is refreshed inside its lease, and one that lapsed — its runner stopped — leaves its tree to eviction, oldest write first.
#[test]
fn eviction_spares_what_is_held_until_the_hold_lapses() {
    let f = Fixture::new("holds", PUBLIC_CRANE);
    let cache = f.cache(|c| {
        c.budget = 1;
        c.hold_lease = Duration::from_millis(1500);
    });
    let first = digest_of(&cache, "quay.io/x/a:1");
    let second = digest_of(&cache, "quay.io/x/b:1");
    assert!(
        cache.digest_entry(&first).exists(),
        "a tree just resolved was evicted"
    );

    std::thread::sleep(Duration::from_millis(1600));
    cache.hold(&[second.clone()].into()).unwrap();
    let trim = cache.evict(None);
    assert!(
        !cache.digest_entry(&first).exists(),
        "a lapsed hold still pinned its tree"
    );
    assert!(cache.digest_entry(&second).exists());
    assert_eq!(trim.freed.len(), 1);
    assert!(
        trim.used.is_some_and(|used| used > 1),
        "over budget, and reported"
    );
}

// TEST_SCENARIO: a hold only extends. A runner that names fewer digests than another holds — a short list, or a compromised runner's empty one — cannot free a tree another owner's machine is running from.
#[test]
fn a_hold_cannot_drop_what_another_holds() {
    let f = Fixture::new("hold-extends", PUBLIC_CRANE);
    let cache = f.cache(|c| c.budget = 1);
    let held = digest_of(&cache, "quay.io/x/a:1");
    cache.hold(&BTreeSet::new()).unwrap();
    cache.evict(None);
    assert!(cache.digest_entry(&held).exists());
}

// TEST_SCENARIO: any runner on a node may hold over the shared socket, so what a hold makes the service remember is bounded: a digest with no entry on disk is not held at all, and a call naming more digests than any runner's machines could boot is refused whole.
#[test]
fn a_hold_is_bounded_by_what_the_cache_holds() {
    let f = Fixture::new("hold-bounded", PUBLIC_CRANE);
    let cache = f.cache(|_| {});
    let present = digest_of(&cache, IMAGE);
    let absent = format!("sha256:{}", "e".repeat(64));
    cache
        .hold(&[present.clone(), absent.clone()].into())
        .unwrap();
    let holds = locked(&cache.memory).holds.clone();
    assert!(holds.contains_key(&present));
    assert!(
        !holds.contains_key(&absent),
        "a digest with no entry was held"
    );

    let flood: BTreeSet<String> = (0..=HOLDS_PER_CALL)
        .map(|i| format!("sha256:{i:064x}"))
        .collect();
    assert!(cache.hold(&flood).is_err());
}

// TEST_SCENARIO: a hold or a resolve must never wait on the walk that weighs the cache's trees, which on a full node cache reads every file of every image. The walk runs outside the memory lock, so a hold made while one is running returns at once.
#[test]
fn a_hold_does_not_wait_for_the_cache_to_be_weighed() {
    let f = Fixture::new("hold-unblocked", PUBLIC_CRANE);
    let cache = Arc::new(f.cache(|_| {}));
    let digest = digest_of(&cache, IMAGE);
    let weighing = locked(&cache.measuring);
    let holding = {
        let cache = cache.clone();
        std::thread::spawn(move || cache.hold(&[digest].into()))
    };
    let started = Instant::now();
    while !holding.is_finished() {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "a hold waited on the walk"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
    drop(weighing);
    holding.join().unwrap().unwrap();
}

// TEST_SCENARIO: eviction deletes outside the memory lock, so a resolve can reach an entry while it is chosen. An entry a resolve is reading is passed over rather than deleted under it, and taken by a later pass once it is free again; a resolve that comes after the delete finds it gone and fetches it again.
#[test]
fn eviction_passes_over_an_entry_a_resolve_is_reading() {
    let f = Fixture::new("evict-reading", PUBLIC_CRANE);
    let cache = f.cache(|c| {
        c.budget = 1;
        c.hold_lease = Duration::ZERO;
    });
    let digest = digest_of(&cache, IMAGE);
    let gate = cache.fetch_gate(&digest);
    let reading = locked(&gate);
    assert!(cache.evict(None).freed.is_empty());
    assert!(cache.digest_entry(&digest).exists());
    drop(reading);

    assert_eq!(cache.evict(None).freed.len(), 1);
    assert!(!cache.digest_entry(&digest).exists());
    let exports = f.calls("export");
    assert!(cache.resolve(IMAGE, &[]).fetched.is_some_and(|f| f.ok));
    assert_eq!(f.calls("export"), exports + 1);
}

// TEST_SCENARIO: a node cache whose every tree is held cannot evict, so each further fetch would grow it without bound. Past its ceiling it refuses to fetch, as a capacity problem rather than a problem with the image, while an image it already holds still boots.
#[test]
fn a_node_cache_past_its_ceiling_refuses_to_fetch() {
    let f = Fixture::new("ceiling", PUBLIC_CRANE);
    let cache = f.cache(|c| {
        c.budget = 1;
        c.fetch_ceiling = node_fetch_ceiling(1);
    });
    let held = digest_of(&cache, IMAGE);
    let refused = cache.resolve("quay.io/x/other:1", &[]);
    let error = refused.resolved.unwrap_err();
    assert_eq!(failure_reason(&error), crate::api::REASON_OUT_OF_CAPACITY);
    assert!(refused.fetched.is_none(), "a refused fetch was started");
    assert_eq!(resolved(cache.resolve(IMAGE, &[])).digest, held);
}

// TEST_SCENARIO: the node service forgets every hold when it restarts. Until the runners have named theirs again, nothing is evicted, however far over budget the cache is.
#[test]
fn nothing_is_evicted_during_the_grace_after_opening() {
    let f = Fixture::new("grace", PUBLIC_CRANE);
    let digest = digest_of(&f.cache(|_| {}), IMAGE);
    let restarted = f.cache(|c| {
        c.budget = 1;
        c.hold_lease = Duration::ZERO;
        c.hold_grace = Duration::from_secs(60);
    });
    restarted.evict(None);
    assert!(restarted.digest_entry(&digest).exists());
}

// TEST_SCENARIO: a pass preloads each harness image the install ships and holds it as a pin, so eviction never takes an image nobody is running yet — it is held by no machine and is the oldest write. A second pass resolves again and fetches nothing.
#[test]
fn a_preload_pass_fetches_what_is_missing_and_pins_it() {
    let f = Fixture::new("preload", PUBLIC_CRANE);
    let cache = f.cache(|c| {
        c.budget = 1;
        c.hold_lease = Duration::ZERO;
        c.pins = vec![IMAGE.into(), "../bad".into()];
    });
    cache.preload(&[]);
    let pinned = digest_of(&cache, IMAGE);
    let other = digest_of(&cache, "quay.io/x/other:1");
    cache.evict(None);
    assert!(cache.digest_entry(&pinned).exists(), "a pin was evicted");
    assert!(!cache.digest_entry(&other).exists());
    let exports = f.calls("export");
    cache.preload(&[]);
    assert_eq!(f.calls("export"), exports, "a warm cache was fetched again");
}

// TEST_SCENARIO: every owner's runner on a node shares the cache, so an image one owner fetched with credentials is not another's to boot by naming it. A caller with no credential, or one the registry refuses, is refused the cached entry as an image problem; one whose credential reads the manifest boots the tree already there without fetching it again. What is known about an entry is kept in memory, so after a restart the check is made again and still fails closed.
#[test]
fn a_private_entry_is_served_only_to_credentials_that_read_it() {
    let f = Fixture::new("private", PRIVATE_CRANE);
    let cache = f.cache(|_| {});
    let credential = [CREDENTIAL.to_string()];
    assert!(cache.resolve(IMAGE, &credential).resolved.is_ok());

    for auths in [vec![], vec![OTHER.to_string()]] {
        let refused = cache.resolve(IMAGE, &auths).resolved.unwrap_err();
        assert_eq!(failure_reason(&refused), REASON_IMAGE_UNAVAILABLE);
        assert!(
            refused.to_string().contains("private registry"),
            "{refused}"
        );
    }
    let exports = f.calls("export");
    assert!(cache.resolve(IMAGE, &credential).resolved.is_ok());
    assert_eq!(
        f.calls("export"),
        exports,
        "a readable private image was fetched again"
    );

    let restarted = f.cache(|_| {});
    let digest = format!("sha256:{}", "f".repeat(64));
    let pinned = format!("quay.io/x/vm@{digest}");
    assert!(restarted.resolve(&pinned, &[]).resolved.is_err());
    assert!(restarted.resolve(&pinned, &credential).resolved.is_ok());
}

// TEST_SCENARIO: an image fetched with a credential that an anonymous read also reaches is public, so any caller boots it, even with the registry down. A cache that is not shared, a runner's own, never checks at all.
#[test]
fn a_public_entry_boots_for_anyone_without_asking_the_registry() {
    let f = Fixture::new("public", PUBLIC_CRANE);
    let cache = f.cache(|_| {});
    assert!(cache
        .resolve(IMAGE, &[CREDENTIAL.to_string()])
        .resolved
        .is_ok());
    fs::write(f.dir.path().join("registry-down"), "").unwrap();
    assert!(cache.resolve(IMAGE, &[]).resolved.is_ok());

    let own = Fixture::new("unshared", PRIVATE_CRANE);
    let unshared = own.cache(|c| c.check_access = false);
    assert!(unshared
        .resolve(IMAGE, &[CREDENTIAL.to_string()])
        .resolved
        .is_ok());
    assert!(unshared.resolve(IMAGE, &[]).resolved.is_ok());
}

// TEST_SCENARIO: a runner reaches the node service over a Unix socket in the cache directory. A resolve comes back with the digest and launch the service unpacked, a hold is accepted, and a refusal keeps its reason across the socket, so the controller still tells the person to fix the image. A client with no service behind the socket says it was unreachable, as an image problem.
#[tokio::test(flavor = "multi_thread")]
async fn a_runner_reaches_the_service_over_its_socket() {
    let f = Fixture::new("socket", PRIVATE_CRANE);
    let cache = Arc::new(f.cache(|_| {}));
    let socket = cache.dir().join(".cache.sock");
    let stop = CancellationToken::new();
    let serving = tokio::spawn({
        let (socket, cache, stop) = (socket.clone(), cache.clone(), stop.clone());
        async move { cacheapi::serve(&socket, cache, async move { stop.cancelled().await }).await }
    });
    while !socket.exists() {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let client = CacheClient::new(socket.clone());
    let answer = tokio::task::spawn_blocking(move || {
        let ok = client.resolve(IMAGE, &[CREDENTIAL.to_string()]);
        let refused = client.resolve(IMAGE, &[]);
        let held = client.hold(&[format!("sha256:{}", "f".repeat(64))].into());
        (ok, refused, held)
    })
    .await
    .unwrap();

    let (ok, refused, held) = answer;
    assert!(ok.fetched.is_some_and(|f| f.ok));
    let ok = ok.resolved.unwrap();
    assert_eq!(ok.launch.cmd, ["serve"]);
    assert!(cache.digest_entry(&ok.digest).join(ROOTFS_DIR).exists());
    let refused = refused.resolved.unwrap_err();
    assert_eq!(failure_reason(&refused), REASON_IMAGE_UNAVAILABLE);
    assert!(
        refused.to_string().contains("private registry"),
        "{refused}"
    );
    held.unwrap();

    stop.cancel();
    serving.await.unwrap().unwrap();
    let gone = CacheClient::new(f.dir.path().join("no-such.sock"));
    let lookup = tokio::task::spawn_blocking(move || gone.resolve(IMAGE, &[]))
        .await
        .unwrap();
    assert!(lookup.unreachable);
    assert_eq!(
        failure_reason(&lookup.resolved.unwrap_err()),
        REASON_IMAGE_UNAVAILABLE
    );
}

fn scratch_trees(cache: &ImageCache) -> usize {
    fs::read_dir(cache.dir())
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(PARTIAL_PREFIX))
        .count()
}

// TEST_SCENARIO: a multi-arch image read with no platform is read as linux/amd64 on every host, so an arm64 node would unpack a tree it cannot run. Every registry read names this host's platform, and the tree records the platform it was unpacked for. A tree recorded for another platform — a claim that moved to a node of another architecture, under a pinned index digest both share — is fetched again rather than booted.
#[test]
fn an_image_is_read_and_kept_for_the_hosts_platform() {
    let f = Fixture::new("platform", PUBLIC_CRANE);
    let cache = f.cache(|_| {});
    let digest = digest_of(&cache, IMAGE);
    let platform = fetch::host_platform();
    let log = fs::read_to_string(f.dir.path().join("crane.log")).unwrap();
    for op in ["digest", "config", "manifest", "export"] {
        let line = log
            .lines()
            .find(|l| l.starts_with(&format!("{op} ")))
            .unwrap_or_else(|| panic!("no {op} call: {log}"));
        assert!(line.ends_with(&format!(" --platform {platform}")), "{line}");
    }
    let entry = cache.digest_entry(&digest);
    assert_eq!(read_origin(&entry).unwrap().platform, platform);

    let pinned = format!("quay.io/x/vm@{digest}");
    fs::write(
        entry.join(ORIGIN_FILE),
        r#"{"platform":"linux/s390x","repositories":["quay.io/x/vm"]}"#,
    )
    .unwrap();
    let again = cache.resolve(&pinned, &[]);
    assert!(
        again.fetched.is_some_and(|f| f.ok),
        "a tree of another platform was booted"
    );
    assert_eq!(f.calls("export"), 2);
    assert_eq!(read_origin(&entry).unwrap().platform, platform);
    assert_eq!(scratch_trees(&cache), 0);
}

// TEST_SCENARIO: eviction must never leave a partly deleted tree under an entry's name, because the name is all a lookup checks and the tree would be booted as complete. An evicted entry leaves its name in one rename, to a scratch name no lookup matches, and only then is deleted; a writer killed before the delete finished leaves a scratch tree, which the next open reclaims.
#[test]
fn an_evicted_entry_leaves_its_name_in_one_step() {
    let f = Fixture::new("evict-atomic", PUBLIC_CRANE);
    let cache = f.cache(|_| {});
    let entry = cache.digest_entry(&digest_of(&cache, IMAGE));
    let aside = cache.discard(&entry).unwrap().expect("the entry was there");
    assert!(!entry.exists());
    assert!(
        aside.path().join(ROOTFS_DIR).join("hello").exists(),
        "the tree was deleted while it still had the entry's name"
    );
    assert!(aside
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with(PARTIAL_PREFIX));
    std::mem::forget(aside);
    assert!(cache.discard(&entry).unwrap().is_none());

    let reopened = f.cache(|_| {});
    assert_eq!(scratch_trees(&reopened), 0, "a half-deleted tree survived");
}

// TEST_SCENARIO: a tree with no launch record beside it is not an entry anyone may boot — what an older writer that died mid-eviction left, or anything else incomplete. A fetch of its digest puts a whole new tree in its place rather than leaving the stale one to be served, and none of the stale tree's files survive.
#[test]
fn a_fetch_replaces_an_incomplete_tree_under_its_name() {
    let f = Fixture::new("replace", PUBLIC_CRANE);
    let cache = f.cache(|_| {});
    let digest = format!("sha256:{}", "b".repeat(64));
    let entry = cache.digest_entry(&digest);
    fs::create_dir_all(entry.join(ROOTFS_DIR)).unwrap();
    fs::write(entry.join(ROOTFS_DIR).join("stale"), "left behind").unwrap();

    let lookup = cache.resolve(&format!("quay.io/x/vm@{digest}"), &[]);
    assert!(lookup.fetched.is_some_and(|f| f.ok));
    assert!(entry.join(ROOTFS_DIR).join("hello").exists());
    assert!(!entry.join(ROOTFS_DIR).join("stale").exists());
    assert!(entry.join(LAUNCH_FILE).exists());
    assert_eq!(scratch_trees(&cache), 0);

    let truncated = format!("sha256:{}", "d".repeat(64));
    let entry = cache.digest_entry(&truncated);
    fs::create_dir_all(entry.join(ROOTFS_DIR)).unwrap();
    fs::write(entry.join(LAUNCH_FILE), "{").unwrap();
    let lookup = cache.resolve(&format!("quay.io/x/vm@{truncated}"), &[]);
    assert!(lookup.fetched.is_some_and(|f| f.ok));
    assert!(read_launch(&entry).unwrap().is_some());
}

// TEST_SCENARIO: anyone can name a digest under a registry of their own that answers every manifest read. A private tree must not be served, or marked public, because a caller's own repository claims to hold its digest: access is checked against the repositories the tree was fetched from. A caller naming the digest elsewhere proves its access by fetching the digest from there, which a registry that lacks the bytes cannot answer; one that holds them joins the tree's origins, so that caller reuses the tree from then on without fetching it again.
#[test]
fn a_private_entry_is_checked_where_it_came_from() {
    let f = Fixture::new("origin", ORIGIN_CRANE);
    let cache = f.cache(|_| {});
    let digest = resolved(cache.resolve(IMAGE, &[CREDENTIAL.to_string()])).digest;

    let attacker = cache.resolve(&format!("attacker.io/x@{digest}"), &[]);
    assert!(attacker.resolved.is_err(), "a lying registry won the tree");
    assert!(!locked(&cache.memory).public.contains(&digest));
    let anonymous = cache
        .resolve(&format!("quay.io/x/vm@{digest}"), &[])
        .resolved
        .unwrap_err();
    assert!(
        anonymous.to_string().contains("private registry"),
        "{anonymous}"
    );
    assert_eq!(f.calls("export"), 1);

    let mirror = format!("mirror.io/x/vm@{digest}");
    let proven = cache.resolve(&mirror, &[OTHER.to_string()]);
    assert!(proven.fetched.is_some_and(|f| f.ok));
    let origins = read_origin(&cache.digest_entry(&digest))
        .unwrap()
        .repositories;
    assert_eq!(
        origins,
        ["mirror.io/x/vm".to_string(), "quay.io/x/vm".to_string()].into()
    );
    let exports = f.calls("export");
    assert!(cache
        .resolve(&mirror, &[OTHER.to_string()])
        .fetched
        .is_none());
    assert_eq!(f.calls("export"), exports);
    assert!(!locked(&cache.memory).public.contains(&digest));
}

// TEST_SCENARIO: the node's fetch ceiling is what keeps runners that share its socket from filling the disk with trees nobody may evict. Fetches that start together must not each find the cache under its ceiling: a fetch reserves what its manifest weighs for as long as it runs, and the next is refused, as a capacity problem, while the reserved bytes take the cache past the ceiling. The reservation is given back when the fetch ends.
#[test]
fn fetches_under_way_count_against_the_ceiling() {
    let f = Fixture::new("in-flight", PUBLIC_CRANE);
    fs::write(f.dir.path().join("size"), "1000").unwrap();
    fs::write(f.dir.path().join("hold-export"), "").unwrap();
    let cache = Arc::new(f.cache(|c| {
        c.budget = 100;
        c.fetch_ceiling = node_fetch_ceiling(100);
    }));
    let first = {
        let cache = cache.clone();
        std::thread::spawn(move || cache.resolve("quay.io/x/a:1", &[]).resolved.is_ok())
    };
    let started = Instant::now();
    while f.calls("export") == 0 {
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "no fetch began"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    let refused = cache.resolve("quay.io/x/b:1", &[]);
    assert_eq!(
        failure_reason(&refused.resolved.unwrap_err()),
        crate::api::REASON_OUT_OF_CAPACITY
    );
    assert!(refused.fetched.is_none());
    fs::remove_file(f.dir.path().join("hold-export")).unwrap();
    assert!(first.join().unwrap());
    assert_eq!(locked(&cache.memory).in_flight, 0);
}

// TEST_SCENARIO: a hold is how eviction knows a tree is in use, and every runner on the node can make the service resolve any digest. A resolve that fails leaves nothing on disk and so holds nothing, or naming digests that do not exist would grow what the service remembers without bound.
#[test]
fn a_resolve_that_fails_holds_nothing() {
    let f = Fixture::new("hold-failed", PUBLIC_CRANE);
    fs::write(f.dir.path().join("export-fails"), "").unwrap();
    let cache = f.cache(|_| {});
    let digest = format!("sha256:{}", "c".repeat(64));
    let failed = cache.resolve(&format!("quay.io/x/vm@{digest}"), &[]);
    let error = failed.resolved.unwrap_err();
    assert_eq!(
        failure_reason(&error),
        REASON_IMAGE_UNAVAILABLE,
        "{error:#}"
    );
    assert!(failed.fetched.is_some_and(|f| !f.ok));
    assert!(locked(&cache.memory).holds.is_empty());
    assert_eq!(scratch_trees(&cache), 0);
}
