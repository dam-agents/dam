use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicBool, Ordering};

use super::*;
use crate::api::{
    REASON_BOOT_FAILED, REASON_IMAGE_UNAVAILABLE, STATE_ABSENT, STATE_CREATING, STATE_RESTARTING,
    STATE_RUNNING, STATE_STARTING, STATE_STOPPED, STATE_STOPPING,
};
use crate::cache::{archive_path, digest_path, staged_path, PARTIAL_PREFIX};
use crate::cacheapi;
use crate::imagecache::{CacheConfig, ImageCache};
use crate::launch::{ImageLaunch, LAUNCH_FILE};
use crate::plan::{READY_GRACE, UNHEALTHY_RESTART};
use std::path::Path;

// UNIT_BOUNDARY_DESCRIPTION: what one update asked of the fake runtime: the image it moved the machine to, if any, and the allowlist and disk size it wrote.
#[derive(Debug, Clone, PartialEq)]
struct Updated {
    image: Option<String>,
    allow_cidrs: Vec<String>,
    storage_gib: i32,
}

// UNIT_BOUNDARY_DESCRIPTION: a runtime with no hypervisor behind it. It records each call in order, keeps each machine's state and the image its record names in memory, and can be told to boot slowly or fail once — which is everything the server's decisions depend on.
#[derive(Default)]
struct Fake {
    states: Mutex<HashMap<String, State>>,
    calls: Mutex<Vec<String>>,
    created: Mutex<HashMap<String, (String, ImageLaunch)>>,
    images: Mutex<HashMap<String, String>>,
    updated: Mutex<Vec<Updated>>,
    start_delay: Mutex<Duration>,
    stop_delay: Mutex<Duration>,
    fail_start_once: Mutex<Option<String>>,
    console: Mutex<String>,
}

impl Fake {
    fn calls(&self) -> Vec<String> {
        locked(&self.calls).clone()
    }

    fn record(&self, call: String) {
        locked(&self.calls).push(call);
    }

    fn last_update(&self) -> Updated {
        locked(&self.updated).last().cloned().expect("no update")
    }
}

impl Runtime for Fake {
    fn state(&self, id: &str) -> anyhow::Result<State> {
        Ok(locked(&self.states)
            .get(id)
            .copied()
            .unwrap_or(State::Absent))
    }

    fn create(&self, id: &str, machine: &Machine<'_>) -> anyhow::Result<()> {
        self.record(format!("create {id}"));
        locked(&self.created).insert(
            id.to_string(),
            (machine.image.to_string(), machine.launch.clone()),
        );
        locked(&self.images).insert(id.to_string(), machine.image.to_string());
        locked(&self.states).insert(id.to_string(), State::Stopped);
        Ok(())
    }

    fn update(&self, id: &str, update: &Update<'_>) -> anyhow::Result<()> {
        self.record(format!("update {id}"));
        if let Some((image, _)) = update.image {
            locked(&self.images).insert(id.to_string(), image.to_string());
        }
        locked(&self.updated).push(Updated {
            image: update.image.map(|(image, _)| image.to_string()),
            allow_cidrs: update.desired.allow_cidrs.clone(),
            storage_gib: update.desired.storage_gib,
        });
        Ok(())
    }

    fn start(&self, id: &str) -> anyhow::Result<()> {
        self.record(format!("start {id}"));
        std::thread::sleep(*locked(&self.start_delay));
        if let Some(message) = locked(&self.fail_start_once).take() {
            anyhow::bail!(message);
        }
        locked(&self.states).insert(id.to_string(), State::Running);
        Ok(())
    }

    fn stop(&self, id: &str) -> anyhow::Result<()> {
        std::thread::sleep(*locked(&self.stop_delay));
        self.record(format!("stop {id}"));
        locked(&self.states).insert(id.to_string(), State::Stopped);
        Ok(())
    }

    fn delete(&self, id: &str) -> anyhow::Result<()> {
        self.record(format!("delete {id}"));
        locked(&self.states).remove(id);
        Ok(())
    }

    fn image_present(&self, id: &str) -> anyhow::Result<bool> {
        Ok(locked(&self.images)
            .get(id)
            .map(Path::new)
            .is_none_or(|image| !image.is_absolute() || image.exists()))
    }

