use super::support::*;
use super::*;

// TEST_SCENARIO: a machine that does not fit the runner's memory is refused at the door, with a message naming the shortfall, and nothing is created. Capacity counts machines still being created, which have no spec on disk yet, so two creates cannot both fit into room for one.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_is_refused_when_the_runner_has_no_room() {
    let h = Harness::with("capacity", |c| c.memory_mib = 3000);
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    assert_eq!(
        h.server.put("m1", spec(true)).unwrap().state,
        STATE_CREATING
    );
    let refused = h.server.put("m2", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY);
    assert!(refused.message.contains("does not fit"), "{refused:?}");
    h.settle("m1").await;
    assert!(!h.fake.calls().iter().any(|c| c.ends_with("m2")));
}

// TEST_SCENARIO: the controller caps admission at the memory the pod was allocated, which is below the pod's own limit while an in-place resize waits for room, so a machine that fits the limit is refused until the node has granted the owner that much. The refusal names the node's allocation rather than the owner's pool, under its own reason, so the controller neither hibernates idle agents for room the node is about to grant nor tells the person their memory is full. The same machine starts once a later spec carries a ceiling that covers it.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_is_refused_above_the_memory_the_node_granted() {
    let h = Harness::with("allocation", |c| c.memory_mib = 8192);
    let mut machine = spec(true);
    machine.memory_mib = 4096;
    machine.admit_mib = 3072;
    let refused = h.server.put("m1", machine.clone()).unwrap();
    assert_eq!(refused.reason, REASON_AWAITING_ALLOCATION, "{refused:?}");
    assert!(
        refused
            .message
            .contains("3072 MiB the node has allocated this runner so far, less the 0 MiB the runner keeps for itself"),
        "{refused:?}"
    );
    assert!(
        h.fake.calls().is_empty(),
        "nothing is created: {:?}",
        h.fake.calls()
    );

    machine.admit_mib = 4096;
    assert_eq!(h.server.put("m1", machine).unwrap().state, STATE_CREATING);
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: a boot the runner admitted is the runner's to finish. The controller re-sends the machine on every reconcile, and the ceiling it carries moves under it — a node that stops reporting its grant re-sends the one-MiB ceiling that authorizes nothing, a node that grants less sends a smaller figure. Deciding that ceiling again would refuse a boot already carrying out, which the controller answers by stopping the machine it had just started, so an action in flight keeps the admission it was given, on a Create from a machine with no record and on a Start from a stopped one alike.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_in_flight_keeps_the_admission_it_was_given() {
    for (label, stop_first) in [("create", false), ("start", true)] {
        let h = Harness::with(&format!("boot-admitted-{label}"), |c| c.memory_mib = 8192);
        let mut machine = spec(true);
        machine.memory_mib = 3072;
        machine.admit_mib = 4096;
        if stop_first {
            h.server.put("m1", spec(false)).unwrap();
            assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
        }
        // TEST_SCENARIO: the boot is held inside the runtime, so the ensure below lands while it runs rather than at whatever speed this host schedules the test.
        let (held, release) = h.fake.hold_start();
        let booting = if stop_first {
            STATE_STARTING
        } else {
            STATE_CREATING
        };
        assert_eq!(
            h.server.put("m1", machine.clone()).unwrap().state,
            booting,
            "{label}"
        );
        held.recv_timeout(ACTION_DEADLINE)
            .expect("the boot never reached the runtime");

        let mut shrunk = machine.clone();
        shrunk.admit_mib = 1024;
        let answered = h.server.put("m1", shrunk.clone()).unwrap();
        assert_ne!(
            answered.reason, REASON_AWAITING_ALLOCATION,
            "{label}: a boot already in flight was admitted again: {answered:?}"
        );
        assert_eq!(answered.state, booting, "{label}: {answered:?}");
        release.send(()).unwrap();
        assert_eq!(h.settle("m1").await.state, STATE_RUNNING, "{label}");

        // TEST_SCENARIO: the same ceiling on a machine that holds nothing is decided afresh, and it refuses.
        h.server.put("m1", spec(false)).unwrap();
        assert_eq!(h.settle("m1").await.state, STATE_STOPPED, "{label}");
        assert_eq!(
            h.server.put("m1", shrunk).unwrap().reason,
            REASON_AWAITING_ALLOCATION,
            "{label}: a ceiling that authorizes nothing admitted a cold start"
        );
    }
}

