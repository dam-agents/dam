// UNIT_BOUNDARY_DESCRIPTION: the fakes and helpers every topic file here shares: a runtime with no hypervisor, one server over it in a directory of its own, and the stand-ins a test needs for a node, a registry, a claim and a VMM.
use super::*;

// UNIT_BOUNDARY_DESCRIPTION: what one update asked of the fake runtime: the image it moved the machine to, if any, and the allowlist and disk size it wrote.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Updated {
    pub(super) image: Option<String>,
    pub(super) allow_cidrs: Vec<String>,
    pub(super) storage_gib: i32,
}

// UNIT_BOUNDARY_DESCRIPTION: a runtime with no hypervisor behind it. It records each call in order, keeps each machine's state and the image its record names in memory, and can be told to boot slowly or fail once — which is everything the server's decisions depend on.
#[derive(Default)]
pub(super) struct Fake {
    pub(super) states: Mutex<HashMap<String, State>>,
    pub(super) calls: Mutex<Vec<String>>,
    pub(super) created: Mutex<HashMap<String, (String, ImageLaunch)>>,
    pub(super) images: Mutex<HashMap<String, String>>,
    updated: Mutex<Vec<Updated>>,
    pub(super) start_delay: Mutex<Duration>,
    // UNIT_BOUNDARY_DESCRIPTION: the next start reports that it is inside the gate and then waits for the test to let it go, so a test can act while a boot is provably in flight rather than within a delay a loaded machine can outlast.
    start_held: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    // UNIT_BOUNDARY_DESCRIPTION: the ordinal of the start that `hold_nth_start` holds, so a test can gate the reboot after a grow and let the small boot before it through.
    hold_start_at: Mutex<Option<usize>>,
    nth_held: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    start_release: Mutex<Option<std::sync::mpsc::Receiver<()>>>,
    pub(super) stop_delay: Mutex<Duration>,
    pub(super) delete_delay: Mutex<Duration>,
    pub(super) fail_start_once: Mutex<Option<String>>,
    // UNIT_BOUNDARY_DESCRIPTION: a start this many calls in fails with this message, so a test can break the boot that follows a grow without touching the one before it.
    pub(super) fail_start_at: Mutex<Option<(usize, String)>>,
    // UNIT_BOUNDARY_DESCRIPTION: a signal the VMM of the next start dies by, which that start returns as the kill the runtime read, as the real one does when its boot monitor reaps the child.
    start_killed: Mutex<Option<i32>>,
    pub(super) fail_grow_once: Mutex<Option<String>>,
    // UNIT_BOUNDARY_DESCRIPTION: a grow whose VMM the kernel kills, as memory pressure does: the grow answers with that death, and the replacement start is held by `start_held`/`start_release`, so a test can sample the OOM count while the recovery is still in flight, which is the moment a hold has to exist by.
    pub(super) grow_killed: Mutex<Option<i32>>,
    // UNIT_BOUNDARY_DESCRIPTION: the start time this runtime persists for a machine's VMM, which is what a loader record is judged against after that VMM is gone.
    pub(super) vmm_start_times: Mutex<HashMap<String, u64>>,
    pub(super) booted_mib: Mutex<Vec<i32>>,
    pub(super) start_sizes: Mutex<Vec<i32>>,
    pub(super) console: Mutex<String>,
    // UNIT_BOUNDARY_DESCRIPTION: the file this fake writes a machine's kernel log to, which a test fills with platform-init's marks; None for a runtime that keeps no log.
    pub(super) kernel: Mutex<Option<std::path::PathBuf>>,
    pub(super) panic_on_state: AtomicBool,
    pub(super) nests: AtomicBool,
    pub(super) state_fails_until_start: Mutex<HashSet<String>>,
    pub(super) vmms: Mutex<HashSet<String>>,
    pub(super) resident: Mutex<Option<i32>>,
    pub(super) cpu: Mutex<Option<u64>>,
    vmm_pids: Mutex<HashMap<String, i32>>,
    // UNIT_BOUNDARY_DESCRIPTION: pids the kernel has handed to another process, which a machine's record still names: the runtime's start-time check is what tells them apart from the VMM the record meant.
    recycled: Mutex<HashSet<i32>>,
    // UNIT_BOUNDARY_DESCRIPTION: the signal the runtime's own code kept for a VMM it reaped itself, as smolvm's boot monitor and sweep leave it.
    exit_signals: Mutex<HashMap<i32, i32>>,
    pub(super) state_reads: AtomicUsize,
}

