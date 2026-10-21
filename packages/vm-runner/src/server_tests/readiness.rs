use super::support::*;
use super::*;

// TEST_SCENARIO: a guest that answers its health endpoint is up, even while the start call that booted it has not returned. The controller would otherwise spend those seconds telling a person their agent was not ready.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_that_answers_is_ready_before_its_start_returns() {
    let h = Harness::new("early-ready");
    *locked(&h.fake.start_delay) = Duration::from_secs(1);
    let _guest = guest(h.base);
    h.server.put("m1", spec(true)).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let status = h.server.status("m1");
        if status.ready {
            assert_eq!(
                status.state, STATE_CREATING,
                "ready was only seen after the start returned"
            );
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the answering guest was never reported ready"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

// TEST_SCENARIO: a guest answers only after platform-init has put the agent's home on the disk, so its first answer is when the runner records in the share that this disk holds a home. The stand-in guest answers from the moment it listens, so it listens only once the start that boots it is under way, as a real guest's would. platform-init reads that record to refuse a later boot that finds the home gone, which is what a disk smolvm reformatted looks like; a machine that has never answered has no record, so its first boot still seeds.
#[tokio::test(flavor = "multi_thread")]
async fn the_first_answer_records_that_the_disk_holds_a_home() {
    let h = Harness::new("seeded");
    let share = h.dir.join("machines").join("m1").join(SHARE_DIR);
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    assert!(
        !share::seeded(&share),
        "a machine that has not answered was recorded as seeded"
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while !h.fake.calls().iter().any(|c| c == "start m1") {
        assert!(Instant::now() < deadline, "the machine was never started");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let _guest = guest(h.base);
    while !h.server.status("m1").ready {
        assert!(Instant::now() < deadline, "the guest was never ready");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(share::seeded(&share));
}

// TEST_SCENARIO: a machine being stopped keeps answering until it dies, and that answer says nothing about a machine that is going away — it is never reported ready.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_answering_through_its_own_stop_is_not_ready() {
    let h = Harness::new("stopping");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let _guest = guest(h.base);
    *locked(&h.fake.stop_delay) = Duration::from_millis(500);
    let status = h.server.put("m1", spec(false)).unwrap();
    assert_eq!(status.state, STATE_STOPPING);
    assert!(!h.server.status("m1").ready);
}

// TEST_SCENARIO: a stop that arrives while the machine is still booting is stored behind the boot and acted on once the boot returns, so a machine nobody wants running does not end up running.
#[tokio::test(flavor = "multi_thread")]
async fn a_stop_issued_while_booting_is_honoured() {
    let h = Harness::new("stop-mid-boot");
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    assert!(!h.server.put("m1", spec(false)).unwrap().ready);
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    assert_eq!(h.fake.calls(), vec!["create m1", "start m1", "stop m1"]);
}

// TEST_SCENARIO: a boot that fails is explained by the end of the guest's console, carried in the machine's message. The guest prints what it likes, including the environment an operator's Secret reaches it through, so every env value the runner was given for the machine is redacted out of it first.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_boot_carries_the_redacted_console() {
    let h = Harness::new("console");
    *locked(&h.fake.console) = format!("booting\nHTTPS_PROXY={PROXY}\nkernel panic");
    *locked(&h.fake.fail_start_once) = Some("guest agent never became ready".into());
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_BOOT_FAILED, "{status:?}");
    assert!(
        status
            .message
            .ends_with("\nthe guest console ends:\nbooting\nHTTPS_PROXY=***\nkernel panic"),
        "{status:?}"
    );
    assert!(!status.message.contains(PROXY));
}

// TEST_SCENARIO: a guest that boots and never answers has no failure — its start returned — so after a minute the prober writes a note saying it is stuck, with the console, and keeps the same note rather than changing it on every probe. Once the guest answers, the note is gone and the time it took is recorded under the operation that started it. A probe the guest misses after that is a health blip, with no note.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_that_never_answers_is_explained() {
    let h = Harness::new("slow-boot");
    *locked(&h.fake.console) = "waiting for disk".into();
    h.server.put("m1", spec(true)).unwrap();
    assert!(h.settle("m1").await.message.is_empty());
    age_boot(&h, "m1");
    let stuck = h
        .until("m1", "noted as stuck", |s| !s.message.is_empty())
        .await;
    assert!(!stuck.ready);
    assert_eq!(
        stuck.message,
        format!("{SLOW_BOOT}\nthe guest console ends:\nwaiting for disk")
    );
    *locked(&h.fake.console) = "something else".into();
    h.server.probe("m1");
    let again = h.server.status("m1");
    assert_eq!(again.message, stuck.message);
    assert_eq!(
        again.version, stuck.version,
        "the same note is not a change"
    );

    let up = guest(h.base);
    let ready = h.until("m1", "ready", |s| s.ready).await;
    assert!(ready.message.is_empty(), "{ready:?}");
    up.store(false, Ordering::SeqCst);
    let scrape = h.server.metrics_text();
    assert!(
        scrape.contains("platform_vm_runner_machine_ready_seconds_count{op=\"create\"} 1"),
        "{scrape}"
    );
    h.server.probe("m1");
    let down = h.server.status("m1");
    assert!(
        down.ready,
        "one missed probe after the answer is not a guest gone quiet"
    );
    assert_eq!(
        down.message, "",
        "a missed probe after the answer is not a stuck boot"
    );
    h.machine("m1", |m| {
        m.health.quiet_since = Some(SystemTime::now() - READY_GRACE - Duration::from_secs(1))
    });
    h.server.probe("m1");
    assert!(
        !h.server.status("m1").ready,
        "quiet past the grace is unready"
    );
}

