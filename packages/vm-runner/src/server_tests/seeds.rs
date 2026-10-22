use super::support::*;
use super::*;

// TEST_SCENARIO: an agent moving to this backend brings its home as a seed, which platform-init reads only on the first boot. So the controller creates its machine stopped: a stopped spec with a whole shape creates the machine, its share, spec and port, and never starts it. Only the ensure that asks for it running boots it, onto the same machine.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_can_be_created_without_being_booted() {
    let h = Harness::new("create-stopped");
    h.server.put("m1", spec(false)).unwrap();
    let parked = h.settle("m1").await;
    assert_eq!(parked.state, STATE_STOPPED, "{parked:?}");
    assert_eq!(h.fake.calls(), vec!["create m1"]);
    assert!(read_spec(&h.dir.join("machines"), "m1").is_some());

    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(h.fake.calls(), vec!["create m1", "update m1", "start m1"]);
}

// TEST_SCENARIO: the migration's whole sequence on the runner: a machine created stopped takes a seed into its share, and the ensure that then boots it rewrites the share without removing the seed, because that boot is the one that reads it.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_uploaded_to_a_stopped_machine_is_still_there_when_it_boots() {
    let h = Harness::new("seed-boot");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;

    let mut seeding = h.server.claim_seed("m1", None).unwrap();
    seeding.write(b"a home").unwrap();
    let result = seeding.commit().unwrap();
    assert_eq!(result.bytes, 6);

    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let seed = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::SEED_FILE);
    assert_eq!(fs::read(seed).unwrap(), b"a home");
}

// TEST_SCENARIO: a seed stays on the owner's claim until the move finishes and its restore writes as much again onto the same claim, so an upload that started with room stops, as storage full and before anything more is written, once what it wrote would take the claim past the critical level after the restore; checking only at the start let a large home fill the claim under every other agent.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_whose_restore_would_fill_the_claim_stops_as_storage_full() {
    let (h, claim) = with_claim("seed-room");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    *locked(&claim) = Some(StorageUse {
        used: (90 << 30) - (32 << 20),
        usable: 100 << 30,
    });
    let mut seeding = h.server.claim_seed("m1", None).unwrap();
    seeding.write(b"a").unwrap();
    let refused = seeding.write(&vec![0; 64 << 20]).unwrap_err();
    assert_eq!(refused.status, 507, "{}", refused.message);
    assert!(
        refused.message.contains("twice the home's size"),
        "{}",
        refused.message
    );
}

// TEST_SCENARIO: a machine with an action in flight may be about to boot, so a seed claimed then could be read half-written; it is refused, as is a second upload to a machine that already has one running. And while a seed is being uploaded, an ensure that asks for the machine running is stored but boots nothing until the upload is done; the next ensure boots it.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_and_a_boot_never_overlap() {
    let h = Harness::new("seed-overlap");
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(
        h.server.claim_seed("m1", None).err().map(|e| e.status),
        Some(409),
        "a seed was claimed while the machine was starting"
    );
    h.settle("m1").await;
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);

    let seeding = h.server.claim_seed("m1", None).unwrap();
    assert_eq!(
        h.server.claim_seed("m1", None).err().map(|e| e.status),
        Some(409)
    );
    let calls = h.fake.calls().len();
    h.server.put("m1", spec(true)).unwrap();
    assert!(!h.server.converging("m1"), "a boot started mid-upload");
    assert_eq!(h.fake.calls().len(), calls);
    drop(seeding);

    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: a boot that restores a migration's seed copies its disk before its guest answers, so it is still booting, not failing: it reports REASON_COPYING_DISK while the guest has not answered, also past the stuck-boot minute, so the controller neither counts it as a start that never became ready nor lets the image update move it back mid-copy. The reason goes once the guest answers, and a boot that copies nothing never carries it.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_that_copies_a_disk_reports_it_until_the_guest_answers() {
    let h = Harness::new("copying");
    h.server.put("m1", spec(true)).unwrap();
    let plain = h.settle("m1").await;
    assert_eq!(plain.reason, "", "{plain:?}");

    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    let seed = upload(&h, "m1", b"a home");
    h.server.put("m1", expecting(true, &seed)).unwrap();
    let seeding = h.settle("m1").await;
    assert!(!seeding.ready);
    assert_eq!(seeding.reason, REASON_COPYING_DISK, "{seeding:?}");
    age_boot(&h, "m1");
    h.server.probe("m1");
    assert_eq!(
        h.server.status("m1").reason,
        REASON_COPYING_DISK,
        "a slow copy is still a copy"
    );
    let _guest = guest(h.base);
    let up = h.until("m1", "ready", |s| s.ready).await;
    assert_eq!(up.reason, "", "{up:?}");
}