    fn console_tail(&self, _id: &str) -> String {
        locked(&self.console).clone()
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a crane that answers the two questions the runner asks — what an image says to run, and what its filesystem holds — and logs each call, so a test can count fetches. A fake that answered only one would let a change that stopped asking the other pass.
const FAKE_CRANE: &str = r#"#!/bin/sh
echo "$@" >> "$(dirname "$0")/crane.log"
if [ "$1" = digest ]; then
  if [ -f "$(dirname "$0")/registry-down" ]; then echo 'connection refused' >&2; exit 1; fi
  moved=$(cat "$(dirname "$0")/moved" 2>/dev/null)
  printf 'sha256:%s\n' "$(printf '%s%s' "${2%@*}" "$moved" | sha256sum | cut -c1-64)"
  exit 0
fi
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
            image_cache_socket: None,
            image_budget: 1 << 40,
            crane: crane.to_string_lossy().into_owned(),
            init: Some(init),
            ports: base..=base + 1,
            memory_mib: 1 << 20,
            reserve_mib: 0,
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

    // UNIT_BOUNDARY_DESCRIPTION: the cache entry a machine boots from, by the digest it recorded.
    fn entry(&self, id: &str) -> PathBuf {
        let digest = fs::read_to_string(self.dir.join("machines").join(id).join(IMAGE_DIGEST_FILE))
            .unwrap_or_else(|e| panic!("{id} recorded no digest: {e}"));
        digest_path(&self.dir.join("images"), digest.trim())
    }

    fn crane_log(&self, op: &str) -> usize {
        fs::read_to_string(self.dir.join("crane.log"))
            .map(|log| {
                log.lines()
                    .filter(|l| l.starts_with(&format!("{op} ")))
                    .count()
            })
            .unwrap_or_default()
    }

    fn crane_calls(&self) -> usize {
        fs::read_to_string(self.dir.join("crane.log"))
            .map(|log| log.lines().count())
            .unwrap_or_default()
    }

    // UNIT_BOUNDARY_DESCRIPTION: waits until no worker is converging the machine, then reads its status.
    async fn settle(&self, id: &str) -> MachineStatus {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let status = self.server.status(id);
            if !self.server.converging(id)
                && !matches!(
                    status.state.as_str(),
                    STATE_CREATING | STATE_STARTING | STATE_STOPPING | STATE_RESTARTING
                )
            {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "the operation never finished: {status:?}"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: waits on the machine's status version, as the controller does, until the status satisfies `done`.
    async fn until(
        &self,
        id: &str,
        what: &str,
        done: impl Fn(&MachineStatus) -> bool,
    ) -> MachineStatus {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut status = self.server.status(id);
        while !done(&status) {
            assert!(
                Instant::now() < deadline,
                "the machine never became {what}: {status:?}"
            );
            status = self.wait(id, status.version, Duration::from_secs(1)).await;
        }
        status
    }

    async fn wait(&self, id: &str, since: u64, timeout: Duration) -> MachineStatus {
        let server = self.server.clone();
        let id = id.to_string();
        tokio::task::spawn_blocking(move || server.wait(&id, since, timeout).unwrap())
            .await
            .unwrap()
    }

    // UNIT_BOUNDARY_DESCRIPTION: waits until the runtime has been called with `call`, so a test can act while that call is still running.
    async fn wait_for_call(&self, call: &str) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !self.fake.calls().iter().any(|c| c == call) {
            assert!(
                Instant::now() < deadline,
                "{call} never reached the runtime"
            );
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }

    fn machine<R>(&self, id: &str, change: impl FnOnce(&mut MachineEntry) -> R) -> R {
        change(
            locked(&self.server.machines)
                .entries
                .get_mut(id)
                .expect("the runner has no entry for the machine"),
        )
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

// UNIT_BOUNDARY_DESCRIPTION: moves the start of the boot the runner is waiting on back past SLOW_BOOT_AFTER, which is what a guest stuck for a minute looks like.
fn age_boot(h: &Harness, id: &str) {
    h.machine(id, |m| {
        m.boot.as_mut().expect("no boot is waited on").at =
            Instant::now() - SLOW_BOOT_AFTER - Duration::from_secs(1)
    });
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
        pull_auths: Vec::new(),
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
    assert_eq!(PathBuf::from(image), h.entry("m1").join(ROOTFS_DIR));
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

// TEST_SCENARIO: a machine's record names the cache tree it boots by path, read at every start. A tree gone from under a stopped machine — the image directory moved or relaid between runner releases — is resolved again when the machine next starts, its record moved to the new tree and its digest recorded again; without that the machine fails every start until its image changes, which for a hibernated agent is never. The stored spec has not changed, so nothing else may trigger it.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_machine_whose_tree_is_gone_resolves_its_image_again() {
    let h = Harness::new("stale-tree");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    let tree = h.entry("m1");
    let fetches = h.crane_calls();
    fs::remove_dir_all(&tree).unwrap();
    fs::remove_file(h.dir.join("machines/m1").join(IMAGE_DIGEST_FILE)).unwrap();

    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert_eq!(
        h.fake.calls(),
        ["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
    assert!(h.crane_calls() > fetches, "the image was not fetched again");
    assert!(
        tree.join(ROOTFS_DIR).is_dir(),
        "the tree was not unpacked again"
    );
    assert_eq!(
        h.fake.last_update().image.map(PathBuf::from),
        Some(h.entry("m1").join(ROOTFS_DIR)),
        "the record was not moved to the new tree"
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

// TEST_SCENARIO: the controller is level-triggered, so only its latest spec matters. Specs sent while a boot runs replace each other, and once the boot returns the machine goes straight to the last one — the stop sent in between is never carried out on its own.
#[tokio::test(flavor = "multi_thread")]
async fn the_latest_spec_wins() {
    let h = Harness::new("latest");
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    h.server.put("m1", spec(false)).unwrap();
    let mut last = spec(true);
    last.revision = "r3".into();
    last.cpus = 4;
    h.server.put("m1", last).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
    let stored = read_spec(&h.dir.join("machines"), "m1").unwrap();
    assert_eq!((stored.revision.as_str(), stored.cpus), ("r3", 4));
}

// TEST_SCENARIO: a template upgrade gives a running agent a new image. The machine is stopped, its record moved to the new image's own tree, and started again: the same machine, so the same disk and the port its Service already maps to. The stored spec names the new image once it has booted.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_image_is_applied_to_the_same_machine() {
    let h = Harness::new("new-image");
    h.server.put("m1", spec(true)).unwrap();
    let first = h.settle("m1").await;
    let mut upgraded = spec(true);
    upgraded.image = "quay.io/x/vm:2".into();
    assert_eq!(
        h.server.put("m1", upgraded).unwrap().state,
        STATE_RESTARTING
    );
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert_eq!(status.message, "");
    assert_eq!(status.port, first.port);
    assert_eq!(
        h.fake.calls(),
        ["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
    assert_eq!(
        h.fake.last_update().image.map(PathBuf::from),
        Some(h.entry("m1").join(ROOTFS_DIR))
    );
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:2"
    );
    assert!(h.server.forwarder.is_published("m1"));
}

// TEST_SCENARIO: the new image is fetched before the old machine is touched, so an image that cannot be read is reported as an image problem while the agent keeps running on what it has.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_image_that_cannot_be_fetched_leaves_the_machine_running() {
    let h = Harness::new("new-image-fails");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    fs::write(
        h.dir.join("crane"),
        "#!/bin/sh\necho 'MANIFEST_UNKNOWN' >&2\nexit 1\n",
    )
    .unwrap();
    let mut upgraded = spec(true);
    upgraded.image = "quay.io/x/vm:2".into();
    h.server.put("m1", upgraded).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_IMAGE_UNAVAILABLE, "{status:?}");
    assert_eq!(h.fake.calls(), ["create m1", "start m1"]);
    assert_eq!(h.fake.state("m1").unwrap(), State::Running);
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:1"
    );
}

// TEST_SCENARIO: a delete that arrives while a boot is running waits for it, then removes the machine; the spec stored behind the boot is dropped rather than carried out on a machine that is gone.
#[tokio::test(flavor = "multi_thread")]
async fn a_delete_waits_for_the_action_in_flight_and_drops_the_spec_behind_it() {
    let h = Harness::new("delete-mid-boot");
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    let mut next = spec(true);
    next.revision = "r2".into();
    h.server.put("m1", next).unwrap();
    let asked = Instant::now();
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.delete("m1").unwrap())
        .await
        .unwrap();
    assert!(asked.elapsed() > Duration::from_millis(150));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(h.fake.calls(), ["create m1", "start m1", "delete m1"]);
    assert_eq!(h.server.status("m1").state, STATE_ABSENT);
    assert!(!h.dir.join("machines/m1").exists());
}

// TEST_SCENARIO: the allowlist is the gateway's ClusterIP, and Kubernetes reuses those, so a machine must never keep running on an old one. A running machine is restarted onto the new allowlist; a stopped one is started onto it rather than left stopped.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_allowlist_is_applied_by_restarting_the_machine() {
    let h = Harness::new("egress");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut moved = spec(true);
    moved.allow_cidrs = vec!["10.0.0.9/32".into()];
    assert_eq!(
        h.server.put("m1", moved.clone()).unwrap().state,
        STATE_RESTARTING
    );
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "stop m1", "update m1", "start m1"]
    );
    assert_eq!(h.fake.last_update().allow_cidrs, ["10.0.0.9/32"]);

    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    let mut again = spec(true);
    again.allow_cidrs = vec!["10.0.0.10/32".into()];
    assert_eq!(h.server.put("m1", again).unwrap().state, STATE_STARTING);
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING, "{status:?}");
    assert!(status.reason.is_empty(), "{status:?}");
    assert_eq!(h.fake.last_update().allow_cidrs, ["10.0.0.10/32"]);
}

// TEST_SCENARIO: a disk grows and cannot shrink, so a smaller storage request is already met and does nothing; a larger one restarts the machine and asks the runtime to grow the disk.
#[tokio::test(flavor = "multi_thread")]
async fn storage_is_grown_and_never_shrunk() {
    let h = Harness::new("storage");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut smaller = spec(true);
    smaller.storage_gib = 1;
    assert_eq!(h.server.put("m1", smaller).unwrap().state, STATE_RUNNING);
    assert_eq!(h.fake.calls(), ["create m1", "start m1"]);

    let mut larger = spec(true);
    larger.storage_gib = 50;
    h.server.put("m1", larger).unwrap();
    h.settle("m1").await;
    assert_eq!(h.fake.last_update().storage_gib, 50);
    assert_eq!(h.fake.calls().len(), 5);
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

// TEST_SCENARIO: a machine whose first boot failed still has a record the create wrote. The next spec must be compared against that record, or a new image sent after the failure would never reach the machine: the start would boot the old image, and the spec written after it would claim the new one.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_whose_first_boot_failed_takes_the_next_spec_whole() {
    let h = Harness::new("first-boot-failed");
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.reason, REASON_BOOT_FAILED);
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:1",
        "the create records the shape it wrote before it boots"
    );

    let mut upgraded = spec(true);
    upgraded.image = "quay.io/x/vm:2".into();
    h.server.put("m1", upgraded).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.last_update().image.map(PathBuf::from),
        Some(h.entry("m1").join(ROOTFS_DIR)),
        "the new image is resolved and written to the record"
    );
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:2"
    );
}