// TEST_SCENARIO: the grace belongs to the boot that answered. A machine that answered and was then restarted is not ready on the old guest's answers: until the new boot answers, a missed probe is a boot still running, and the controller keeps waiting closely for it.
#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_machine_is_not_ready_on_its_old_answers() {
    let h = Harness::new("grace-restart");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let up = guest(h.base);
    h.until("m1", "ready", |s| s.ready).await;
    up.store(false, Ordering::SeqCst);
    let mut changed = spec(true);
    changed.revision = "r2".into();
    h.server.put("m1", changed).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING);
    assert!(!status.ready, "{status:?}");
}

// TEST_SCENARIO: a machine stopped before its guest ever answered has nothing left to wait for. Its stop ends the boot, so the stopped machine carries no stuck-boot note, however long ago it was asked to start.
#[tokio::test(flavor = "multi_thread")]
async fn a_stop_ends_the_boot_wait() {
    let h = Harness::new("stop-ends-wait");
    h.server.put("m1", spec(true)).unwrap();
    assert!(!h.settle("m1").await.ready);
    age_boot(&h, "m1");
    h.until("m1", "noted as stuck", |s| !s.message.is_empty())
        .await;
    h.server.put("m1", spec(false)).unwrap();
    let stopped = h.settle("m1").await;
    assert_eq!(stopped.state, STATE_STOPPED);
    assert_eq!(stopped.message, "");
    assert!(h.machine("m1", |m| m.boot.is_none()));
}

// TEST_SCENARIO: the controller watches a booting machine by holding the last status version it saw. A read that names an older version is answered at once, without waiting.
#[tokio::test(flavor = "multi_thread")]
async fn a_wait_on_an_old_version_answers_at_once() {
    let h = Harness::new("wait-stale");
    h.server.put("m1", MachineSpec::default()).unwrap();
    let current = h.settle("m1").await;
    assert_ne!(current.version, 0, "a known machine has a version");
    let started = Instant::now();
    let answer = h
        .wait("m1", current.version - 1, Duration::from_secs(5))
        .await;
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "the read waited"
    );
    assert_eq!(answer.version, current.version);
}

