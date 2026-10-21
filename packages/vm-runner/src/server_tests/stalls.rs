use super::support::*;
use super::*;

// TEST_SCENARIO: a machine that answered once and then went quiet for longer than any boot is restarted and counted; the count is what the controller reports as the agent's restarts. The next spec, with the new guest not yet answering, must not restart it again.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_that_went_quiet_is_restarted_once_and_counted() {
    let h = Harness::new("dead");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.machine("m1", |m| {
        m.health = Health {
            ever_ready: true,
            quiet_since: Some(SystemTime::now() - UNHEALTHY_RESTART - Duration::from_secs(1)),
        }
    });
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.restarts, 1);
    let calls = vec!["create m1", "start m1", "stop m1", "update m1", "start m1"];
    assert_eq!(h.fake.calls(), calls);

    assert_eq!(h.server.put("m1", spec(true)).unwrap().state, STATE_RUNNING);
    assert_eq!(h.settle("m1").await.restarts, 1);
    assert_eq!(h.fake.calls(), calls, "the restart earned another one");
}

// TEST_SCENARIO: a stop the controller asks for, as hibernation does, clears the count of restarts, so the wake after it does not read as a crash; a restart the runner chose for a quiet guest keeps it.
#[tokio::test(flavor = "multi_thread")]
async fn a_requested_stop_clears_the_restart_count() {
    let h = Harness::new("stop-clears");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.machine("m1", |m| {
        m.health = Health {
            ever_ready: true,
            quiet_since: Some(SystemTime::now() - UNHEALTHY_RESTART - Duration::from_secs(1)),
        }
    });
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.restarts, 1);

    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.restarts, 0);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.restarts, 0);
}

// TEST_SCENARIO: a guest that answered in this boot and then stopped answering is restarted by the prober itself, once it has been quiet past STALLED_RESTART, without waiting for the controller's next ensure. Its replacement is not restarted while it boots, and when it stalls again soon after, it waits the long UNHEALTHY_RESTART instead, so a guest a reboot does not cure is not restarted every minute.
#[tokio::test(flavor = "multi_thread")]
async fn a_stalled_guest_is_restarted_soon_but_not_in_a_loop() {
    let h = Harness::new("stalled");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let up = guest(h.base);
    h.until("m1", "ready", |s| s.ready).await;
    up.store(false, Ordering::SeqCst);
    stall(&h, "m1");
    h.server.probe("m1");
    let status = h.settle("m1").await;
    assert_eq!(status.restarts, 1, "{status:?}");
    let calls = vec!["create m1", "start m1", "stop m1", "update m1", "start m1"];
    assert_eq!(h.fake.calls(), calls);

    stall(&h, "m1");
    h.server.probe("m1");
    assert_eq!(h.settle("m1").await.restarts, 1);
    assert_eq!(
        h.fake.calls(),
        calls,
        "a boot not yet answered was restarted"
    );

    let up = guest_again(&h).await;
    h.until("m1", "ready again", |s| s.ready).await;
    up.store(false, Ordering::SeqCst);
    stall(&h, "m1");
    h.server.probe("m1");
    assert_eq!(h.settle("m1").await.restarts, 1);
    assert_eq!(
        h.fake.calls(),
        calls,
        "a second stall soon after the first was restarted at once"
    );

    h.machine("m1", |m| {
        m.gave_up = Some(Instant::now() - UNHEALTHY_RESTART - Duration::from_secs(1))
    });
    stall(&h, "m1");
    h.server.probe("m1");
    assert_eq!(h.settle("m1").await.restarts, 2);
}

// TEST_SCENARIO: what must not be restarted as stalled: a boot whose guest has not answered yet, however long a slow first boot or image unpack takes, and a guest that answers again after a long silence, as a busy one does.
#[tokio::test(flavor = "multi_thread")]
async fn a_booting_or_answering_guest_is_not_restarted_as_stalled() {
    let h = Harness::new("not-stalled");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.machine("m1", |m| m.health.ever_ready = true);
    stall(&h, "m1");
    h.server.probe("m1");
    assert_eq!(h.settle("m1").await.restarts, 0);

    let _guest = guest(h.base);
    h.until("m1", "ready", |s| s.ready).await;
    stall(&h, "m1");
    h.server.probe("m1");
    let status = h.settle("m1").await;
    assert_eq!(status.restarts, 0);
    assert!(status.ready);
    assert_eq!(h.fake.calls(), vec!["create m1", "start m1"]);
}
