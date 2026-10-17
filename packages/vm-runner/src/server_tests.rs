use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use super::*;
use crate::api::{
    REASON_BOOT_FAILED, REASON_HOME_FULL, REASON_IMAGE_UNAVAILABLE, REASON_SEED_MISSING,
    REASON_STORAGE_FULL, STATE_ABSENT, STATE_CREATING, STATE_RESTARTING, STATE_RUNNING,
    STATE_STARTING, STATE_STOPPED, STATE_STOPPING,
};
use crate::cache::{archive_path, digest_path, staged_path, PARTIAL_PREFIX};
use crate::cacheapi;
use crate::forward::HEALTH_TIMEOUT;
use crate::imagecache::{CacheConfig, ImageCache};
use crate::launch::{ImageLaunch, LAUNCH_FILE};
use crate::plan::{READY_GRACE, STALLED_RESTART, UNHEALTHY_RESTART};
use crate::state::RUNTIME_FILE;
use crate::storage::StorageUse;
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
    delete_delay: Mutex<Duration>,
    fail_start_once: Mutex<Option<String>>,
    fail_grow_once: Mutex<Option<String>>,
    booted_mib: Mutex<Vec<i32>>,
    start_sizes: Mutex<Vec<i32>>,
    console: Mutex<String>,
    panic_on_state: AtomicBool,
    nests: AtomicBool,
    state_fails_until_start: Mutex<HashSet<String>>,
    resident: Mutex<Option<i32>>,
    cpu: Mutex<Option<u64>>,
    state_reads: AtomicUsize,
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
    fn resident_mib(&self, _id: &str) -> Option<i32> {
        *locked(&self.resident)
    }

    fn cpu_usec(&self, _id: &str) -> Option<u64> {
        *locked(&self.cpu)
    }

    fn nests(&self) -> bool {
        self.nests.load(Ordering::SeqCst)
    }

    fn state(&self, id: &str) -> anyhow::Result<State> {
        assert!(
            !self.panic_on_state.load(Ordering::SeqCst),
            "the fake was told to panic"
        );
        self.state_reads.fetch_add(1, Ordering::SeqCst);
        if locked(&self.state_fails_until_start).contains(id) {
            anyhow::bail!("the runtime cannot read the machine's record");
        }
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

    fn start(&self, id: &str, boot_mib: i32, memory_mib: i32) -> anyhow::Result<()> {
        self.record(format!("start {id}"));
        locked(&self.booted_mib).push(boot_mib);
        locked(&self.start_sizes).push(memory_mib);
        std::thread::sleep(*locked(&self.start_delay));
        if let Some(message) = locked(&self.fail_start_once).take() {
            anyhow::bail!(message);
        }
        locked(&self.state_fails_until_start).remove(id);
        locked(&self.states).insert(id.to_string(), State::Running);
        Ok(())
    }

    fn grow(&self, id: &str, memory_mib: i32) -> anyhow::Result<()> {
        self.record(format!("grow {id} {memory_mib}"));
        assert_eq!(
            locked(&self.states).get(id),
            Some(&State::Running),
            "grown before it booted"
        );
        if let Some(message) = locked(&self.fail_grow_once).take() {
            anyhow::bail!(message);
        }
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
        std::thread::sleep(*locked(&self.delete_delay));
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

// UNIT_BOUNDARY_DESCRIPTION: one server on a fake runtime, in a directory of its own. The name is short for the same reason as testdir's: the node cache's socket sits in it.
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
        let dir = std::env::temp_dir().join(format!("vmr-{}-{name}", std::process::id()));
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
            runc: None,
            ports: base..=base + 1,
            memory_mib: 1 << 20,
            reserve_mib: 0,
            headroom_mib: 0,
            boot_mib: 0,
            listen: Some(Arc::new(move |port| match locked(&held).remove(&port) {
                Some(listener) => Ok(listener),
                None => TcpListener::bind(("127.0.0.1", port)),
            })),
            runtime: None,
            cgroup_dir: None,
            measure_storage: Arc::new(|| None),
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

    // UNIT_BOUNDARY_DESCRIPTION: hands this runner's machines off and starts the next runner on the same directories, fake runtime and ports, as the loader starts a new release. `tune` sets what the next runner is given beyond that.
    async fn hand_off(&self, tune: impl FnOnce(&mut Config)) -> Harness {
        self.server.hand_off().await;
        let mut config = Config {
            state_dir: self.dir.join("machines"),
            image_dir: self.dir.join("images"),
            image_cache_socket: None,
            image_budget: 1 << 40,
            crane: self.dir.join("crane").to_string_lossy().into_owned(),
            init: Some(self.dir.join("platform-init")),
            runc: None,
            ports: self.base..=self.base + 1,
            memory_mib: 1 << 20,
            reserve_mib: 0,
            headroom_mib: 0,
            boot_mib: 0,
            listen: Some(retrying_listen()),
            runtime: None,
            cgroup_dir: None,
            measure_storage: Arc::new(|| None),
        };
        tune(&mut config);
        Harness {
            dir: self.dir.clone(),
            fake: self.fake.clone(),
            server: Server::start(config, self.fake.clone()).unwrap(),
            base: self.base,
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

    // UNIT_BOUNDARY_DESCRIPTION: waits on the machine's status version, as the controller does, until the status satisfies `done`. The deadline is long because a boot runs the fake crane several times, and on a loaded Mac each run of a fresh script takes up to a second; only a failing test waits it out.
    async fn until(
        &self,
        id: &str,
        what: &str,
        done: impl Fn(&MachineStatus) -> bool,
    ) -> MachineStatus {
        let deadline = Instant::now() + Duration::from_secs(30);
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

    // UNIT_BOUNDARY_DESCRIPTION: waits until the runtime has been called with `call`, so a test can act while that call is still running. Its deadline is as long as `until`'s, for the same reason.
    async fn wait_for_call(&self, call: &str) {
        let deadline = Instant::now() + Duration::from_secs(30);
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
        gateway_host_port: 0,
        guest_resolver: String::new(),
        revision: "r1".into(),
        running,
        pull_auths: Vec::new(),
        migration: None,
        expect_seed: None,
        nested_virtualization: false,
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

// TEST_SCENARIO: a guest's boot costs time for every GiB of RAM it boots with, so a machine boots with the runner's boot estimate and is grown to its spec's size as soon as its start returns, on every boot: the first, and one after a stop, whose record the update set back to the spec. The grow is part of the start, so the action ends only once the machine has its size. Every start is also told that size, so a runtime that knows the boot cannot grow (a disk conversion) boots at it.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_boots_small_and_is_grown_to_its_size_on_every_boot() {
    let h = Harness::with("boot-small", |c| c.boot_mib = 1024);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", spec(true)).unwrap();
    let again = h.settle("m1").await;
    assert_eq!(again.state, STATE_RUNNING);
    assert!(again.reason.is_empty(), "{again:?}");
    assert_eq!(
        h.fake.calls(),
        vec![
            "create m1",
            "start m1",
            "grow m1 2048",
            "stop m1",
            "update m1",
            "start m1",
            "grow m1 2048"
        ]
    );
    assert_eq!(*locked(&h.fake.booted_mib), vec![1024, 1024]);
    assert_eq!(*locked(&h.fake.start_sizes), vec![2048, 2048]);
}

// TEST_SCENARIO: a machine no larger than the boot estimate boots whole and is never grown, and so is every machine of a runner given no estimate.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_within_the_boot_estimate_boots_whole() {
    for (name, boot_mib) in [("boot-whole-larger", 4096), ("boot-whole-none", 0)] {
        let h = Harness::with(name, |c| c.boot_mib = boot_mib);
        h.server.put("m1", spec(true)).unwrap();
        assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
        assert_eq!(h.fake.calls(), vec!["create m1", "start m1"], "{name}");
        assert_eq!(*locked(&h.fake.booted_mib), vec![2048], "{name}");
    }
}

// TEST_SCENARIO: a guest that cannot grow would run with a fraction of the memory its spec and its agent count on. So a machine whose guest has not answered yet is stopped and booted again whole, in the same start, and reads running with no failure: the grow is an optimisation, never a reason for the agent not to run. The runner remembers that the machine cannot grow, so its next start boots it whole and does not pay for a small boot and a failed grow again.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_that_cannot_grow_is_booted_again_whole() {
    let h = Harness::with("grow-failed", |c| c.boot_mib = 1024);
    *locked(&h.fake.fail_grow_once) = Some("the VMM did not add the RAM".into());
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.state, STATE_RUNNING);
    assert!(status.reason.is_empty(), "{status:?}");
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.calls(),
        vec![
            "create m1",
            "start m1",
            "grow m1 2048",
            "stop m1",
            "start m1",
            "stop m1",
            "update m1",
            "start m1"
        ]
    );
    assert_eq!(*locked(&h.fake.booted_mib), vec![1024, 2048, 2048]);
}

// TEST_SCENARIO: readiness does not wait for the grow, so a guest can answer, and the agent read ready, before its grow fails. A reboot then would make the agent flap and lose a prompt sent to it. So the guest is left running at its boot size, and its next start boots it whole.
#[tokio::test(flavor = "multi_thread")]
async fn a_guest_that_answered_is_not_rebooted_when_it_cannot_grow() {
    let h = Harness::with("grow-failed-answered", |c| c.boot_mib = 1024);
    *locked(&h.fake.fail_grow_once) = Some("the VMM did not add the RAM".into());
    let _guest = guest(h.base);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(
        h.fake.calls(),
        vec!["create m1", "start m1", "grow m1 2048"]
    );
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(*locked(&h.fake.booted_mib), vec![1024, 2048]);
}

// TEST_SCENARIO: booting small changes nothing admission counts. A machine on its way up is counted at the boot estimate, as it was when it booted whole, and its spec's size stays its cap: two machines whose estimates fit are admitted while the first still boots, and a third is refused.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_booting_small_is_admitted_as_before() {
    let h = Harness::with("boot-small-capacity", |c| {
        c.memory_mib = 2500;
        c.boot_mib = 1024;
    });
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    assert_eq!(
        h.server.put("m2", spec(true)).unwrap().state,
        STATE_CREATING
    );
    let refused = h.server.put("m3", spec(true)).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");
    h.settle("m1").await;
    h.settle("m2").await;
}

