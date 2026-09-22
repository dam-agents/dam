use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicBool, Ordering};

use super::*;
use crate::api::{
    ImageLaunch, REASON_BOOT_FAILED, REASON_EGRESS_CHANGED, REASON_IMAGE_UNAVAILABLE,
    STATE_CREATING, STATE_STARTING,
};
use crate::cache::{cache_path, PARTIAL_PREFIX};
use crate::imagecache::PRIVATE_FILE;
use std::path::Path;

// UNIT_BOUNDARY_DESCRIPTION: a runtime with no hypervisor behind it. It records each call in order, keeps each machine's state in memory, and can be told to boot slowly or fail once — which is everything the server's decisions depend on.
#[derive(Default)]
struct Fake {
    states: Mutex<HashMap<String, &'static str>>,
    calls: Mutex<Vec<String>>,
    created: Mutex<HashMap<String, (String, Option<ImageLaunch>)>>,
    start_delay: Mutex<Duration>,
    stop_delay: Mutex<Duration>,
    fail_start_once: Mutex<Option<String>>,
    ungrowable: AtomicBool,
}

impl Fake {
    fn calls(&self) -> Vec<String> {
        locked(&self.calls).clone()
    }

    fn record(&self, call: String) {
        locked(&self.calls).push(call);
    }
}

