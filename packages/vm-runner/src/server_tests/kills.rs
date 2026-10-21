use super::support::*;
use super::*;

// TEST_SCENARIO: a machine's VMM killed by a signal is the one thing that tells a seccomp kill from a guest that flapped: nothing else on the host records it, since the runtime's own sweep discards the status and it drops the record's pid the moment it notices the death. The status says which kill it was, with a counter for the dashboards, and the machine reads stopped at once so the controller restarts it rather than trusting a machine that is up.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_whose_vmm_the_kernel_killed_says_which_kill_it_was() {
    let h = Harness::new("killed");
    let kill_and_read = |id: &str, signal: libc::c_int| -> MachineStatus {
        let mut vmm = stand_in_vmm();
        let pid = i32::try_from(vmm.id()).unwrap();
        h.fake.set_vmm(id, pid);
        // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
        unsafe { libc::kill(pid, signal) };
        let deadline = Instant::now() + ACTION_DEADLINE;
        let status = loop {
            h.server.reap_killed();
            let status = h.server.status(id);
            if !status.reason.is_empty() {
                break status;
            }
            assert!(
                Instant::now() < deadline,
                "{id}: the kill was never reported: {status:?}"
            );
            std::thread::sleep(Duration::from_millis(5));
        };
        let _ = vmm.wait();
        status
    };

    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Stopped);
    let status = kill_and_read("m1", libc::SIGSYS);
    assert_eq!(status.reason, REASON_SECCOMP_KILLED, "{status:?}");
    assert!(
        status.message.contains("seccomp"),
        "the message names the filter: {status:?}"
    );
    assert_eq!(status.state, STATE_STOPPED, "{status:?}");
    assert!(
        h.server
            .metrics_text()
            .contains("platform_vm_runner_machine_kills_total{reason=\"MachineSeccompKilled\"} 1"),
        "the kill was not counted:\n{}",
        h.server.metrics_text()
    );

    // TEST_SCENARIO: the signal the kernel's OOM killer sends reads as the memory kill.
    h.server.put("m2", spec(true)).unwrap();
    h.settle("m2").await;
    locked(&h.fake.states).insert("m2".into(), State::Stopped);
    let status = kill_and_read("m2", libc::SIGKILL);
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");
    assert!(
        status.message.contains("free memory"),
        "the message names the memory: {status:?}"
    );
    assert!(
        h.server
            .metrics_text()
            .contains("platform_vm_runner_machine_kills_total{reason=\"MachineOOMKilled\"} 1"),
        "the kill was not counted:\n{}",
        h.server.metrics_text()
    );
}