// TEST_SCENARIO: an agent moving to this backend brings its home as a seed, which platform-init reads only on the first boot. So the controller creates its machine stopped: a stopped spec with a whole shape creates the machine, its share, spec and port, and never starts it. Only the ensure that asks for it running boots it, onto the same machine.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_can_be_created_without_being_booted() {
    let h = Harness::new("create-stopped");
    h.server.put("m1", spec(false)).unwrap();
    let parked = h.settle("m1").await;
    assert_eq!(parked.state, STATE_STOPPED, "{parked:?}");
    assert_eq!(h.fake.calls(), vec!["create m1"]);
    assert!(read_spec(&h.dir.join("machines"), "m1").is_some());

    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert_eq!(h.fake.calls(), vec!["create m1", "update m1", "start m1"]);
}

// TEST_SCENARIO: the migration's whole sequence on the runner: a machine created stopped takes a seed into its share, and the ensure that then boots it rewrites the share without removing the seed, because that boot is the one that reads it.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_uploaded_to_a_stopped_machine_is_still_there_when_it_boots() {
    let h = Harness::new("seed-boot");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;

    let mut seeding = h.server.claim_seed("m1", None).unwrap();
    seeding.write(b"a home").unwrap();
    let result = seeding.commit().unwrap();
    assert_eq!(result.bytes, 6);

    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let seed = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::SEED_FILE);
    assert_eq!(fs::read(seed).unwrap(), b"a home");
}

