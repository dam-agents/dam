use super::support::*;
use super::*;

// TEST_SCENARIO: a count whose victim this runner never saw, and then nothing: the count does not move and the ticks go on. The credit has to age out on those idle ticks and be written away, or a runner that idles for hours hands it to whoever replaces it as a kill it has just seen.
#[tokio::test(flavor = "multi_thread")]
async fn idle_ticks_give_up_on_a_credit_before_a_handoff() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-idle-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let during = cgroup.clone();
    let h = Harness::with("idle-expiry", move |config| {
        config.cgroup_dir = Some(during)
    });
    counted(&cgroup, 1);
    h.server.reap_killed();
    assert_eq!(
        locked(&h.server.oom).credits.len(),
        1,
        "one kill, one credit"
    );
    locked(&h.server.oom).credits = vec![Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1)];
    // TEST_SCENARIO: the ticks that follow sample the same count and see no death at all.
    h.server.reap_killed();
    h.server.reap_killed();
    assert!(
        locked(&h.server.oom).credits.is_empty(),
        "an idle tick kept a credit past its window"
    );

    let next = h
        .hand_off(|config| config.cgroup_dir = Some(cgroup.clone()))
        .await;
    next.server.match_oom_kills();
    assert_eq!(
        locked(&next.server.oom).credits.len(),
        0,
        "an idle runner's expired credit came back as a fresh kill after the hand-off"
    );
}

// TEST_SCENARIO: a count whose victim this runner never saw ages out while another machine boots, and an operator then kills a settled machine with the count unchanged. The old unmatched kill must not become spendable on that SIGKILL merely because some action is running.
#[tokio::test(flavor = "multi_thread")]
async fn another_machines_boot_does_not_make_an_old_kill_spendable() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-unrelated-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("unrelated-boot", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    counted(&cgroup, 1);
    h.server.reap_killed();
    locked(&h.server.oom).credits = vec![Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1)];

    // TEST_SCENARIO: another machine starts, and its own VMM is alive, so the old kill is what this boot cannot name.
    let (held, release) = h.fake.hold_start();
    h.server.put("m2", spec(true)).unwrap();
    h.wait_for_call("start m2").await;
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot holds until this test lets it go");
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_ne!(
        status.reason, REASON_OOM_KILLED,
        "a kill counted long before this one, for something this runner never saw, was blamed on it: {status:?}"
    );
    release.send(()).ok();
}

// TEST_SCENARIO: eight unmatched kills age out while a machine boots, and the kernel then takes a ninth. Protecting a boot's own recovery must not let the old, expired entries hold the cap: the ninth kill is the fresh one, and its victim must still be namable.
#[tokio::test(flavor = "multi_thread")]
async fn expired_credits_do_not_hold_the_cap_against_a_fresh_kill() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-cap-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("cap-with-a-boot", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    counted(&cgroup, 8);
    h.server.reap_killed();
    locked(&h.server.oom).credits =
        vec![Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1); OOM_CREDIT_CAP];

    // TEST_SCENARIO: a boot holds while the kernel counts a ninth kill.
    let (held, release) = h.fake.hold_start();
    h.server.put("m2", spec(true)).unwrap();
    h.wait_for_call("start m2").await;
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot holds until this test lets it go");
    counted(&cgroup, 9);
    h.server.reap_killed();
    assert_eq!(
        locked(&h.server.oom).credits.len(),
        1,
        "the ninth kill was dropped because eight expired ones held the cap"
    );
    release.send(()).ok();
    h.settle("m2").await;
}

