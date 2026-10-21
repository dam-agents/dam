use super::support::*;
use super::*;

// TEST_SCENARIO: once the owner's claim is critically full, every write that adds much is refused with the reason the controller shows as full storage, and nothing is created for it: a create and a seed upload alike. An image is fetched onto the node's disk rather than the claim, so a new image for an existing machine is not refused. A machine that already exists still starts and restarts, so an owner whose agents are all asleep can get into one to clean it up, but at the disk size it has: a larger size waits for a start that finds room. A running machine whose spec asks for nothing new keeps running untouched.
#[tokio::test(flavor = "multi_thread")]
async fn a_critical_claim_refuses_big_writes_and_still_starts_existing_machines() {
    let (h, claim) = with_claim("storage-critical");
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    h.server.put("m2", spec(false)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_STOPPED);
    let before = h.fake.calls();

    *locked(&claim) = filled(92);
    let created = h.server.put("m3", spec(true)).unwrap();
    assert_eq!(created.reason, REASON_STORAGE_FULL, "{created:?}");
    assert!(
        created.message.contains("used 92.0 of 100.0 GiB"),
        "{created:?}"
    );
    assert!(
        created.message.contains("can still be started"),
        "{created:?}"
    );
    assert!(read_spec(&h.dir.join("machines"), "m3").is_none());
    assert_eq!(
        h.server.claim_seed("m2", None).err().map(|e| e.status),
        Some(507)
    );
    let steady = h.server.put("m1", spec(true)).unwrap();
    assert_eq!(
        (steady.state.as_str(), steady.reason.as_str()),
        (STATE_RUNNING, "")
    );
    assert_eq!(h.fake.calls(), before, "nothing reached the runtime");

    let mut grown = spec(true);
    grown.storage_gib = 50;
    assert_eq!(h.server.put("m2", grown).unwrap().state, STATE_STARTING);
    let started = h.settle("m2").await;
    assert_eq!(
        (started.state.as_str(), started.disk_gib),
        (STATE_RUNNING, 5)
    );
    let mut changed = spec(true);
    changed.revision = "r2".into();
    h.server.put("m1", changed).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: once the claim is full, no machine starts or restarts either, since even a boot's few writes could fail every guest's; a running machine that asks for nothing new still keeps running, and once room is freed the same start goes through.
#[tokio::test(flavor = "multi_thread")]
async fn a_full_claim_refuses_every_boot_and_leaves_running_machines_alone() {
    let (h, claim) = with_claim("storage-full");
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    h.server.put("m2", spec(false)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_STOPPED);
    let before = h.fake.calls();

    *locked(&claim) = filled(95);
    let started = h.server.put("m2", spec(true)).unwrap();
    assert_eq!(started.reason, REASON_STORAGE_FULL, "{started:?}");
    assert!(started.message.contains("can't be started"), "{started:?}");
    let mut changed = spec(true);
    changed.revision = "r2".into();
    let restarted = h.server.put("m1", changed).unwrap();
    assert_eq!(restarted.reason, REASON_STORAGE_FULL, "{restarted:?}");
    let steady = h.server.put("m1", spec(true)).unwrap();
    assert_eq!(
        (steady.state.as_str(), steady.reason.as_str()),
        (STATE_RUNNING, "")
    );
    assert_eq!(h.fake.calls(), before, "nothing reached the runtime");
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    *locked(&claim) = filled(50);
    assert_eq!(
        h.server.put("m2", spec(true)).unwrap().state,
        STATE_STARTING
    );
    assert_eq!(h.settle("m2").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: a guest whose writes fail on a full claim makes its boot fail with nothing typed in the error, so a failed boot on a critical claim is reported as the owner's storage being full, with the console it left, rather than as a boot to retry.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_that_fails_on_a_critical_claim_reports_full_storage() {
    let (h, claim) = with_claim("storage-boot");
    *locked(&h.fake.start_delay) = Duration::from_millis(200);
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    *locked(&h.fake.console) = "EXT4-fs (vda): failed to convert unwritten extents".into();
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    *locked(&claim) = filled(95);
    let failed = h.settle("m1").await;
    assert_eq!(failed.reason, REASON_STORAGE_FULL, "{failed:?}");
    assert!(
        failed.message.contains("used 95.0 of 100.0 GiB"),
        "{failed:?}"
    );
    assert!(failed.message.contains("EXT4-fs (vda)"), "{failed:?}");
}

// TEST_SCENARIO: a guest sees its own disk as free while the claim under it fills, so the runner marks every machine's share while the claim is short, and keeps the mark until use is back under the lower threshold, so a claim hovering on the line does not mark and unmark at every look.
#[tokio::test(flavor = "multi_thread")]
async fn a_short_claim_marks_every_share_until_it_has_room_again() {
    let (h, claim) = with_claim("storage-short");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mark = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::STORAGE_SHORT_FILE);
    for (percent, marked) in [(74, false), (80, true), (72, true), (65, false)] {
        *locked(&claim) = filled(percent);
        h.server.check_storage();
        assert_eq!(mark.exists(), marked, "at {percent}%");
    }
}

// TEST_SCENARIO: a guest's disk is sized at the whole claim, so the runner grants every machine's guest, at each look, its part of what is left below 95% of the claim, with an id new at every look so the guest counts its writes from the latest grant; a claim that cannot be measured grants nothing, so no guest is held to a grant nobody renews, and the runner records that it is no longer holding them, for its log.
#[tokio::test(flavor = "multi_thread")]
async fn every_look_grants_each_guest_its_room_on_the_claim() {
    let (h, claim) = with_claim("storage-room");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let grant = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::STORAGE_ROOM_FILE);
    *locked(&claim) = filled(55);
    h.server.check_storage();
    let first = std::fs::read_to_string(&grant).unwrap();
    assert_eq!(
        first.split_whitespace().nth(1),
        Some((40u64 << 30).to_string().as_str()),
        "{first}"
    );
    h.server.check_storage();
    assert_ne!(std::fs::read_to_string(&grant).unwrap(), first);
    assert!(!h.server.storage_unmeasured.load(Ordering::Relaxed));
    *locked(&claim) = None;
    h.server.check_storage();
    assert!(!grant.exists());
    assert!(h.server.storage_unmeasured.load(Ordering::Relaxed));
    *locked(&claim) = filled(55);
    h.server.check_storage();
    assert!(!h.server.storage_unmeasured.load(Ordering::Relaxed));
}