impl Fake {
    pub(super) fn calls(&self) -> Vec<String> {
        locked(&self.calls).clone()
    }

    fn record(&self, call: String) {
        locked(&self.calls).push(call);
    }

    // UNIT_BOUNDARY_DESCRIPTION: the process the runtime reports as a machine's VMM, which a test spawns so the runner reaps a real child it can kill.
    pub(super) fn set_vmm(&self, id: &str, pid: i32) {
        locked(&self.vmm_pids).insert(id.to_string(), pid);
    }

    // UNIT_BOUNDARY_DESCRIPTION: holds the next start inside the gate until the returned sender is used, and answers a receiver that says when the start is in it, so the test orders its own steps against a boot that is still running instead of racing a delay.
    // UNIT_BOUNDARY_DESCRIPTION: holds the start whose number is `hold_start_at`, for a boot whose place in the sequence is what matters — the reboot a failed grow runs, rather than the small boot before it.
    pub(super) fn hold_nth_start(
        &self,
        nth: usize,
    ) -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>) {
        let (held, held_at) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        *locked(&self.hold_start_at) = Some(nth);
        *locked(&self.nth_held) = Some(held);
        *locked(&self.start_release) = Some(released);
        (held_at, release)
    }

    pub(super) fn hold_start(
        &self,
    ) -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>) {
        let (held, held_at) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        *locked(&self.start_held) = Some(held);
        *locked(&self.start_release) = Some(released);
        (held_at, release)
    }

    // UNIT_BOUNDARY_DESCRIPTION: hands a pid to another process, as the kernel does once the VMM it named has been reaped.
    pub(super) fn recycle(&self, pid: i32) {
        locked(&self.recycled).insert(pid);
    }

    // UNIT_BOUNDARY_DESCRIPTION: keeps the signal of a VMM the runtime's own code reaped, where a runner that never saw the status reads it.
    pub(super) fn keep_signal(&self, pid: i32, signal: i32) {
        locked(&self.exit_signals).insert(pid, signal);
    }

    // UNIT_BOUNDARY_DESCRIPTION: kills the VMM of the next start with `signal`, the way the kernel or the machine's own seccomp filter does — on a process this test spawns, so the kill is a real one.
    pub(super) fn kill_on_start(&self, signal: i32) {
        *locked(&self.start_killed) = Some(signal);
    }

    pub(super) fn last_update(&self) -> Updated {
        locked(&self.updated).last().cloned().expect("no update")
    }
}

impl Runtime for Fake {
    fn resident_mib(&self, _id: &str) -> Option<i32> {
        *locked(&self.resident)
    }

    fn holds_vmm(&self, id: &str) -> bool {
        locked(&self.vmms).contains(id)
    }

    fn cpu_usec(&self, _id: &str) -> Option<u64> {
        *locked(&self.cpu)
    }

    fn vmm_pid(&self, id: &str) -> Option<i32> {
        let pid = locked(&self.vmm_pids).get(id).copied()?;
        // UNIT_BOUNDARY_DESCRIPTION: a record keeps naming the pid of a VMM that has died, which is the pid the loader's own record of the death is written under; only a pid the kernel has handed to another process is refused.
        (!locked(&self.recycled).contains(&pid)).then_some(pid)
    }

    fn forget_vmm_exit(&self, pid: i32) {
        locked(&self.exit_signals).remove(&pid);
    }