// TEST_SCENARIO: a machine deleted while its seed is uploaded must not have the seed put back into a directory that is gone, or recreated by the rename; the upload's commit is refused instead.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_for_a_machine_deleted_mid_upload_is_not_committed() {
    let h = Harness::new("seed-deleted");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    let mut seeding = h.server.claim_seed("m1", None).unwrap();
    seeding.write(b"half").unwrap();
    h.server.delete("m1").unwrap();

    assert_eq!(seeding.commit().err().map(|e| e.status), Some(409));
    assert!(!h.dir.join("machines/m1").exists());
}

// TEST_SCENARIO: a migration's seed can go missing between the upload and the boot — a lost runner claim, a crash, an operator. A machine whose spec expects a seed is then not started at all, under a reason of its own, so the controller copies the home again instead of the guest booting the image's home and the migration being taken for done. The same holds for a seed that is not the one expected.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_that_expects_a_seed_it_does_not_hold_is_not_started() {
    let h = Harness::new("seed-missing");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    let seed = SeedResult {
        bytes: 6,
        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
    };

    h.server.put("m1", expecting(true, &seed)).unwrap();
    let refused = h.settle("m1").await;
    assert_eq!(refused.state, STATE_STOPPED, "{refused:?}");
    assert_eq!(refused.reason, REASON_SEED_MISSING, "{refused:?}");
    assert!(refused.message.contains(&seed.sha256), "{refused:?}");
    assert!(!h.fake.calls().iter().any(|c| c == "start m1"));

    let other = upload(&h, "m1", b"a home");
    assert_ne!(other.sha256, seed.sha256);
    h.server.put("m1", expecting(true, &seed)).unwrap();
    let refused = h.settle("m1").await;
    assert_eq!(refused.reason, REASON_SEED_MISSING, "{refused:?}");
    assert!(refused.message.contains(&other.sha256), "{refused:?}");
    assert!(!h.fake.calls().iter().any(|c| c == "start m1"));

    h.server.remove_seed("m1").unwrap();
    assert!(!h
        .dir
        .join("machines/m1")
        .join(share::SEED_DIGEST_FILE)
        .exists());
}

// TEST_SCENARIO: the seed the machine expects is the one it holds, so it boots with the expectation in its share for platform-init to enforce. Once its guest answers, the status names that seed as the one the home came from — the signal the controller ends the migration on — and it keeps naming it after the controller stops expecting a seed and removes it, without the guest being restarted for either.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_booted_from_its_expected_seed_reports_the_seed_its_home_came_from() {
    let h = Harness::new("seed-reported");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    let seed = upload(&h, "m1", b"a home");
    let share = h.dir.join("machines/m1").join(SHARE_DIR);

    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", expecting(true, &seed)).unwrap();
    h.wait_for_call("start m1").await;
    assert_eq!(
        crate::guest::SeedDigest::parse(
            &fs::read_to_string(share.join(share::SEED_EXPECTED_FILE)).unwrap()
        )
        .map(|d| d.sha256),
        Some(seed.sha256.clone()),
        "platform-init is not told which seed to expect"
    );
    let _guest = guest(h.base);
    let up = h.until("m1", "ready", |s| s.ready).await;
    assert_eq!(up.home_seeded_from, seed.sha256);

    h.server.remove_seed("m1").unwrap();
    h.server.put("m1", spec(true)).unwrap();
    let after = h.settle("m1").await;
    assert_eq!(after.home_seeded_from, seed.sha256);
    assert_eq!(
        h.fake.calls().iter().filter(|c| *c == "start m1").count(),
        1,
        "the end of the migration restarted the guest"
    );
}
