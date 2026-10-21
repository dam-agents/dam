use super::support::*;
use super::*;

// TEST_SCENARIO: the runtime reads a machine as absent once it has forgotten it, even when a delete cut short left the machine's disk behind. A delete of an absent machine must still ask the runtime, which is what removes that disk.
#[tokio::test(flavor = "multi_thread")]
async fn a_delete_of_an_absent_machine_still_asks_the_runtime() {
    let h = Harness::new("absent-delete");
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.delete("m1").unwrap())
        .await
        .unwrap();
    assert_eq!(h.fake.calls(), ["delete m1"]);
}

// TEST_SCENARIO: a machine id is a path segment under the state directory, and an image reference names a cache entry. Anything that could leave either is refused before it reaches the disk.
#[tokio::test(flavor = "multi_thread")]
async fn names_that_could_escape_their_directories_are_refused() {
    let h = Harness::new("escape");
    assert_eq!(h.server.put("../etc", spec(true)).unwrap_err().status, 400);
    assert_eq!(h.server.get("../etc").unwrap_err().status, 400);
    assert_eq!(h.server.delete("../etc").unwrap_err().status, 400);
    let mut bad = spec(true);
    bad.image = "quay.io/../../etc".into();
    assert_eq!(
        h.server.put("m1", bad).unwrap_err().message,
        crate::plan::BAD_IMAGE
    );
    let mut incomplete = spec(true);
    incomplete.cpus = 0;
    assert_eq!(
        h.server.put("m1", incomplete).unwrap_err().message,
        crate::plan::REQUIRED
    );
}

// TEST_SCENARIO: a delete of a machine whose create is waiting on a fetch must not wait out the fetch's twenty minutes. The delete cancels the machine's own token, the create stops waiting at once, and the machine is gone well inside the controller's request timeout.
#[tokio::test(flavor = "multi_thread")]
async fn a_delete_does_not_wait_out_the_fetch_its_machine_is_waiting_on() {
    let h = Harness::new("delete-fetch");
    stall_fetches(&h);
    h.server.put("m1", spec(true)).unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(h.server.status("m1").state, STATE_CREATING);

    let asked = Instant::now();
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.delete("m1"))
        .await
        .unwrap()
        .unwrap();
    assert!(
        asked.elapsed() < Duration::from_secs(5),
        "the delete waited out the fetch"
    );
    assert_eq!(h.server.status("m1").state, STATE_ABSENT);
    assert!(!h.dir.join("machines/m1").exists());
    assert_eq!(h.fake.calls(), ["delete m1"]);
    h.server.close().await;
}

// TEST_SCENARIO: an action that cannot be cancelled — a VMM call — may outlast what the controller waits for an answer. The delete then answers 503 rather than hang, nothing is removed under the call, the spec stored behind it is never acted on, and the delete the controller sends again once the call has returned removes the machine.
#[tokio::test(flavor = "multi_thread")]
async fn a_delete_that_cannot_wait_for_the_action_answers_503_and_the_next_one_deletes() {
    let h = Harness::new("delete-busy");
    *locked(&h.fake.start_delay) = Duration::from_millis(800);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    let mut next = spec(true);
    next.revision = "r2".into();
    h.server.put("m1", next).unwrap();

    let server = h.server.clone();
    let busy =
        tokio::task::spawn_blocking(move || server.delete_within("m1", Duration::from_millis(100)))
            .await
            .unwrap()
            .unwrap_err();
    assert_eq!(busy.status, 503, "{busy:?}");
    assert!(h.dir.join("machines/m1").exists());

    let deadline = Instant::now() + Duration::from_secs(5);
    while h.server.converging("m1") {
        assert!(Instant::now() < deadline, "the worker never ended");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.delete("m1").unwrap())
        .await
        .unwrap();
    assert_eq!(h.fake.calls(), ["create m1", "start m1", "delete m1"]);
    assert!(!h.dir.join("machines/m1").exists());
}

// TEST_SCENARIO: a start the worker gave up on at its limit still runs and still holds the runtime's lock on the machine. Every delete behind it must answer 503 within its own short wait and start no runtime delete that would block on that lock, so retries pile up no threads; once the call returns, the next delete removes the machine.
#[tokio::test(flavor = "multi_thread")]
async fn a_delete_behind_a_runtime_call_given_up_on_answers_in_its_wait_every_time() {
    let h = Harness::new("abandoned-call");
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    let (release, released) = std::sync::mpsc::channel::<()>();
    let gave_up = h.server.runtime_call(
        "m1",
        "a stuck start",
        Duration::from_millis(50),
        move || {
            let _ = released.recv();
            Ok(())
        },
    );
    assert!(gave_up.is_err());
    assert!(!h.server.converging("m1"));

    for _ in 0..3 {
        let asked = Instant::now();
        let server = h.server.clone();
        let busy = tokio::task::spawn_blocking(move || {
            server.delete_within("m1", Duration::from_millis(200))
        })
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(busy.status, 503, "{busy:?}");
        assert!(asked.elapsed() < Duration::from_secs(2));
    }
    assert!(!h.fake.calls().iter().any(|c| c.starts_with("delete")));

    release.send(()).unwrap();
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || {
        server.delete_within("m1", Duration::from_secs(5)).unwrap()
    })
    .await
    .unwrap();
    assert_eq!(h.fake.calls(), ["create m1", "delete m1"]);
}

// TEST_SCENARIO: the runtime's own delete is stuck. The delete answers 503 within its wait rather than hang past the controller's timeout, and the retries behind it wait on that one call rather than each start another, and the machine stays marked as being deleted meanwhile, so the prober never restarts it; the retry after it returns finds the machine gone and succeeds.
#[tokio::test(flavor = "multi_thread")]
async fn a_stuck_runtime_delete_is_waited_on_once_and_not_repeated() {
    let h = Harness::new("stuck-delete");
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    *locked(&h.fake.delete_delay) = Duration::from_millis(1500);

    for _ in 0..2 {
        let asked = Instant::now();
        let server = h.server.clone();
        let busy = tokio::task::spawn_blocking(move || {
            server.delete_within("m1", Duration::from_millis(200))
        })
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(busy.status, 503, "{busy:?}");
        assert!(asked.elapsed() < Duration::from_secs(1));
        assert!(
            locked(&h.server.machines).entries["m1"].deleting,
            "a delete still running lets the worker act again"
        );
        h.server.put("m1", spec(true)).unwrap();
        assert!(locked(&h.server.machines).entries["m1"].deleting);
    }
    *locked(&h.fake.delete_delay) = Duration::ZERO;
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || {
        server.delete_within("m1", Duration::from_secs(5)).unwrap()
    })
    .await
    .unwrap();
    assert_eq!(h.fake.calls(), ["create m1", "delete m1", "delete m1"]);
    assert!(!h.dir.join("machines/m1").exists());
}
