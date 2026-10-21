use super::support::*;
use super::*;

// TEST_SCENARIO: a runner renames a record aside to read it and exits before reporting it, and the runner that replaces it must still read that death: the claim names no live runner, so the death is recovered instead of pruned.
#[test]
fn an_interrupted_claim_is_read_by_the_next_runner() {
    let dir = std::env::temp_dir().join(format!("vmr-claim-recover-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let exits = dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&exits).unwrap();
    // TEST_SCENARIO: the claim a runner left, naming a runner that is gone: a process this test started and let exit, so no liveness check answers for it.
    let mut gone = std::process::Command::new("true")
        .spawn()
        .expect("a process to name");
    let gone_pid = gone.id();
    let _ = gone.wait();
    fs::write(exits.join(format!(".4242.claim.0.{gone_pid}")), "7\n9").unwrap();
    let recovered = claim_exit_record(&dir, 4242).expect("the abandoned claim is recovered");
    assert_eq!(
        read_claimed(&recovered, &exits.join("4242")),
        Some((Some(7), 9)),
        "the death a runner claimed and never reported was not read by the runner that replaced it"
    );
}

// TEST_SCENARIO: the pruner inspects an old record, the loader publishes a new death under the same name before the pruner removes anything, and the new death must survive. This drives the production pruner, gated between the claim and the removal, so the interleaving is ordered rather than raced.
#[tokio::test(flavor = "multi_thread")]
async fn the_pruner_does_not_delete_a_newer_publication() {
    let h = Harness::new("prune-race");
    let records = h.server.config.state_dir.join(crate::state::EXIT_RECORDS);
    std::fs::create_dir_all(&records).unwrap();
    // UNIT_BOUNDARY_DESCRIPTION: an old record, backdated past the window so the pruner will want it gone.
    let record = records.join("4242");
    std::fs::write(&record, "1\n12").unwrap();
    let old = std::fs::File::options().write(true).open(&record).unwrap();
    old.set_modified(SystemTime::now() - EXIT_KEPT - Duration::from_secs(30))
        .unwrap();
    drop(old);
    // TEST_SCENARIO: the pruner is held after claiming the old file, and the loader publishes the machine's real death on the freed name meanwhile.
    let (in_the_prune, let_go) = std::sync::mpsc::channel::<()>();
    let (release, released) = std::sync::mpsc::channel::<()>();
    *h.server.prune_gate.0.lock().unwrap() = Some((in_the_prune, released));
    let pruning = h.server.clone();
    let pruner = std::thread::spawn(move || pruning.reap_killed());
    let _ = let_go.recv_timeout(Duration::from_secs(10)).map(|()| {
        std::fs::write(records.join(".4242.part"), "9\n9").unwrap();
        std::fs::rename(records.join(".4242.part"), &record).unwrap();
    });
    let _ = release.send(());
    let _ = pruner.join();
    assert_eq!(
        std::fs::read_to_string(&record).unwrap(),
        "9\n9",
        "the pruner deleted a death the loader published after it looked"
    );
}

// TEST_SCENARIO: a record with no start time, under the pid of a VMM that is alive now, must not be read as that VMM's death: an undated record is indistinguishable from a predecessor's, and reading it would report a running machine as stopped by its filter.
#[tokio::test(flavor = "multi_thread")]
async fn an_undated_record_does_not_name_a_live_vmms_death() {
    let h = Harness::new("undated-record");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // TEST_SCENARIO: the identity is known to the runtime, and the record carries none, which is what the loader writes when it cannot read the zombie's.
    locked(&h.fake.vmm_start_times).insert(
        "m1".into(),
        smolvm::process::process_start_time(pid).expect("a start time of its own"),
    );
    let records = h.server.config.state_dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&records).unwrap();
    fs::write(records.join(pid.to_string()), format!("\n{}", libc::SIGSYS)).unwrap();
    assert!(smolvm::process::is_alive(pid));
    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_ne!(
        status.reason, REASON_SECCOMP_KILLED,
        "an undated record named a live VMM's death: {status:?}"
    );
    assert!(
        smolvm::process::is_alive(pid),
        "the VMM was alive throughout"
    );
    drop(vmm.kill());
    let _ = vmm.wait();
}

// TEST_SCENARIO: a claim the production writer made, whose name carries the runner that made it, is adopted by the runner that replaces it once that runner is gone. The name is built by the writer here, not hand-written, so a shape production never emits cannot make this pass.
#[test]
fn a_claim_the_writer_made_is_recoverable_by_the_next_runner() {
    let dir = std::env::temp_dir().join(format!("vmr-claim-writer-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let exits = dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&exits).unwrap();
    fs::write(exits.join("4242"), "7\n9").unwrap();
    // UNIT_BOUNDARY_DESCRIPTION: the claim the production writer makes, taken and then abandoned, as a runner that exits between the rename and the read leaves it.
    let made = claim_exit_record(&dir, 4242).expect("the record is claimed");
    let name = made.file_name().unwrap().to_string_lossy().to_string();
    // TEST_SCENARIO: the runner that made it is this process, so the claim is not yet abandoned: nothing else may take it.
    assert!(
        name.rsplit('.').next().and_then(|p| p.parse::<i32>().ok())
            == i32::try_from(std::process::id()).ok(),
        "the claim does not name the runner that made it: {name}"
    );
    assert!(
        claim_exit_record(&dir, 4242).is_none(),
        "a live reader's claim was taken from it"
    );
    // TEST_SCENARIO: the runner that made it is gone — reaped, not a zombie, since a zombie still answers for its pid — and the claim is adopted rather than left to be pruned.
    let mut gone = std::process::Command::new("true")
        .spawn()
        .expect("a process to name");
    let gone_pid = gone.id();
    let _ = gone.wait();
    assert!(!smolvm::process::is_alive(i32::try_from(gone_pid).unwrap()));
    let abandoned = exits.join(format!(".4242.claim.0.{gone_pid}"));
    fs::rename(&made, &abandoned).unwrap();
    let adopted = claim_exit_record(&dir, 4242).expect("the abandoned claim is adopted");
    assert_eq!(
        read_claimed(&adopted, &exits.join("4242")),
        Some((Some(7), 9)),
        "the death a runner claimed and never reported was not read by the runner that replaced it"
    );
}

// TEST_SCENARIO: a machine's VMM is adopted by a new runner after a hand-off, and the record on disk belongs to the incarnation before it. The record names the process it is about by the start time the kernel gave that process, so a hand-off changes nothing: the predecessor's record is refused and the machine's own death is not read as a filter kill.
#[tokio::test(flavor = "multi_thread")]
async fn an_adopted_vmm_is_not_named_by_its_predecessors_record() {
    let h = Harness::new("adopted-record");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    let exits = h.dir.join("machines").join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&exits).unwrap();
    // TEST_SCENARIO: a record of some other process under this pid, which is the predecessor's, naming the filter's own signal so that reading it would be visible as that reason on either platform.
    fs::write(exits.join(pid.to_string()), format!("1\n{}", libc::SIGSYS)).unwrap();

    // TEST_SCENARIO: a hand-off, and a tick on the other side while the VMM is still alive.
    let next = h.hand_off(|_| {}).await;
    next.server.reap_killed();
    assert_eq!(
        next.server.status("m1").reason,
        "",
        "an adopted VMM was named by a record of another process"
    );
    // TEST_SCENARIO: the adopted VMM dies, and the loader has not published its record yet.
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    next.fake.keep_signal(pid, ended.signal().unwrap());
    next.server.reap_killed();
    assert_ne!(
        next.server.status("m1").reason,
        REASON_SECCOMP_KILLED,
        "the adopted VMM's death was read from its predecessor's record"
    );
}

// TEST_SCENARIO: a predecessor's record is claimed while the machine's own VMM runs, and the loader publishes the machine's real death under the freed name before the claim is read. What the reader decides about is the file the claim moved, never the name, so a death that arrives meanwhile is neither read as the predecessor's nor deleted with it.
#[test]
fn a_newer_death_survives_the_claim_that_takes_its_predecessor() {
    let dir = std::env::temp_dir().join(format!("vmr-record-stale-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let exits = dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&exits).unwrap();
    // TEST_SCENARIO: the predecessor's death, claimed by a reader that is about to decide about it. The signal is this platform's, so the record says what the assertion reads back on either.
    fs::write(exits.join("4242"), format!("1\n{}", libc::SIGSYS)).unwrap();
    let claimed = claim_exit_record(&dir, 4242).expect("the predecessor's record is claimed");
    // TEST_SCENARIO: the machine's own death, published by the loader under the name the claim freed.
    fs::write(dir.join(".4242.part"), "9\n9").unwrap();
    fs::rename(dir.join(".4242.part"), exits.join("4242")).unwrap();

    let read = read_claimed(&claimed, &exits.join("4242"));
    assert_eq!(
        read,
        Some((Some(1), libc::SIGSYS)),
        "the reader decided about the death that arrived while it was deciding, not the one it claimed"
    );
    assert_eq!(
        fs::read_to_string(exits.join("4242")).unwrap(),
        "9\n9",
        "the machine's own death was deleted with its predecessor's claim"
    );
    let _ = fs::remove_dir_all(&dir);
}

// TEST_SCENARIO: the loader has reaped the VMM a machine ran and left a record under its pid, and by then the kernel has given that number to a replacement, whose start time the record does not name. A pid is a number, not an identity, so the record must not be read as the replacement's death: what it named would be reported as this machine's, as a filter kill or an OOM kill, for a machine that is running.
#[tokio::test(flavor = "multi_thread")]
async fn a_record_of_the_incarnation_before_is_not_the_replacements_death() {
    let h = Harness::new("record-identity");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    // TEST_SCENARIO: the replacement, which the machine runs now, and whose start time is not the one the record names.
    let mut replacement = stand_in_vmm();
    let pid = i32::try_from(replacement.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    let started = smolvm::process::process_start_time(pid).expect("a start time of its own");
    // UNIT_BOUNDARY_DESCRIPTION: the identity the runtime recorded for the VMM this machine booted, which is what a record is judged against.
    locked(&h.fake.vmm_start_times).insert("m1".into(), started);
    let records = h.server.config.state_dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&records).unwrap();
    let record = records.join(pid.to_string());
    // UNIT_BOUNDARY_DESCRIPTION: a start time the record can never have come from this process with, which is what a predecessor's record looks like once the number is handed out again. It stays alive, so nothing but the start time can refuse it.
    fs::write(&record, format!("{}\n{}", started + 1, libc::SIGSYS)).unwrap();

    assert!(
        h.server.vmm_exit("m1").is_none(),
        "a record of the incarnation before was read as the replacement's death"
    );
    // TEST_SCENARIO: a record naming the process the machine runs is its death, which is the same reading allowed.
    fs::write(&record, format!("{started}\n{}", libc::SIGSYS)).unwrap();
    assert!(
        matches!(h.server.vmm_exit("m1"), Some((_, Some(libc::SIGSYS)))),
        "the machine's own death was refused"
    );
    drop(replacement.kill());
    let _ = replacement.wait();
}

// TEST_SCENARIO: an incomplete record has been claimed, and the loader publishes a whole one under that name before the claim is put back. The restore must not replace the newer death with the older incomplete file.
#[test]
fn restoring_an_incomplete_record_never_replaces_a_newer_one() {
    let dir = std::env::temp_dir().join(format!("vmr-record-restore-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let published = dir.join("4242");
    let claimed = dir.join(".4242.claim");
    fs::write(&claimed, "").unwrap();
    assert!(!published.exists());

    // TEST_SCENARIO: the loader publishes the death that arrived after the claim was taken.
    fs::write(dir.join(".4242.part"), libc::SIGKILL.to_string()).unwrap();
    fs::rename(dir.join(".4242.part"), &published).unwrap();
    assert_eq!(read_claimed(&claimed, &published), None);
    assert_eq!(
        fs::read_to_string(&published).unwrap(),
        libc::SIGKILL.to_string(),
        "restoring the incomplete predecessor overwrote the newer death"
    );
}

// TEST_SCENARIO: a machine restarted at a pid the kernel handed out again, with a record the loader wrote for the incarnation before it still on disk: the record names a death that belongs to the process that held the pid, so a live process there is not it, and the machine must not be reported as killed by a filter or by the kernel while it runs.
#[tokio::test(flavor = "multi_thread")]
async fn a_live_pid_does_not_read_the_record_of_the_incarnation_before_it() {
    let h = Harness::new("record-of-the-incarnation-before");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    let started = smolvm::process::process_start_time(pid).expect("a start time of its own");
    locked(&h.fake.vmm_start_times).insert("m1".into(), started);
    // TEST_SCENARIO: the record the loader leaves for a VMM it reaped, under a pid this one now holds, naming the incarnation before this one.
    let exits = h.dir.join("machines").join(crate::state::EXIT_RECORDS);
    std::fs::create_dir_all(&exits).unwrap();
    std::fs::write(
        exits.join(pid.to_string()),
        format!("{}\n{}", started + 1, libc::SIGSYS),
    )
    .unwrap();

    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_eq!(status.state, State::Running.to_string(), "{status:?}");
    assert_eq!(
        status.reason, "",
        "a live machine was read as the death of the one before it"
    );
    assert!(
        !h.server.metrics_text().lines().any(|line| line
            .starts_with("platform_vm_runner_machine_kills_total{")
            && !line.ends_with(" 0")),
        "the kill counter took a death that never happened:\n{}",
        h.server.metrics_text()
    );
    let _ = vmm.kill();
    let _ = vmm.wait();
}

// TEST_SCENARIO: the count a runner starts from is the one the runner before it last read, since a kill counted in the handoff window belongs to a machine the loader still records; a count below that is a cgroup the kernel recreated, which starts afresh rather than waiting for a figure it may never reach.
#[test]
fn a_starting_runner_begins_at_the_count_the_one_before_it_read() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-before-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    let state = std::env::temp_dir().join(format!("vmr-state-before-{}", std::process::id()));
    let _ = fs::remove_dir_all(&state);
    fs::create_dir_all(&state).unwrap();
    counted(&cgroup, 3);
    let before = |state: &Path, cgroup: &Path| oom_kills_seen_before(state, Some(cgroup));
    assert_eq!(before(&state, &cgroup), 3, "a first start");
    fs::write(state.join(OOM_KILL_COUNT), "1").unwrap();
    assert_eq!(before(&state, &cgroup), 1, "the count the last runner read");
    fs::write(state.join(OOM_KILL_COUNT), "9").unwrap();
    assert_eq!(
        before(&state, &cgroup),
        3,
        "a recreated cgroup starts afresh"
    );
}

// TEST_SCENARIO: a machine's record keeps the pid of a VMM that has died, and the kernel hands that pid to another process. Reading it as this machine's would reap, and blame, a process that belongs to something else — so a pid that no longer names the process the record meant is not this machine's, its status is left for its real owner, and no kill is reported for it.
#[tokio::test(flavor = "multi_thread")]
async fn a_recycled_pid_is_neither_reaped_nor_reported() {
    let h = Harness::new("recycled-pid");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);

    let mut other = stand_in_vmm();
    let pid = i32::try_from(other.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    h.fake.recycle(pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    for _ in 0..3 {
        h.server.reap_killed();
        std::thread::sleep(Duration::from_millis(5));
    }
    let status = h.server.status("m1");
    assert!(status.reason.is_empty(), "{status:?}");
    assert_eq!(
        other
            .wait()
            .expect("its own child is still waited on")
            .signal(),
        Some(libc::SIGKILL),
        "the status of another process's child was not taken"
    );
}

// TEST_SCENARIO: after a hand-off the machine's VMM is a child of the loader, which reads its status and records the signal for the runner that adopted the machine; this process reads nothing of it. The record is the only thing that names the kill, and it is read once.
#[tokio::test(flavor = "multi_thread")]
async fn a_death_the_loader_recorded_is_named_after_a_handoff() {
    let h = Harness::new("handoff-record");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);

    // TEST_SCENARIO: the VMM the machine was booted with, reaped by the loader as the old runner's child, so this process can read no status of it.
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    let started = smolvm::process::process_start_time(pid).expect("a start time of its own");
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGSYS) };
    let _ = vmm.wait();
    let records = h.server.config.state_dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&records).unwrap();
    // TEST_SCENARIO: the record the loader writes for that VMM, naming it by the start time the kernel gave it.
    fs::write(
        records.join(pid.to_string()),
        format!("{started}\n{}", libc::SIGSYS),
    )
    .unwrap();

    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_eq!(status.reason, REASON_SECCOMP_KILLED, "{status:?}");
    assert!(
        !records.join(pid.to_string()).exists(),
        "the record was read twice"
    );
}

// TEST_SCENARIO: the loader writes a machine's death under the pid of a VMM that died while no runner was its parent, and the runner learns that pid only from the record. Pruning against the pids a tick happens to name would delete a record written while that tick looked at the machine, and the kill would go unreported: so a record is kept until it is old, whoever names its pid.
#[tokio::test(flavor = "multi_thread")]
async fn a_record_no_tick_names_yet_is_kept_until_it_is_old() {
    let h = Harness::new("record-kept");
    let records = h.server.config.state_dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&records).unwrap();
    // UNIT_BOUNDARY_DESCRIPTION: a whole record, so what the pruner is shown is a death rather than an incomplete file.
    let fresh = records.join("424242");
    fs::write(&fresh, format!("7\n{}", libc::SIGSYS)).unwrap();
    h.server.reap_killed();
    assert!(fresh.exists(), "a record nothing has read yet is kept");

    // TEST_SCENARIO: the same record, old enough that no death in hand can be the one it names.
    let old = std::time::SystemTime::now() - EXIT_KEPT - Duration::from_secs(1);
    fs::File::options()
        .write(true)
        .open(&fresh)
        .unwrap()
        .set_modified(old)
        .unwrap();
    h.server.reap_killed();
    assert!(!fresh.exists(), "a record past its window is pruned");
}

// TEST_SCENARIO: a record caught before its signal landed is not a machine that exited on its own: reading it as one would drop the kill it names, and the file would go with it. The runner says nothing this tick, keeps the file, and names the kill when the record is whole.
#[tokio::test(flavor = "multi_thread")]
async fn a_record_read_before_it_is_whole_names_no_clean_exit() {
    let h = Harness::new("record-early");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    let started = smolvm::process::process_start_time(pid).expect("a start time of its own");
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGSYS) };
    let _ = vmm.wait();
    let records = h.server.config.state_dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&records).unwrap();
    let record = records.join(pid.to_string());
    // UNIT_BOUNDARY_DESCRIPTION: the identity line has landed and the signal has not, which is what a reader can catch.
    fs::write(&record, format!("{started}\n")).unwrap();

    h.server.reap_killed();
    assert!(
        h.server.status("m1").reason.is_empty(),
        "nothing was read as an exit"
    );
    assert!(
        record.exists(),
        "the record was not read as a machine that exited"
    );
    fs::write(&record, format!("{started}\n{}", libc::SIGSYS)).unwrap();
    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_eq!(status.reason, REASON_SECCOMP_KILLED, "{status:?}");
}

