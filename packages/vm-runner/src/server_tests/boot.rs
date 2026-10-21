use super::support::*;
use super::*;

// TEST_SCENARIO: an absent machine the controller wants running is fetched, created, published and started, in that order, and its spec, port and share are left on disk for a restarted runner to find. It boots from the unpacked tree, with the launch the image named.
#[tokio::test(flavor = "multi_thread")]
async fn an_absent_machine_is_created_and_started() {
    let h = Harness::new("create");
    let status = h.server.put("m1", spec(true)).unwrap();
    assert_eq!(status.state, STATE_CREATING);
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING);
    assert_eq!(status.port, i32::from(h.base));
    assert_eq!(h.fake.calls(), vec!["create m1", "start m1"]);

    let (image, launch) = locked(&h.fake.created).get("m1").cloned().unwrap();
    assert_eq!(PathBuf::from(image), h.entry("m1").join(ROOTFS_DIR));
    assert_eq!(launch.entrypoint, vec!["/entry"]);
    assert_eq!(launch.working_dir, "/app");

    let state = h.dir.join("machines/m1");
    assert!(state.join("spec.json").exists());
    assert_eq!(
        fs::read_to_string(state.join("port")).unwrap(),
        h.base.to_string()
    );
    assert_eq!(
        fs::read_to_string(state.join("share/ca/ca.crt")).unwrap(),
        "PEM"
    );
    assert!(state.join("share/init").exists());
    assert!(
        !read_spec(&h.dir.join("machines"), "m1").unwrap().running,
        "the stored spec must never say the machine should be running"
    );
}

// TEST_SCENARIO: a stop and a later start are the same machine: same port, same disk, no second create.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_machine_starts_again_on_the_same_port() {
    let h = Harness::new("restart");
    h.server.put("m1", spec(true)).unwrap();
    let first = h.settle("m1").await;
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", spec(true)).unwrap();
    let again = h.settle("m1").await;
    assert_eq!(again.state, STATE_RUNNING);
    assert_eq!(again.port, first.port);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
}

// TEST_SCENARIO: a guest's boot costs time for every GiB of RAM it boots with, so a machine boots with the runner's boot estimate and is grown to its spec's size as soon as its start returns, on every boot: the first, and one after a stop, whose record the update set back to the spec. The grow is part of the start, so the action ends only once the machine has its size. Every start is also told that size, so a runtime that knows the boot cannot grow (a disk conversion) boots at it.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_boots_small_and_is_grown_to_its_size_on_every_boot() {
    let h = Harness::with("boot-small", |c| c.boot_mib = 1024);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", spec(true)).unwrap();
    let again = h.settle("m1").await;
    assert_eq!(again.state, STATE_RUNNING);
    assert!(again.reason.is_empty(), "{again:?}");
    assert_eq!(
        h.fake.calls(),
        vec![
            "create m1",
            "start m1",
            "grow m1 2048",
            "stop m1",
            "update m1",
            "start m1",
            "grow m1 2048"
        ]
    );
    assert_eq!(*locked(&h.fake.booted_mib), vec![1024, 1024]);
    assert_eq!(*locked(&h.fake.start_sizes), vec![2048, 2048]);
}

// TEST_SCENARIO: a machine no larger than the boot estimate boots whole and is never grown, and so is every machine of a runner given no estimate.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_within_the_boot_estimate_boots_whole() {
    for (name, boot_mib) in [("boot-whole-larger", 4096), ("boot-whole-none", 0)] {
        let h = Harness::with(name, |c| c.boot_mib = boot_mib);
        h.server.put("m1", spec(true)).unwrap();
        assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
        assert_eq!(h.fake.calls(), vec!["create m1", "start m1"], "{name}");
        assert_eq!(*locked(&h.fake.booted_mib), vec![2048], "{name}");
    }
}