// TEST_SCENARIO: a stored spec that cannot be read says nothing about which image the machine's record names. The next start must write the image it is asked for rather than assume the record already holds it, or the machine boots its old image and reads as converged.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_whose_stored_spec_is_unreadable_takes_the_image_it_is_asked_for() {
    let h = Harness::new("unreadable-spec");
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    std::fs::write(
        h.dir.join("machines").join("m1").join("spec.json"),
        "not json",
    )
    .unwrap();

    let mut upgraded = spec(true);
    upgraded.image = "quay.io/x/vm:2".into();
    h.server.put("m1", upgraded).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.last_update().image.map(PathBuf::from),
        Some(h.entry("m1").join(ROOTFS_DIR)),
        "the image is resolved and written to the record"
    );
    assert_eq!(
        read_spec(&h.dir.join("machines"), "m1").unwrap().image,
        "quay.io/x/vm:2"
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
        crate::plan::BAD_IMAGE
    );
    let mut incomplete = spec(true);
    incomplete.cpus = 0;
    assert_eq!(
        h.server.put("m1", incomplete).unwrap_err().message,
        crate::plan::REQUIRED
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
            image_cache_socket: None,
            image_budget: 1 << 40,
            crane: String::new(),
            init: None,
            ports: port..=port + 1,
            memory_mib: 1 << 20,
            reserve_mib: 0,
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
    assert_eq!(
        after_first, 3,
        "one resolution, one config read and one export"
    );
    h.server.put("m2", spec(true)).unwrap();
    h.settle("m2").await;
    assert_eq!(
        h.crane_calls(),
        after_first,
        "the second machine fetched the image again"
    );
    let launch = read_launch(&h.entry("m2")).unwrap();
    assert_eq!(launch.unwrap().cmd, vec!["serve"]);
    assert!(
        !fs::read_dir(h.dir.join("images"))
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with(PARTIAL_PREFIX)),
        "a finished fetch left its scratch tree behind"
    );
}