impl Runtime for Fake {
    fn state(&self, id: &str) -> anyhow::Result<&'static str> {
        Ok(locked(&self.states)
            .get(id)
            .copied()
            .unwrap_or(STATE_ABSENT))
    }

    fn create(&self, id: &str, machine: &Machine<'_>) -> anyhow::Result<()> {
        self.record(format!("create {id}"));
        locked(&self.created).insert(
            id.to_string(),
            (machine.image.to_string(), machine.launch.cloned()),
        );
        locked(&self.states).insert(id.to_string(), STATE_STOPPED);
        Ok(())
    }

    fn update(
        &self,
        id: &str,
        _desired: &MachineSpec,
        _applied: Option<&MachineSpec>,
    ) -> anyhow::Result<()> {
        self.record(format!("update {id}"));
        Ok(())
    }

    fn start(&self, id: &str) -> anyhow::Result<()> {
        self.record(format!("start {id}"));
        std::thread::sleep(*locked(&self.start_delay));
        if let Some(message) = locked(&self.fail_start_once).take() {
            anyhow::bail!(message);
        }
        locked(&self.states).insert(id.to_string(), STATE_RUNNING);
        Ok(())
    }

    fn stop(&self, id: &str) -> anyhow::Result<()> {
        std::thread::sleep(*locked(&self.stop_delay));
        self.record(format!("stop {id}"));
        locked(&self.states).insert(id.to_string(), STATE_STOPPED);
        Ok(())
    }

    fn delete(&self, id: &str) -> anyhow::Result<()> {
        self.record(format!("delete {id}"));
        locked(&self.states).remove(id);
        Ok(())
    }

    fn storage_growable(&self, _id: &str) -> bool {
        !self.ungrowable.load(Ordering::SeqCst)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a crane that answers the two questions the runner asks — what an image says to run, and what its filesystem holds — and logs each call, so a test can count fetches. A fake that answered only one would let a change that stopped asking the other pass.
const FAKE_CRANE: &str = r#"#!/bin/sh
echo "$@" >> "$(dirname "$0")/crane.log"
if [ "$1" = config ]; then
  printf '{"config":{"Entrypoint":["/entry"],"Cmd":["serve"],"Env":["PATH=/bin","A=image"],"WorkingDir":"/app"}}'
  exit 0
fi
d=$(mktemp -d); echo rootfs > "$d/hello"; tar -cf - -C "$d" .; rm -rf "$d"
"#;

struct Harness {
    dir: PathBuf,
    fake: Arc<Fake>,
    server: Arc<Server>,
    base: u16,
}

impl Harness {
    fn new(name: &str) -> Self {
        Self::with(name, |_| {})
    }

    fn with(name: &str, tune: impl FnOnce(&mut Config)) -> Self {
        let dir =
            std::env::temp_dir().join(format!("vm-runner-server-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let crane = dir.join("crane");
        fs::write(&crane, FAKE_CRANE).unwrap();
        fs::set_permissions(&crane, fs::Permissions::from_mode(0o755)).unwrap();
        let init = dir.join("platform-init");
        fs::write(&init, "#!/bin/sh\nexec \"$@\"\n").unwrap();
        let (base, held) = port_block();
        let held = Mutex::new(held);
        let mut config = Config {
            state_dir: dir.join("machines"),
            image_dir: dir.join("images"),
            runner_id: "runner-a".into(),
            image_budget: 1 << 40,
            crane: crane.to_string_lossy().into_owned(),
            init: Some(init),
            ports: base..=base + 1,
            memory_mib: 1 << 20,
            reserve_mib: 0,
            allow_from: Vec::new(),
            pinned: Vec::new(),
            listen: Some(Arc::new(move |port| match locked(&held).remove(&port) {
                Some(listener) => Ok(listener),
                None => TcpListener::bind(("127.0.0.1", port)),
            })),
        };
        tune(&mut config);
        let fake = Arc::new(Fake::default());
        let server = Server::start(config, fake.clone()).unwrap();
        Self {
            dir,
            fake,
            server,
            base,
        }
    }

    fn crane_calls(&self) -> usize {
        fs::read_to_string(self.dir.join("crane.log"))
            .map(|log| log.lines().count())
            .unwrap_or_default()
    }

    async fn settle(&self, id: &str) -> MachineStatus {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let status = self.server.status(id);
            if !matches!(
                status.state.as_str(),
                STATE_CREATING | STATE_STARTING | STATE_STOPPING | STATE_RESTARTING
            ) {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "the operation never finished: {status:?}"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.server.forwarder.unpublish_all();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: two published ports held by this test until the runner takes them, with both guest ports at the loopback offset free. A port proven free and released is only a port that used to be free, so the published ones are handed over bound.
fn port_block() -> (u16, HashMap<u16, TcpListener>) {
    for _ in 0..200 {
        let first = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = first.local_addr().unwrap().port();
        if base > u16::MAX - LOOPBACK_OFFSET - 2 {
            continue;
        }
        let Ok(second) = TcpListener::bind(("127.0.0.1", base + 1)) else {
            continue;
        };
        let guests_free = [base, base + 1]
            .iter()
            .all(|p| TcpListener::bind(("127.0.0.1", p + LOOPBACK_OFFSET)).is_ok());
        if guests_free {
            return (base, HashMap::from([(base, first), (base + 1, second)]));
        }
    }
    panic!("no free port block");
}

// UNIT_BOUNDARY_DESCRIPTION: a guest answering its health endpoint on the loopback port behind a published one, until the returned flag is cleared.
fn guest(port: u16) -> Arc<AtomicBool> {
    let listener = TcpListener::bind(("127.0.0.1", port + LOOPBACK_OFFSET)).unwrap();
    let up = Arc::new(AtomicBool::new(true));
    let serving = up.clone();
    std::thread::spawn(move || {
        for mut conn in listener.incoming().flatten() {
            if !serving.load(Ordering::SeqCst) {
                return;
            }
            let mut buf = [0u8; 256];
            let _ = conn.read(&mut buf);
            let _ = conn.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        }
    });
    up
}

fn spec(running: bool) -> MachineSpec {
    MachineSpec {
        image: "quay.io/x/vm:1".into(),
        cpus: 2,
        memory_mib: 2048,
        storage_gib: 5,
        env: [
            (
                "HTTPS_PROXY".to_string(),
                "http://10.0.0.1:10000".to_string(),
            ),
            ("A".to_string(), "b".to_string()),
        ]
        .into(),
        ca_cert: "PEM".into(),
        allow_cidrs: vec!["10.0.0.1/32".into()],
        revision: "r1".into(),
        running,
        pull_auth: String::new(),
    }
}

// TEST_SCENARIO: an absent machine the controller wants running is fetched, created, published and started, in that order, and its spec, port and share are left on disk for a restarted runner to find. It boots from the unpacked tree, with the launch the image named.
#[tokio::test(flavor = "multi_thread")]
async fn an_absent_machine_is_created_and_started() {
    let h = Harness::new("create");
    let status = h.server.put("m1", spec(true)).unwrap();
    assert_eq!(status.state, STATE_CREATING);
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING);
    assert_eq!(status.port, i32::from(h.base));
    assert_eq!(h.fake.calls(), vec!["create m1", "start m1"]);

    let (image, launch) = locked(&h.fake.created).get("m1").cloned().unwrap();
    assert_eq!(
        PathBuf::from(image),
        cache_path(&h.dir.join("images"), "quay.io/x/vm:1").join(ROOTFS_DIR)
    );
    let launch = launch.unwrap();
    assert_eq!(launch.entrypoint, vec!["/entry"]);
    assert_eq!(launch.working_dir, "/app");

    let state = h.dir.join("machines/m1");
    assert!(state.join("spec.json").exists());
    assert_eq!(
        fs::read_to_string(state.join("port")).unwrap(),
        h.base.to_string()
    );
    assert_eq!(
        fs::read_to_string(state.join("share/ca/ca.crt")).unwrap(),
        "PEM"
    );
    assert!(state.join("share/init").exists());
    assert!(
        !read_spec(&h.dir.join("machines"), "m1").unwrap().running,
        "the stored spec must never say the machine should be running"
    );
}

// TEST_SCENARIO: a stop and a later start are the same machine: same port, same disk, no second create.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_machine_starts_again_on_the_same_port() {
    let h = Harness::new("restart");
    h.server.put("m1", spec(true)).unwrap();
    let first = h.settle("m1").await;
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", spec(true)).unwrap();
    let again = h.settle("m1").await;
    assert_eq!(again.state, STATE_RUNNING);
    assert_eq!(again.port, first.port);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
}

// TEST_SCENARIO: a new revision or a new size restarts the running machine in place — stop, update, start — keeping its disk. A spec that has not changed does nothing at all.
#[tokio::test(flavor = "multi_thread")]
async fn a_changed_shape_restarts_the_machine_in_place() {
    let h = Harness::new("reshape");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let _guest = guest(h.base);
    assert!(h.server.put("m1", spec(true)).unwrap().ready);
    let mut changed = spec(true);
    changed.revision = "r2".into();
    assert_eq!(h.server.put("m1", changed).unwrap().state, STATE_RESTARTING);
    h.settle("m1").await;
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
}

// TEST_SCENARIO: a guest that answers its health endpoint is up, even while the start call that booted it has not returned. The controller would otherwise spend those seconds telling a person their agent was not ready.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_that_answers_is_ready_before_its_start_returns() {
    let h = Harness::new("early-ready");
    *locked(&h.fake.start_delay) = Duration::from_secs(2);
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

// TEST_SCENARIO: a stop that arrives while the machine is still booting is queued behind the boot rather than dropped, so a machine nobody wants running does not end up running.
#[tokio::test(flavor = "multi_thread")]
async fn a_stop_issued_while_booting_is_honoured() {
    let h = Harness::new("stop-mid-boot");
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(
        h.server.put("m1", spec(false)).unwrap().state,
        STATE_STOPPING
    );
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    assert_eq!(h.fake.calls(), vec!["create m1", "start m1", "stop m1"]);
}

// TEST_SCENARIO: operations run in the order they were queued, whichever worker thread starts first. Many alternating starts and stops queued at once must end in the state the last one asked for, with the runtime called in exactly the queued order.
#[tokio::test(flavor = "multi_thread")]
async fn operations_run_in_the_order_they_were_queued() {
    let h = Harness::new("order");
    *locked(&h.fake.start_delay) = Duration::from_millis(20);
    let lock = h.server.lock("m1");
    let mut queued = Vec::new();
    {
        let _held = locked(&lock);
        for i in 0..20u64 {
            let fake = h.fake.clone();
            let label = format!("op {i}");
            queued.push(label.clone());
            h.server.spawn("m1", STATE_STARTING, move || {
                fake.record(label);
                Ok(())
            });
        }
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    while h.fake.calls().len() < queued.len() {
        assert!(Instant::now() < deadline, "the queue never drained");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(h.fake.calls(), queued);
}

// TEST_SCENARIO: the image is fixed at create, so a spec with a different image is reported in the machine's message and the rest of the spec still applies. The machine keeps booting the image it has.
#[tokio::test(flavor = "multi_thread")]
async fn a_changed_image_is_reported_and_does_not_block_the_rest() {
    let h = Harness::new("drift");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut changed = spec(true);
    changed.image = "quay.io/x/vm:2".into();
    changed.revision = "r2".into();
    h.server.put("m1", changed).unwrap();
    let status = h.settle("m1").await;
    assert!(
        status
            .message
            .contains("image is quay.io/x/vm:1, wanted quay.io/x/vm:2"),
        "{status:?}"
    );
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:1"
    );
    assert_eq!(h.fake.calls().last().unwrap(), "start m1");
}

// TEST_SCENARIO: the allowlist is the gateway's ClusterIP, and Kubernetes reuses those. A machine whose gateway moved is stopped and reported, not run on an address that may now belong to another owner.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_is_stopped_when_its_gateway_address_changes() {
    let h = Harness::new("egress");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut moved = spec(true);
    moved.allow_cidrs = vec!["10.0.0.9/32".into()];
    assert_eq!(
        h.server.put("m1", moved.clone()).unwrap().state,
        STATE_STOPPING
    );
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", moved).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_EGRESS_CHANGED);
    assert!(
        status.message.contains("[10.0.0.1/32]") && status.message.contains("[10.0.0.9/32]"),
        "{status:?}"
    );
    assert_eq!(h.fake.calls(), vec!["create m1", "start m1", "stop m1"]);
}

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

// TEST_SCENARIO: a boot that fails is reported under the reason the controller shows the person, and a later attempt that succeeds clears it.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_boot_is_reported_until_one_succeeds() {
    let h = Harness::new("boot-failed");
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    h.server.put("m1", spec(true)).unwrap();
    let failed = h.settle("m1").await;
    assert_eq!(failed.reason, REASON_BOOT_FAILED);
    assert!(failed.message.contains("never became ready"));
    h.server.put("m1", spec(true)).unwrap();
    let recovered = h.settle("m1").await;
    assert_eq!(recovered.state, STATE_RUNNING);
    assert!(
        recovered.reason.is_empty() && recovered.message.is_empty(),
        "{recovered:?}"
    );
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
        plan::BAD_IMAGE
    );
    let mut incomplete = spec(true);
    incomplete.cpus = 0;
    assert_eq!(
        h.server.put("m1", incomplete).unwrap_err().message,
        plan::REQUIRED
    );
}

// TEST_SCENARIO: an operation queued against a machine that has since been deleted must not run: a boot queued before a delete would otherwise bring the machine back afterwards. The delete bumps the machine's generation while holding its lock, and the queued work checks it before running.
#[tokio::test(flavor = "multi_thread")]
async fn work_queued_before_a_delete_is_dropped() {
    let h = Harness::new("queued");
    let ran = Arc::new(AtomicBool::new(false));
    let lock = h.server.lock("m1");
    {
        let _held = locked(&lock);
        let flag = ran.clone();
        h.server.spawn("m1", STATE_CREATING, move || {
            flag.store(true, Ordering::SeqCst);
            Ok(())
        });
        *locked(&h.server.inner).gens.entry("m1".into()).or_default() += 1;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        !ran.load(Ordering::SeqCst),
        "work queued against a superseded generation ran anyway"
    );
}

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
    let deadline = Instant::now() + Duration::from_secs(5);
    let port = h.base;
    let listen: Arc<Listen> = Arc::new(move |p| loop {
        match TcpListener::bind(("127.0.0.1", p)) {
            Ok(l) => return Ok(l),
            Err(e) if Instant::now() > deadline => return Err(e),
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    });
    let again = Server::start(
        Config {
            state_dir: h.dir.join("machines"),
            image_dir: h.dir.join("images"),
            runner_id: "runner-a".into(),
            image_budget: 1 << 40,
            crane: String::new(),
            init: None,
            ports: port..=port + 1,
            memory_mib: 1 << 20,
            reserve_mib: 0,
            allow_from: Vec::new(),
            pinned: Vec::new(),
            listen: Some(listen),
        },
        h.fake.clone(),
    )
    .unwrap();
    assert!(again.forwarder.is_published("m1"));
    again.close().await;
}

// TEST_SCENARIO: the handful of images nearly every owner runs is fetched once per cache, not once per machine: a second machine of the same image boots the tree the first one unpacked.
#[tokio::test(flavor = "multi_thread")]
async fn an_image_is_fetched_once_for_every_machine_that_wants_it() {
    let h = Harness::new("fetch-once");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let after_first = h.crane_calls();
    assert_eq!(after_first, 2, "one config read and one export");
    h.server.put("m2", spec(true)).unwrap();
    h.settle("m2").await;
    assert_eq!(
        h.crane_calls(),
        after_first,
        "the second machine fetched the image again"
    );
    let launch = read_launch(&cache_path(&h.dir.join("images"), "quay.io/x/vm:1")).unwrap();
    assert_eq!(launch.unwrap().cmd, vec!["serve"]);
    assert!(
        !fs::read_dir(h.dir.join("images"))
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with(PARTIAL_PREFIX)),
        "a finished fetch left its scratch tree behind"
    );
}

// TEST_SCENARIO: a tree with no launch record beside it names nothing to run. It is never booted from; the image is fetched again and the complete entry replaces it.
#[tokio::test(flavor = "multi_thread")]
async fn a_tree_with_no_launch_beside_it_is_not_booted_from() {
    let h = Harness::new("no-launch");
    let base = cache_path(&h.dir.join("images"), "quay.io/x/vm:1");
    fs::create_dir_all(base.join(ROOTFS_DIR)).unwrap();
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(h.crane_calls(), 2);
    assert!(read_launch(&base).unwrap().is_some());
}

// TEST_SCENARIO: an install whose fetch fails still has the archive an earlier release cached, and that archive still boots — with the launch read out of the archive's own config.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_fetch_still_boots_the_archive_on_disk() {
    let h = Harness::new("archive");
    fs::write(
        h.dir.join("crane"),
        "#!/bin/sh\necho unreachable >&2\nexit 1\n",
    )
    .unwrap();
    let images = h.dir.join("images");
    fs::create_dir_all(&images).unwrap();
    let archive = PathBuf::from(format!(
        "{}.tar",
        cache_path(&images, "quay.io/x/vm:1").display()
    ));
    write_archive(&archive, r#"{"config":{"Entrypoint":["/from-archive"]}}"#);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let (image, launch) = locked(&h.fake.created).get("m1").cloned().unwrap();
    assert_eq!(PathBuf::from(image), archive);
    assert_eq!(launch.unwrap().entrypoint, vec!["/from-archive"]);
}

// TEST_SCENARIO: an image that cannot be read is reported as an image problem, which is what tells the person to fix the image rather than wait for a retry.
#[tokio::test(flavor = "multi_thread")]
async fn an_image_that_cannot_be_read_is_reported_as_such() {
    let h = Harness::new("unreadable");
    fs::write(
        h.dir.join("crane"),
        "#!/bin/sh\necho 'MANIFEST_UNKNOWN' >&2\nexit 1\n",
    )
    .unwrap();
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_IMAGE_UNAVAILABLE);
    assert!(status.message.contains("MANIFEST_UNKNOWN"), "{status:?}");
    assert!(h.fake.calls().is_empty());
}

