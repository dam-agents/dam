use super::support::*;
use super::*;

// TEST_SCENARIO: a runner has a range of ports and no more; a machine past it is refused with a message saying so. A delete arriving while a start is genuinely running waits for it rather than racing it, and removes the machine after.
#[tokio::test(flavor = "multi_thread")]
async fn ports_are_unique_and_a_delete_waits_for_work_in_flight() {
    let h = Harness::new("ports");
    for id in ["agent-a", "agent-b"] {
        h.server.put(id, spec(true)).unwrap();
        h.settle(id).await;
    }
    assert_eq!(h.settle("agent-b").await.port, i32::from(h.base + 1));
    h.server.put("agent-c", spec(true)).unwrap();
    let full = h.settle("agent-c").await;
    assert_eq!(full.state, STATE_ABSENT);
    assert!(full.message.contains("no free machine port"), "{full:?}");
    assert_eq!(full.reason, REASON_OUT_OF_CAPACITY);

    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.delete("agent-a").unwrap())
        .await
        .unwrap();
    assert_eq!(h.settle("agent-a").await.state, STATE_ABSENT);

    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("agent-c", spec(true)).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !h.fake.calls().iter().any(|c| c == "start agent-c") {
        assert!(
            Instant::now() < deadline,
            "the start never reached the runtime"
        );
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    let blocked = Instant::now();
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.delete("agent-c").unwrap())
        .await
        .unwrap();
    assert!(
        blocked.elapsed() > Duration::from_millis(200),
        "the delete raced the in-flight start instead of waiting it out"
    );
    let calls = h.fake.calls();
    assert_eq!(
        &calls[calls.len() - 2..],
        ["start agent-c", "delete agent-c"],
        "{calls:?}"
    );
}

// TEST_SCENARIO: a restarted runner has lost its listeners, but the machines' ports are still on disk. It publishes each of them again as it starts, so the agents' Services keep reaching them.
#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_runner_republishes_its_ports() {
    let h = Harness::new("republish");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.close().await;
    assert!(!h.server.forwarder.is_published("m1"));
    let port = h.base;
    let listen = retrying_listen();
    let again = Server::start(
        Config {
            state_dir: h.dir.join("machines"),
            image_dir: h.dir.join("images"),
            images: None,
            image_budget: 1 << 40,
            init: None,
            runc: None,
            ports: port..=port + 1,
            memory_mib: 1 << 20,
            reserve_mib: 0,
            headroom_mib: 0,
            boot_mib: 0,
            listen: Some(listen),
            runtime: None,
            cgroup_dir: None,
            measure_storage: Arc::new(|| None),
        },
        h.fake.clone(),
    )
    .unwrap();
    assert!(again.forwarder.is_published("m1"));
    again.close().await;
}
