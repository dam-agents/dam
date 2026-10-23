use super::support::*;
use super::*;
use std::sync::atomic::AtomicU32;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

// TEST_SCENARIO: every timer of the runner is one task that waits a period before its first pass, so a start does not run them all at once, and that ends when the runner closes rather than leaving a task behind. A pass runs off the runtime's own threads, so a slow look at a claim or a console log holds up no status read.
#[tokio::test(flavor = "multi_thread")]
async fn a_periodic_task_waits_a_period_and_stops_with_the_runner() {
    let h = Harness::new("timers");
    let passes = Arc::new(AtomicU32::new(0));
    let counted = passes.clone();
    h.server.every(Duration::from_millis(40), move |_| {
        counted.fetch_add(1, Ordering::Relaxed);
    });

    tokio::time::sleep(Duration::from_millis(15)).await;
    assert_eq!(
        passes.load(Ordering::Relaxed),
        0,
        "a pass ran before its first period"
    );

    tokio::time::sleep(Duration::from_millis(150)).await;
    let ran = passes.load(Ordering::Relaxed);
    assert!(
        ran >= 2,
        "ran {ran} times in a hundred and fifty milliseconds"
    );

    h.server.stop_taking_work();
    tokio::time::sleep(Duration::from_millis(150)).await;
    let settled = passes.load(Ordering::Relaxed);
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        passes.load(Ordering::Relaxed),
        settled,
        "a closed runner's task ran on"
    );
}

// TEST_SCENARIO: a hold refresh or a look at the claim that is running when the runner closes is the last one, and closing waits for it. Whatever a pass writes, it writes while the machines are still the runner's, not beside the stop that closes them.
#[tokio::test(flavor = "multi_thread")]
async fn closing_waits_for_a_pass_in_flight() {
    let h = Harness::new("timers-close");
    let entered = Arc::new(AtomicBool::new(false));
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let (passing, wait) = (entered.clone(), gate.clone());
    h.server.every(Duration::from_millis(5), move |_| {
        passing.store(true, Ordering::Relaxed);
        let (held, released) = &*wait;
        let mut open = held.lock().unwrap_or_else(|e| e.into_inner());
        while !*open {
            open = released.wait(open).unwrap_or_else(|e| e.into_inner());
        }
    });

    let deadline = Instant::now() + Duration::from_secs(5);
    while !entered.load(Ordering::Relaxed) {
        assert!(Instant::now() < deadline, "no pass began");
        tokio::time::sleep(Duration::from_millis(1)).await;
    }

    let server = h.server.clone();
    let closing = tokio::spawn(async move { server.close().await });
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        !closing.is_finished(),
        "closing returned while a pass was in flight"
    );

    let (held, released) = &*gate;
    *held.lock().unwrap_or_else(|e| e.into_inner()) = true;
    released.notify_all();
    tokio::time::timeout(Duration::from_secs(5), closing)
        .await
        .expect("closing did not finish after the pass ended")
        .expect("the closing task failed");
}