// TEST_SCENARIO: a machine is killed by an operator while no count explains it, and the kernel then hands the same pid to the machine's replacement. The replacement's own death, counted by the kernel, has to be named: nothing may be left behind that silences a process merely because it holds the pid of one already reported.
#[tokio::test(flavor = "multi_thread")]
async fn a_replacement_at_a_reported_pid_is_still_reported() {
    let cgroup =
        std::env::temp_dir().join(format!("vmr-cgroup-replacement-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("replacement-pid", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut first = stand_in_vmm();
    let pid = i32::try_from(first.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = first.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    h.server.reap_killed();
    assert_ne!(
        h.server.status("m1").reason,
        REASON_OOM_KILLED,
        "a kill the cgroup did not count is not memory"
    );
    assert_eq!(
        h.fake.vmm_exit_signal(pid),
        None,
        "the death it named is consumed, so nothing is left to silence the next one"
    );

    // TEST_SCENARIO: the replacement the kernel puts at that same pid dies of a counted kill.
    let mut replacement = stand_in_vmm();
    let replacement_pid = i32::try_from(replacement.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(replacement_pid, libc::SIGKILL) };
    let ended = replacement.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    counted(&cgroup, 1);
    h.server.reap_killed();
    assert_eq!(
        h.server.status("m1").reason,
        REASON_OOM_KILLED,
        "the replacement's death was silenced by the pid its predecessor held"
    );
}

// TEST_SCENARIO: a record the loader wrote for a machine's previous VMM is still on disk when the machine's replacement holds that pid. The replacement dies and the loader has not yet published its own record: the old one names a death that is not this one's, so it must not be read as the replacement's.
#[tokio::test(flavor = "multi_thread")]
async fn a_replacement_does_not_read_the_record_of_the_incarnation_before_it() {
    let h = Harness::new("record-before-the-replacement");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    let started = smolvm::process::process_start_time(pid).expect("a start time of its own");
    locked(&h.fake.vmm_start_times).insert("m1".into(), started);
    let exits = h.dir.join("machines").join(crate::state::EXIT_RECORDS);
    std::fs::create_dir_all(&exits).unwrap();
    // UNIT_BOUNDARY_DESCRIPTION: a whole record naming another incarnation, which is what the predecessor's looks like once the kernel hands the pid out again: a single-line record would only be an incomplete one and prove nothing about identity.
    std::fs::write(
        exits.join(pid.to_string()),
        format!("{}\n{}", started + 1, libc::SIGSYS),
    )
    .unwrap();

    // TEST_SCENARIO: one tick while the replacement runs: the record can only be the predecessor's, since a live holder cannot have published one.
    h.server.reap_killed();
    assert_eq!(
        h.server.status("m1").reason,
        "",
        "a live machine was read as the death of the one before it"
    );
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    h.server.reap_killed();
    // UNIT_BOUNDARY_DESCRIPTION: this harness reads no cgroup, so a SIGKILL is the kernel's by definition here: what the reason tells apart is a death read from the stale record — a filter kill — from the replacement's own.
    assert_eq!(
        h.server.status("m1").reason,
        REASON_OOM_KILLED,
        "the replacement's death was named with the record of the incarnation before it"
    );
}

// TEST_SCENARIO: m1 is settled and m2 begins a slow boot; the kernel then counts one OOM kill that no machine of this runner died of, and more than the window passes while m2 is still in that same action. An operator `kill -9`s m1 with the count unchanged: the credit the window dropped must not be spendable on m1 merely because m2 is busy, or the machine an operator killed is told it ran out of memory and m2's own failure loses its kill.
#[tokio::test(flavor = "multi_thread")]
async fn a_settled_machine_does_not_spend_a_credit_held_for_another_action() {
    let cgroup =
        std::env::temp_dir().join(format!("vmr-cgroup-held-credit-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("held-credit", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);

    // TEST_SCENARIO: m2's boot begins, and the kill is counted while it runs.
    let (held, release) = h.fake.hold_start();
    h.server.put("m2", spec(true)).unwrap();
    h.wait_for_call("start m2").await;
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot holds until this test lets it go");
    counted(&cgroup, 1);
    h.server.reap_killed();
    // TEST_SCENARIO: the window passes with m2 still in the same action, and the credit is counted before that action began only in name: m2 did begin before the sample, which is what the older rule held the credit on.
    let aged = Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1);
    locked(&h.server.oom).credits = vec![aged];
    h.action_began_at("m2", aged - Duration::from_secs(1));

    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_ne!(
        status.reason, REASON_OOM_KILLED,
        "a settled machine an operator killed spent a credit the window had dropped, because another machine was booting: {status:?}"
    );
    release.send(()).ok();
}

// TEST_SCENARIO: a boot is already held when the kernel counts eight unmatched kills, and the window passes with that same action still running. A ninth genuine kill then arrives, and the held eight must not have taken the room it needs: the ninth is a fresh count and its victim has to be namable after the boot ends.
#[tokio::test(flavor = "multi_thread")]
async fn eight_held_kills_do_not_drop_the_ninth() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-action-cap-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("action-cap", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    let (held, release) = h.fake.hold_start();
    h.server.put("m2", spec(true)).unwrap();
    h.wait_for_call("start m2").await;
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot holds until this test lets it go");

    // TEST_SCENARIO: eight kills counted while that boot runs, and the window passes with it still running.
    counted(&cgroup, OOM_CREDIT_CAP as u64);
    h.server.reap_killed();
    let aged = Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1);
    locked(&h.server.oom).credits = vec![aged; OOM_CREDIT_CAP];
    h.action_began_at("m2", aged - Duration::from_secs(1));
    h.fake.set_vmm("m2", 1 << 22);

    // TEST_SCENARIO: the ninth kill.
    counted(&cgroup, OOM_CREDIT_CAP as u64 + 1);
    h.server.reap_killed();
    // UNIT_BOUNDARY_DESCRIPTION: exactly one kill is owed after the ninth count, and it is the fresh one: the expired eight are given up and the ninth is either pooled or held for m2's own boot. A cap that counted the retained eight would owe eight aged kills and none for the ninth.
    let owed: Vec<Instant> = {
        let oom = locked(&h.server.oom);
        oom.credits
            .iter()
            .chain(oom.holds.values().flatten())
            .copied()
            .collect()
    };
    assert_eq!(
        owed.len(),
        1,
        "the expired eight were kept and the ninth kill was dropped: {owed:?}"
    );
    assert!(
        owed[0].elapsed() < OOM_CREDIT_TTL,
        "the one kill owed is one of the expired eight, not the ninth"
    );
    release.send(()).ok();
}

// TEST_SCENARIO: a replacement VMM holds a pid the loader still has a record for, from the incarnation before it. The replacement is killed and reaped before the loader publishes its own record: the predecessor's record is older than the VMM the machine runs, so it names no death of this one and must not be reported as its signal.
#[tokio::test(flavor = "multi_thread")]
async fn a_claimed_record_from_before_this_vmm_is_not_its_death() {
    let h = Harness::new("claim-before-this-vmm");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    let started = smolvm::process::process_start_time(pid).expect("a start time of its own");
    locked(&h.fake.vmm_start_times).insert("m1".into(), started);
    let exits = h.dir.join("machines").join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&exits).unwrap();
    // UNIT_BOUNDARY_DESCRIPTION: a whole record naming another incarnation, which is what a predecessor's record is: an incomplete one would be refused for being incomplete and prove nothing about identity.
    fs::write(
        exits.join(pid.to_string()),
        format!("{}\n{}", started + 1, libc::SIGSYS),
    )
    .unwrap();
    assert!(smolvm::process::is_alive(pid));

    // TEST_SCENARIO: the replacement dies inside the moment between the liveness check and the claim, and its own record has not been published.
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    assert_eq!(
        vmm.wait().expect("the VMM is waited on").signal(),
        Some(libc::SIGKILL)
    );
    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_ne!(
        status.reason, REASON_SECCOMP_KILLED,
        "the record of the incarnation before this one named this one's death: {status:?}"
    );
}

// TEST_SCENARIO: a machine's VMM is reaped by the loader, so the kernel no longer answers for its identity, and the record under its pid names a predecessor instead. Judging that record by a kernel look would find nothing and admit it, reporting the machine as killed by its filter when it was killed by the kernel. The comparison is against the identity the runtime wrote down while the VMM ran, so a mismatch is still refused once both processes are gone.
#[tokio::test(flavor = "multi_thread")]
async fn a_reaped_vmm_is_judged_against_the_identity_its_runtime_recorded() {
    let h = Harness::new("reaped-identity");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    let started = smolvm::process::process_start_time(pid).expect("a start time of its own");
    h.fake.set_vmm("m1", pid);
    // UNIT_BOUNDARY_DESCRIPTION: the identity this machine's VMM was booted with, which outlives the process in the runtime's record.
    locked(&h.fake.vmm_start_times).insert("m1".into(), started);
    let records = h.server.config.state_dir.join(crate::state::EXIT_RECORDS);
    fs::create_dir_all(&records).unwrap();
    // TEST_SCENARIO: the loader reaps the VMM, and a predecessor's record is what lies under its pid: nothing answers for the dead process's identity any more.
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let _ = vmm.wait();
    assert_eq!(
        smolvm::process::process_start_time(pid),
        None,
        "the kernel answered for identity after the reap"
    );
    fs::write(
        records.join(pid.to_string()),
        format!("{}\n{}", started + 1, libc::SIGSYS),
    )
    .unwrap();
    assert!(
        h.server.vmm_exit("m1").is_none(),
        "a predecessor's record was admitted once the kernel stopped answering for identity"
    );
    // TEST_SCENARIO: the machine's own record is the one its runtime recorded, and it is read.
    fs::write(
        records.join(pid.to_string()),
        format!("{started}\n{}", libc::SIGSYS),
    )
    .unwrap();
    assert!(
        matches!(h.server.vmm_exit("m1"), Some((_, Some(libc::SIGSYS)))),
        "the machine's own death was refused"
    );
}

// TEST_SCENARIO: an unrelated kill leaves a credit in the pool and it ages out before the next sample. A boot then dies of an operator's SIGKILL, and the credit must not be handed to it: an aged credit belongs to a death this runner never saw, and reviving it would report the operator's kill as memory.
#[tokio::test(flavor = "multi_thread")]
async fn a_claim_does_not_revive_an_expired_credit() {
    let cgroup = std::env::temp_dir().join(format!("vmr-claim-expiry-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("claim-expiry", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    counted(&cgroup, 1);
    h.server.reap_killed();
    assert_eq!(
        locked(&h.server.oom).credits.len(),
        1,
        "the unrelated kill was not credited"
    );
    // TEST_SCENARIO: the credit ages past its window without any sample noticing, which is what an idle runner does between ticks.
    locked(&h.server.oom).credits = vec![Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1)];
    // TEST_SCENARIO: a machine's own boot dies now, and its claim must find no count to take.
    h.server.claim_own_kill("m1");
    assert!(
        locked(&h.server.oom)
            .holds
            .get("m1")
            .is_none_or(Option::is_none),
        "an aged credit was revived as a hold for a machine that died after it expired"
    );
    assert!(
        locked(&h.server.oom).credits.is_empty(),
        "the aged credit was left in the pool"
    );
}

// TEST_SCENARIO: a machine's held kill belongs to that machine. One count is sampled and claimed for m2 through the production claim, and m1's own SIGKILL must not spend it: the credit is m2's, and only m2 can take it.
#[tokio::test(flavor = "multi_thread")]
async fn another_machines_held_credit_is_not_spent() {
    let cgroup = std::env::temp_dir().join(format!("vmr-held-owner-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("held-owner", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    // TEST_SCENARIO: one count, claimed for m2 by the production claim path, which is what makes the credit m2's.
    counted(&cgroup, 1);
    h.server.reap_killed();
    h.server.claim_own_kill("m2");
    assert!(
        locked(&h.server.oom)
            .holds
            .get("m2")
            .is_some_and(Option::is_some),
        "the count was not assigned to the machine that claimed it"
    );
    // TEST_SCENARIO: m1's own SIGKILL asks for a credit, and m2's is the only one there is.
    assert!(
        !h.server.take_oom_credit("m1"),
        "a machine spent the credit held for another machine"
    );
    assert!(
        locked(&h.server.oom)
            .holds
            .get("m2")
            .is_some_and(Option::is_some),
        "the credit held for m2 was taken by m1"
    );
    // TEST_SCENARIO: the machine the credit is held for still has it.
    assert!(
        h.server.take_oom_credit("m2"),
        "the machine the credit was held for could not spend it"
    );
}

// TEST_SCENARIO: a grow's VMM dies of a SIGKILL, the runtime boots its whole-size replacement and that recovery outlives a credit's window, while the tick samples the kernel's count and expires it in the meantime. The hold has to exist from the moment the death is read, so the replacement's arrival cannot erase the count the death belongs to. This drives the production create, grow, recovery, tick and settlement, and never seeds the hold itself.
#[tokio::test(flavor = "multi_thread")]
async fn a_grows_own_kill_survives_the_recovery_it_started() {
    let cgroup = std::env::temp_dir().join(format!("vmr-grow-oom-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("grow-oom", |config| {
        config.cgroup_dir = Some(cgroup.clone());
        config.boot_mib = 1024;
    });
    // TEST_SCENARIO: the boot's grow dies of a SIGKILL, and the reboot that follows is held so the count can be sampled while it runs.
    *locked(&h.fake.grow_killed) = Some(libc::SIGKILL);
    // UNIT_BOUNDARY_DESCRIPTION: the reboot the failed grow runs is the second start, and it is the one held, so the count is sampled while that recovery is provably in flight.
    let (in_the_boot, let_go) = h.fake.hold_nth_start(2);
    // UNIT_BOUNDARY_DESCRIPTION: the create is scheduled from this test's own runtime, so its worker's waits have a reactor under them, and this task keeps running while the boot is in flight.
    h.server.put("m1", spec(true)).unwrap();
    // TEST_SCENARIO: the count is sampled and expired while the recovery still runs, which is the window the hold has to already cover. The boot is provably in flight before the first sample, so nothing here races a delay.
    let deadline = Instant::now() + Duration::from_secs(10);
    while !locked(&h.server.oom).holds.contains_key("m1") {
        assert!(
            Instant::now() < deadline,
            "the grow's death was read and no hold was made for it: {:?}",
            h.fake.calls()
        );
        counted(&cgroup, 1);
        h.server.reap_killed();
        std::thread::sleep(Duration::from_millis(10));
    }
    counted(&cgroup, 1);
    h.server.reap_killed();
    {
        let mut oom = locked(&h.server.oom);
        oom.credits.clear();
        if let Some(Some(held)) = oom.holds.get_mut("m1") {
            *held = Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1);
        }
    }
    // UNIT_BOUNDARY_DESCRIPTION: the recovery is still held here, so the hold has survived a window in which no ordinary credit could; letting it go lets the reboot finish and the machine settle.
    let _ = in_the_boot.try_recv();
    let _ = let_go.send(());
    h.settle("m1").await;
    assert!(
        h.server.status("m1").reason == REASON_OOM_KILLED
            || locked(&h.server.oom)
                .holds
                .get("m1")
                .is_some_and(Option::is_some),
        "the grow's own kill was lost while its replacement booted: {:?}",
        h.server.status("m1")
    );
}

// TEST_SCENARIO: two samples reach the runner while one machine's boot has already seen its VMM die, and both run at once: the count each brings is one victim, so exactly one hold may result and no count may be dropped. Made with the production sample path from both callers, gated inside the runtime so both are past every eligibility check before either takes a credit.
#[tokio::test(flavor = "multi_thread")]
async fn two_samples_at_once_do_not_lose_a_counted_kill() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-two-scans-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("two-scans", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    counted(&cgroup, 2);
    // UNIT_BOUNDARY_DESCRIPTION: two machines each waiting for the kill their own action saw, so both holds depend on assigning from the same count while both samples run: the count is turned into credits once, what a sample finds is only ever spent, and nothing is spent twice.
    for id in ["m1", "m2"] {
        if let Some(entry) = locked(&h.server.machines).entries.get_mut(id) {
            entry.action = Some(Action::Start);
        }
    }
    let one = h.server.clone();
    let two = h.server.clone();
    let (first, second) = std::thread::scope(|scope| {
        let first = scope.spawn(move || one.reap_killed());
        let second = scope.spawn(move || two.reap_killed());
        (first.join().unwrap(), second.join().unwrap())
    });
    let _ = (first, second);
    h.server.claim_own_kill("m1");
    h.server.claim_own_kill("m2");
    let owed = {
        let oom = locked(&h.server.oom);
        oom.holds.values().filter(|held| held.is_some()).count() + oom.credits.len()
    };
    assert_eq!(
        owed, 2,
        "two victims were counted and {owed} are still owed: a kill was consumed twice, or dropped"
    );
}

// TEST_SCENARIO: a machine is in an operator-requested stop, whose SIGKILL is nobody's memory death, and the kernel separately takes another machine. Only the machine whose own boot or grow saw its VMM die may hold a counted kill, so the stopped machine must not take the count, and the machine the kernel really took must name memory.
#[tokio::test(flavor = "multi_thread")]
async fn a_stop_holds_no_kill_belonging_to_another_machine() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-stop-hold-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("stop-hold", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    for id in ["m1", "m2"] {
        h.server.put(id, spec(true)).unwrap();
        h.settle(id).await;
        locked(&h.fake.states).insert(id.into(), State::Running);
    }
    // TEST_SCENARIO: m1 is being stopped, which is an action with no death of its own to hold, and the kernel's count goes up for m2.
    if let Some(entry) = locked(&h.server.machines).entries.get_mut("m1") {
        entry.action = Some(Action::Stop);
        entry.action_since = Some(Instant::now());
    }
    counted(&cgroup, 1);
    h.server.reap_killed();
    assert!(
        !locked(&h.server.oom).holds.contains_key("m1"),
        "a stop held a counted kill its own SIGKILL is not evidence for"
    );
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m2", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    h.server.reap_killed();
    assert_eq!(
        h.server.status("m2").reason,
        REASON_OOM_KILLED,
        "the machine the kernel took was not told it ran out of memory, because a stop was holding its count"
    );
}

// TEST_SCENARIO: a grow has already seen its machine's VMM die of a SIGKILL and starts the whole-size replacement, and the count that death belongs to is read while that replacement is alive. The hold is made from the death the grow captured, not from anything a scan can see about the pid the machine has now, so the kill is still namable after a recovery longer than a credit's window.
#[tokio::test(flavor = "multi_thread")]
async fn a_grows_own_kill_outlives_the_recovery_that_replaces_it() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-grow-hold-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("grow-hold", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    // TEST_SCENARIO: the kernel counts the grow's victim at the second it dies, and the count is read at the tick after; the grow is still recovering, so its death is claimed after the count.
    counted(&cgroup, 1);
    h.server.reap_killed();
    assert_eq!(locked(&h.server.oom).credits.len(), 1, "the count is owed");
    h.server.claim_own_kill("m1");
    // TEST_SCENARIO: the replacement the grow left behind lives on past the window, so a credit left in the pool would expire.
    {
        let mut oom = locked(&h.server.oom);
        oom.credits.clear();
        if let Some(Some(held)) = oom.holds.get_mut("m1") {
            *held = Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1);
        }
    }
    h.server.reap_killed();
    assert!(
        locked(&h.server.oom)
            .holds
            .get("m1")
            .is_some_and(Option::is_some),
        "the kill the grow's own death was counted for was dropped when its replacement outlived the window"
    );
}

// TEST_SCENARIO: an operator `kill -9`s a machine while the cgroup count does not move, so the death is considered and explained on the console alone. The kernel then takes another VMM for memory and the count rises: the death already considered must not be read again and spend that count, or the machine the kernel did take keeps no reason.
#[tokio::test(flavor = "multi_thread")]
async fn a_death_already_considered_does_not_spend_a_later_count() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-considered-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("considered-once", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    h.server.reap_killed();
    assert_ne!(
        h.server.status("m1").reason,
        REASON_OOM_KILLED,
        "a kill the cgroup did not count is not memory"
    );

    // TEST_SCENARIO: the kernel counts the next kill for another machine, and this tick reads the first death again if nothing remembers it.
    counted(&cgroup, 1);
    h.server.reap_killed();
    assert_ne!(
        h.server.status("m1").reason,
        REASON_OOM_KILLED,
        "the same death was counted twice and took the kill of another machine"
    );
    assert_eq!(
        locked(&h.server.oom).credits.len(),
        1,
        "the count is still unspent for the machine it was counted for"
    );
}

// TEST_SCENARIO: two kills in one burst, one named before the runner hands off. The other is still owed to a machine, so the runner that replaces this one has to credit it again: a baseline that moves past every sampled kill leaves the second victim unnamed.
#[tokio::test(flavor = "multi_thread")]
async fn a_handoff_keeps_the_other_kill_of_a_burst() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-burst-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let during = cgroup.clone();
    let h = Harness::with("burst-handoff", move |config| {
        config.cgroup_dir = Some(during)
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    counted(&cgroup, 2);
    h.server.match_oom_kills();
    assert_eq!(
        locked(&h.server.oom).credits.len(),
        2,
        "two kills, two credits"
    );

    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    h.server.reap_killed();
    assert_eq!(h.server.status("m1").reason, REASON_OOM_KILLED);
    assert_eq!(locked(&h.server.oom).credits.len(), 1, "one victim left");

    let next = h
        .hand_off(|config| config.cgroup_dir = Some(cgroup.clone()))
        .await;
    next.server.match_oom_kills();
    assert_eq!(
        locked(&next.server.oom).credits.len(),
        1,
        "the kill the last runner never named is still owed"
    );
}

// TEST_SCENARIO: a credit for a kill no machine explained ages out, and the runner hands off afterwards. Expiry is this runner saying the victim died where it could not see it, so the runner that replaces it must not read the same count as a fresh kill and spend it on whichever machine an operator kills next.
#[tokio::test(flavor = "multi_thread")]
async fn a_handoff_does_not_revive_a_credit_that_aged_out() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-revive-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let during = cgroup.clone();
    let h = Harness::with("no-revival", move |config| config.cgroup_dir = Some(during));
    counted(&cgroup, 1);
    h.server.match_oom_kills();
    let aged = Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1);
    locked(&h.server.oom).credits = vec![aged];
    assert!(
        !h.server.take_oom_credit("m"),
        "a credit past its window spends on nothing"
    );

    let next = h
        .hand_off(|config| config.cgroup_dir = Some(cgroup.clone()))
        .await;
    next.server.match_oom_kills();
    assert_eq!(
        locked(&next.server.oom).credits.len(),
        0,
        "a count this runner gave up on came back as a fresh kill"
    );
}

// TEST_SCENARIO: an OOM kill is counted at the moment the kernel makes it, which can be before the runner reads its first count — a machine handed over from a runner that ran out of memory itself dies in that window. The count is read when the runner is built, so that kill is still matched to its victim instead of being taken for the starting point.
#[tokio::test(flavor = "multi_thread")]
async fn a_kill_counted_before_the_runner_began_still_names_its_victim() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-baseline-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("cgroup-baseline", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);

    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // TEST_SCENARIO: the kill lands after the runner read the count it started from and before its first tick, which is the window a machine handed over from a runner that ran out of memory dies in.
    counted(&cgroup, 1);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());

    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");
}

