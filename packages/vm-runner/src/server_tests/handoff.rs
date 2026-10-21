use super::support::*;
use super::*;

// TEST_SCENARIO: a runner pod that is stopped takes its VMMs with it. Closing the runner stops each machine still running the way a controller's stop does, so the guest quiesces its disk before it goes, and leaves a stopped machine alone.
#[tokio::test(flavor = "multi_thread")]
async fn closing_the_runner_stops_the_machines_it_runs() {
    let h = Harness::new("close-stops");
    for id in ["agent-a", "agent-b"] {
        h.server.put(id, spec(true)).unwrap();
        h.settle(id).await;
    }
    h.server.put("agent-b", spec(false)).unwrap();
    assert_eq!(h.settle("agent-b").await.state, STATE_STOPPED);

    h.server.close().await;

    let calls = h.fake.calls();
    let stops = |id: &str| calls.iter().filter(|c| **c == format!("stop {id}")).count();
    assert_eq!(stops("agent-a"), 1, "{calls:?}");
    assert_eq!(
        stops("agent-b"),
        1,
        "the stopped machine was stopped again: {calls:?}"
    );
    assert_eq!(h.fake.state("agent-a").unwrap(), State::Stopped);
}

// TEST_SCENARIO: the loader replaces the runner with another release inside the same pod, and the VMMs are the pod's processes, not the runner's. A hand-off closes the runner without stopping any machine, so the next runner finds every machine still running and publishes its port again.
#[tokio::test(flavor = "multi_thread")]
async fn a_hand_off_leaves_every_machine_running_for_the_next_runner() {
    let h = Harness::new("hand-off");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;

    h.server.hand_off().await;

    let calls = h.fake.calls();
    assert!(!calls.iter().any(|c| c == "stop m1"), "{calls:?}");
    assert_eq!(h.fake.state("m1").unwrap(), State::Running);
    assert!(!h.server.forwarder.is_published("m1"));
    let next = Server::start(
        Config {
            state_dir: h.dir.join("machines"),
            image_dir: h.dir.join("images"),
            images: None,
            image_budget: 1 << 40,
            init: None,
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
    assert!(next.forwarder.is_published("m1"));
    next.close().await;
}

// TEST_SCENARIO: whether a guest has answered is held in the runner's memory, which a hand-off, a runner restart or a crash empties. A guest that answered before the hand-off and then stopped answering must still be restarted by the next runner once it is quiet past its limit, from the seeded record its first answer left in the share; without that it read as running and not ready forever.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_quiet_across_a_hand_off_is_restarted_by_the_next_runner() {
    let h = Harness::new("hand-off-quiet");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let up = guest(h.base);
    h.until("m1", "ready", |s| s.ready).await;
    up.store(false, Ordering::SeqCst);
    h.server.hand_off().await;

    let next = Harness {
        dir: h.dir.clone(),
        fake: h.fake.clone(),
        server: Server::start(
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
        .unwrap(),
        base: h.base,
    };
    next.server.put("m1", spec(true)).unwrap();
    next.settle("m1").await;
    next.server.probe("m1");
    stall(&next, "m1");
    next.server.put("m1", spec(true)).unwrap();
    let status = next.settle("m1").await;
    assert_eq!(status.restarts, 1, "{status:?}");
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
}

// TEST_SCENARIO: a runner release may bring another VM runtime than the one that booted a machine it adopts, and manages that machine assuming the two are compatible. A runtime error on such a machine is taken as the sign they are not: the machine is rebooted at once onto the runner's own runtime, and its record then names that runtime. A machine this runner's own runtime booted is left as it is through the same error, as before.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_another_runtime_booted_is_rebooted_at_its_first_runtime_error() {
    let h = Harness::with("foreign", |c| c.runtime = Some("runtime-b".into()));
    let record =
        |id: &str| fs::read_to_string(h.dir.join("machines").join(id).join(RUNTIME_FILE)).unwrap();
    for id in ["own", "adopted"] {
        h.server.put(id, spec(true)).unwrap();
        h.settle(id).await;
        assert_eq!(
            record(id),
            "runtime-b",
            "a start records the runtime it booted"
        );
    }
    fs::write(
        h.dir.join("machines/adopted").join(RUNTIME_FILE),
        "runtime-a",
    )
    .unwrap();
    for id in ["own", "adopted"] {
        locked(&h.fake.state_fails_until_start).insert(id.to_string());
        h.machine(id, |m| m.probed = Some(Instant::now() - STEADY_PROBE));
        h.server.put(id, spec(true)).unwrap();
        h.settle(id).await;
    }

    let calls = h.fake.calls();
    let starts = |id: &str| {
        calls
            .iter()
            .filter(|c| **c == format!("start {id}"))
            .count()
    };
    assert_eq!(starts("adopted"), 2, "{calls:?}");
    assert_eq!(record("adopted"), "runtime-b");
    assert_eq!(starts("own"), 1, "{calls:?}");
}

// TEST_SCENARIO: the pod's grace ends in a SIGKILL whatever the runner is doing, so a guest slow to stop must not hold the close past its window: the close returns when the window ends, and the kill of the pod is what ends that guest.
#[tokio::test(flavor = "multi_thread")]
async fn closing_the_runner_waits_for_a_slow_stop_only_within_its_window() {
    let h = Harness::new("close-slow-stop");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    *locked(&h.fake.stop_delay) = Duration::from_secs(3);

    let started = Instant::now();
    h.server
        .close_within(Duration::from_secs(1), Some(Duration::from_millis(200)))
        .await;
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "the close waited out the slow stop"
    );
}