// TEST_SCENARIO: a read that names the current version waits, and is answered as soon as something the status reports changes — here the machine being asked to start — with the new version.
#[tokio::test(flavor = "multi_thread")]
async fn a_wait_on_the_current_version_answers_on_the_next_change() {
    let h = Harness::new("wait-change");
    h.server.put("m1", MachineSpec::default()).unwrap();
    let before = h.settle("m1").await;
    let server = h.server.clone();
    let waiting = tokio::task::spawn_blocking(move || {
        server
            .wait("m1", before.version, Duration::from_secs(10))
            .unwrap()
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!waiting.is_finished(), "the read did not wait for a change");
    let started = Instant::now();
    h.server.put("m1", spec(true)).unwrap();
    let answer = waiting.await.unwrap();
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_ne!(answer.version, before.version);
}

// TEST_SCENARIO: a read that sees no change answers when its wait ends, with the version it was given, so the caller can simply ask again.
#[tokio::test(flavor = "multi_thread")]
async fn a_wait_with_no_change_answers_when_it_ends() {
    let h = Harness::new("wait-timeout");
    h.server.put("m1", MachineSpec::default()).unwrap();
    let before = h.settle("m1").await;
    let started = Instant::now();
    let answer = h
        .wait("m1", before.version, Duration::from_millis(300))
        .await;
    assert!(started.elapsed() >= Duration::from_millis(300));
    assert_eq!(answer.version, before.version);
    assert_eq!(answer.state, STATE_ABSENT);
}

// TEST_SCENARIO: the pod has a fixed grace between SIGTERM and SIGKILL, and the HTTP drain waits for every request in flight. A status read waiting out its half minute would take that whole grace, so stopping the runner answers every waiting read at once.
#[tokio::test(flavor = "multi_thread")]
async fn stopping_the_runner_answers_a_waiting_read_at_once() {
    let h = Harness::new("wait-close");
    h.server.put("m1", MachineSpec::default()).unwrap();
    let before = h.settle("m1").await;
    let started = Instant::now();
    let waiting = h.wait("m1", before.version, Duration::from_secs(20));
    let stopping = async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        h.server.stop_taking_work();
    };
    let (answer, ()) = tokio::join!(waiting, stopping);
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(answer.version, before.version);
}

// TEST_SCENARIO: a guest that comes up after its start returned is noticed by the prober and not by the status read, and a read waiting on the machine is answered with it ready. This is the path by which the controller hears that a wake finished.
#[tokio::test(flavor = "multi_thread")]
async fn the_prober_reports_a_guest_that_comes_up_to_a_waiting_read() {
    let h = Harness::new("prober");
    h.server.put("m1", spec(true)).unwrap();
    let booted = h.settle("m1").await;
    assert!(!booted.ready);
    let _guest = guest(h.base);
    let started = Instant::now();
    let ready = h.until("m1", "ready", |s| s.ready).await;
    assert!(
        started.elapsed() < BOOT_PROBE * 4,
        "a booting machine was not probed at the boot cadence"
    );
    assert_ne!(ready.version, booted.version);
}

// TEST_SCENARIO: a PUT plans from what the prober recorded while that is no older than the probe cadence, so it costs no runtime read and no health check: on a wake, the PUT right after the start answered at once instead of looking at the guest the start had just looked at. A record past the cadence is looked at again, so a VMM that died since is started at once.
#[tokio::test(flavor = "multi_thread")]
async fn a_put_plans_from_a_recent_look_and_looks_again_once_it_is_old() {
    let h = Harness::new("put-reuses-look");
    let _guest = guest(h.base);
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.until("m1", "ready", |s| s.ready).await;
    let reads = h.fake.state_reads.load(Ordering::SeqCst);
    let status = h.server.put("m1", spec(true)).unwrap();
    assert!(status.ready && status.state == STATE_RUNNING, "{status:?}");
    assert_eq!(
        h.fake.state_reads.load(Ordering::SeqCst),
        reads,
        "the PUT read the runtime again"
    );

    locked(&h.fake.states).insert("m1".into(), State::Stopped);
    h.machine("m1", |m| m.probed = Some(Instant::now() - STEADY_PROBE));
    assert_eq!(
        h.server.put("m1", spec(true)).unwrap().state,
        STATE_STARTING
    );
    h.settle("m1").await;
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "update m1", "start m1"]
    );
}