// TEST_SCENARIO: a count the runner never matched to a victim is dropped once it is old: the victim died where no runner saw it, and spending that count on the next SIGKILL it does see would name memory for a machine an operator killed hours later.
#[tokio::test(flavor = "multi_thread")]
async fn a_credit_past_its_window_is_dropped_rather_than_spent() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-stale-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("cgroup-stale", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    h.server.reap_killed();

    // TEST_SCENARIO: the count of a kill this runner never saw a victim for, aged past the window it could still belong to a death in hand.
    locked(&h.server.oom)
        .credits
        .push(Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1));
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    h.server.reap_killed();
    let status = h.server.status("m1");
    assert!(status.reason.is_empty(), "{status:?}");
    let _ = vmm.wait();
}

// TEST_SCENARIO: a tick reads a growing VMM's death before the grow itself does — the sweep or the boot's monitor left the signal where both read — and the grow then reboots the machine, which hands it a new pid. The death must still be named, so the round leaves an acting machine's death to its action rather than reading it first, and the grow still finds the signal its reboot follows.
#[tokio::test(flavor = "multi_thread")]
async fn a_death_a_tick_read_first_is_still_named_by_the_grow_that_reboots_the_machine() {
    let h = Harness::with("grow-kill-collected", |c| c.boot_mib = 1024);
    *locked(&h.fake.fail_grow_once) = Some("the VMM did not add the RAM".into());
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    h.fake.keep_signal(pid, libc::SIGKILL);
    let (held, release) = h.fake.hold_start();
    h.server.put("m1", spec(true)).unwrap();
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot is in the gate");
    h.server.collect_exits();
    assert!(
        locked(&h.server.exits).is_empty(),
        "a death the machine's own action will read is not collected first"
    );
    release.send(()).expect("the boot is released");
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");
    let _ = vmm.kill();
    let _ = vmm.wait();
}