    fn vmm_exit_signal(&self, pid: i32) -> Option<i32> {
        locked(&self.exit_signals).get(&pid).copied()
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
        let nth = locked(&self.booted_mib).len();
        if locked(&self.hold_start_at).is_some_and(|at| at == nth) {
            *locked(&self.hold_start_at) = None;
            if let Some(held) = locked(&self.nth_held).take() {
                let _ = held.send(());
            }
            if let Some(release) = locked(&self.start_release).take() {
                let _ = release.recv();
            }
        }
        if let Some(held) = locked(&self.start_held).take() {
            let _ = held.send(());
            if let Some(release) = locked(&self.start_release).take() {
                let _ = release.recv();
            }
        }
        if let Some(message) = locked(&self.fail_start_once).take() {
            anyhow::bail!(message);
        }
        let nth = locked(&self.booted_mib).len();
        let failing = locked(&self.fail_start_at).clone();
        if let Some((at, message)) = failing {
            if at == nth {
                *locked(&self.fail_start_at) = None;
                anyhow::bail!(message);
            }
        }
        if let Some(signal) = locked(&self.start_killed).take() {
            let mut vmm = stand_in_vmm();
            let pid = i32::try_from(vmm.id()).unwrap();
            // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
            unsafe { libc::kill(pid, signal) };
            let ended = vmm.wait().expect("the VMM is waited on");
            return Err(
                anyhow::anyhow!("the machine died before its guest answered").context(
                    crate::runtime::VmmKilled {
                        pid,
                        signal: ended.signal().unwrap_or(signal),
                    },
                ),
            );
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
        if let Some(signal) = locked(&self.grow_killed).take() {
            // UNIT_BOUNDARY_DESCRIPTION: the grow's own VMM dies here, on a child this test spawns, and the pid the machine reports stays the dead one until the reboot replaces it: the runner reads the death by that pid before the reboot, which is the moment the hold has to be made. The signal is kept where the runner's own reader looks, exactly as the runtime's sweep leaves one it reaped itself.
            let mut vmm = stand_in_vmm();
            let pid = i32::try_from(vmm.id()).unwrap();
            locked(&self.vmm_pids).insert(id.to_string(), pid);
            // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
            unsafe { libc::kill(pid, signal) };
            let ended = vmm.wait().expect("the VMM is waited on");
            let signal = ended.signal().unwrap_or(signal);
            self.keep_signal(pid, signal);
            anyhow::bail!("the VMM died growing: {signal}");
        }
        Ok(())
    }

    fn vmm_start_time(&self, id: &str) -> Option<u64> {
        locked(&self.vmm_start_times).get(id).copied()
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

    fn kernel_log(&self, _id: &str) -> Option<std::path::PathBuf> {
        locked(&self.kernel).clone()
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a crane that answers the two questions the runner asks — what an image says to run, and what its filesystem holds — and logs each call, so a test can count fetches. A fake that answered only one would let a change that stopped asking the other pass. It reads its own directory from `$0` once instead of forking `dirname` at each use: a resolve runs it four times, a stress run resolves one image per test, and the runner always runs it by the absolute path it was given.
const FAKE_CRANE: &str = r#"#!/bin/sh
here=${0%/*}
echo "$@" >> "$here/crane.log"
if [ "$1" = digest ]; then
  if [ -f "$here/registry-down" ]; then echo 'connection refused' >&2; exit 1; fi
  moved=$(cat "$here/moved" 2>/dev/null)
  printf 'sha256:%s\n' "$(printf '%s%s' "${2%@*}" "$moved" | sha256sum | cut -c1-64)"
  exit 0
fi
if [ "$1" = config ]; then
  printf '{"config":{"Entrypoint":["/entry"],"Cmd":["serve"],"Env":["PATH=/bin","A=image"],"WorkingDir":"/app"}}'
  exit 0
fi
d=$(mktemp -d); echo rootfs > "$d/hello"; tar -cf - -C "$d" .; rm -rf "$d"
"#;

// UNIT_BOUNDARY_DESCRIPTION: the node's image cache, in this test's process rather than behind its socket, over the harness's image directory and with its crane, unless the test gave the runner a cache of its own. Only the service writes a node cache, so this stands in for it, at the budget the test gave the runner.
fn in_process_cache(config: &mut Config, dir: &Path) {
    if config.images.is_none() {
        config.images = Some(node_cache_in(dir, config.image_budget));
    }
}

pub(super) fn node_cache_in(dir: &Path, budget: i64) -> Arc<dyn Images> {
    Arc::new(ImageCache::open(CacheConfig {
        dir: dir.join("images"),
        budget,
        crane: dir.join("crane").to_string_lossy().into_owned(),
        pins: Vec::new(),
        lifetime: CancellationToken::new(),
        ref_fresh: REF_FRESH,
        hold_lease: HOLD_LEASE,
        hold_grace: Duration::ZERO,
        fetch_ceiling: None,
    }))
}

// UNIT_BOUNDARY_DESCRIPTION: how long a test waits for the work it watches before it calls that work stuck: one resolve of the image, the boot, the health dial after it and a second action all fit inside it. That work is real — a resolve runs the fake crane four times, and every run spawns processes and unpacks a tree — and its cost belongs to the host, not the runner: on this suite a create resolves in about 0.4 s with 4 test threads, and in 3 s, with a tail past 10 s, with 64. Only a failing test reaches the deadline.
pub(super) const ACTION_DEADLINE: Duration = Duration::from_secs(30);

// UNIT_BOUNDARY_DESCRIPTION: one server on a fake runtime, in a directory of its own. The name is short for the same reason as testdir's: the node cache's socket sits in it.
pub(super) struct Harness {
    pub(super) dir: PathBuf,
    pub(super) fake: Arc<Fake>,
    pub(super) server: Arc<Server>,
    pub(super) base: u16,
}

impl Harness {
    // UNIT_BOUNDARY_DESCRIPTION: moves the instant a machine's action began, so a test can say when a kill was counted relative to it without waiting out the window.
    pub(super) fn action_began_at(&self, id: &str, at: Instant) {
        if let Some(entry) = locked(&self.server.machines).entries.get_mut(id) {
            entry.action_since = Some(at);
        }
    }

    pub(super) fn new(name: &str) -> Self {
        Self::with(name, |_| {})
    }

    pub(super) fn with(name: &str, tune: impl FnOnce(&mut Config)) -> Self {
        let dir = std::env::temp_dir().join(format!("vmr-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        crate::testdir::exec_script(&dir.join("crane"), FAKE_CRANE);
        let init = dir.join("platform-init");
        fs::write(&init, "#!/bin/sh\nexec \"$@\"\n").unwrap();
        let (base, held) = port_block();
        let held = Mutex::new(held);
        let mut config = Config {
            state_dir: dir.join("machines"),
            image_dir: dir.join("images"),
            images: None,
            image_budget: 1 << 40,
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
        in_process_cache(&mut config, &dir);
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
    pub(super) async fn hand_off(&self, tune: impl FnOnce(&mut Config)) -> Harness {
        self.server.hand_off().await;
        let mut config = Config {
            state_dir: self.dir.join("machines"),
            image_dir: self.dir.join("images"),
            images: None,
            image_budget: 1 << 40,
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
        in_process_cache(&mut config, &self.dir);
        Harness {
            dir: self.dir.clone(),
            fake: self.fake.clone(),
            server: Server::start(config, self.fake.clone()).unwrap(),
            base: self.base,
        }
    }
    // UNIT_BOUNDARY_DESCRIPTION: the cache entry a machine boots from, by the digest it recorded.
    pub(super) fn entry(&self, id: &str) -> PathBuf {
        let digest = fs::read_to_string(self.dir.join("machines").join(id).join(IMAGE_DIGEST_FILE))
            .unwrap_or_else(|e| panic!("{id} recorded no digest: {e}"));
        digest_path(&self.dir.join("images"), digest.trim())
    }

    pub(super) fn crane_log(&self, op: &str) -> usize {
        fs::read_to_string(self.dir.join("crane.log"))
            .map(|log| {
                log.lines()
                    .filter(|l| l.starts_with(&format!("{op} ")))
                    .count()
            })
            .unwrap_or_default()
    }

    pub(super) fn crane_calls(&self) -> usize {
        fs::read_to_string(self.dir.join("crane.log"))
            .map(|log| log.lines().count())
            .unwrap_or_default()
    }

    // UNIT_BOUNDARY_DESCRIPTION: waits until no worker is converging the machine, then reads its status. It waits `ACTION_DEADLINE`, as `until` does: what it waits out is the same action, and a worker that is slow is not a worker that is stuck.
    pub(super) async fn settle(&self, id: &str) -> MachineStatus {
        let deadline = Instant::now() + ACTION_DEADLINE;
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

    // UNIT_BOUNDARY_DESCRIPTION: waits on the machine's status version, as the controller does, until the status satisfies `done`. Only a failing test waits `ACTION_DEADLINE` out.
    pub(super) async fn until(
        &self,
        id: &str,
        what: &str,
        done: impl Fn(&MachineStatus) -> bool,
    ) -> MachineStatus {
        let deadline = Instant::now() + ACTION_DEADLINE;
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

    pub(super) async fn wait(&self, id: &str, since: u64, timeout: Duration) -> MachineStatus {
        let server = self.server.clone();
        let id = id.to_string();
        tokio::task::spawn_blocking(move || server.wait(&id, since, timeout).unwrap())
            .await
            .unwrap()
    }

    // UNIT_BOUNDARY_DESCRIPTION: waits until the runtime has been called with `call`, so a test can act while that call is still running. Its deadline is as long as `until`'s, for the same reason.
    pub(super) async fn wait_for_call(&self, call: &str) {
        let deadline = Instant::now() + ACTION_DEADLINE;
        while !self.fake.calls().iter().any(|c| c == call) {
            assert!(
                Instant::now() < deadline,
                "{call} never reached the runtime"
            );
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the bytes each named machine's share grants its guest, as platform-init reads them.
    pub(super) fn grants(&self, ids: &[&str]) -> Vec<u64> {
        ids.iter()
            .map(|id| {
                let grant = self
                    .dir
                    .join("machines")
                    .join(id)
                    .join(SHARE_DIR)
                    .join(share::STORAGE_ROOM_FILE);
                let text = std::fs::read_to_string(grant).unwrap();
                text.split_whitespace().nth(1).unwrap().parse().unwrap()
            })
            .collect()
    }

    // UNIT_BOUNDARY_DESCRIPTION: holds the worker at the moment it refused a planned action, before it decides whether that refusal is still the newest spec, so a test can accept a spec inside that window rather than racing it.
    pub(super) fn hold_refusal(
        &self,
    ) -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>) {
        let (reached, refused) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        *locked(&self.server.refusal_gate) = Some((reached, released));
        (refused, release)
    }

    pub(super) fn machine<R>(&self, id: &str, change: impl FnOnce(&mut MachineEntry) -> R) -> R {
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

// UNIT_BOUNDARY_DESCRIPTION: two published ports held by this test until the runner takes them, with both guest ports at the loopback offset free. A port proven free and released is only a port that used to be free, so the published ones are handed over bound. Blocks come from `testdir`'s band, not from the kernel: an ephemeral base in the top 1000 of the range has no free block to find, and a retry from there fails every time.
fn port_block() -> (u16, HashMap<u16, TcpListener>) {
    for base in crate::testdir::PORT_BLOCK_BASE..crate::testdir::PORT_BLOCK_TOP {
        let Ok(first) = TcpListener::bind(("127.0.0.1", base)) else {
            continue;
        };
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
    panic!(
        "no free port block in {}..{}",
        crate::testdir::PORT_BLOCK_BASE,
        crate::testdir::PORT_BLOCK_TOP
    );
}

// UNIT_BOUNDARY_DESCRIPTION: a guest answering its health endpoint on the loopback port behind a published one, until the returned flag is cleared.
pub(super) fn guest(port: u16) -> Arc<AtomicBool> {
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
pub(super) fn age_boot(h: &Harness, id: &str) {
    h.machine(id, |m| {
        m.boot.as_mut().expect("no boot is waited on").at =
            Instant::now() - SLOW_BOOT_AFTER - Duration::from_secs(1)
    });
}

pub(super) fn spec(running: bool) -> MachineSpec {
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
        admit_mib: 0,
    }
}

pub(super) fn expecting(running: bool, seed: &SeedResult) -> MachineSpec {
    MachineSpec {
        expect_seed: Some(seed.clone()),
        ..spec(running)
    }
}

pub(super) fn upload(h: &Harness, id: &str, body: &[u8]) -> SeedResult {
    let mut seeding = h.server.claim_seed(id, None).unwrap();
    seeding.write(body).unwrap();
    seeding.commit().unwrap()
}

// UNIT_BOUNDARY_DESCRIPTION: binds a published port on loopback, retrying for a few seconds while the closed runner's listener lets go of it.
pub(super) fn retrying_listen() -> Arc<Listen> {
    let deadline = Instant::now() + Duration::from_secs(5);
    Arc::new(move |p| loop {
        match TcpListener::bind(("127.0.0.1", p)) {
            Ok(l) => return Ok(l),
            Err(e) if Instant::now() > deadline => return Err(e),
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    })
}

// UNIT_BOUNDARY_DESCRIPTION: marks the machine quiet for just longer than STALLED_RESTART, as a guest that stopped answering that long ago looks.
pub(super) fn stall(h: &Harness, id: &str) {
    h.machine(id, |m| {
        m.health.quiet_since = Some(SystemTime::now() - STALLED_RESTART - Duration::from_secs(1))
    });
}

// UNIT_BOUNDARY_DESCRIPTION: a guest on the machine's port again, once the one stopped before it has let the port go.
pub(super) async fn guest_again(h: &Harness) -> Arc<AtomicBool> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while TcpListener::bind(("127.0.0.1", h.base + LOOPBACK_OFFSET)).is_err() {
        assert!(Instant::now() < deadline, "the old guest kept its port");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    guest(h.base)
}

pub(super) const PRIVATE_CRANE: &str = r##"#!/bin/sh
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

pub(super) const CREDENTIAL: &str = r#"{"auths":{"quay.io":{"auth":"c2VjcmV0"}}}"#;

pub(super) fn with_credential(running: bool) -> MachineSpec {
    MachineSpec {
        pull_auths: vec![CREDENTIAL.into()],
        ..spec(running)
    }
}

pub(super) fn files_under(dir: &Path) -> Vec<PathBuf> {
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

pub(super) const STALE: &str = r#"{"auths":{"quay.io":{"auth":"c3RhbGU="}}}"#;

pub(super) const PROXY: &str = "http://10.0.0.1:10000";

// UNIT_BOUNDARY_DESCRIPTION: the node image cache service in this test's process, serving the harness's image directory on the socket the runner was told, with the harness's crane. Its holds lapse in `lease`, so a test can see whether the runner renews them. The test waits until the service accepts a connection: the socket file appears a syscall before the listen, and on a loaded machine the serving task waits for a core between the two, long enough for the runner's first connect to be refused.
pub(super) async fn node_service(
    h: &Harness,
    lease: Duration,
) -> (Arc<ImageCache>, CancellationToken) {
    let cache = Arc::new(ImageCache::open(CacheConfig {
        dir: h.dir.join("images"),
        budget: 1,
        crane: h.dir.join("crane").to_string_lossy().into_owned(),
        pins: Vec::new(),
        lifetime: CancellationToken::new(),
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
    while tokio::net::UnixStream::connect(&socket).await.is_err() {
        if served.is_finished() {
            panic!("the node's service did not start: {:?}", served.await);
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    (cache, stop)
}

pub(super) fn on_node_cache(c: &mut Config) {
    c.images = Some(Arc::new(cacheapi::CacheClient::new(
        c.image_dir.join(".cache.sock"),
    )));
}

// UNIT_BOUNDARY_DESCRIPTION: a crane whose layer fetch never ends, as a pull of a huge image over a slow registry does.
pub(super) fn stall_fetches(h: &Harness) {
    crate::testdir::exec_script(
        &h.dir.join("crane"),
        "#!/bin/sh\nif [ \"$1\" = config ]; then printf '{\"config\":{\"Cmd\":[\"x\"]}}'; exit 0; fi\nsleep 60\n",
    );
}

// UNIT_BOUNDARY_DESCRIPTION: a runner over a claim whose use the test sets, starting at nothing measured.
pub(super) fn with_claim(name: &str) -> (Harness, Arc<Mutex<Option<StorageUse>>>) {
    let claim: Arc<Mutex<Option<StorageUse>>> = Arc::default();
    let measured = claim.clone();
    let h = Harness::with(name, move |c| {
        c.measure_storage = Arc::new(move || *locked(&measured));
    });
    (h, claim)
}

pub(super) fn filled(percent: u64) -> Option<StorageUse> {
    Some(StorageUse {
        used: percent << 30,
        usable: 100 << 30,
    })
}

// UNIT_BOUNDARY_DESCRIPTION: a child of this process that stands in for a VMM the runtime reported a pid for: the runner reaps its children itself, so a test can kill one with the signal the kernel or a seccomp filter would send.
pub(super) fn stand_in_vmm() -> std::process::Child {
    std::process::Command::new("sleep")
        .arg("60")
        .spawn()
        .expect("a process to stand in for a VMM")
}

// UNIT_BOUNDARY_DESCRIPTION: waits, within `ACTION_DEADLINE`, for the child to end without taking its status, so the reaper's own read is the one that collects it. The wait blocks until the child ends, so it runs off this thread and the deadline bounds it here.
pub(super) fn wait_ended_without_reaping(pid: i32) {
    let (ended, was_ended) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        // SAFETY: waitid(2) writes only into `info`, and WNOWAIT leaves the status for the next reader.
        let waited = unsafe {
            libc::waitid(
                libc::P_PID,
                u32::try_from(pid).unwrap(),
                &raw mut info,
                libc::WEXITED | libc::WNOWAIT,
            )
        };
        let _ = ended.send(waited);
    });
    assert_eq!(
        was_ended
            .recv_timeout(ACTION_DEADLINE)
            .expect("the VMM was never ended"),
        0,
        "the VMM was never ended"
    );
}

// UNIT_BOUNDARY_DESCRIPTION: fails when the runner counted a kill it did not make: both reasons read zero, since a family that first appears at its first event is missed by `increase()`.
pub(super) fn assert_no_kill_counted(h: &Harness) {
    let text = h.server.metrics_text();
    for reason in [REASON_OOM_KILLED, REASON_SECCOMP_KILLED] {
        let line = format!("platform_vm_runner_machine_kills_total{{reason=\"{reason}\"}} 0");
        assert!(
            text.lines().any(|l| l == line),
            "a kill was counted:\n{text}"
        );
    }
}

// UNIT_BOUNDARY_DESCRIPTION: stands a process in for a machine's VMM, kills it with `signal`, and reaps until the runner says what took the machine down, giving that status back. The stand-in is waited on, so a test leaves no process behind.
pub(super) fn kill_vmm(h: &Harness, id: &str, signal: libc::c_int) -> MachineStatus {
    let mut vmm = stand_in_vmm();
    let pid = i32::try_from(vmm.id()).unwrap();
    h.fake.set_vmm(id, pid);
    // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
    unsafe { libc::kill(pid, signal) };
    let deadline = Instant::now() + ACTION_DEADLINE;
    let status = loop {
        h.server.reap_killed();
        let status = h.server.status(id);
        if !status.reason.is_empty() {
            break status;
        }
        if Instant::now() >= deadline {
            let mut st = 0;
            // SAFETY: WNOHANG never blocks and the status word is a valid local.
            let reaped = unsafe { libc::waitpid(pid, &mut st, libc::WNOHANG) };
            // SAFETY: kill(2) takes no pointers.
            let alive = unsafe { libc::kill(pid, 0) };
            panic!(
                "{id}: the kill was never reported: {status:?} waitpid={reaped} alive={alive} errno={:?}",
                std::io::Error::last_os_error()
            );
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let _ = vmm.wait();
    status
}

// UNIT_BOUNDARY_DESCRIPTION: the cgroup's own words for how many OOM kills it has made, which is all a runner reads of it.
pub(super) fn counted(cgroup: &Path, kills: u64) {
    fs::write(
        cgroup.join("memory.events"),
        format!("low 0\nhigh 0\nmax 4\noom {kills}\noom_kill {kills}\noom_group_kill 0\n"),
    )
    .unwrap();
}