// TEST_SCENARIO: the runner kills VMMs itself — a stop, a delete, a start clearing a VMM left on the disk — so a kill it is acting through must never read as a machine the kernel took: an agent stopped by its owner would otherwise be told it ran out of memory.
#[tokio::test(flavor = "multi_thread")]
async fn a_vmm_the_runner_is_stopping_is_not_a_kill_to_report() {
    let h = Harness::new("stopping-kill");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;

    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    *locked(&h.fake.stop_delay) = Duration::from_millis(500);
    h.server.put("m1", spec(false)).unwrap();
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    for _ in 0..5 {
        h.server.reap_killed();
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_ne!(
        h.server.status("m1").reason,
        REASON_OOM_KILLED,
        "the runner's own stop was reported as a kill"
    );
    assert_no_kill_counted(&h);
    let _ = vmm.wait();
    h.settle("m1").await;
}

// TEST_SCENARIO: a probe takes the machine's `looked` before it asks the guest, and a kill lands while it is out. The probe's answer arrives afterwards, and must not put the dead machine back to running over the kill it reported: what the reap recorded moves `looked` with it, so the older answer is dropped.
#[tokio::test(flavor = "multi_thread")]
async fn a_probe_that_looked_before_the_kill_cannot_undo_it() {
    let h = Harness::new("stale-probe");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let looked = h.machine("m1", |e| e.looked);
    let status = kill_vmm(&h, "m1", libc::SIGKILL);
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");

    h.server.record(
        "m1",
        Seen {
            state: State::Running,
            ready: true,
            error: None,
        },
        Some(looked),
    );
    let status = h.server.status("m1");
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");
    assert_eq!(status.state, STATE_STOPPED, "{status:?}");
}

// TEST_SCENARIO: a restart stops the machine's VMM while its owner still asks it to run, so the spec alone is no guard and the action in flight is. The signal the restart's own stop sends is never reported as the kernel's memory kill, and never counted.
#[tokio::test(flavor = "multi_thread")]
async fn a_restarts_stop_is_not_a_kill_to_report() {
    let h = Harness::new("restart-kill");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);

    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    *locked(&h.fake.stop_delay) = Duration::from_millis(300);
    let mut next = spec(true);
    next.revision = "r2".into();
    h.server.put("m1", next).unwrap();
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    for _ in 0..10 {
        h.server.reap_killed();
        assert_ne!(
            h.server.status("m1").reason,
            REASON_OOM_KILLED,
            "the restart's own stop was reported as a kill"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_no_kill_counted(&h);
    let _ = vmm.wait();
    h.settle("m1").await;
}

// TEST_SCENARIO: a stop whose wait the runner gave up on keeps holding the machine until the runtime call returns, so the machine can be killed after its action ended and before the call did. That kill is the runner's, not the kernel's: the machine reports no reason while the call still holds it, and the kill is reported once the call returns.
#[tokio::test(flavor = "multi_thread")]
async fn a_kill_a_runtime_call_still_holds_is_not_reported_before_it_returns() {
    let h = Harness::new("held-kill");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);

    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    let held = h.machine("m1", |e| e.calls.clone());
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    let killed = unsafe { libc::kill(pid, libc::SIGKILL) };
    assert_eq!(killed, 0, "the VMM was not signalled");
    // UNIT_BOUNDARY_DESCRIPTION: a signal is delivered a moment after the call, so the death is waited for before the ticks: the ticks then prove what holds the kill, not whether it had landed.
    wait_ended_without_reaping(pid);
    for _ in 0..5 {
        h.server.reap_killed();
        assert_ne!(
            h.server.status("m1").reason,
            REASON_OOM_KILLED,
            "a call still running on the machine was reported as a kill"
        );
    }
    drop(held);
    h.server.reap_killed();
    assert_eq!(h.server.status("m1").reason, REASON_OOM_KILLED);
    let _ = vmm.wait();
}

// TEST_SCENARIO: the kill is said until the guest answers again, because the boot that follows it is what tells the controller to restart the agent; once the guest answers, the machine is up and the kill no longer explains it.
#[tokio::test(flavor = "multi_thread")]
async fn the_kill_goes_when_the_guest_answers_again() {
    let h = Harness::new("kill-cleared-by-guest");
    h.server.put("m1", spec(true)).unwrap();
    let running = h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let status = kill_vmm(&h, "m1", libc::SIGKILL);
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");

    let _up = guest(running.port.try_into().unwrap());
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert!(
        status.reason.is_empty(),
        "the kill outlived the guest's answer: {status:?}"
    );
}

// TEST_SCENARIO: an owner that asks the machine down ends the report at once: a hibernated machine says it is hibernated, not that the kernel killed it for memory it no longer asks for.
#[tokio::test(flavor = "multi_thread")]
async fn the_kill_goes_when_the_owner_asks_the_machine_down() {
    let h = Harness::new("kill-cleared-by-owner");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let status = kill_vmm(&h, "m1", libc::SIGKILL);
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");

    h.server.put("m1", spec(false)).unwrap();
    assert!(
        h.server.status("m1").reason.is_empty(),
        "{:?}",
        h.server.status("m1")
    );
}

// TEST_SCENARIO: a SIGKILL is the kernel's OOM killer's only when the runner's cgroup counted an OOM kill since the last reap, so an operator's `kill -9` on a VMM restarts the machine with no memory reason; a SIGKILL the cgroup did count is the kernel's, and says so.
#[tokio::test(flavor = "multi_thread")]
async fn a_sigkill_the_cgroup_did_not_count_is_not_a_memory_kill() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    let counted = |kills: u64| {
        fs::write(
            cgroup.join("memory.events"),
            format!("low 0\nhigh 0\nmax 4\noom {kills}\noom_kill {kills}\noom_group_kill 0\n"),
        )
        .unwrap();
    };
    counted(0);
    let h = Harness::with("cgroup-kill", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    // TEST_SCENARIO: the baseline the next reap compares against.
    h.server.reap_killed();

    // TEST_SCENARIO: a `kill -9` the cgroup counted nothing for is reaped and reported as nothing.
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    for _ in 0..10 {
        h.server.reap_killed();
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_ne!(
        h.server.status("m1").reason,
        REASON_OOM_KILLED,
        "a kill the cgroup did not count was reported as memory"
    );
    assert_no_kill_counted(&h);
    let _ = vmm.wait();
    // TEST_SCENARIO: the operator stops the machine, so the pid the kernel frees is never read as the next machine's VMM.
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;

    counted(1);
    h.server.put("m2", spec(true)).unwrap();
    h.settle("m2").await;
    locked(&h.fake.states).insert("m2".into(), State::Running);
    let status = kill_vmm(&h, "m2", libc::SIGKILL);
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");
}

// TEST_SCENARIO: a VMM that dies while its machine's start call is still running is the case the runtime's own sweep hides: the reaper cannot report a kill the start might itself be causing, and the sweep in the same tick reads the status and drops it, so the machine would restart under a boot failure and the kill would go unrecorded. The status is collected once, before either decides, and kept until the start returns: the kill is then named as the boot after it.
#[tokio::test(flavor = "multi_thread")]
async fn a_kill_during_a_boot_outlives_the_sweep_that_would_have_erased_it() {
    let h = Harness::new("kill-during-boot");
    // UNIT_BOUNDARY_DESCRIPTION: the boot holds until this test lets it go, so a kill is provably read while the start call still runs, rather than within a delay a loaded machine can outlast.
    let (held, release) = h.fake.hold_start();
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot holds until this test lets it go");

    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    // TEST_SCENARIO: the sweep's own read, which erases the status on every host: the runtime reaps the child and keeps only the signal, so the reaper's ticks find no status left to read.
    // UNIT_BOUNDARY_DESCRIPTION: a signal is delivered a moment after the call, so the reap repeats until the kernel has run the child.
    let deadline = Instant::now() + ACTION_DEADLINE;
    let swept = loop {
        match smolvm::process::try_wait(pid) {
            Some(swept) => break swept,
            None if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(1)),
            None => panic!("the VMM was never reaped"),
        }
    };
    assert_eq!(swept, 128 + libc::SIGKILL);
    let kept =
        smolvm::process::peek_exit_signal(pid).expect("the runtime keeps the signal it read");
    h.fake.keep_signal(pid, kept);
    // TEST_SCENARIO: the production tick, three times over, each proving on its own that a machine still starting reports nothing: only the boot's own return can make the death reportable.
    for _ in 0..3 {
        h.server.reap_killed();
        assert_ne!(
            h.server.status("m1").reason,
            REASON_OOM_KILLED,
            "a kill was reported while the start it may belong to still ran"
        );
    }

    release.send(()).expect("the boot returns");
    h.settle("m1").await;
    h.server.reap_killed();
    assert_eq!(
        h.server.status("m1").reason,
        REASON_OOM_KILLED,
        "the kill the sweep would have erased was not named once the start returned"
    );
    let _ = vmm.wait();
}

// TEST_SCENARIO: the kernel counts the kill of a booting VMM, and the boot's own recovery — stopping the machine and booting it whole — takes longer than the window a credit is held for. The victim and its signal are known, so the credit must wait for the action that names it rather than age out while that action still runs.
#[tokio::test(flavor = "multi_thread")]
async fn a_slow_boot_keeps_the_kill_it_was_restarted_for() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-slow-boot-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    counted(&cgroup, 0);
    let h = Harness::with("slow-boot-kill", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    let (held, release) = h.fake.hold_start();
    h.fake.kill_on_start(libc::SIGKILL);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot holds until this test lets it go");
    counted(&cgroup, 1);
    h.server.reap_killed();
    assert_eq!(
        locked(&h.server.oom).credits.len(),
        1,
        "the kill is counted while its boot runs"
    );
    // TEST_SCENARIO: the recovery takes longer than the window. The kill counted while it ran stays owed to the machine, so nothing the clock does can take it away.
    let aged = Instant::now() - OOM_CREDIT_TTL - Duration::from_secs(1);
    {
        let mut oom = locked(&h.server.oom);
        oom.credits.clear();
        oom.holds.insert("m1".into(), Some(aged));
    }

    release.send(()).expect("the boot returns");
    let status = h.settle("m1").await;
    assert_eq!(
        status.reason, REASON_OOM_KILLED,
        "the kill the machine was restarted for was forgotten while it restarted: {status:?}"
    );
}

// TEST_SCENARIO: the cgroup counts an OOM kill, and an operator `kill -9`s another machine in the same second. One count is one victim: the machine the kernel took names memory, the operator's does not, and the kill counter shows the one. A count the reaper never matched to a victim — a kill of something outside its machines — does not label the next SIGKILL it does see.
#[tokio::test(flavor = "multi_thread")]
async fn one_counted_oom_names_one_machine_not_every_sigkill_beside_it() {
    let cgroup = std::env::temp_dir().join(format!("vmr-cgroup-two-{}", std::process::id()));
    let _ = fs::remove_dir_all(&cgroup);
    fs::create_dir_all(&cgroup).unwrap();
    let counted = |kills: u64| {
        fs::write(
            cgroup.join("memory.events"),
            format!("low 0\nhigh 0\nmax 4\noom {kills}\noom_kill {kills}\noom_group_kill 0\n"),
        )
        .unwrap();
    };
    counted(0);
    let h = Harness::with("cgroup-one-of-two", |config| {
        config.cgroup_dir = Some(cgroup.clone())
    });
    for id in ["m1", "m2"] {
        h.server.put(id, spec(true)).unwrap();
        h.settle(id).await;
        locked(&h.fake.states).insert(id.into(), State::Running);
    }
    h.server.reap_killed();

    let mut first = stand_in_vmm();
    let mut second = stand_in_vmm();
    let (one, two) = (
        i32::try_from(first.id()).unwrap(),
        i32::try_from(second.id()).unwrap(),
    );
    h.fake.set_vmm("m1", one);
    h.fake.set_vmm("m2", two);
    counted(1);
    // SAFETY: kill(2) takes no pointers, and both pids are this test's own children.
    unsafe {
        libc::kill(one, libc::SIGKILL);
        libc::kill(two, libc::SIGKILL);
    }
    let deadline = Instant::now() + ACTION_DEADLINE;
    while h.server.status("m1").reason.is_empty() && h.server.status("m2").reason.is_empty() {
        assert!(Instant::now() < deadline, "neither kill was reported");
        h.server.reap_killed();
        std::thread::sleep(Duration::from_millis(5));
    }
    let (one_reason, two_reason) = (
        h.server.status("m1").reason.clone(),
        h.server.status("m2").reason.clone(),
    );
    let named = [one_reason.clone(), two_reason.clone()]
        .iter()
        .filter(|reason| **reason == REASON_OOM_KILLED)
        .count();
    assert_eq!(
        named, 1,
        "one count is one victim: m1={one_reason:?} m2={two_reason:?}"
    );
    assert!(
        h.server.metrics_text().lines().any(|line| line
            == format!(
                "platform_vm_runner_machine_kills_total{{reason=\"{REASON_OOM_KILLED}\"}} 1"
            )),
        "the counter shows one kill:\n{}",
        h.server.metrics_text()
    );
    let _ = first.wait();
    let _ = second.wait();
}

// TEST_SCENARIO: the kernel can take a VMM while its guest is still booting, and the boot then fails like any other. The kill is what the machine must say: a boot that broke sends a person looking at an image, and a kill the runner names restarts the machine and is counted, which is the difference between a machine that flapped and a machine that ran out of memory.
#[tokio::test(flavor = "multi_thread")]
async fn a_kill_during_a_boot_is_named_as_the_kill_it_was() {
    let h = Harness::new("boot-killed");
    h.fake.kill_on_start(libc::SIGSYS);
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_SECCOMP_KILLED, "{status:?}");
    assert!(
        status.message.contains("seccomp"),
        "the message says which kill it was: {status:?}"
    );
    assert!(
        h.server.metrics_text().lines().any(|line| line
            == format!(
                "platform_vm_runner_machine_kills_total{{reason=\"{REASON_SECCOMP_KILLED}\"}} 1"
            )),
        "the kill is counted:\n{}",
        h.server.metrics_text()
    );
}