// TEST_SCENARIO: a set of credits whose victims this runner never saw has aged out, and the kernel has counted one more kill since. The cap must count the credits that are still live, not the dead ones still in the vector: a full set of expired credits that refuses the kill just counted leaves a machine killed for memory restarting with no reason at all.
#[tokio::test(flavor = "multi_thread")]
async fn a_full_set_of_aged_credits_does_not_refuse_a_kill_just_counted() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-expired-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("cgroup-expired", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let aged = Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1);
    locked(&h.server.oom).credits = vec![aged; OOM_CREDIT_CAP];

    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    counted(&cgroup, 1);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());
    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");
}

// TEST_SCENARIO: a boot, a grow and the tick all sample the cgroup's count, and the kernel may answer them in the other order: a sample of one kill that arrives after another worker has already read two must not move the count back, or the next sample counts one of those kills a second time and a machine an operator kills is named as memory.
#[tokio::test(flavor = "multi_thread")]
async fn a_sample_another_worker_already_passed_credits_nothing() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-race-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("cgroup-race", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.credit_oom(2);
    h.server.credit_oom(1);
    assert_eq!(
        locked(&h.server.oom).credits.len(),
        2,
        "the stale sample credited nothing"
    );
    h.server.credit_oom(2);
    assert_eq!(
        locked(&h.server.oom).credits.len(),
        2,
        "and the count it had already passed is not counted again"
    );
}