// TEST_SCENARIO: an action the convergence loop plans after the one before it ended is a new operation. A boot admitted under a ceiling that covered it then fails, and the worker stays alive because a newer spec arrived while it ran: the step it plans next is a fresh start, and the newer spec's own ceiling has to admit it. Inheriting the first boot's admission would boot a machine this spec cannot pay for, which is memory the node never granted.
#[tokio::test(flavor = "multi_thread")]
async fn a_step_planned_after_a_failed_boot_is_admitted_on_its_own() {
    let h = Harness::with("planned-admission", |c| c.memory_mib = 8192);
    let mut machine = spec(true);
    machine.memory_mib = 3072;
    machine.admit_mib = 4096;
    *locked(&h.fake.fail_start_once) = Some("guest agent never became ready".into());
    let (held, release) = h.fake.hold_start();
    h.server.put("m1", machine.clone()).unwrap();
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot never reached the runtime");

    let mut shrunk = machine.clone();
    shrunk.admit_mib = 1024;
    h.server.put("m1", shrunk).unwrap();
    release.send(()).unwrap();

    let settled = h.settle("m1").await;
    assert_eq!(
        h.fake.calls().iter().filter(|c| *c == "start m1").count(),
        1,
        "the failed boot was retried under a ceiling that does not cover it: {:?} {:?}",
        h.fake.calls(),
        settled
    );
    assert_eq!(settled.reason, REASON_AWAITING_ALLOCATION, "{settled:?}");
}

// TEST_SCENARIO: a restart of a machine the runtime reports running replaces memory it already holds, so it is exempt from the ceiling wherever the plan comes from. A revision change accepted while a boot was still in flight is planned by the worker that booted it, not by a PUT: reading that plan as a new operation and capping it would refuse a restart the same PUT would have admitted, and the machine would be left on the old revision.
#[tokio::test(flavor = "multi_thread")]
async fn a_restart_planned_by_the_worker_is_exempt_like_one_a_put_asks_for() {
    let h = Harness::with("planned-restart", |c| c.memory_mib = 4096);
    let mut machine = spec(true);
    machine.memory_mib = 3072;
    machine.admit_mib = 4096;
    let (held, release) = h.fake.hold_start();
    h.server.put("m1", machine.clone()).unwrap();
    held.recv_timeout(ACTION_DEADLINE)
        .expect("the boot never reached the runtime");

    // TEST_SCENARIO: a revision change arrives under a ceiling far below what the machine boots at, while that boot is still running.
    let mut changed = machine.clone();
    changed.admit_mib = 1024;
    changed.revision = "r2".into();
    h.server.put("m1", changed.clone()).unwrap();
    release.send(()).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    let applied = h.machine("m1", |e| e.desired.clone().unwrap().revision);
    assert_eq!(
        applied, "r2",
        "the restart onto the new revision was refused for a ceiling a PUT of the same spec would have been exempt from"
    );
    assert!(
        h.fake.calls().iter().filter(|c| *c == "start m1").count() >= 2,
        "the replacement never booted: {:?}",
        h.fake.calls()
    );
}