// TEST_SCENARIO: the probe cadence is what the user waits on between the guest answering and the controller hearing of it, so a fresh boot is asked every FRESH_BOOT_PROBE. A probe still costs a connect, so a boot still quiet after SLOW_BOOT_AFTER falls back to BOOT_PROBE, and a guest that has answered is asked only at the steady cadence.
#[tokio::test(flavor = "multi_thread")]
async fn a_fresh_boot_is_probed_tightly_and_an_old_or_answered_one_is_not() {
    let h = Harness::new("probe-cadence");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    assert_eq!(h.machine("m1", |m| probe_every(m)), Some(FRESH_BOOT_PROBE));
    h.machine("m1", |m| {
        m.boot.as_mut().unwrap().at = Instant::now()
            .checked_sub(SLOW_BOOT_AFTER + Duration::from_secs(1))
            .unwrap()
    });
    assert_eq!(h.machine("m1", |m| probe_every(m)), Some(BOOT_PROBE));
    let _guest = guest(h.base);
    h.until("m1", "ready", |s| s.ready).await;
    assert_eq!(h.machine("m1", |m| probe_every(m)), Some(STEADY_PROBE));
}

// TEST_SCENARIO: a guest that accepts its health check and never answers holds its probe for the whole health timeout. The other machines on their way up must still be probed at the boot cadence, or one hung guest would delay every wake on the runner by that timeout.
#[tokio::test(flavor = "multi_thread")]
async fn a_hung_guest_does_not_hold_up_the_probes_of_the_others() {
    let h = Harness::new("prober-hung");
    let _hung = TcpListener::bind(("127.0.0.1", h.base + LOOPBACK_OFFSET)).unwrap();
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.put("m2", spec(true)).unwrap();
    let booted = h.settle("m2").await;
    assert_eq!(booted.port, i32::from(h.base + 1));
    let _guest = guest(h.base + 1);
    let started = Instant::now();
    h.until("m2", "ready", |s| s.ready).await;
    assert!(
        started.elapsed() < BOOT_PROBE * 3,
        "a hung guest held up another machine's probe for {:?}",
        started.elapsed()
    );
    assert!(!h.server.status("m1").ready);
}

// TEST_SCENARIO: a probe that answers after its machine was deleted finds no entry, and must not put one back: the runner would keep probing a machine that is gone and report it forever.
#[tokio::test(flavor = "multi_thread")]
async fn a_probe_answering_after_a_delete_leaves_nothing_behind() {
    let h = Harness::new("probe-after-delete");
    h.server.record(
        "gone",
        Seen {
            state: State::Running,
            ready: false,
            error: None,
        },
        Some(3),
    );
    assert!(!locked(&h.server.machines).entries.contains_key("gone"));
}

// TEST_SCENARIO: a probe that panics must not leave its machine marked as being probed. The prober skips a machine with a probe in flight, so a mark left set would stop every later probe of it, and its status would never move again.
#[tokio::test(flavor = "multi_thread")]
async fn a_probe_that_panics_does_not_end_the_probing_of_its_machine() {
    let h = Harness::new("probe-panic");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.fake.panic_on_state.store(true, Ordering::SeqCst);
    h.machine("m1", |m| m.probed = None);
    tokio::time::sleep(PROBE_TICK * 5).await;
    h.fake.panic_on_state.store(false, Ordering::SeqCst);

    let deadline = Instant::now() + Duration::from_secs(5);
    while h.machine("m1", |m| m.probed.is_none()) {
        assert!(
            Instant::now() < deadline,
            "the machine was never probed again after a probe panicked"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

// TEST_SCENARIO: a worker that ends does so in the critical section that decided it had nothing left to do. A PUT landing right after starts a worker of its own, and the ended one must not then mark that new worker as done on its way out, or the new spec would wait for the next reconcile with no worker acting on it.
#[tokio::test(flavor = "multi_thread")]
async fn an_ended_worker_does_not_end_the_next_one() {
    let h = Harness::new("settle");
    h.server.put("m1", MachineSpec::default()).unwrap();
    h.machine("m1", |m| {
        m.converging = true;
        m.asked = 1;
    });
    {
        let mut settle = Settle {
            server: &h.server,
            id: "m1",
            armed: true,
        };
        assert!(!settle.settles(&mut locked(&h.server.machines), Some(0)));
        assert!(settle.settles(&mut locked(&h.server.machines), Some(1)));
        assert!(!h.server.converging("m1"), "ended under the lock");
        h.machine("m1", |m| m.converging = true);
    }
    assert!(
        h.server.converging("m1"),
        "the ended worker left the next one running"
    );
}