// TEST_SCENARIO: machines woken together boot together and write together, so the room below 95% is split between every machine that is neither stopped nor absent. Split between the running ones alone, none of them is running yet when the group boots, and each holds a grant for the whole room until the next look, so their writes together pass the level the claim is held to.
#[tokio::test(flavor = "multi_thread")]
async fn machines_woken_together_share_the_room_between_them() {
    let (h, claim) = with_claim("storage-woken-together");
    let ids = ["m1", "m2"];
    for id in ids {
        h.server.put(id, spec(true)).unwrap();
        h.until(id, "running", |s| s.state == STATE_RUNNING).await;
        h.server.put(id, spec(false)).unwrap();
        h.until(id, "stopped", |s| s.state == STATE_STOPPED).await;
    }
    *locked(&claim) = filled(55);
    *locked(&h.fake.start_delay) = Duration::from_millis(500);
    locked(&h.fake.calls).clear();
    for id in ids {
        assert_eq!(h.server.put(id, spec(true)).unwrap().state, STATE_STARTING);
    }
    h.wait_for_call("start m2").await;
    h.server.check_storage();
    assert_eq!(h.grants(&ids), vec![20u64 << 30; 2]);
    for id in ids {
        h.until(id, "running", |s| s.state == STATE_RUNNING).await;
    }
    h.server.check_storage();
    assert_eq!(h.grants(&ids), vec![20u64 << 30; 2]);
}

// TEST_SCENARIO: a grant outlives the look that wrote it, so a machine that is stopped is granted nothing rather than a part of the room: started between two looks, it would otherwise boot on the room its share held while it was stopped, beside every machine started with it. A start is a look of its own, so the machines woken together boot on their even part instead of on the floor alone, and the room they hold together never passes what the claim has left below 95%.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_woken_between_looks_does_not_boot_on_the_whole_room() {
    let (h, claim) = with_claim("storage-woken-between");
    let ids = ["m1", "m2"];
    for id in ids {
        h.server.put(id, spec(true)).unwrap();
        h.until(id, "running", |s| s.state == STATE_RUNNING).await;
        h.server.put(id, spec(false)).unwrap();
        h.until(id, "stopped", |s| s.state == STATE_STOPPED).await;
    }
    let room = 40u64 << 30;
    *locked(&claim) = filled(55);
    h.server.check_storage();
    assert_eq!(
        h.grants(&ids),
        vec![0; 2],
        "a sleeping machine was granted room"
    );
    *locked(&h.fake.start_delay) = Duration::from_millis(500);
    locked(&h.fake.calls).clear();
    for id in ids {
        assert_eq!(h.server.put(id, spec(true)).unwrap().state, STATE_STARTING);
    }
    h.wait_for_call("start m2").await;
    let woken = h.grants(&ids);
    assert!(
        woken.iter().all(|&bytes| bytes > 0),
        "a wake booted on no grant of its own: {woken:?}"
    );
    assert!(
        woken.iter().sum::<u64>() <= room,
        "the machines woken together hold {woken:?} of the room's {room} bytes"
    );
    for id in ids {
        h.until(id, "running", |s| s.state == STATE_RUNNING).await;
    }
}