// TEST_SCENARIO: a seed stays on the owner's claim until the move finishes and its restore writes as much again onto the same claim, so an upload that started with room stops, as storage full and before anything more is written, once what it wrote would take the claim past the critical level after the restore; checking only at the start let a large home fill the claim under every other agent.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_whose_restore_would_fill_the_claim_stops_as_storage_full() {
    let (h, claim) = with_claim("seed-room");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    *locked(&claim) = Some(StorageUse {
        used: (90 << 30) - (32 << 20),
        usable: 100 << 30,
    });
    let mut seeding = h.server.claim_seed("m1", None).unwrap();
    seeding.write(b"a").unwrap();
    let refused = seeding.write(&vec![0; 64 << 20]).unwrap_err();
    assert_eq!(refused.status, 507, "{}", refused.message);
    assert!(
        refused.message.contains("twice the home's size"),
        "{}",
        refused.message
    );
}

// TEST_SCENARIO: a machine with an action in flight may be about to boot, so a seed claimed then could be read half-written; it is refused, as is a second upload to a machine that already has one running. And while a seed is being uploaded, an ensure that asks for the machine running is stored but boots nothing until the upload is done; the next ensure boots it.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_and_a_boot_never_overlap() {
    let h = Harness::new("seed-overlap");
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(
        h.server.claim_seed("m1", None).err().map(|e| e.status),
        Some(409),
        "a seed was claimed while the machine was starting"
    );
    h.settle("m1").await;
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);

    let seeding = h.server.claim_seed("m1", None).unwrap();
    assert_eq!(
        h.server.claim_seed("m1", None).err().map(|e| e.status),
        Some(409)
    );
    let calls = h.fake.calls().len();
    h.server.put("m1", spec(true)).unwrap();
    assert!(!h.server.converging("m1"), "a boot started mid-upload");
    assert_eq!(h.fake.calls().len(), calls);
    drop(seeding);

    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: a machine deleted while its seed is uploaded must not have the seed put back into a directory that is gone, or recreated by the rename; the upload's commit is refused instead.
#[tokio::test(flavor = "multi_thread")]
async fn a_seed_for_a_machine_deleted_mid_upload_is_not_committed() {
    let h = Harness::new("seed-deleted");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    let mut seeding = h.server.claim_seed("m1", None).unwrap();
    seeding.write(b"half").unwrap();
    h.server.delete("m1").unwrap();

    assert_eq!(seeding.commit().err().map(|e| e.status), Some(409));
    assert!(!h.dir.join("machines/m1").exists());
}

fn expecting(running: bool, seed: &SeedResult) -> MachineSpec {
    MachineSpec {
        expect_seed: Some(seed.clone()),
        ..spec(running)
    }
}

fn upload(h: &Harness, id: &str, body: &[u8]) -> SeedResult {
    let mut seeding = h.server.claim_seed(id, None).unwrap();
    seeding.write(body).unwrap();
    seeding.commit().unwrap()
}

// TEST_SCENARIO: a migration's seed can go missing between the upload and the boot — a lost runner claim, a crash, an operator. A machine whose spec expects a seed is then not started at all, under a reason of its own, so the controller copies the home again instead of the guest booting the image's home and the migration being taken for done. The same holds for a seed that is not the one expected.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_that_expects_a_seed_it_does_not_hold_is_not_started() {
    let h = Harness::new("seed-missing");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    let seed = SeedResult {
        bytes: 6,
        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
    };

    h.server.put("m1", expecting(true, &seed)).unwrap();
    let refused = h.settle("m1").await;
    assert_eq!(refused.state, STATE_STOPPED, "{refused:?}");
    assert_eq!(refused.reason, REASON_SEED_MISSING, "{refused:?}");
    assert!(refused.message.contains(&seed.sha256), "{refused:?}");
    assert!(!h.fake.calls().iter().any(|c| c == "start m1"));

    let other = upload(&h, "m1", b"a home");
    assert_ne!(other.sha256, seed.sha256);
    h.server.put("m1", expecting(true, &seed)).unwrap();
    let refused = h.settle("m1").await;
    assert_eq!(refused.reason, REASON_SEED_MISSING, "{refused:?}");
    assert!(refused.message.contains(&other.sha256), "{refused:?}");
    assert!(!h.fake.calls().iter().any(|c| c == "start m1"));

    h.server.remove_seed("m1").unwrap();
    assert!(!h
        .dir
        .join("machines/m1")
        .join(share::SEED_DIGEST_FILE)
        .exists());
}