// TEST_SCENARIO: an install with no registry stages each image's archive in the image directory, mounted read-only. The staged archive boots without the registry being asked anything, with the launch read out of the archive's own config.
#[tokio::test(flavor = "multi_thread")]
async fn a_staged_archive_boots_without_asking_the_registry() {
    let h = Harness::new("archive");
    fs::write(
        h.dir.join("crane"),
        "#!/bin/sh\necho unreachable >&2\nexit 1\n",
    )
    .unwrap();
    let images = h.dir.join("images");
    fs::create_dir_all(&images).unwrap();
    let archive = archive_path(&images, "quay.io/x/vm:1");
    write_archive(&archive, r#"{"config":{"Entrypoint":["/from-archive"]}}"#);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let (image, launch) = locked(&h.fake.created).get("m1").cloned().unwrap();
    assert_eq!(PathBuf::from(image), archive);
    assert_eq!(launch.entrypoint, vec!["/from-archive"]);
    assert_eq!(h.crane_calls(), 0);
    assert!(
        !h.dir.join("machines/m1").join(IMAGE_DIGEST_FILE).exists(),
        "a machine booted from an archive holds no cache entry"
    );
}

// TEST_SCENARIO: an install stages an image as a tree with its launch record beside it (image:stage-vm), so the machine boots the tree in place instead of flattening an archive inside the guest. The tree wins over an archive staged under the same name, which an earlier install left behind.
#[tokio::test(flavor = "multi_thread")]
async fn a_staged_tree_boots_in_place_and_wins_over_the_archive() {
    let h = Harness::new("staged-tree");
    fs::write(
        h.dir.join("crane"),
        "#!/bin/sh\necho unreachable >&2\nexit 1\n",
    )
    .unwrap();
    let images = h.dir.join("images");
    let tree = staged_path(&images, "quay.io/x/vm:1");
    fs::create_dir_all(tree.join(ROOTFS_DIR)).unwrap();
    fs::write(
        tree.join(LAUNCH_FILE),
        r#"{"entrypoint":["/from-tree"],"cmd":[],"env":[],"workingDir":"/"}"#,
    )
    .unwrap();
    write_archive(
        &archive_path(&images, "quay.io/x/vm:1"),
        r#"{"config":{"Entrypoint":["/from-archive"]}}"#,
    );
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let (image, launch) = locked(&h.fake.created).get("m1").cloned().unwrap();
    assert_eq!(PathBuf::from(image), tree.join(ROOTFS_DIR));
    assert_eq!(launch.entrypoint, vec!["/from-tree"]);
    assert_eq!(h.crane_calls(), 0);
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

// TEST_SCENARIO: a spec sent after close starts no worker and holds no memory, so nothing counts a machine that never started.
#[tokio::test(flavor = "multi_thread")]
async fn no_action_starts_after_close() {
    let h = Harness::new("after-close");
    h.server.close().await;
    h.server.put("m1", spec(true)).unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(h.fake.calls().is_empty());
    assert!(h.server.committing().is_empty());
}

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
    assert_eq!(
        h.server.put("m1", spec(true)).unwrap().state,
        STATE_RESTARTING
    );
    let status = h.settle("m1").await;
    assert_eq!(status.restarts, 1);
    let calls = vec!["create m1", "start m1", "stop m1", "update m1", "start m1"];
    assert_eq!(h.fake.calls(), calls);

    assert_eq!(h.server.put("m1", spec(true)).unwrap().state, STATE_RUNNING);
    assert_eq!(h.settle("m1").await.restarts, 1);
    assert_eq!(h.fake.calls(), calls, "the restart earned another one");
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
    assert!(
        h.entry("m1").exists(),
        "the running machine's image was evicted"
    );
    assert!(h.entry("m2").exists());
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

// TEST_SCENARIO: a reference pinned by digest cannot move, so it is never resolved — its entry is the digest it names, fetched by that digest.
#[tokio::test(flavor = "multi_thread")]
async fn a_pinned_reference_is_never_resolved() {
    let h = Harness::new("pinned");
    let digest = format!("sha256:{}", "a".repeat(64));
    let mut pinned = spec(true);
    pinned.image = format!("quay.io/x/vm:1@{digest}");
    h.server.put("m1", pinned).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(h.crane_log("digest"), 0);
    let fetched = fs::read_to_string(h.dir.join("crane.log")).unwrap();
    assert!(
        fetched
            .lines()
            .any(|l| l == format!("export quay.io/x/vm@{digest} -")),
        "{fetched}"
    );
    assert_eq!(h.entry("m1"), digest_path(&h.dir.join("images"), &digest));
    assert!(read_launch(&h.entry("m1")).unwrap().is_some());
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
  digest) case "$auth" in *c2VjcmV0*) echo sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff; exit 0;; esac; echo UNAUTHORIZED >&2; exit 1;;
  config) case "$auth" in *c2VjcmV0*) printf '{"config":{"Cmd":["serve"]}}'; exit 0;; esac; echo UNAUTHORIZED >&2; exit 1;;