// TEST_SCENARIO: the two halves of a look count different machines. The room is split between the machines that are up, so a starting machine takes its part from the running ones before it boots. The shortage is asked back of the running machines alone, since only a guest that runs can free its scratch, so a starting sibling does not halve what a running one is asked for.
#[tokio::test(flavor = "multi_thread")]
async fn a_running_and_a_starting_machine_split_the_room_but_only_the_running_one_sheds() {
    let (h, claim) = with_claim("storage-mixed");
    h.server.put("m1", spec(true)).unwrap();
    h.until("m1", "running", |s| s.state == STATE_RUNNING).await;
    h.server.put("m2", spec(true)).unwrap();
    h.until("m2", "running", |s| s.state == STATE_RUNNING).await;
    h.server.put("m2", spec(false)).unwrap();
    h.until("m2", "stopped", |s| s.state == STATE_STOPPED).await;
    *locked(&h.fake.start_delay) = Duration::from_millis(500);
    locked(&h.fake.calls).clear();
    assert_eq!(
        h.server.put("m2", spec(true)).unwrap().state,
        STATE_STARTING
    );
    h.wait_for_call("start m2").await;
    *locked(&claim) = filled(80);
    h.server.check_storage();
    let room = 15u64 << 30;
    assert_eq!(h.grants(&["m1", "m2"]), vec![room / 2; 2]);
    let shed = std::fs::read_to_string(
        h.dir
            .join("machines/m1")
            .join(SHARE_DIR)
            .join(share::STORAGE_SHORT_FILE),
    )
    .expect("a short claim asks every share");
    assert_eq!(
        shed.split_whitespace().nth(1),
        Some((10u64 << 30).to_string().as_str()),
        "the running machine is asked the whole shortage: {shed}"
    );
    h.until("m2", "running", |s| s.state == STATE_RUNNING).await;
}

// TEST_SCENARIO: a look scans the machines and then writes every share, and two looks run at once: the periodic one and the one a start takes. A periodic look that scanned before a start, and stalled past it, must not write its older room over the newer one: that leaves the started machine at the floor and its sibling holding the whole room. The shares hold the look that scanned last, and what the machines hold together stays inside the room.
#[tokio::test(flavor = "multi_thread")]
async fn a_look_that_scanned_first_does_not_write_over_a_later_one() {
    let armed = Arc::new(AtomicBool::new(false));
    let scanned = Arc::new(AtomicBool::new(false));
    let stored: Arc<Mutex<Option<StorageUse>>> = Arc::default();
    let (measured, slow, told) = (stored.clone(), armed.clone(), scanned.clone());
    let h = Harness::with("storage-look-order", move |c| {
        c.measure_storage = Arc::new(move || {
            let storage = *locked(&measured);
            if slow.swap(false, Ordering::SeqCst) {
                told.store(true, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(300));
            }
            storage
        });
    });
    for id in ["m1", "m2"] {
        h.server.put(id, spec(true)).unwrap();
        h.until(id, "running", |s| s.state == STATE_RUNNING).await;
    }
    h.server.put("m2", spec(false)).unwrap();
    h.until("m2", "stopped", |s| s.state == STATE_STOPPED).await;
    *locked(&stored) = filled(55);
    armed.store(true, Ordering::SeqCst);
    let server = h.server.clone();
    let stalled = std::thread::spawn(move || server.check_storage());
    while !scanned.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(1));
    }
    *locked(&h.fake.start_delay) = Duration::from_millis(500);
    locked(&h.fake.calls).clear();
    assert_eq!(
        h.server.put("m2", spec(true)).unwrap().state,
        STATE_STARTING
    );
    h.wait_for_call("start m2").await;
    stalled.join().unwrap();
    let room = 40u64 << 30;
    let held = h.grants(&["m1", "m2"]);
    assert_eq!(
        held,
        vec![room / 2; 2],
        "the shares do not hold the look that scanned last"
    );
    for id in ["m1", "m2"] {
        h.until(id, "running", |s| s.state == STATE_RUNNING).await;
    }
}