// TEST_SCENARIO: closing the runner ends a fetch in flight instead of waiting out its twenty minutes, and the scratch tree it was unpacking into goes with it.
#[tokio::test(flavor = "multi_thread")]
async fn closing_the_runner_cancels_a_fetch_instead_of_abandoning_it() {
    let h = Harness::new("close-fetch");
    fs::write(
        h.dir.join("crane"),
        "#!/bin/sh\nif [ \"$1\" = config ]; then printf '{\"config\":{\"Cmd\":[\"x\"]}}'; exit 0; fi\nsleep 60\n",
    )
    .unwrap();
    h.server.put("m1", spec(true)).unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let started = Instant::now();
    h.server.close().await;
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "close waited out the fetch"
    );
    assert!(
        !fs::read_dir(h.dir.join("images"))
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with(PARTIAL_PREFIX)),
        "the cancelled fetch left its scratch tree"
    );
}

// TEST_SCENARIO: an operation offered after close is refused, and the memory its caller reserved for it is released — a runner that came back to the same state would otherwise count a machine that never started.
#[tokio::test(flavor = "multi_thread")]
async fn no_operation_starts_after_close() {
    let h = Harness::new("after-close");
    h.server.close().await;
    h.server.put("m1", spec(true)).unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(h.fake.calls().is_empty());
    assert!(locked(&h.server.inner).committing.is_empty());
}

