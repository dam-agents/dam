use super::support::*;
use super::*;

// TEST_SCENARIO: the handful of images nearly every owner runs is fetched once per cache, not once per machine: a second machine of the same image boots the tree the first one unpacked.
#[tokio::test(flavor = "multi_thread")]
async fn an_image_is_fetched_once_for_every_machine_that_wants_it() {
    let h = Harness::new("fetch-once");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let after_first = h.crane_calls();
    assert_eq!(
        after_first, 4,
        "one resolution, one config read, one manifest read and one export"
    );
    h.server.put("m2", spec(true)).unwrap();
    h.settle("m2").await;
    assert_eq!(
        h.crane_calls(),
        after_first,
        "the second machine fetched the image again"
    );
    let launch = read_launch(&h.entry("m2")).unwrap();
    assert_eq!(launch.unwrap().cmd, vec!["serve"]);
    assert!(
        !fs::read_dir(h.dir.join("images"))
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with(PARTIAL_PREFIX)),
        "a finished fetch left its scratch tree behind"
    );
}

// TEST_SCENARIO: an install with no registry once staged `docker save` archives in the image directory, and nothing boots one any more: smolvm flattens an archive inside the guest, which no guest does since platform-init became its init. An archive left there by hand is refused as an image problem whose message says how to restage it, rather than booted into a guest that never starts its agent, and the registry is not asked instead.
#[tokio::test(flavor = "multi_thread")]
async fn a_staged_archive_is_refused_with_how_to_restage_it() {
    let h = Harness::new("archive");
    crate::testdir::exec_script(
        &h.dir.join("crane"),
        "#!/bin/sh\necho unreachable >&2\nexit 1\n",
    );
    let images = h.dir.join("images");
    fs::create_dir_all(&images).unwrap();
    fs::write(
        archive_path(&images, "quay.io/x/vm:1"),
        b"a docker save archive",
    )
    .unwrap();
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_IMAGE_UNAVAILABLE, "{status:?}");
    assert!(
        status.message.contains("mise run image:stage-vm <image>"),
        "the message names no staging command: {status:?}"
    );
    assert!(
        !status
            .message
            .contains(&format!("VM_IMAGE_DIR={}", images.display())),
        "the message offers the directory this runner reads as one to stage into, and inside a pod that is a mount no staging can write: {status:?}"
    );
    assert!(h.fake.calls().is_empty());
    assert_eq!(h.crane_calls(), 0);
}

// TEST_SCENARIO: a runner pod reads the install's cache directory through a mount, so the path it reads is no directory on the node. The hint names where the node directory is known and never offers the mount: a person who stages into the mount leaves the archive in place that refuses the image, and the next boot refuses it again.
#[test]
fn the_restage_hint_of_a_runner_pod_points_at_the_node_directory() {
    assert_eq!(
        restage_hint(Path::new("/var/lib/platform/images"), false),
        "`mise run image:stage-vm <image>`, with `VM_IMAGE_DIR` set to the node directory this runner's pod mounts its image cache from"
    );
}

// TEST_SCENARIO: a runner outside a cluster owns its image directory, so the hint has to select the host staging mode as well as the directory: a shell a person opens exports no `VM_HOST_RUNNER` and no `PLATFORM_VM_RUNNER_HOME`, and a staging without them stages on the node instead. The home comes from the directory this runner reads, customized or default, and it arrives as one shell word.
#[test]
fn the_restage_hint_of_a_host_runner_stages_on_the_mac_in_its_home() {
    assert_eq!(
        restage_hint(
            Path::new("/Users/example/VM images/it's/platform-vm-runner/images"),
            true
        ),
        r"`VM_HOST_RUNNER=1 PLATFORM_VM_RUNNER_HOME='/Users/example/VM images/it'\''s/platform-vm-runner' mise run image:stage-vm <image>`"
    );
    assert_eq!(
        restage_hint(
            Path::new("/Users/example/.local/state/platform-vm-runner/images"),
            true
        ),
        "`VM_HOST_RUNNER=1 PLATFORM_VM_RUNNER_HOME='/Users/example/.local/state/platform-vm-runner' mise run image:stage-vm <image>`"
    );
}

// TEST_SCENARIO: an install stages an image as a tree with its launch record beside it (image:stage-vm), and the machine boots the tree in place. An archive left under the same name by an earlier install does not refuse the tree.
#[tokio::test(flavor = "multi_thread")]
async fn a_staged_tree_boots_in_place_and_wins_over_the_archive() {
    let h = Harness::new("staged-tree");
    crate::testdir::exec_script(
        &h.dir.join("crane"),
        "#!/bin/sh\necho unreachable >&2\nexit 1\n",
    );
    let images = h.dir.join("images");
    let tree = staged_path(&images, "quay.io/x/vm:1");
    fs::create_dir_all(tree.join(ROOTFS_DIR)).unwrap();
    fs::write(
        tree.join(LAUNCH_FILE),
        r#"{"entrypoint":["/from-tree"],"cmd":[],"env":[],"workingDir":"/"}"#,
    )
    .unwrap();
    fs::write(
        archive_path(&images, "quay.io/x/vm:1"),
        b"a docker save archive",
    )
    .unwrap();
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let (image, launch) = locked(&h.fake.created).get("m1").cloned().unwrap();
    assert_eq!(PathBuf::from(image), tree.join(ROOTFS_DIR));
    assert_eq!(launch.entrypoint, vec!["/from-tree"]);
    assert_eq!(h.crane_calls(), 0);
}