// TEST_SCENARIO: the storage every guest may add is the claim's room split among the machines holding it, and a runner that starts on records it cannot read must not hand one machine's share to the others. A machine a VMM process still holds is recorded as unknown and counted, as admission counts it, so a restart changes no guest's grant while the record is unreadable.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_whose_state_cannot_be_read_at_startup_still_counts_toward_the_storage_grant() {
    let (h, claim) = with_claim("startup-unread");
    let measured = claim.clone();
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.put("m2", spec(true)).unwrap();
    h.settle("m2").await;
    let grant = |h: &Harness, id: &str| {
        std::fs::read_to_string(
            h.dir
                .join("machines")
                .join(id)
                .join(SHARE_DIR)
                .join(share::STORAGE_ROOM_FILE),
        )
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse::<u64>()
        .unwrap()
    };
    *locked(&claim) = filled(55);
    h.server.check_storage();
    assert_eq!(
        grant(&h, "m1"),
        20 << 30,
        "two machines share the room below 95% of the claim"
    );

    locked(&h.fake.state_fails_until_start).insert("m1".to_string());
    locked(&h.fake.vmms).insert("m1".to_string());
    let next = h
        .hand_off(move |c| {
            let measured = measured.clone();
            c.measure_storage = Arc::new(move || *locked(&measured));
        })
        .await;
    *locked(&claim) = filled(55);
    next.server.check_storage();
    assert_eq!(
        grant(&next, "m2"),
        20 << 30,
        "a machine whose record cannot be read at startup was left out of the share, so the others were granted its room"
    );
    next.server.close().await;
}

// TEST_SCENARIO: a machine the runner is stopping frees all of its scratch by going down, so it takes no part of the request a short claim sends the others: while its stop is in flight the shortage is split among the machines that stay, and each is asked for its full part, not for a share the machine on its way out cannot give.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_on_its_way_down_takes_no_part_of_the_shed_request() {
    let (h, claim) = with_claim("shed-stopping");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.put("m2", spec(true)).unwrap();
    h.settle("m2").await;
    *locked(&h.fake.stop_delay) = Duration::from_secs(2);
    assert_eq!(
        h.server.put("m1", spec(false)).unwrap().state,
        STATE_STOPPING
    );
    *locked(&claim) = filled(80);
    h.server.check_storage();
    let request = std::fs::read_to_string(
        h.dir
            .join("machines/m2")
            .join(SHARE_DIR)
            .join(share::STORAGE_SHORT_FILE),
    )
    .unwrap();
    assert_eq!(
        request.split_whitespace().nth(1).unwrap(),
        (10u64 << 30).to_string(),
        "the machine on its way down took half of the shortage the machine that stays has to free"
    );
}

// TEST_SCENARIO: a guest serves each request to give back scratch once, and only a running guest frees anything, so the shortage is split among the running machines alone. The runner keeps the same request while the claim stays short at about the same use, and sends a new one, with a new id and its part of the new shortage, only once the claim has filled SHED_STEP_PERCENT further; a claim that has room again clears it, and the next shortage is a new request.
#[tokio::test(flavor = "multi_thread")]
async fn a_short_claim_asks_again_only_when_it_fills_further() {
    let (h, claim) = with_claim("storage-reshed");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.put("m2", spec(false)).unwrap();
    h.settle("m2").await;
    let mark = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::STORAGE_SHORT_FILE);
    let request = |percent| {
        *locked(&claim) = filled(percent);
        h.server.check_storage();
        std::fs::read_to_string(&mark).ok()
    };
    let first = request(80).expect("a short claim asks");
    let bytes = |text: &str| {
        text.split_whitespace()
            .nth(1)
            .unwrap()
            .parse::<u64>()
            .unwrap()
    };
    assert_eq!(
        bytes(&first),
        10 << 30,
        "the running machine is asked for the whole shortage: {first}"
    );
    assert_eq!(
        request(82).as_deref(),
        Some(first.as_str()),
        "a small rise asks nothing new"
    );
    let second = request(85).expect("still short");
    assert_ne!(second, first, "a claim that filled further asks again");
    assert!(bytes(&second) > bytes(&first), "{second} {first}");
    assert_eq!(request(65), None);
    assert_ne!(request(80).as_deref(), Some(first.as_str()));
}

// TEST_SCENARIO: a guest whose own disk filled has an agent that exits as it starts, which on its own reads as a boot that failed. platform-init marks that exit on the console, and the runner reports it as a full home, which the controller shows as the full home volume a container agent reports.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_whose_console_shows_a_full_home_reports_it() {
    let h = Harness::new("home-full");
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    *locked(&h.fake.console) = "[ 2.0] platform-init: the image entrypoint exited with status 1 after 1s; the agent's home is full".into();
    h.server.put("m1", spec(true)).unwrap();
    let failed = h.settle("m1").await;
    assert_eq!(failed.reason, REASON_HOME_FULL, "{failed:?}");
    assert!(
        failed.message.contains("This agent's storage is full"),
        "{failed:?}"
    );
}

// TEST_SCENARIO: a user whose storage is short is told what fills it, so the usage read names, beside each machine's disk, what a migration's seed takes of the claim.
#[tokio::test(flavor = "multi_thread")]
async fn the_usage_read_names_the_seeds() {
    let h = Harness::new("usage-parts");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let seed = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::SEED_FILE);
    fs::write(&seed, vec![1u8; 1 << 20]).unwrap();
    let storage = h.server.usage().unwrap().storage;
    assert!(storage.seed_bytes >= 1 << 20, "{storage:?}");
}