esac
d=$(mktemp -d); echo rootfs > "$d/hello"; tar -cf - -C "$d" .; rm -rf "$d"
"##;

const CREDENTIAL: &str = r#"{"auths":{"quay.io":{"auth":"c2VjcmV0"}}}"#;

fn with_credential(running: bool) -> MachineSpec {
    MachineSpec {
        pull_auths: vec![CREDENTIAL.into()],
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

// TEST_SCENARIO: the controller sends a machine's registry credential on its spec so a private image can be fetched. It reaches crane alone, through a DOCKER_CONFIG directory only the runner can read that is gone once the fetch ends: never the stored spec, the share the guest mounts, or the runtime.
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
    for file in files_under(&h.dir.join("machines")) {
        let body = fs::read(&file).unwrap_or_default();
        assert!(
            !String::from_utf8_lossy(&body).contains("c2VjcmV0"),
            "the credential reached {}",
            file.display()
        );
    }
}

const STALE: &str = r#"{"auths":{"quay.io":{"auth":"c3RhbGU="}}}"#;

// TEST_SCENARIO: a pod lists several pull Secrets and the kubelet tries each, so when an Agent's own credential for a registry has gone stale, the install default for that registry still pulls. The runner tries them in the order they were sent: the stale one is refused, the next one reads the config, and the layers are fetched with the one that worked.
#[tokio::test(flavor = "multi_thread")]
async fn a_stale_credential_does_not_hide_a_good_one_listed_after_it() {
    let h = Harness::new("pull-auth-fallback");
    fs::write(h.dir.join("crane"), PRIVATE_CRANE).unwrap();
    let spec = MachineSpec {
        pull_auths: vec![STALE.into(), CREDENTIAL.into()],
        ..spec(true)
    };
    h.server.put("m1", spec).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    let log = fs::read_to_string(h.dir.join("auth.log")).unwrap();
    let with = |op: &str| -> Vec<String> {
        log.lines()
            .filter(|l| l.starts_with(&format!("{op} ")))
            .map(|l| l.splitn(4, ' ').nth(3).unwrap_or_default().to_string())
            .collect()
    };
    assert_eq!(with("config"), [STALE, CREDENTIAL], "{log}");
    assert_eq!(with("export"), [CREDENTIAL], "{log}");
}

const PROXY: &str = "http://10.0.0.1:10000";

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
    h.server.put("m1", spec(false)).unwrap();
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
    h.server.put("m1", spec(false)).unwrap();
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
    h.server.put("m1", spec(false)).unwrap();
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
    h.server.put("m1", spec(false)).unwrap();
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

// TEST_SCENARIO: a worker that ends does so in the critical section that decided it had nothing left to do. A PUT landing right after starts a worker of its own, and the ended one must not then mark that new worker as done on its way out, or the new spec would wait for the next reconcile with no worker acting on it.
#[tokio::test(flavor = "multi_thread")]
async fn an_ended_worker_does_not_end_the_next_one() {
    let h = Harness::new("settle");
    h.server.put("m1", spec(false)).unwrap();
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

// TEST_SCENARIO: a create is counted as what it was — one operation, one start, one image the cache did not hold and one fetch — and the memory gauges read the runner as it stands, so the scrape after a boot shows the machine it booted.
#[tokio::test(flavor = "multi_thread")]
async fn a_scrape_counts_what_a_create_did() {
    let h = Harness::new("scrape");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let scrape = h.server.metrics_text();
    for line in [
        "platform_vm_runner_machine_operation_duration_seconds_count{op=\"create\",outcome=\"ok\"} 1",
        "platform_vm_runner_machine_start_duration_seconds_count{op=\"create\",outcome=\"ok\"} 1",
        "platform_vm_runner_image_cache_lookups_total{result=\"miss\"} 1",
        "platform_vm_runner_image_fetch_duration_seconds_count{outcome=\"ok\"} 1",
        "platform_vm_runner_memory_committed_mib 2048",
    ] {
        assert!(scrape.lines().any(|l| l == line), "missing {line}\n{scrape}");
    }
    assert!(
        !scrape.contains("m1") && !scrape.contains("quay.io"),
        "{scrape}"
    );
}

// UNIT_BOUNDARY_DESCRIPTION: the node image cache service in this test's process, serving the harness's image directory on the socket the runner was told, with the harness's crane. Its holds lapse in `lease`, so a test can see whether the runner renews them.
async fn node_service(h: &Harness, lease: Duration) -> (Arc<ImageCache>, CancellationToken) {
    let cache = Arc::new(ImageCache::open(CacheConfig {
        dir: h.dir.join("images"),
        budget: 1,
        crane: h.dir.join("crane").to_string_lossy().into_owned(),
        pins: Vec::new(),
        lifetime: CancellationToken::new(),
        check_access: true,
        ref_fresh: Duration::from_secs(600),
        hold_lease: lease,
        hold_grace: Duration::ZERO,
        fetch_ceiling: None,
    }));
    let socket = h.dir.join("images/.cache.sock");
    let stop = CancellationToken::new();
    tokio::spawn({
        let (cache, stop, socket) = (cache.clone(), stop.clone(), socket.clone());
        async move { cacheapi::serve(&socket, cache, async move { stop.cancelled().await }).await }
    });
    while !socket.exists() {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    (cache, stop)
}

fn on_node_cache(c: &mut Config) {
    c.image_cache_socket = Some(c.image_dir.join(".cache.sock"));
    c.crane = String::new();
}

// TEST_SCENARIO: on a node cache the runner fetches nothing itself: it asks the node's service, which unpacks the image into the shared directory, and the machine boots that tree through the runner's own mount of it. The runner then holds the digest, so the service's eviction spares the tree for as long as the runner keeps renewing the hold — past the lease the resolve itself took.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_on_a_node_cache_boots_the_tree_the_service_unpacked() {
    let h = Harness::with("node-cache", on_node_cache);
    let (service, _stop) = node_service(&h, Duration::from_millis(300)).await;
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let (image, launch) = locked(&h.fake.created).get("m1").cloned().unwrap();
    assert_eq!(PathBuf::from(image), h.entry("m1").join(ROOTFS_DIR));
    assert!(h.entry("m1").join(ROOTFS_DIR).join("hello").exists());
    assert_eq!(launch.entrypoint, vec!["/entry"]);
    assert_eq!(h.crane_log("export"), 1, "the service fetched it once");

    tokio::time::sleep(Duration::from_millis(400)).await;
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.hold_images())
        .await
        .unwrap();
    service.evict(None);
    assert!(
        h.entry("m1").exists(),
        "the service evicted a tree the runner holds"
    );
}

// TEST_SCENARIO: with the node's service down, a new image cannot be resolved, checked or fetched, so a machine of it is refused as an image problem that says why, and nothing is booted straight from the registry. A machine of an image another of this runner's machines already boots still starts, from the tree that machine holds, which is only read.
#[tokio::test(flavor = "multi_thread")]
async fn a_node_cache_that_cannot_be_reached_boots_only_what_the_runner_holds() {
    let h = Harness::with("node-cache-down", on_node_cache);
    let (_service, stop) = node_service(&h, HOLD_LEASE).await;
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    stop.cancel();
    while tokio::net::UnixStream::connect(h.dir.join("images/.cache.sock"))
        .await
        .is_ok()
    {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }

    h.server.put("m2", spec(true)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_RUNNING);
    assert_eq!(h.entry("m2"), h.entry("m1"));

    h.server.delete("m2").unwrap();
    let mut other = spec(true);
    other.image = "quay.io/x/other:1".into();
    h.server.put("m3", other).unwrap();
    let refused = h.settle("m3").await;
    assert_eq!(refused.reason, REASON_IMAGE_UNAVAILABLE, "{refused:?}");
    assert!(refused.message.contains("cannot be reached"), "{refused:?}");
    assert!(!locked(&h.fake.created).contains_key("m3"));
}