// TEST_SCENARIO: a machine that answered once and then went quiet for longer than any boot is restarted and counted; the count is what the controller reports as the agent's restarts.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_that_went_quiet_is_restarted_and_counted() {
    let h = Harness::new("dead");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    locked(&h.server.inner).health.insert(
        "m1".into(),
        Health {
            ever_ready: true,
            quiet_since: Some(SystemTime::now() - plan::UNHEALTHY_RESTART - Duration::from_secs(1)),
        },
    );
    assert_eq!(
        h.server.put("m1", spec(true)).unwrap().state,
        STATE_RESTARTING
    );
    let status = h.settle("m1").await;
    assert_eq!(status.restarts, 1);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
}

// TEST_SCENARIO: an unpacked image is the root filesystem of every machine of it, so eviction never takes one a machine is running from — the cache goes over its budget instead.
#[tokio::test(flavor = "multi_thread")]
async fn the_cache_never_evicts_an_image_a_machine_is_running() {
    let h = Harness::with("evict", |c| c.image_budget = 1);
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut other = spec(true);
    other.image = "quay.io/x/other:1".into();
    h.server.put("m2", other).unwrap();
    h.settle("m2").await;
    let images = h.dir.join("images");
    assert!(
        cache_path(&images, "quay.io/x/vm:1").exists(),
        "the running machine's image was evicted"
    );
    assert!(cache_path(&images, "quay.io/x/other:1").exists());
}