// TEST_SCENARIO: a guest that cannot grow would run with a fraction of the memory its spec and its agent count on. So a machine whose guest has not answered yet is stopped and booted again whole, in the same start, and reads running with no failure: the grow is an optimisation, never a reason for the agent not to run. The runner remembers that the machine cannot grow, so its next start boots it whole and does not pay for a small boot and a failed grow again.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_that_cannot_grow_is_booted_again_whole() {
    let h = Harness::with("grow-failed", |c| c.boot_mib = 1024);
    *locked(&h.fake.fail_grow_once) = Some("the VMM did not add the RAM".into());
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING);
    assert!(status.reason.is_empty(), "{status:?}");
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.calls(),
        vec![
            "create m1",
            "start m1",
            "grow m1 2048",
            "stop m1",
            "start m1",
            "stop m1",
            "update m1",
            "start m1"
        ]
    );
    assert_eq!(*locked(&h.fake.booted_mib), vec![1024, 2048, 2048]);
}

// TEST_SCENARIO: the RAM a grow asks for is what most often kills the machine asking, and the reboot that follows a failed grow is a boot that can fail on its own. The kill the grow read rides in the error the reboot returns, so the machine names the death it was restarted for rather than a boot that broke, and the OOM count that death spent is not left to label a later kill.
#[tokio::test(flavor = "multi_thread")]
async fn a_grow_that_failed_on_a_kill_names_it_even_when_the_reboot_fails() {
    let h = Harness::with("grow-kill-reboot", |c| c.boot_mib = 1024);
    *locked(&h.fake.fail_grow_once) = Some("the VMM did not add the RAM".into());
    *locked(&h.fake.fail_start_at) = Some((2, "the boot after the grow broke".into()));
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    h.fake.keep_signal(pid, libc::SIGKILL);
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");
    let _ = vmm.kill();
    let _ = vmm.wait();
}

// TEST_SCENARIO: readiness does not wait for the grow, so a guest can answer, and the agent read ready, before its grow fails. A reboot then would make the agent flap and lose a prompt sent to it. So the guest is left running at its boot size, and its next start boots it whole.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_that_answered_is_not_rebooted_when_it_cannot_grow() {
    let h = Harness::with("grow-failed-answered", |c| c.boot_mib = 1024);
    *locked(&h.fake.fail_grow_once) = Some("the VMM did not add the RAM".into());
    let _guest = guest(h.base);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "grow m1 2048"]
    );
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(*locked(&h.fake.booted_mib), vec![1024, 2048]);
}

// TEST_SCENARIO: booting small changes nothing admission counts. A machine on its way up is counted at the boot estimate, as it was when it booted whole, and its spec's size stays its cap: two machines whose estimates fit are admitted while the first still boots, and a third is refused.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_booting_small_is_admitted_as_before() {
    let h = Harness::with("boot-small-capacity", |c| {
        c.memory_mib = 2500;
        c.boot_mib = 1024;
    });
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    assert_eq!(
        h.server.put("m2", spec(true)).unwrap().state,
        STATE_CREATING
    );
    let refused = h.server.put("m3", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");
    h.settle("m1").await;
    h.settle("m2").await;
}