// TEST_SCENARIO: a boot's VMM can die before the runtime's record names it, and the runtime's own code — the monitor waiting on that boot, or its sweep over its children — reaps the child and takes the status word. The signal it kept is the only one there is, and the machine must still say which kill took it rather than that its boot broke.
#[tokio::test(flavor = "multi_thread")]
async fn a_kill_the_runtime_reaped_itself_is_still_named() {
    let h = Harness::new("boot-killed-swept");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);

    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGSYS) };
    let ended = vmm.wait().expect("the VMM is waited on");
    // TEST_SCENARIO: what the runtime's sweep keeps instead of the status word it read.
    h.fake.keep_signal(pid, ended.signal().unwrap());

    h.server.reap_killed();
    let status = h.server.status("m1");
    assert_eq!(status.reason, REASON_SECCOMP_KILLED, "{status:?}");
}

// TEST_SCENARIO: the RAM a grow asks for is the memory that most often kills the machine asking for it, and the reboot that follows a failed grow gives the machine a new pid. A death collected under the old pid is never matched again, so the kill must be read where the grow failed and said on the machine — otherwise the machine restarts from an OOM with nothing on its status saying so.
#[tokio::test(flavor = "multi_thread")]
async fn a_kill_during_a_grow_is_named_after_the_reboot() {
    let h = Harness::with("grow-killed", |c| c.boot_mib = 1024);
    *locked(&h.fake.fail_grow_once) = Some("the VMM did not add the RAM".into());
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm("m1", pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let ended = vmm.wait().expect("the VMM is waited on");
    h.fake.keep_signal(pid, ended.signal().unwrap());

    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");
    assert_eq!(
        h.fake.calls(),
        vec![
            "create m1",
            "start m1",
            "grow m1 2048",
            "stop m1",
            "start m1"
        ]
    );
}

// TEST_SCENARIO: a machine the kernel killed that wakes onto a boot copying a migration's seed reports the copy, not the kill: the copy is what is running now, the controller holds it past its idle cap and exempts it from its not-ready bound, and a kill from before it explains neither. The kill is still what the status said before that boot, and it says so again if the copy ends before the guest answers.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_copying_a_disk_reads_over_the_kill_before_it() {
    let h = Harness::new("copying-after-kill");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.fake.states).insert("m1".into(), State::Running);
    let status = kill_vmm(&h, "m1", libc::SIGKILL);
    assert_eq!(status.reason, REASON_OOM_KILLED, "{status:?}");

    // TEST_SCENARIO: the machine is stopped in the runtime while the kill's reason still stands, and its next start copies a migration's seed.
    locked(&h.fake.states).insert("m1".into(), State::Stopped);
    h.server.probe("m1");
    let seed = upload(&h, "m1", b"a home");
    h.server.put("m1", expecting(true, &seed)).unwrap();
    let copying = h.settle("m1").await;
    assert!(!copying.ready);
    assert_eq!(copying.reason, REASON_COPYING_DISK, "{copying:?}");
    assert!(
        !copying.message.contains("free memory"),
        "the copy's message carries the kill's: {copying:?}"
    );

    let _guest = guest(h.base);
    let up = h.until("m1", "ready", |s| s.ready).await;
    assert_eq!(up.reason, "", "{up:?}");
}