fn write_archive(path: &Path, config: &str) {
    let mut builder = tar::Builder::new(fs::File::create(path).unwrap());
    let manifest = br#"[{"Config":"config.json"}]"#;
    for (name, body) in [
        ("manifest.json", &manifest[..]),
        ("config.json", config.as_bytes()),
    ] {
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        builder.append_data(&mut header, name, body).unwrap();
    }
    builder.finish().unwrap();
}

const PRIVATE_CRANE: &str = r##"#!/bin/sh
here="$(dirname "$0")"
echo "$@" >> "$here/crane.log"
auth=""
if [ -n "$DOCKER_CONFIG" ]; then
  auth=$(cat "$DOCKER_CONFIG/config.json")
  echo "$1 $(stat -c %a "$DOCKER_CONFIG") $DOCKER_CONFIG $auth" >> "$here/auth.log"
fi
case "$1" in
  digest) case "$auth" in *c2VjcmV0*) echo sha256:x; exit 0;; esac; echo UNAUTHORIZED >&2; exit 1;;
  config) printf '{"config":{"Cmd":["serve"]}}'; exit 0;;
esac
d=$(mktemp -d); echo rootfs > "$d/hello"; tar -cf - -C "$d" .; rm -rf "$d"
"##;

const CREDENTIAL: &str = r#"{"auths":{"quay.io":{"auth":"c2VjcmV0"}}}"#;