// TEST_SCENARIO: the kernel counts an OOM kill between the runner that was reading the count exiting and the next one starting, which is the window a hand-off opens. The count the old runner last read is kept, so the kill is credited to the runner that follows and can be spent on the machine its loader record names — taken as the new runner's starting point, it is spent on nobody.
#[tokio::test(flavor = "multi_thread")]
async fn a_kill_counted_while_no_runner_was_running_is_credited_to_the_next_one() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-handoff-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let dir = cgroup.clone();
    let h = Harness::with("cgroup-handoff", move |config| {
        config.cgroup_dir = Some(dir)
    });
    assert_eq!(
        locked(&h.server.oom).seen,
        0,
        "the first runner reads the count"
    );
    // TEST_SCENARIO: the kill lands while no runner is reading the count at all.
    let during = cgroup.clone();
    let later = cgroup.clone();
    let next = h
        .hand_off(move |config| {
            config.cgroup_dir = Some(during);
            counted(&later, 1);
        })
        .await;
    assert_eq!(
        locked(&next.server.oom).seen,
        0,
        "the next runner starts where the last one read, not where the count now stands"
    );
    next.server.match_oom_kills();
    assert_eq!(
        locked(&next.server.oom).credits.len(),
        1,
        "the kill counted in between is still unmatched, and spendable"
    );
}