// TEST_SCENARIO: a machine's record names the cache tree it boots by path, read at every start. A tree gone from under a stopped machine — the image directory moved or relaid between runner releases — is resolved again when the machine next starts, its record moved to the new tree and its digest recorded again; without that the machine fails every start until its image changes, which for a hibernated agent is never. The stored spec has not changed, so nothing else may trigger it.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_machine_whose_tree_is_gone_resolves_its_image_again() {
    let h = Harness::new("stale-tree");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    let tree = h.entry("m1");
    let fetches = h.crane_calls();
    fs::remove_dir_all(&tree).unwrap();
    fs::remove_file(h.dir.join("machines/m1").join(IMAGE_DIGEST_FILE)).unwrap();

    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert_eq!(
        h.fake.calls(),
        ["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
    assert!(h.crane_calls() > fetches, "the image was not fetched again");
    assert!(
        tree.join(ROOTFS_DIR).is_dir(),
        "the tree was not unpacked again"
    );
    assert_eq!(
        h.fake.last_update().image.map(PathBuf::from),
        Some(h.entry("m1").join(ROOTFS_DIR)),
        "the record was not moved to the new tree"
    );
}

// TEST_SCENARIO: a new revision restarts the running machine in place — stop, update, start — keeping its disk. A spec that has not changed does nothing at all.
#[tokio::test(flavor = "multi_thread")]
async fn a_changed_shape_restarts_the_machine_in_place() {
    let h = Harness::new("reshape");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let _guest = guest(h.base);
    h.until("m1", "ready", |s| s.ready).await;
    assert!(h.server.put("m1", spec(true)).unwrap().ready);
    let mut changed = spec(true);
    changed.revision = "r2".into();
    assert_eq!(h.server.put("m1", changed).unwrap().state, STATE_RESTARTING);
    h.settle("m1").await;
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
}

// TEST_SCENARIO: a new size reaches a running machine only when it next starts. Until then the status reports the size the guest runs at and admission counts that one, so a second machine that fits beside it is let in; the start that applies the new size is admitted against it, and refused when it no longer fits. A restart asked for anything else applies it too.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_size_is_applied_at_the_next_start_and_not_before() {
    let h = Harness::with("resize-on-start", |c| c.memory_mib = 5000);
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let resized = MachineSpec {
        cpus: 4,
        memory_mib: 4096,
        ..spec(true)
    };
    let live = h.server.put("m1", resized.clone()).unwrap();
    assert_eq!(live.state, STATE_RUNNING);
    assert_eq!((live.cpus, live.memory_mib), (2, 2048));
    assert_eq!(h.fake.calls(), vec!["create m1", "start m1"]);

    h.server.put("m2", spec(true)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_RUNNING);

    h.server
        .put(
            "m1",
            MachineSpec {
                running: false,
                ..resized.clone()
            },
        )
        .unwrap();
    h.settle("m1").await;
    let refused = h.server.put("m1", resized.clone()).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");

    h.server.delete("m2").unwrap();
    h.server.put("m1", resized.clone()).unwrap();
    let woken = h.settle("m1").await;
    assert_eq!(woken.state, STATE_RUNNING);
    assert_eq!((woken.cpus, woken.memory_mib), (4, 4096));

    let rolled = MachineSpec {
        cpus: 1,
        memory_mib: 1024,
        revision: "r2".into(),
        ..resized
    };
    assert_eq!(h.server.put("m1", rolled).unwrap().state, STATE_RESTARTING);
    let restarted = h.settle("m1").await;
    assert_eq!((restarted.cpus, restarted.memory_mib), (1, 1024));
}

// TEST_SCENARIO: the status says a machine nests only when its spec asks for it and its runner grants it, so the controller can tell the owner who asked whether they got it. A machine on the same runner that does not ask never reads as nested.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_reads_as_nested_only_when_it_asks_and_its_runner_nests() {
    let h = Harness::new("nested");
    h.server
        .put(
            "m1",
            MachineSpec {
                nested_virtualization: true,
                ..spec(true)
            },
        )
        .unwrap();
    h.server.put("m2", spec(true)).unwrap();
    assert!(!h.settle("m1").await.nested);
    assert!(!h.settle("m2").await.nested);

    h.fake.nests.store(true, Ordering::SeqCst);
    assert!(h.server.status("m1").nested);
    assert!(!h.server.status("m2").nested);
}

// TEST_SCENARIO: the controller is level-triggered, so only its latest spec matters. Specs sent while a boot runs replace each other, and once the boot returns the machine goes straight to the last one — the stop sent in between is never carried out on its own.
#[tokio::test(flavor = "multi_thread")]
async fn the_latest_spec_wins() {
    let h = Harness::new("latest");
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    h.server.put("m1", spec(false)).unwrap();
    let mut last = spec(true);
    last.revision = "r3".into();
    last.cpus = 4;
    h.server.put("m1", last).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
    let stored = read_spec(&h.dir.join("machines"), "m1").unwrap();
    assert_eq!((stored.revision.as_str(), stored.cpus), ("r3", 4));
}