// TEST_SCENARIO: the seed the machine expects is the one it holds, so it boots with the expectation in its share for platform-init to enforce. Once its guest answers, the status names that seed as the one the home came from — the signal the controller ends the migration on — and it keeps naming it after the controller stops expecting a seed and removes it, without the guest being restarted for either.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_booted_from_its_expected_seed_reports_the_seed_its_home_came_from() {
    let h = Harness::new("seed-reported");
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    let seed = upload(&h, "m1", b"a home");
    let share = h.dir.join("machines/m1").join(SHARE_DIR);

    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", expecting(true, &seed)).unwrap();
    h.wait_for_call("start m1").await;
    assert_eq!(
        crate::guest::SeedDigest::parse(
            &fs::read_to_string(share.join(share::SEED_EXPECTED_FILE)).unwrap()
        )
        .map(|d| d.sha256),
        Some(seed.sha256.clone()),
        "platform-init is not told which seed to expect"
    );
    let _guest = guest(h.base);
    let up = h.until("m1", "ready", |s| s.ready).await;
    assert_eq!(up.home_seeded_from, seed.sha256);

    h.server.remove_seed("m1").unwrap();
    h.server.put("m1", spec(true)).unwrap();
    let after = h.settle("m1").await;
    assert_eq!(after.home_seeded_from, seed.sha256);
    assert_eq!(
        h.fake.calls().iter().filter(|c| *c == "start m1").count(),
        1,
        "the end of the migration restarted the guest"
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

// TEST_SCENARIO: a new revision restarts the running machine in place — stop, update, start — keeping its disk. A spec that has not changed does nothing at all.
#[tokio::test(flavor = "multi_thread")]
async fn a_changed_shape_restarts_the_machine_in_place() {
    let h = Harness::new("reshape");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let _guest = guest(h.base);
    h.until("m1", "ready", |s| s.ready).await;
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

// TEST_SCENARIO: a new size reaches a running machine only when it next starts. Until then the status reports the size the guest runs at and admission counts that one, so a second machine that fits beside it is let in; the start that applies the new size is admitted against it, and refused when it no longer fits. A restart asked for anything else applies it too.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_size_is_applied_at_the_next_start_and_not_before() {
    let h = Harness::with("resize-on-start", |c| c.memory_mib = 5000);
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let resized = MachineSpec {
        cpus: 4,
        memory_mib: 4096,
        ..spec(true)
    };
    let live = h.server.put("m1", resized.clone()).unwrap();
    assert_eq!(live.state, STATE_RUNNING);
    assert_eq!((live.cpus, live.memory_mib), (2, 2048));
    assert_eq!(h.fake.calls(), vec!["create m1", "start m1"]);

    h.server.put("m2", spec(true)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_RUNNING);

    h.server
        .put(
            "m1",
            MachineSpec {
                running: false,
                ..resized.clone()
            },
        )
        .unwrap();
    h.settle("m1").await;
    let refused = h.server.put("m1", resized.clone()).unwrap();
    assert_eq!(refused.reason, REASON_OUT_OF_CAPACITY, "{refused:?}");

    h.server.delete("m2").unwrap();
    h.server.put("m1", resized.clone()).unwrap();
    let woken = h.settle("m1").await;
    assert_eq!(woken.state, STATE_RUNNING);
    assert_eq!((woken.cpus, woken.memory_mib), (4, 4096));

    let rolled = MachineSpec {
        cpus: 1,
        memory_mib: 1024,
        revision: "r2".into(),
        ..resized
    };
    assert_eq!(h.server.put("m1", rolled).unwrap().state, STATE_RESTARTING);
    let restarted = h.settle("m1").await;
    assert_eq!((restarted.cpus, restarted.memory_mib), (1, 1024));
}

// TEST_SCENARIO: the status says a machine nests only when its spec asks for it and its runner grants it, so the controller can tell the owner who asked whether they got it. A machine on the same runner that does not ask never reads as nested.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_reads_as_nested_only_when_it_asks_and_its_runner_nests() {
    let h = Harness::new("nested");
    h.server
        .put(
            "m1",
            MachineSpec {
                nested_virtualization: true,
                ..spec(true)
            },
        )
        .unwrap();
    h.server.put("m2", spec(true)).unwrap();
    assert!(!h.settle("m1").await.nested);
    assert!(!h.settle("m2").await.nested);

    h.fake.nests.store(true, Ordering::SeqCst);
    assert!(h.server.status("m1").nested);
    assert!(!h.server.status("m2").nested);
}

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