// TEST_SCENARIO: a refusal ends this worker only if the spec it refused is still the newest one. A spec accepted between the refusal and the cleanup started no worker, because this one still held the machine, so ending here would leave a start the runner accepted with nothing to run it until something else asked again.
#[tokio::test(flavor = "multi_thread")]
async fn a_refused_step_settles_only_on_the_spec_it_refused() {
    let h = Harness::with("refusal-settle", |c| c.memory_mib = 4096);
    let mut machine = spec(true);
    machine.memory_mib = 3072;
    machine.admit_mib = 4096;
    *locked(&h.fake.fail_start_once) = Some("guest agent never became ready".into());
    let (booted, release_boot) = h.fake.hold_start();
    h.server.put("m1", machine.clone()).unwrap();
    booted
        .recv_timeout(ACTION_DEADLINE)
        .expect("the boot never reached the runtime");

    // TEST_SCENARIO: the ceiling shrinks under the boot, so the step the worker plans after it fails is refused.
    let mut shrunk = machine.clone();
    shrunk.admit_mib = 1024;
    h.server.put("m1", shrunk).unwrap();
    // TEST_SCENARIO: the gate is armed before the failing boot is released, so the spec below is the one accepted behind the refusal.
    let (refused, release_refusal) = h.hold_refusal();
    release_boot.send(()).unwrap();
    refused
        .recv_timeout(ACTION_DEADLINE)
        .expect("the refusal never happened");

    let mut restored = machine.clone();
    restored.admit_mib = 4096;
    h.server.put("m1", restored).unwrap();
    release_refusal.send(()).unwrap();

    let settled = h.settle("m1").await;
    assert_eq!(
        h.fake.calls().iter().filter(|c| *c == "start m1").count(),
        2,
        "the spec accepted behind the refusal was left with no worker to start it: {:?} {settled:?}",
        h.fake.calls()
    );
    assert_eq!(settled.state, STATE_RUNNING, "{settled:?}");
}

// TEST_SCENARIO: a machine that is already running comes back under a ceiling sized from what it holds while idle, which is below the size it boots at: a revision roll, an image or env change, a CA rotation and a guest gone quiet all restart a running machine, and refusing those for good would park the agent and scale its gateway away. A machine that is not running is still capped, so the ceiling keeps gating every footprint the runner does not already hold.
#[tokio::test(flavor = "multi_thread")]
async fn a_running_machine_restarts_under_a_ceiling_below_what_it_boots_at() {
    let h = Harness::with("restart-ceiling", |c| c.memory_mib = 4096);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    *locked(&h.fake.resident) = Some(400);

    let mut ceilinged = spec(true);
    ceilinged.admit_mib = 1536;
    let mut changed = ceilinged.clone();
    changed.revision = "r2".into();
    let restarted = h.server.put("m1", changed).unwrap();
    assert_eq!(restarted.state, STATE_RESTARTING, "{restarted:?}");
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    let mut second = spec(true);
    second.admit_mib = 1536;
    let refused = h.server.put("m2", second).unwrap();
    assert_eq!(refused.reason, REASON_AWAITING_ALLOCATION, "{refused:?}");
}