// TEST_SCENARIO: a launch record that cannot be read says nothing about whether its machine runs, and a runner that read it as "not running" counted a live VMM as nothing: admission then handed its room to the next machine. It counts as running while a VMM process holds its directory, at what it was measured holding or at its size, until the record reads again.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_whose_launch_record_cannot_be_read_still_holds_its_room() {
    let tune = |c: &mut Config| c.memory_mib = 3000;
    let h = Harness::with("unreadable-record", tune);
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    assert_eq!(h.server.usage().unwrap().memory.committed_mib, 2048);

    locked(&h.fake.state_fails_until_start).insert("m1".to_string());
    locked(&h.fake.vmms).insert("m1".to_string());
    let next = h.hand_off(tune).await;
    assert_eq!(
        next.server.usage().unwrap().memory.committed_mib,
        2048,
        "a running machine whose launch record cannot be read was counted as nothing"
    );
    let refused = next.server.put("m2", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");
    next.server.close().await;
}

// TEST_SCENARIO: a record that no longer decodes is not evidence that a machine runs — a stopped or hibernated machine's record fails the same way, and a runner that counted every unreadable one as running held the whole handout for a machine holding nothing, refusing every start for its owner. Only a VMM process on its directory says a machine nothing has looked at is up; without one it holds no room.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_machine_whose_launch_record_cannot_be_read_holds_no_room() {
    let tune = |c: &mut Config| c.memory_mib = 3000;
    let h = Harness::with("stopped-record-unreadable", tune);
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;

    locked(&h.fake.state_fails_until_start).insert("m1".to_string());
    let next = h.hand_off(tune).await;
    assert_eq!(
        next.server.usage().unwrap().memory.committed_mib,
        0,
        "a stopped machine whose launch record cannot be read held room it does not use"
    );
    let started = next.server.put("m2", spec(true)).unwrap();
    assert_eq!(
        started.state, STATE_CREATING,
        "the owner's next machine was refused for a machine that holds nothing: {started:?}"
    );
    next.server.close().await;
}