// TEST_SCENARIO: a template upgrade gives a running agent a new image. The machine is stopped, its record moved to the new image's own tree, and started again: the same machine, so the same disk and the port its Service already maps to. The stored spec names the new image once it has booted.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_image_is_applied_to_the_same_machine() {
    let h = Harness::new("new-image");
    h.server.put("m1", spec(true)).unwrap();
    let first = h.settle("m1").await;
    let mut upgraded = spec(true);
    upgraded.image = "quay.io/x/vm:2".into();
    assert_eq!(
        h.server.put("m1", upgraded).unwrap().state,
        STATE_RESTARTING
    );
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert_eq!(status.message, "");
    assert_eq!(status.port, first.port);
    assert_eq!(
        h.fake.calls(),
        ["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
    assert_eq!(
        h.fake.last_update().image.map(PathBuf::from),
        Some(h.entry("m1").join(ROOTFS_DIR))
    );
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:2"
    );
    assert!(h.server.forwarder.is_published("m1"));
}

// TEST_SCENARIO: the new image is fetched before the old machine is touched, so an image that cannot be read is reported as an image problem while the agent keeps running on what it has.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_image_that_cannot_be_fetched_leaves_the_machine_running() {
    let h = Harness::new("new-image-fails");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    crate::testdir::exec_script(
        &h.dir.join("crane"),
        "#!/bin/sh\necho 'MANIFEST_UNKNOWN' >&2\nexit 1\n",
    );
    let mut upgraded = spec(true);
    upgraded.image = "quay.io/x/vm:2".into();
    h.server.put("m1", upgraded).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_IMAGE_UNAVAILABLE, "{status:?}");
    assert_eq!(h.fake.calls(), ["create m1", "start m1"]);
    assert_eq!(h.fake.state("m1").unwrap(), State::Running);
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:1"
    );
}

// TEST_SCENARIO: a delete that arrives while a boot is running waits for it, then removes the machine; the spec stored behind the boot is dropped rather than carried out on a machine that is gone.
#[tokio::test(flavor = "multi_thread")]
async fn a_delete_waits_for_the_action_in_flight_and_drops_the_spec_behind_it() {
    let h = Harness::new("delete-mid-boot");
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    let mut next = spec(true);
    next.revision = "r2".into();
    h.server.put("m1", next).unwrap();
    let asked = Instant::now();
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.delete("m1").unwrap())
        .await
        .unwrap();
    assert!(asked.elapsed() > Duration::from_millis(150));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(h.fake.calls(), ["create m1", "start m1", "delete m1"]);
    assert_eq!(h.server.status("m1").state, STATE_ABSENT);
    assert!(!h.dir.join("machines/m1").exists());
}

// TEST_SCENARIO: the allowlist is the gateway's ClusterIP, and Kubernetes reuses those, so a machine must never keep running on an old one. A running machine is restarted onto the new allowlist; a stopped one is started onto it rather than left stopped.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_allowlist_is_applied_by_restarting_the_machine() {
    let h = Harness::new("egress");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut moved = spec(true);
    moved.allow_cidrs = vec!["10.0.0.9/32".into()];
    assert_eq!(
        h.server.put("m1", moved.clone()).unwrap().state,
        STATE_RESTARTING
    );
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
    assert_eq!(h.fake.last_update().allow_cidrs, ["10.0.0.9/32"]);

    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    let mut again = spec(true);
    again.allow_cidrs = vec!["10.0.0.10/32".into()];
    assert_eq!(h.server.put("m1", again).unwrap().state, STATE_STARTING);
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert!(status.reason.is_empty(), "{status:?}");
    assert_eq!(h.fake.last_update().allow_cidrs, ["10.0.0.10/32"]);
}