fn with_credential(running: bool) -> MachineSpec {
    MachineSpec {
        pull_auth: CREDENTIAL.into(),
        ..spec(running)
    }
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(files_under(&path));
        } else {
            found.push(path);
        }
    }
    found
}

// TEST_SCENARIO: the controller sends a machine's registry credential on its spec so a private image can be fetched. It reaches crane alone, through a DOCKER_CONFIG directory only the runner can read that is gone once the fetch ends: never the stored spec, the share the guest mounts, or the runtime. An image an anonymous read cannot reach is marked private in the cache.
#[tokio::test(flavor = "multi_thread")]
async fn a_registry_credential_reaches_crane_alone() {
    let h = Harness::new("pull-auth");
    fs::write(h.dir.join("crane"), PRIVATE_CRANE).unwrap();
    h.server.put("m1", with_credential(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    let log = fs::read_to_string(h.dir.join("auth.log")).unwrap();
    for op in ["config", "export"] {
        let line = log
            .lines()
            .find(|l| l.starts_with(&format!("{op} ")))
            .unwrap_or_else(|| panic!("crane {op} ran without the credential: {log}"));
        let fields: Vec<&str> = line.splitn(4, ' ').collect();
        assert_eq!(fields[1], "700", "{line}");
        assert_eq!(fields[3], CREDENTIAL);
        assert!(
            !Path::new(fields[2]).exists(),
            "{} was left behind",
            fields[2]
        );
    }
    assert!(
        log.lines()
            .any(|l| l.starts_with("digest ") && l.ends_with(" {}")),
        "the image was never probed anonymously: {log}"
    );
    for file in files_under(&h.dir.join("machines")) {
        let body = fs::read(&file).unwrap_or_default();
        assert!(
            !String::from_utf8_lossy(&body).contains("c2VjcmV0"),
            "the credential reached {}",
            file.display()
        );
    }
    let entry = cache_path(&h.dir.join("images"), "quay.io/x/vm:1");
    assert!(entry.join(PRIVATE_FILE).exists());
    assert!(!entry.join(ROOTFS_DIR).join(PRIVATE_FILE).exists());
}

// TEST_SCENARIO: runners of every owner on a node share its cache, so an image one owner fetched with credentials is not another's to boot by naming it. A machine with no credential is refused the private entry as an image problem; one whose credential still reads the manifest boots the tree already there without fetching it again.
#[tokio::test(flavor = "multi_thread")]
async fn a_private_image_is_reused_only_with_credentials_that_read_it() {
    let h = Harness::new("private-reuse");
    fs::write(h.dir.join("crane"), PRIVATE_CRANE).unwrap();
    h.server.put("m1", with_credential(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    h.server.put("m2", spec(true)).unwrap();
    let refused = h.settle("m2").await;
    assert_eq!(refused.reason, REASON_IMAGE_UNAVAILABLE, "{refused:?}");
    assert!(refused.message.contains("private registry"), "{refused:?}");
    assert!(!locked(&h.fake.created).contains_key("m2"));

    h.server.delete("m2").unwrap();
    let exports = || {
        fs::read_to_string(h.dir.join("crane.log"))
            .unwrap()
            .lines()
            .filter(|l| l.starts_with("export "))
            .count()
    };
    let before = exports();
    h.server.put("m2", with_credential(true)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_RUNNING);
    assert_eq!(
        exports(),
        before,
        "a readable private image was fetched again"

// TEST_SCENARIO: a resize that asks for more storage than a disk that cannot grow is refused before the machine is touched: it keeps running at the size it has, the reason is in its status, and its stored spec still says the old size, so the resize is not taken for done.
#[tokio::test(flavor = "multi_thread")]
async fn a_disk_that_cannot_grow_is_not_resized_under_a_running_machine() {
    let h = Harness::new("ungrowable");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.fake.ungrowable.store(true, Ordering::SeqCst);
    let mut bigger = spec(true);
    bigger.storage_gib += 10;
    h.server.put("m1", bigger).unwrap();
    let status = h.settle("m1").await;
    assert!(
        status
            .message
            .contains(crate::embedded::STORAGE_NOT_GROWABLE),
        "{status:?}"
    );
    assert_eq!(h.fake.calls(), ["create m1", "start m1"]);
    assert_eq!(h.fake.state("m1").unwrap(), STATE_RUNNING);
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1")
            .unwrap()
            .storage_gib,
        spec(true).storage_gib
    );
}
