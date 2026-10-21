use super::support::*;
use super::*;

// TEST_SCENARIO: a create is counted as what it was — one operation, one start, one image the cache did not hold and one fetch — and the memory gauges read the runner as it stands, so the scrape after a boot shows the machine it booted.
#[tokio::test(flavor = "multi_thread")]
async fn a_scrape_counts_what_a_create_did() {
    let h = Harness::new("scrape");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let scrape = h.server.metrics_text();
    for line in [
        "platform_vm_runner_machine_operation_duration_seconds_count{op=\"create\",outcome=\"ok\"} 1",
        "platform_vm_runner_machine_start_duration_seconds_count{op=\"create\",outcome=\"ok\"} 1",
        "platform_vm_runner_image_cache_lookups_total{result=\"miss\"} 1",
        "platform_vm_runner_image_fetch_duration_seconds_count{outcome=\"ok\"} 1",
        "platform_vm_runner_memory_committed_mib 2048",
    ] {
        assert!(scrape.lines().any(|l| l == line), "missing {line}\n{scrape}");
    }
    assert!(
        !scrape.contains("m1") && !scrape.contains("quay.io"),
        "{scrape}"
    );
}

// TEST_SCENARIO: a machine's CPU share is what it used over its last two looks while running. Once it stops, the usage read reports no CPU for it, so the bars never name a paused agent among the heaviest CPU users.
#[tokio::test]
async fn a_stopped_machine_reports_no_cpu() {
    let h = Harness::new("cpu-stopped");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    *locked(&h.fake.resident) = Some(500);
    *locked(&h.fake.cpu) = Some(0);
    h.server.probe("m1");
    tokio::time::sleep(Duration::from_millis(50)).await;
    *locked(&h.fake.cpu) = Some(1_000_000);
    h.server.probe("m1");
    let cpu = |h: &Harness| {
        h.server
            .usage()
            .unwrap()
            .machines
            .into_iter()
            .find(|m| m.id == "m1")
            .map(|m| m.cpu_milli)
    };
    assert!(
        cpu(&h).unwrap() > 0,
        "a busy running machine reports its CPU"
    );

    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    assert_eq!(cpu(&h), Some(0), "a stopped machine reports none");
}

// TEST_SCENARIO: a probe reads the kernel log outside the machine's lock, so a cut of that log can rewrite the file between the probe's read and its write: the offset it read to then counts from a log that no longer exists, and the mark it carries is older than the ones the cut kept, which leaves the next probe reading an old GUEST_FULL and the runner reporting a guest full for as long as the machine runs. A probe that began on an earlier cut of the log publishes neither its offset nor its mark, and the next probe reads the log the cut left from its start.
#[tokio::test(flavor = "current_thread")]
async fn a_probe_that_began_before_a_cut_publishes_nothing() {
    let dir = crate::testdir::TempDir::new("cut-probe");
    let path = dir.path().join(crate::console::VMM_LOG);
    let mut log = format!(
        "[t ERROR init_or_kernel] [    9.1] platform-init: {}: this agent may write nothing more\n",
        crate::guest::GUEST_FULL
    );
    for i in 0..20_000 {
        log.push_str(&format!("[t WARN  smolvm_network::stack] guest SYN {i}\n"));
    }
    std::fs::write(&path, &log).unwrap();
    let size = std::fs::metadata(&path).unwrap().len();
    let room = format!(
            "[t ERROR init_or_kernel] [   60.2] platform-init: {}: the agent's writes are no longer held back\n",
            crate::guest::GUEST_ROOM
        );

    let h = Harness::new("cut-probe");
    h.server.put("m1", spec(true)).unwrap();
    let began = h.machine("m1", |m| {
        m.boot = Some(Boot {
            at: Instant::now(),
            action: Action::Start,
            seed: None,
            note: None,
        });
        (m.boot.as_ref().map(|boot| boot.at), m.kernel_cuts)
    });
    let mut sampled: Option<(u64, String)> = None;
    let mut calls = 0;
    crate::console::trim_with(&path, size, &mut || {
        calls += 1;
        if calls == 2 {
            std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(room.as_bytes())
                .unwrap();
            sampled = Some(crate::console::kernel_since(&path, 0));
        }
    })
    .unwrap();
    let (read, text) = sampled.expect("the probe read the log during the cut");
    assert_eq!(
        crate::console::room_full(&text),
        Some(false),
        "the probe read the guest's newest mark: {text:.160}"
    );
    let (_, stale) = crate::console::kernel_since(&path, read);
    assert_eq!(
        crate::console::room_full(&stale),
        Some(true),
        "the offset that probe read to names the older mark as the newest: {stale:.160}"
    );

    h.server.forget_kernel_read("m1");
    let (current, from) = h.machine("m1", |m| {
        (Server::read_current(m, began.0, began.1), m.kernel_read)
    });
    assert!(
        !current,
        "a read of the log as it was before the cut is published over the log the cut left"
    );
    assert_eq!(
        from, 0,
        "the next probe reads the log the cut left from its start"
    );
    let (_, after) = crate::console::kernel_since(&path, from);
    assert_eq!(
        crate::console::room_full(&after),
        Some(false),
        "the log the cut left still says the guest has room: {after:.160}"
    );
}