// TEST_SCENARIO: a restart the runner admitted holds its exemption for the whole action, because the worker stops the old VMM and boots its replacement in one: the controller's next ensure can land while the machine is down, and re-checking that already-admitted restart against the grant answered MachineAwaitingAllocation, which the controller acts on by stopping the machine the restart had just booted.
#[tokio::test(flavor = "multi_thread")]
async fn a_restart_keeps_its_exemption_while_its_replacement_boots() {
    let h = Harness::with("restart-in-flight", |c| c.memory_mib = 4096);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    *locked(&h.fake.resident) = Some(400);

    let mut ceilinged = spec(true);
    ceilinged.admit_mib = 1536;
    *locked(&h.fake.start_delay) = Duration::from_millis(400);
    let mut changed = ceilinged.clone();
    changed.revision = "r2".into();
    assert_eq!(
        h.server.put("m1", changed.clone()).unwrap().state,
        STATE_RESTARTING
    );
    h.wait_for_call("stop m1").await;
    // TEST_SCENARIO: the restart's own boot is the second start the runtime is asked for, and it is still running here.
    while h.fake.calls().iter().filter(|c| *c == "start m1").count() < 2 {
        tokio::time::sleep(Duration::from_millis(1)).await;
    }

    let again = h.server.put("m1", changed).unwrap();
    assert_ne!(
        again.reason, REASON_AWAITING_ALLOCATION,
        "an admitted restart was re-checked against the grant: {again:?}"
    );
    assert_eq!(again.state, STATE_RESTARTING, "{again:?}");
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: a machine that does not fit the runner's own limit is refused as the owner's memory being full whether the ceiling is above the limit or below it: the ceiling never hides the real shortfall, which is the one the controller relieves by hibernating idle agents, and a machine the node cannot help never reads as waiting for the node.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_over_the_runner_limit_is_refused_as_out_of_capacity_under_a_ceiling() {
    for admit_mib in [8192, 3072] {
        let h = Harness::with("both-bounds", |c| c.memory_mib = 4096);
        let mut machine = spec(true);
        machine.memory_mib = 8192;
        machine.admit_mib = admit_mib;
        let refused = h.server.put("m1", machine).unwrap();
        assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");
        assert!(
            refused
                .message
                .contains("the VM runner has 4096 MiB for machines"),
            "admit_mib={admit_mib}: {refused:?}"
        );
    }
}

// TEST_SCENARIO: a machine still booting holds its memory even when the spec stored behind the boot is a stop: the VMM is up until the stop that follows it runs. Admission counts it by the action in flight, so another machine that would only fit without it is refused until it is really down, and admitted after.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_with_a_stop_behind_it_still_counts_against_the_runners_memory() {
    let h = Harness::with("capacity-stop-behind", |c| c.memory_mib = 3000);
    *locked(&h.fake.start_delay) = Duration::from_millis(500);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    h.server.put("m1", spec(false)).unwrap();

    let refused = h.server.put("m2", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");

    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    *locked(&h.fake.start_delay) = Duration::ZERO;
    assert_eq!(
        h.server.put("m2", spec(true)).unwrap().state,
        STATE_CREATING
    );
    assert_eq!(h.settle("m2").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: a failure recorded against a spec the controller then replaced says nothing about the new one. A spec that needs no action at all — here a stop without a shape, for a machine that was refused and so never made — clears it, with a new status version so a waiting read hears of it, rather than carrying the old refusal until some later action succeeds.
#[tokio::test(flavor = "multi_thread")]
async fn a_spec_that_needs_nothing_clears_the_failure_before_it() {
    let h = Harness::with("stale-failure", |c| c.memory_mib = 1000);
    let refused = h.server.put("m1", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");

    let stopped = h.server.put("m1", MachineSpec::default()).unwrap();
    assert!(
        stopped.reason.is_empty() && stopped.message.is_empty(),
        "{stopped:?}"
    );
    assert_ne!(stopped.version, refused.version);
    assert!(h.server.status("m1").reason.is_empty());
}

// TEST_SCENARIO: guests that grow together can take the runner over its limit between two of the controller's passes, so the runner's own working set is what tells the controller to reclaim at once. The signal comes with every running machine measured again, because the controller decides whom to hibernate from what the statuses say each machine holds.
#[tokio::test(flavor = "multi_thread")]
async fn a_working_set_past_ninety_five_percent_answers_a_pressure_wait_with_fresh_measurements() {
    let cgroup = crate::testdir::TempDir::new("pressure-cgroup");
    let charge = |mib: u64| {
        fs::write(
            cgroup.path().join("memory.current"),
            (mib << 20).to_string(),
        )
        .unwrap();
        fs::write(cgroup.path().join("memory.stat"), "inactive_file 0\n").unwrap();
    };
    charge(100);
    let dir = cgroup.path().to_path_buf();
    let h = Harness::with("pressure", move |c| {
        c.memory_mib = 4000;
        c.cgroup_dir = Some(dir);
    });
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let before = h.server.pressure();
    assert!(!before.pressured);

    *locked(&h.fake.resident) = Some(777);
    charge(3840);
    let server = h.server.clone();
    let since = before.version;
    let read =
        tokio::task::spawn_blocking(move || server.wait_pressure(since, Duration::from_secs(5)))
            .await
            .unwrap();
    assert!(read.pressured && read.version != since, "{read:?}");
    assert_eq!((read.limit_mib, read.working_set_mib), (4000, 3840));
    assert_eq!(h.server.status("m1").used_mib, 777);

    charge(3680);
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(
        h.server.pressure().pressured,
        "pressure ended above ninety percent"
    );
    charge(3200);
    let server = h.server.clone();
    let since = read.version;
    let ended =
        tokio::task::spawn_blocking(move || server.wait_pressure(since, Duration::from_secs(5)))
            .await
            .unwrap();
    assert!(!ended.pressured, "{ended:?}");
}

// TEST_SCENARIO: the controller resizes the runner pod's memory limit in place when the owner's pool changes, and the runner keeps the limit it was started with in its arguments. So admission reads the limit the kernel holds: a start refused under the old limit is admitted once the cgroup's memory.max is raised, with no restart of the runner.
#[tokio::test(flavor = "multi_thread")]
async fn a_memory_limit_raised_in_place_admits_what_the_old_one_refused() {
    let cgroup = crate::testdir::TempDir::new("live-limit-cgroup");
    let limit =
        |mib: u64| fs::write(cgroup.path().join("memory.max"), (mib << 20).to_string()).unwrap();
    limit(1000);
    let dir = cgroup.path().to_path_buf();
    let h = Harness::with("live-limit", move |c| {
        c.memory_mib = 8000;
        c.boot_mib = 1024;
        c.cgroup_dir = Some(dir);
    });
    let refused = h.server.put("m1", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");
    assert_eq!(h.server.pressure().limit_mib, 1000);

    limit(4000);
    assert_eq!(
        h.server.put("m1", spec(true)).unwrap().state,
        STATE_CREATING
    );
    assert_eq!(h.server.pressure().limit_mib, 4000);
    h.settle("m1").await;
}

// TEST_SCENARIO: a runner handed its machines by another release has recorded nothing about them, and admission counts each one it finds running. It must ask the runtime whether a machine runs and never its guest: a silent guest costs its health timeout, and paid once per machine under the admission lock it would hold every start behind it.
#[tokio::test(flavor = "multi_thread")]
async fn admission_after_a_hand_off_does_not_wait_on_silent_guests() {
    let h = Harness::new("hand-off-admission");
    let _silent = TcpListener::bind(("127.0.0.1", h.base + LOOPBACK_OFFSET)).unwrap();
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.hand_off().await;
    let next = Server::start(
        Config {
            state_dir: h.dir.join("machines"),
            image_dir: h.dir.join("images"),
            images: Some(node_cache_in(&h.dir, 1 << 40)),
            image_budget: 1 << 40,
            init: Some(h.dir.join("platform-init")),
            runc: None,
            ports: h.base..=h.base + 1,
            memory_mib: 1 << 20,
            reserve_mib: 0,
            headroom_mib: 0,
            boot_mib: 0,
            listen: Some(retrying_listen()),
            runtime: None,
            cgroup_dir: None,
            measure_storage: Arc::new(|| None),
        },
        h.fake.clone(),
    )
    .unwrap();
    let started = Instant::now();
    let server = next.clone();
    tokio::task::spawn_blocking(move || server.put("m2", spec(true)).unwrap())
        .await
        .unwrap();
    assert!(
        started.elapsed() < HEALTH_TIMEOUT / 2,
        "the first ensure after a hand-off waited {:?} on a silent guest",
        started.elapsed()
    );
    next.close().await;
}

// TEST_SCENARIO: a runner handed running machines by another release counts each at what it holds from its first admission on, not at the warm-up floor until the controller first asks about it. With one guest holding 7500 of 8192 MiB, the runner that booted it refuses a 2 GiB start, and so does the runner it hands off to, before any status read.
#[tokio::test(flavor = "multi_thread")]
async fn a_hand_off_admits_no_start_into_memory_adopted_machines_hold() {
    let tune = |c: &mut Config| {
        c.memory_mib = 8192;
        c.boot_mib = 1024;
    };
    let h = Harness::with("hand-off-memory", tune);
    let mut big = spec(true);
    big.memory_mib = 8000;
    h.server.put("m1", big).unwrap();
    h.settle("m1").await;
    *locked(&h.fake.resident) = Some(7500);
    h.server.probe("m1");
    let refused = h.server.put("m2", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");

    let next = h.hand_off(tune).await;
    let refused = next.server.put("m2", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");
    next.server.close().await;
}