// TEST_SCENARIO: two deaths and one count: nothing on the host says which process the kernel's count was for, so the same two deaths must be blamed the same way on every runner, and a machine's name is the one part of that a hash map's order cannot change. The count goes to the first name, on a fresh map each time.
#[tokio::test(flavor = "multi_thread")]
async fn one_count_goes_to_the_first_name_not_to_a_map_order() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-order-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let mut named = Vec::new();
    for (round, kills) in [(0, 1), (1, 2), (2, 3)] {
        let h = Harness::with(&format!("cgroup-order-{round}"), |config| {
            config.cgroup_dir = Some(cgroup.clone())
        });
        for id in ["m1", "m2"] {
            h.server.put(id, spec(true)).unwrap();
            h.settle(id).await;
            locked(&h.fake.states).insert(id.into(), State::Running);
            let mut vmm = stand_in_vmm();
            let pid = i32::try_from(vmm.id()).unwrap();
            h.fake.set_vmm(id, pid);
            // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
            unsafe { libc::kill(pid, libc::SIGKILL) };
            let ended = vmm.wait().expect("the VMM is waited on");
            h.fake.keep_signal(pid, ended.signal().unwrap());
        }
        counted(&cgroup, kills);
        h.server.reap_killed();
        named.push((h.server.status("m1").reason, h.server.status("m2").reason));
    }
    for (one, two) in named {
        assert_eq!(
            (one.as_str(), two.as_str()),
            (REASON_OOM_KILLED, ""),
            "the count went to the name that sorts first"
        );
    }
}