// TEST_SCENARIO: a runner handed running machines by another release holds the image tree each one boots from as it starts, before the controller sends it a spec. Once the old runner's holds have lapsed, aged past their lease rather than waited out, the node's eviction then takes no tree a running guest reads, whether or not the controller has sent the machine's unchanged spec yet; a stopped machine's tree is still given up.
#[tokio::test(flavor = "multi_thread")]
async fn a_hand_off_keeps_the_trees_of_running_machines_held() {
    let node: Arc<std::sync::OnceLock<Arc<ImageCache>>> = Arc::default();
    let opened = node.clone();
    let h = Harness::with("hand-off-holds", move |c| {
        let cache = opened.get_or_init(|| {
            Arc::new(ImageCache::open(CacheConfig {
                dir: c.image_dir.clone(),
                budget: 1,
                crane: c
                    .image_dir
                    .with_file_name("crane")
                    .to_string_lossy()
                    .into_owned(),
                pins: Vec::new(),
                lifetime: CancellationToken::new(),
                ref_fresh: REF_FRESH,
                hold_lease: Duration::from_secs(60),
                hold_grace: Duration::ZERO,
                fetch_ceiling: None,
            }))
        });
        c.images = Some(cache.clone());
    });
    let cache = node.get().unwrap().clone();
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut other = spec(false);
    other.image = "quay.io/x/vm:2".into();
    h.server.put("m2", other).unwrap();
    h.settle("m2").await;
    let (running, stopped) = (h.entry("m1"), h.entry("m2"));
    assert!(running.exists() && stopped.exists());

    cache.age_holds(Duration::from_secs(60));
    let shared = cache.clone();
    let next = h.hand_off(move |c| c.images = Some(shared)).await;
    cache.evict(None);
    assert!(
        running.exists(),
        "the hand-off let a running machine's tree go"
    );
    assert!(!stopped.exists(), "a stopped machine's tree was kept");

    next.server.put("m1", spec(true)).unwrap();
    cache.evict(None);
    assert!(running.exists(), "an unchanged spec let the tree go");
    next.server.close().await;
}

// TEST_SCENARIO: a runner whose machine API fails to serve after it has taken its machines over must not reboot them. Under a loader it leaves every machine running, as a hand-off does, so the release the loader goes back to adopts them; a pod stop that the loader passes on during that close still stops them cleanly; and a runner with no loader is the pod's last process and stops them before the pod's end powers them off.
#[tokio::test(flavor = "multi_thread")]
async fn a_runner_that_fails_to_serve_leaves_its_machines_to_its_loader() {
    let h = Harness::new("failed-serve");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let next = h.hand_off(|_| {}).await;

    next.server.close_failed(true, std::future::pending()).await;
    let calls = h.fake.calls();
    assert!(!calls.iter().any(|c| c == "stop m1"), "{calls:?}");
    assert_eq!(h.fake.state("m1").unwrap(), State::Running);

    let stopped = next.hand_off(|_| {}).await;
    stopped
        .server
        .close_failed(true, std::future::ready(()))
        .await;
    assert_eq!(h.fake.state("m1").unwrap(), State::Stopped);

    let alone = Harness::new("failed-serve-alone");
    alone.server.put("m1", spec(true)).unwrap();
    alone.settle("m1").await;
    alone
        .server
        .close_failed(false, std::future::pending())
        .await;
    assert_eq!(alone.fake.state("m1").unwrap(), State::Stopped);
}