// TEST_SCENARIO: an image that cannot be read is reported as an image problem, which is what tells the person to fix the image rather than wait for a retry.
#[tokio::test(flavor = "multi_thread")]
async fn an_image_that_cannot_be_read_is_reported_as_such() {
    let h = Harness::new("unreadable");
    crate::testdir::exec_script(
        &h.dir.join("crane"),
        "#!/bin/sh\necho 'MANIFEST_UNKNOWN' >&2\nexit 1\n",
    );
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_IMAGE_UNAVAILABLE);
    assert!(status.message.contains("MANIFEST_UNKNOWN"), "{status:?}");
    assert!(h.fake.calls().is_empty());
}

// TEST_SCENARIO: an unpacked image is the root filesystem of every machine of it, so eviction never takes one a machine is running from — the cache goes over its budget instead.
#[tokio::test(flavor = "multi_thread")]
async fn the_cache_never_evicts_an_image_a_machine_is_running() {
    let h = Harness::with("evict", |c| c.image_budget = 1);
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut other = spec(true);
    other.image = "quay.io/x/other:1".into();
    h.server.put("m2", other).unwrap();
    h.settle("m2").await;
    assert!(
        h.entry("m1").exists(),
        "the running machine's image was evicted"
    );
    assert!(h.entry("m2").exists());
}

// TEST_SCENARIO: a reference pinned by digest cannot move, so it is never resolved — its entry is the digest it names, fetched by that digest.
#[tokio::test(flavor = "multi_thread")]
async fn a_pinned_reference_is_never_resolved() {
    let h = Harness::new("pinned");
    let digest = format!("sha256:{}", "a".repeat(64));
    let mut pinned = spec(true);
    pinned.image = format!("quay.io/x/vm:1@{digest}");
    h.server.put("m1", pinned).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(h.crane_log("digest"), 0);
    let fetched = fs::read_to_string(h.dir.join("crane.log")).unwrap();
    assert!(
        fetched
            .lines()
            .any(|l| l.starts_with(&format!("export quay.io/x/vm@{digest} - "))),
        "{fetched}"
    );
    assert_eq!(h.entry("m1"), digest_path(&h.dir.join("images"), &digest));
    assert!(read_launch(&h.entry("m1")).unwrap().is_some());
}

// TEST_SCENARIO: on a node cache the runner fetches nothing itself: it asks the node's service, which unpacks the image into the shared directory, and the machine boots that tree through the runner's own mount of it. The runner then holds the digest, so the service's eviction spares the tree for as long as the runner keeps renewing the hold — past the lease the resolve itself took.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_on_a_node_cache_boots_the_tree_the_service_unpacked() {
    let h = Harness::with("node-cache", on_node_cache);
    let (service, _stop) = node_service(&h, Duration::from_millis(300)).await;
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let (image, launch) = locked(&h.fake.created).get("m1").cloned().unwrap();
    assert_eq!(PathBuf::from(image), h.entry("m1").join(ROOTFS_DIR));
    assert!(h.entry("m1").join(ROOTFS_DIR).join("hello").exists());
    assert_eq!(launch.entrypoint, vec!["/entry"]);
    assert_eq!(h.crane_log("export"), 1, "the service fetched it once");

    tokio::time::sleep(Duration::from_millis(400)).await;
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.hold_images())
        .await
        .unwrap();
    service.evict(None);
    assert!(
        h.entry("m1").exists(),
        "the service evicted a tree the runner holds"
    );
}

// TEST_SCENARIO: a hibernated agent's machine must not keep its tree on the node cache, or every deploy would leave one retired image per stopped machine held until the service refuses every fetch. Once the machine is stopped the runner holds nothing for it, the service evicts the tree, and the next start fetches it again and boots.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_machine_holds_nothing_and_fetches_its_tree_again_on_start() {
    let h = Harness::with("nc-stop", on_node_cache);
    let (service, _stop) = node_service(&h, Duration::from_millis(300)).await;
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);

    tokio::time::sleep(Duration::from_millis(400)).await;
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.hold_images())
        .await
        .unwrap();
    service.evict(None);
    assert!(
        !h.entry("m1").exists(),
        "a stopped machine kept its tree held"
    );

    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert!(h.entry("m1").join(ROOTFS_DIR).join("hello").exists());
    assert_eq!(h.crane_log("export"), 2, "the start fetched the tree again");
}

// TEST_SCENARIO: with the node's service down, a new image cannot be resolved, checked or fetched, so a machine of it is refused under the cache's own reason, which says which mount was looked at and that the fault is the node's rather than the image's, and nothing is booted straight from the registry. A machine of an image another of this runner's machines already boots still starts, from the tree that machine holds, which is only read.
#[tokio::test(flavor = "multi_thread")]
async fn a_node_cache_that_cannot_be_reached_boots_only_what_the_runner_holds() {
    let h = Harness::with("node-cache-down", on_node_cache);
    let (_service, stop) = node_service(&h, HOLD_LEASE).await;
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    stop.cancel();
    while tokio::net::UnixStream::connect(h.dir.join("images/.cache.sock"))
        .await
        .is_ok()
    {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }

    h.server.put("m2", spec(true)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_RUNNING);
    assert_eq!(h.entry("m2"), h.entry("m1"));

    h.server.delete("m2").unwrap();
    let mut other = spec(true);
    other.image = "quay.io/x/other:1".into();
    h.server.put("m3", other).unwrap();
    let refused = h.settle("m3").await;
    assert_eq!(refused.reason, REASON_CACHE_UNREACHABLE, "{refused:?}");
    assert!(refused.message.contains("cannot be reached"), "{refused:?}");
    assert!(
        refused.message.contains(".cache.sock"),
        "the refusal does not name the socket inside the mount the runner looked at: {refused:?}"
    );
    assert!(
        refused.message.contains("read-only"),
        "the refusal does not say the mount is the runner's own read-only one: {refused:?}"
    );
    assert!(!locked(&h.fake.created).contains_key("m3"));
}