// TEST_SCENARIO: a status read reads the machine's seeded record off its share, and a disk that stalls holds that read for as long as it stalls. It must hold up only the read of that machine: one held under the machine lock would freeze every ensure, status, probe and delete on the runner.
#[tokio::test(flavor = "multi_thread")]
async fn a_stalled_share_holds_up_only_the_status_of_its_machine() {
    let h = Harness::new("stalled-share");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let stalled = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::SEEDED_FILE);
    let _ = fs::remove_file(&stalled);
    assert!(std::process::Command::new("mkfifo")
        .arg(&stalled)
        .status()
        .unwrap()
        .success());
    let server = h.server.clone();
    let stuck = std::thread::spawn(move || server.status("m1"));
    tokio::time::sleep(Duration::from_millis(100)).await;
    let server = h.server.clone();
    let (sent, other) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sent.send(server.status("m2"));
    });
    let answered = other.recv_timeout(Duration::from_secs(1));
    let _ = fs::OpenOptions::new().write(true).open(&stalled);
    stuck.join().unwrap();
    assert!(
        answered.is_ok(),
        "one machine's stalled share held up another machine's status"
    );
}

// TEST_SCENARIO: a machine just booted reports itself warming up, which is what the controller counts it at the warm-up floor by, as admission here does; a machine that is not running reports no warm-up.
#[tokio::test]
async fn a_booted_machine_reports_its_warm_up() {
    let h = Harness::new("warming");
    h.server.put("m1", spec(true)).unwrap();
    assert!(
        h.settle("m1").await.warming,
        "a machine just booted was not warming up"
    );
    h.server.put("m1", spec(false)).unwrap();
    assert!(
        !h.settle("m1").await.warming,
        "a stopped machine reported a warm-up"
    );
}

// TEST_SCENARIO: a stop takes the measurement with it. A machine measured while it ran, then stopped, whose launch record cannot be read and whose wake cannot be planned, is unknown with a figure from a VMM that is gone: counted, it holds room for a machine that holds nothing and refuses its owner's next start. The same runner throughout, since a hand-off rebuilds the entries and would hide what the stop left behind.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_machine_keeps_no_measurement() {
    let tune = |c: &mut Config| c.memory_mib = 3000;
    let h = Harness::with("stopped-measured", tune);
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    *locked(&h.fake.resident) = Some(2048);
    h.server.probe("m1");
    assert_eq!(h.server.usage().unwrap().memory.committed_mib, 2048);

    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    assert_eq!(h.server.status("m1").state, STATE_STOPPED);

    locked(&h.fake.state_fails_until_start).insert("m1".to_string());
    *locked(&h.fake.fail_start_once) = Some("the wake could not boot the machine".into());
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let status = h.server.status("m1");
    assert_eq!(status.state, STATE_UNKNOWN, "{status:?}");
    assert_eq!(
        h.server.usage().unwrap().memory.committed_mib,
        0,
        "a stopped machine's measurement outlived the VMM that held it"
    );
    let started = h.server.put("m2", spec(true)).unwrap();
    assert_eq!(
        started.state, STATE_CREATING,
        "the owner's next machine was refused for a machine that holds nothing: {started:?}"
    );
    h.server.close().await;
}