// TEST_SCENARIO: a disk grows and cannot shrink, so a smaller storage request is already met and does nothing. A larger one leaves the running machine alone, as a new size does, and its next start asks the runtime to grow the disk, so a larger storage pool reboots no agent.
#[tokio::test(flavor = "multi_thread")]
async fn storage_is_grown_at_the_next_start_and_never_shrunk() {
    let h = Harness::new("storage");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut smaller = spec(true);
    smaller.storage_gib = 1;
    assert_eq!(h.server.put("m1", smaller).unwrap().state, STATE_RUNNING);
    assert_eq!(h.fake.calls(), ["create m1", "start m1"]);

    let mut larger = spec(true);
    larger.storage_gib = 50;
    let live = h.server.put("m1", larger.clone()).unwrap();
    assert_eq!(live.state, STATE_RUNNING);
    assert_eq!(live.disk_gib, 5, "{live:?}");
    assert_eq!(h.fake.calls(), ["create m1", "start m1"]);

    h.server
        .put(
            "m1",
            MachineSpec {
                running: false,
                ..larger.clone()
            },
        )
        .unwrap();
    h.settle("m1").await;
    h.server.put("m1", larger).unwrap();
    let woken = h.settle("m1").await;
    assert_eq!(woken.state, STATE_RUNNING, "{woken:?}");
    assert_eq!(h.fake.last_update().storage_gib, 50);
    assert_eq!(woken.disk_gib, 50, "{woken:?}");
}

// TEST_SCENARIO: a boot that fails is reported under the reason the controller shows the person, and a later attempt that succeeds clears it.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_boot_is_reported_until_one_succeeds() {
    let h = Harness::new("boot-failed");
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    h.server.put("m1", spec(true)).unwrap();
    let failed = h.settle("m1").await;
    assert_eq!(failed.reason, REASON_BOOT_FAILED);
    assert!(failed.message.contains("never became ready"));
    h.server.put("m1", spec(true)).unwrap();
    let recovered = h.settle("m1").await;
    assert_eq!(recovered.state, STATE_RUNNING);
    assert!(
        recovered.reason.is_empty() && recovered.message.is_empty(),
        "{recovered:?}"
    );
}

// TEST_SCENARIO: a machine whose first boot failed still has a record the create wrote. The next spec must be compared against that record, or a new image sent after the failure would never reach the machine: the start would boot the old image, and the spec written after it would claim the new one.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_whose_first_boot_failed_takes_the_next_spec_whole() {
    let h = Harness::new("first-boot-failed");
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.reason, REASON_BOOT_FAILED);
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:1",
        "the create records the shape it wrote before it boots"
    );

    let mut upgraded = spec(true);
    upgraded.image = "quay.io/x/vm:2".into();
    h.server.put("m1", upgraded).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.last_update().image.map(PathBuf::from),
        Some(h.entry("m1").join(ROOTFS_DIR)),
        "the new image is resolved and written to the record"
    );
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:2"
    );
}

// TEST_SCENARIO: a stored spec that cannot be read says nothing about which image the machine's record names. The next start must write the image it is asked for rather than assume the record already holds it, or the machine boots its old image and reads as converged.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_whose_stored_spec_is_unreadable_takes_the_image_it_is_asked_for() {
    let h = Harness::new("unreadable-spec");
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    std::fs::write(
        h.dir.join("machines").join("m1").join("spec.json"),
        "not json",
    )
    .unwrap();

    let mut upgraded = spec(true);
    upgraded.image = "quay.io/x/vm:2".into();
    h.server.put("m1", upgraded).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.last_update().image.map(PathBuf::from),
        Some(h.entry("m1").join(ROOTFS_DIR)),
        "the image is resolved and written to the record"
    );
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:2"
    );
}

// TEST_SCENARIO: a spec sent after close starts no worker and holds no memory, so nothing counts a machine that never started. It is answered 503, not 200: it was not stored, and the controller must not read it as taken.
#[tokio::test(flavor = "multi_thread")]
async fn no_action_starts_after_close() {
    let h = Harness::new("after-close");
    h.server.close().await;
    let refused = h.server.put("m1", spec(true)).unwrap_err();
    assert_eq!(
        refused.status, 503,
        "a spec that was not stored was answered as taken"
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(h.fake.calls().is_empty());
    assert!(h.server.committing().is_empty());
}