// TEST_SCENARIO: a disk grows and cannot shrink, so a smaller storage request is already met and does nothing. A larger one leaves the running machine alone, as a new size does, and its next start asks the runtime to grow the disk, so a larger storage pool reboots no agent.
#[tokio::test(flavor = "multi_thread")]
async fn storage_is_grown_at_the_next_start_and_never_shrunk() {
    let h = Harness::new("storage");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut smaller = spec(true);
    smaller.storage_gib = 1;
    assert_eq!(h.server.put("m1", smaller).unwrap().state, STATE_RUNNING);
    assert_eq!(h.fake.calls(), ["create m1", "start m1"]);

    let mut larger = spec(true);
    larger.storage_gib = 50;
    let live = h.server.put("m1", larger.clone()).unwrap();
    assert_eq!(live.state, STATE_RUNNING);
    assert_eq!(live.disk_gib, 5, "{live:?}");
    assert_eq!(h.fake.calls(), ["create m1", "start m1"]);

    h.server
        .put(
            "m1",
            MachineSpec {
                running: false,
                ..larger.clone()
            },
        )
        .unwrap();
    h.settle("m1").await;
    h.server.put("m1", larger).unwrap();
    let woken = h.settle("m1").await;
    assert_eq!(woken.state, STATE_RUNNING, "{woken:?}");
    assert_eq!(h.fake.last_update().storage_gib, 50);
    assert_eq!(woken.disk_gib, 50, "{woken:?}");
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

// UNIT_BOUNDARY_DESCRIPTION: binds a published port on loopback, retrying for a few seconds while the closed runner's listener lets go of it.
fn retrying_listen() -> Arc<Listen> {
    let deadline = Instant::now() + Duration::from_secs(5);
    Arc::new(move |p| loop {
        match TcpListener::bind(("127.0.0.1", p)) {
            Ok(l) => return Ok(l),
            Err(e) if Instant::now() > deadline => return Err(e),
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    })
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
            image_cache_socket: None,
            image_budget: 1 << 40,
            crane: String::new(),
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

// TEST_SCENARIO: the handful of images nearly every owner runs is fetched once per cache, not once per machine: a second machine of the same image boots the tree the first one unpacked.
#[tokio::test(flavor = "multi_thread")]
async fn an_image_is_fetched_once_for_every_machine_that_wants_it() {
    let h = Harness::new("fetch-once");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let after_first = h.crane_calls();
    assert_eq!(
        after_first, 4,
        "one resolution, one config read, one manifest read and one export"
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

// TEST_SCENARIO: an install with no registry once staged `docker save` archives in the image directory, and nothing boots one any more: smolvm flattens an archive inside the guest, which no guest does since platform-init became its init. An archive left there by hand is refused as an image problem whose message says how to restage it, rather than booted into a guest that never starts its agent, and the registry is not asked instead.
#[tokio::test(flavor = "multi_thread")]
async fn a_staged_archive_is_refused_with_how_to_restage_it() {
    let h = Harness::new("archive");
    fs::write(
        h.dir.join("crane"),
        "#!/bin/sh\necho unreachable >&2\nexit 1\n",
    )
    .unwrap();
    let images = h.dir.join("images");
    fs::create_dir_all(&images).unwrap();
    fs::write(
        archive_path(&images, "quay.io/x/vm:1"),
        b"a docker save archive",
    )
    .unwrap();
    h.server.put("m1", spec(true)).unwrap();
    let status = h.settle("m1").await;
    assert_eq!(status.reason, REASON_IMAGE_UNAVAILABLE, "{status:?}");
    assert!(
        status.message.contains("mise run image:stage-vm"),
        "{status:?}"
    );
    assert!(h.fake.calls().is_empty());
    assert_eq!(h.crane_calls(), 0);
}

// TEST_SCENARIO: an install stages an image as a tree with its launch record beside it (image:stage-vm), and the machine boots the tree in place. An archive left under the same name by an earlier install does not refuse the tree.
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
    fs::write(
        archive_path(&images, "quay.io/x/vm:1"),
        b"a docker save archive",
    )
    .unwrap();
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

// TEST_SCENARIO: a spec sent after close starts no worker and holds no memory, so nothing counts a machine that never started. It is answered 503, not 200: it was not stored, and the controller must not read it as taken.
#[tokio::test(flavor = "multi_thread")]
async fn no_action_starts_after_close() {
    let h = Harness::new("after-close");
    h.server.close().await;
    let refused = h.server.put("m1", spec(true)).unwrap_err();
    assert_eq!(
        refused.status, 503,
        "a spec that was not stored was answered as taken"
    );
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

// UNIT_BOUNDARY_DESCRIPTION: marks the machine quiet for just longer than STALLED_RESTART, as a guest that stopped answering that long ago looks.
fn stall(h: &Harness, id: &str) {
    h.machine(id, |m| {
        m.health.quiet_since = Some(SystemTime::now() - STALLED_RESTART - Duration::from_secs(1))
    });
}

// UNIT_BOUNDARY_DESCRIPTION: a guest on the machine's port again, once the one stopped before it has let the port go.
async fn guest_again(h: &Harness) -> Arc<AtomicBool> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while TcpListener::bind(("127.0.0.1", h.base + LOOPBACK_OFFSET)).is_err() {
        assert!(Instant::now() < deadline, "the old guest kept its port");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    guest(h.base)
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
            .any(|l| l.starts_with(&format!("export quay.io/x/vm@{digest} - "))),
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

// TEST_SCENARIO: a cached private tree is named by its digest, and the staged-image lookup turns a reference into a file name before the cache checks any credential. A machine with no credential that names the digest as a bare reference, in any spelling that maps onto the entry's name, is refused, and never boots the tree another machine fetched with its credential.
#[tokio::test(flavor = "multi_thread")]
async fn a_bare_digest_reference_cannot_boot_a_cached_private_tree() {
    let h = Harness::new("bare-digest");
    fs::write(h.dir.join("crane"), PRIVATE_CRANE).unwrap();
    h.server.put("m1", with_credential(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    let hex = "f".repeat(64);
    for (id, image) in [
        ("m2", format!("sha256:{hex}")),
        ("m3", format!("sha256_{hex}")),
        ("m4", format!("SHA256@{hex}")),
        ("m5", format!("sha256/{hex}")),
    ] {
        let bare = MachineSpec {
            image: image.clone(),
            ..spec(true)
        };
        assert_eq!(h.server.put(id, bare).unwrap_err().status, 400, "{image}");
        assert!(!locked(&h.fake.created).contains_key(id), "{image} booted");
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
    let served = tokio::spawn({
        let (cache, stop, socket) = (cache.clone(), stop.clone(), socket.clone());
        async move { cacheapi::serve(&socket, cache, async move { stop.cancelled().await }).await }
    });
    while !socket.exists() {
        if served.is_finished() {
            panic!("the node's service did not start: {:?}", served.await);
        }
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

// TEST_SCENARIO: a hibernated agent's machine must not keep its tree on the node cache, or every deploy would leave one retired image per stopped machine held until the service refuses every fetch. Once the machine is stopped the runner holds nothing for it, the service evicts the tree, and the next start fetches it again and boots.
#[tokio::test(flavor = "multi_thread")]
async fn a_stopped_machine_holds_nothing_and_fetches_its_tree_again_on_start() {
    let h = Harness::with("nc-stop", on_node_cache);
    let (service, _stop) = node_service(&h, Duration::from_millis(300)).await;
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    h.server.put("m1", spec(false)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_STOPPED);

    tokio::time::sleep(Duration::from_millis(400)).await;
    let server = h.server.clone();
    tokio::task::spawn_blocking(move || server.hold_images())
        .await
        .unwrap();
    service.evict(None);
    assert!(
        !h.entry("m1").exists(),
        "a stopped machine kept its tree held"
    );

    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    assert!(h.entry("m1").join(ROOTFS_DIR).join("hello").exists());
    assert_eq!(h.crane_log("export"), 2, "the start fetched the tree again");
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

// UNIT_BOUNDARY_DESCRIPTION: a crane whose layer fetch never ends, as a pull of a huge image over a slow registry does.
fn stall_fetches(h: &Harness) {
    fs::write(
        h.dir.join("crane"),
        "#!/bin/sh\nif [ \"$1\" = config ]; then printf '{\"config\":{\"Cmd\":[\"x\"]}}'; exit 0; fi\nsleep 60\n",
    )
    .unwrap();
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
            image_cache_socket: None,
            image_budget: 1 << 40,
            crane: String::new(),
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
                image_cache_socket: None,
                image_budget: 1 << 40,
                crane: h.dir.join("crane").to_string_lossy().into_owned(),
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

// UNIT_BOUNDARY_DESCRIPTION: a runner over a claim whose use the test sets, starting at nothing measured.
fn with_claim(name: &str) -> (Harness, Arc<Mutex<Option<StorageUse>>>) {
    let claim: Arc<Mutex<Option<StorageUse>>> = Arc::default();
    let measured = claim.clone();
    let h = Harness::with(name, move |c| {
        c.measure_storage = Arc::new(move || *locked(&measured));
    });
    (h, claim)
}

fn filled(percent: u64) -> Option<StorageUse> {
    Some(StorageUse {
        used: percent << 30,
        usable: 100 << 30,
    })
}

// TEST_SCENARIO: once the owner's claim is critically full, every write that adds much is refused with the reason the controller shows as full storage, and nothing is created for it: a create, an image fetched onto the claim and a seed upload alike. A machine that already exists still starts and restarts, so an owner whose agents are all asleep can get into one to clean it up, but at the disk size it has: a larger size waits for a start that finds room. A running machine whose spec asks for nothing new keeps running untouched.
#[tokio::test(flavor = "multi_thread")]
async fn a_critical_claim_refuses_big_writes_and_still_starts_existing_machines() {
    let (h, claim) = with_claim("storage-critical");
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    h.server.put("m2", spec(false)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_STOPPED);
    let before = h.fake.calls();

    *locked(&claim) = filled(92);
    let created = h.server.put("m3", spec(true)).unwrap();
    assert_eq!(created.reason, REASON_STORAGE_FULL, "{created:?}");
    assert!(
        created.message.contains("used 92.0 of 100.0 GiB"),
        "{created:?}"
    );
    assert!(
        created.message.contains("can still be started"),
        "{created:?}"
    );
    assert!(read_spec(&h.dir.join("machines"), "m3").is_none());
    let mut new_image = spec(true);
    new_image.image = "quay.io/x/vm:2".into();
    let fetch = h.server.put("m1", new_image).unwrap();
    assert_eq!(fetch.reason, REASON_STORAGE_FULL, "{fetch:?}");
    assert_eq!(
        h.server.claim_seed("m2", None).err().map(|e| e.status),
        Some(507)
    );
    let steady = h.server.put("m1", spec(true)).unwrap();
    assert_eq!(
        (steady.state.as_str(), steady.reason.as_str()),
        (STATE_RUNNING, "")
    );
    assert_eq!(h.fake.calls(), before, "nothing reached the runtime");

    let mut grown = spec(true);
    grown.storage_gib = 50;
    assert_eq!(h.server.put("m2", grown).unwrap().state, STATE_STARTING);
    let started = h.settle("m2").await;
    assert_eq!(
        (started.state.as_str(), started.disk_gib),
        (STATE_RUNNING, 5)
    );
    let mut changed = spec(true);
    changed.revision = "r2".into();
    h.server.put("m1", changed).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: once the claim is nearly full, no machine starts or restarts either, since even a boot's few writes could fail every guest's; a running machine that asks for nothing new still keeps running, and once room is freed the same start goes through.
#[tokio::test(flavor = "multi_thread")]
async fn a_nearly_full_claim_refuses_every_boot_and_leaves_running_machines_alone() {
    let (h, claim) = with_claim("storage-nearly-full");
    h.server.put("m1", spec(true)).unwrap();
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);
    h.server.put("m2", spec(false)).unwrap();
    assert_eq!(h.settle("m2").await.state, STATE_STOPPED);
    let before = h.fake.calls();

    *locked(&claim) = filled(97);
    let started = h.server.put("m2", spec(true)).unwrap();
    assert_eq!(started.reason, REASON_STORAGE_FULL, "{started:?}");
    assert!(started.message.contains("can't be started"), "{started:?}");
    let mut changed = spec(true);
    changed.revision = "r2".into();
    let restarted = h.server.put("m1", changed).unwrap();
    assert_eq!(restarted.reason, REASON_STORAGE_FULL, "{restarted:?}");
    let steady = h.server.put("m1", spec(true)).unwrap();
    assert_eq!(
        (steady.state.as_str(), steady.reason.as_str()),
        (STATE_RUNNING, "")
    );
    assert_eq!(h.fake.calls(), before, "nothing reached the runtime");
    assert_eq!(h.settle("m1").await.state, STATE_RUNNING);

    *locked(&claim) = filled(50);
    assert_eq!(
        h.server.put("m2", spec(true)).unwrap().state,
        STATE_STARTING
    );
    assert_eq!(h.settle("m2").await.state, STATE_RUNNING);
}

// TEST_SCENARIO: a guest whose writes fail on a full claim makes its boot fail with nothing typed in the error, so a failed boot on a critical claim is reported as the owner's storage being full, with the console it left, rather than as a boot to retry.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_that_fails_on_a_critical_claim_reports_full_storage() {
    let (h, claim) = with_claim("storage-boot");
    *locked(&h.fake.start_delay) = Duration::from_millis(200);
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    *locked(&h.fake.console) = "EXT4-fs (vda): failed to convert unwritten extents".into();
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    *locked(&claim) = filled(95);
    let failed = h.settle("m1").await;
    assert_eq!(failed.reason, REASON_STORAGE_FULL, "{failed:?}");
    assert!(
        failed.message.contains("used 95.0 of 100.0 GiB"),
        "{failed:?}"
    );
    assert!(failed.message.contains("EXT4-fs (vda)"), "{failed:?}");
}

// TEST_SCENARIO: a guest sees its own disk as free while the claim under it fills, so the runner marks every machine's share while the claim is short, and keeps the mark until use is back under the lower threshold, so a claim hovering on the line does not mark and unmark at every look.
#[tokio::test(flavor = "multi_thread")]
async fn a_short_claim_marks_every_share_until_it_has_room_again() {
    let (h, claim) = with_claim("storage-short");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mark = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::STORAGE_SHORT_FILE);
    for (percent, marked) in [(74, false), (80, true), (72, true), (65, false)] {
        *locked(&claim) = filled(percent);
        h.server.check_storage();
        assert_eq!(mark.exists(), marked, "at {percent}%");
    }
}

// TEST_SCENARIO: a guest's disk is sized at the whole claim, so the runner grants every machine's guest, at each look, its part of what is left below 95% of the claim, with an id new at every look so the guest counts its writes from the latest grant; a claim that cannot be measured grants nothing, so no guest is held to a grant nobody renews.
#[tokio::test(flavor = "multi_thread")]
async fn every_look_grants_each_guest_its_room_on_the_claim() {
    let (h, claim) = with_claim("storage-room");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let grant = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::STORAGE_ROOM_FILE);
    *locked(&claim) = filled(55);
    h.server.check_storage();
    let first = std::fs::read_to_string(&grant).unwrap();
    assert_eq!(
        first.split_whitespace().nth(1),
        Some((40u64 << 30).to_string().as_str()),
        "{first}"
    );
    h.server.check_storage();
    assert_ne!(std::fs::read_to_string(&grant).unwrap(), first);
    *locked(&claim) = None;
    h.server.check_storage();
    assert!(!grant.exists());
}

// TEST_SCENARIO: a guest serves each request to give back scratch once, and only a running guest frees anything, so the shortage is split among the running machines alone. The runner keeps the same request while the claim stays short at about the same use, and sends a new one, with a new id and its part of the new shortage, only once the claim has filled RESHED_STEP_PERCENT further; a claim that has room again clears it, and the next shortage is a new request.
#[tokio::test(flavor = "multi_thread")]
async fn a_short_claim_asks_again_only_when_it_fills_further() {
    let (h, claim) = with_claim("storage-reshed");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    h.server.put("m2", spec(false)).unwrap();
    h.settle("m2").await;
    let mark = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::STORAGE_SHORT_FILE);
    let request = |percent| {
        *locked(&claim) = filled(percent);
        h.server.check_storage();
        std::fs::read_to_string(&mark).ok()
    };
    let first = request(80).expect("a short claim asks");
    let bytes = |text: &str| {
        text.split_whitespace()
            .nth(1)
            .unwrap()
            .parse::<u64>()
            .unwrap()
    };
    assert_eq!(
        bytes(&first),
        10 << 30,
        "the running machine is asked for the whole shortage: {first}"
    );
    assert_eq!(
        request(82).as_deref(),
        Some(first.as_str()),
        "a small rise asks nothing new"
    );
    let second = request(85).expect("still short");
    assert_ne!(second, first, "a claim that filled further asks again");
    assert!(bytes(&second) > bytes(&first), "{second} {first}");
    assert_eq!(request(65), None);
    assert_ne!(request(80).as_deref(), Some(first.as_str()));
}

// TEST_SCENARIO: a guest whose own disk filled has an agent that exits as it starts, which on its own reads as a boot that failed. platform-init marks that exit on the console, and the runner reports it as a full home, which the controller shows as the full home volume a container agent reports.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_whose_console_shows_a_full_home_reports_it() {
    let h = Harness::new("home-full");
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    *locked(&h.fake.console) = "[ 2.0] platform-init: the image entrypoint exited with status 1 after 1s; the agent's home is full".into();
    h.server.put("m1", spec(true)).unwrap();
    let failed = h.settle("m1").await;
    assert_eq!(failed.reason, REASON_HOME_FULL, "{failed:?}");
    assert!(
        failed.message.contains("This agent's storage is full"),
        "{failed:?}"
    );
}

// TEST_SCENARIO: a user whose storage is short is told what fills it, so the usage read names, beside each machine's disk, what the runner's own image cache and a migration's seed take of the claim.
#[tokio::test(flavor = "multi_thread")]
async fn the_usage_read_names_the_image_cache_and_the_seeds() {
    let h = Harness::new("usage-parts");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let seed = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::SEED_FILE);
    fs::write(&seed, vec![1u8; 1 << 20]).unwrap();
    let storage = h.server.usage().unwrap().storage;
    assert!(storage.seed_bytes >= 1 << 20, "{storage:?}");
    assert!(storage.image_cache_bytes > 0, "{storage:?}");
}

// TEST_SCENARIO: the disk check at boot refuses to mount a disk it could not repair, which fails the boot with nothing typed in the error. The runner reads the refusal off the console and reports the damaged home with the way out, so the owner is not told only that the machine did not boot.
#[tokio::test(flavor = "multi_thread")]
async fn a_boot_the_disk_check_refused_reports_a_damaged_home() {
    let h = Harness::new("home-damaged");
    *locked(&h.fake.fail_start_once) = Some("start machine: guest agent never became ready".into());
    *locked(&h.fake.console) = r#"{"level":"ERROR","message":"storage: e2fsck -f -y -D Damaged (exit Some(4)): errors left; refusing to mount, and the disk is kept as it is","target":"smolvm_agent::boot"}"#.into();
    h.server.put("m1", spec(true)).unwrap();
    let failed = h.settle("m1").await;
    assert_eq!(failed.reason, REASON_HOME_DAMAGED, "{failed:?}");
    assert!(failed.message.contains("could not repair"), "{failed:?}");
}

// TEST_SCENARIO: a boot whose disk check repaired the filesystem comes up as usual, and the status says what was repaired, so the owner learns that files may be gone; the record outlives the boot it came from only until the next boot answers from a clean disk.
#[tokio::test(flavor = "multi_thread")]
async fn a_repair_at_boot_is_reported_until_a_clean_boot() {
    let h = Harness::new("home-repaired");
    *locked(&h.fake.console) = r#"{"level":"WARN","message":"storage: e2fsck -p repaired the filesystem: /dev/vda: 12/65536 files","target":"smolvm_agent::boot"}"#.into();
    *locked(&h.fake.start_delay) = Duration::from_millis(300);
    h.server.put("m1", spec(true)).unwrap();
    h.wait_for_call("start m1").await;
    let _up = guest(h.base);
    let ready = h.until("m1", "ready", |s| s.ready).await;
    assert_eq!(
        ready.home_repaired,
        "storage: e2fsck -p repaired the filesystem: /dev/vda: 12/65536 files"
    );
    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    *locked(&h.fake.console) = "clean".into();
    h.server.put("m1", spec(true)).unwrap();
    let again = h
        .until("m1", "ready after a clean boot", |s| {
            s.ready && s.home_repaired.is_empty()
        })
        .await;
    assert!(again.ready);
}

// TEST_SCENARIO: a machine's CPU share is what it used over its last two looks while running. Once it stops, the usage read reports no CPU for it, so the bars never name a paused agent among the heaviest CPU users.
#[tokio::test]
async fn a_stopped_machine_reports_no_cpu() {
    let h = Harness::new("cpu-stopped");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    *locked(&h.fake.resident) = Some(500);
    *locked(&h.fake.cpu) = Some(0);
    h.server.probe("m1");
    tokio::time::sleep(Duration::from_millis(50)).await;
    *locked(&h.fake.cpu) = Some(1_000_000);
    h.server.probe("m1");
    let cpu = |h: &Harness| {
        h.server
            .usage()
            .unwrap()
            .machines
            .into_iter()
            .find(|m| m.id == "m1")
            .map(|m| m.cpu_milli)
    };
    assert!(
        cpu(&h).unwrap() > 0,
        "a busy running machine reports its CPU"
    );

    h.server.put("m1", spec(false)).unwrap();
    h.settle("m1").await;
    assert_eq!(cpu(&h), Some(0), "a stopped machine reports none");
}

// TEST_SCENARIO: a status read reads the machine's seeded record off its share, and a disk that stalls holds that read for as long as it stalls. It must hold up only the read of that machine: one held under the machine lock would freeze every ensure, status, probe and delete on the runner.
#[tokio::test(flavor = "multi_thread")]
async fn a_stalled_share_holds_up_only_the_status_of_its_machine() {
    let h = Harness::new("stalled-share");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let stalled = h
        .dir
        .join("machines/m1")
        .join(SHARE_DIR)
        .join(share::SEEDED_FILE);
    let _ = fs::remove_file(&stalled);
    assert!(std::process::Command::new("mkfifo")
        .arg(&stalled)
        .status()
        .unwrap()
        .success());
    let server = h.server.clone();
    let stuck = std::thread::spawn(move || server.status("m1"));
    tokio::time::sleep(Duration::from_millis(100)).await;
    let server = h.server.clone();
    let (sent, other) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sent.send(server.status("m2"));
    });
    let answered = other.recv_timeout(Duration::from_secs(1));
    let _ = fs::OpenOptions::new().write(true).open(&stalled);
    stuck.join().unwrap();
    assert!(
        answered.is_ok(),
        "one machine's stalled share held up another machine's status"
    );
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
            image_cache_socket: None,
            image_budget: 1 << 40,
            crane: h.dir.join("crane").to_string_lossy().into_owned(),
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

// TEST_SCENARIO: a machine just booted reports itself warming up, which is what the controller counts it at the warm-up floor by, as admission here does; a machine that is not running reports no warm-up.
#[tokio::test]
async fn a_booted_machine_reports_its_warm_up() {
    let h = Harness::new("warming");
    h.server.put("m1", spec(true)).unwrap();
    assert!(
        h.settle("m1").await.warming,
        "a machine just booted was not warming up"
    );
    h.server.put("m1", spec(false)).unwrap();
    assert!(
        !h.settle("m1").await.warming,
        "a stopped machine reported a warm-up"
    );
}

// TEST_SCENARIO: a runner handed running machines by another release holds the image tree each one boots from as it starts, before the controller sends it a spec. A short claim's first storage check on the new runner then sheds no tree a running guest reads, whether or not the controller has sent the machine's unchanged spec yet; a stopped machine's tree is still given up.
#[tokio::test(flavor = "multi_thread")]
async fn a_hand_off_keeps_the_trees_of_running_machines_through_a_short_claim() {
    let (h, claim) = with_claim("hand-off-holds");
    h.server.put("m1", spec(true)).unwrap();
    h.settle("m1").await;
    let mut other = spec(false);
    other.image = "quay.io/x/vm:2".into();
    h.server.put("m2", other).unwrap();
    h.settle("m2").await;
    let (running, stopped) = (h.entry("m1"), h.entry("m2"));
    assert!(running.exists() && stopped.exists());

    let measured = claim.clone();
    let next = h
        .hand_off(move |c| c.measure_storage = Arc::new(move || *locked(&measured)))
        .await;
    *locked(&claim) = filled(85);
    next.server.check_storage();
    assert!(
        running.exists(),
        "the hand-off shed a running machine's tree"
    );
    assert!(!stopped.exists(), "a stopped machine's tree was kept");

    next.server.put("m1", spec(true)).unwrap();
    next.server.check_storage();
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