// TEST_SCENARIO: a probe that cannot read a machine's resident memory is a failed measurement, not a machine holding nothing: the status keeps the figure the last probe read, as the runner's adoption of a handed-off machine does, and admission counts the machine at least at the warm-up floor instead of at that figure, which is from before the failure. A machine that is not running reports none, so no figure outlives the VMM that held it.
#[tokio::test]
async fn a_probe_that_cannot_read_the_resident_memory_keeps_the_last_figure() {
    let h = Harness::new("resident-unread");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.machine("m1", |m| {
        m.warming_since = Some(Instant::now() - 2 * crate::capacity::WARMUP)
    });
    *locked(&h.fake.resident) = Some(500);
    h.server.probe("m1");
    assert_eq!(h.server.status("m1").used_mib, 500);
    assert_eq!(h.server.usage().unwrap().memory.committed_mib, 500);

    *locked(&h.fake.resident) = None;
    h.server.probe("m1");
    assert_eq!(
        h.server.status("m1").used_mib,
        500,
        "a failed measurement counted the machine as holding nothing"
    );
    assert_eq!(
        h.server.usage().unwrap().memory.committed_mib,
        2048,
        "a figure from before a failed read was counted below the machine's warm-up floor"
    );

    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    assert_eq!(
        h.server.status("m1").used_mib,
        0,
        "a stopped machine still reported the memory it held"
    );
}

// TEST_SCENARIO: a probe that cannot read the machine's state has not learned that it stopped, so the machine keeps what the last probe measured, as it does when only the memory read fails: the runtime answered neither question, and counting it as holding nothing is how admission hands its room to the next machine. The figure it keeps is one no probe could refresh, so admission counts it at the warm-up floor until a look reads the machine again.
#[tokio::test]
async fn a_probe_that_cannot_read_the_state_keeps_the_last_figure() {
    let h = Harness::new("state-unread");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.machine("m1", |m| {
        m.warming_since = Some(Instant::now() - 2 * crate::capacity::WARMUP)
    });
    *locked(&h.fake.resident) = Some(700);
    h.server.probe("m1");
    assert_eq!(h.server.status("m1").used_mib, 700);
    assert_eq!(h.server.usage().unwrap().memory.committed_mib, 700);

    locked(&h.fake.state_fails_until_start).insert("m1".to_string());
    h.server.probe("m1");
    let status = h.server.status("m1");
    assert_eq!(status.state, STATE_UNKNOWN, "{status:?}");
    assert_eq!(
        status.used_mib, 700,
        "an unread state counted the machine as holding nothing"
    );
    assert_eq!(
        h.server.usage().unwrap().memory.committed_mib,
        2048,
        "a figure an unread state could not refresh was counted below the machine's warm-up floor"
    );

    locked(&h.fake.state_fails_until_start).remove("m1");
    h.server.probe("m1");
    assert_eq!(h.server.status("m1").used_mib, 700);
    assert_eq!(h.server.usage().unwrap().memory.committed_mib, 700);
}

// TEST_SCENARIO: a spec that cannot be read says nothing about what the machine holds or how long its boot has been up, and the status that zeroed both over an unreadable spec made the controller count a measured machine at its floor. Neither is read off the spec, so both are still reported; only what the spec carries is missing.
#[tokio::test]
async fn a_machine_whose_spec_cannot_be_read_still_reports_what_it_measured() {
    let h = Harness::new("spec-unread-status");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    *locked(&h.fake.resident) = Some(640);
    h.server.probe("m1");
    std::fs::write(
        h.dir.join("machines").join("m1").join("spec.json"),
        "not json",
    )
    .unwrap();

    let status = h.server.status("m1");
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert_eq!(
        status.used_mib, 640,
        "an unreadable spec counted the machine as holding nothing"
    );
    assert!(
        status.warming,
        "an unreadable spec dropped the warm-up the runner knows about"
    );
}
