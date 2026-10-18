use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::ops::RangeInclusive;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::api::{
    CpuUsage, MachineSpec, MachineStatus, MachineUsage, MemoryUsage, RunnerPressure, RunnerUsage,
    SeedResult, State, StorageUsage, REASON_BOOT_FAILED, REASON_COPYING_DISK, REASON_HOME_FULL,
    REASON_OUT_OF_CAPACITY, REASON_STORAGE_FULL, STATE_RUNNING,
};
use crate::cache::{self, pinned_digest};
use crate::capability::Verified;
use crate::capacity::Capacity;
use crate::console::{home_full, with_console, SLOW_BOOT, SLOW_BOOT_AFTER};
use crate::fetch::{failure_reason, seed_missing, unusable};
use crate::forward::{healthy, Forwarder, Listen, LOOPBACK_OFFSET};
use crate::imagecache::{Images, Resolved, ROOTFS_DIR};
use crate::launch::{read_launch, ImageLaunch};
use crate::locked;
use crate::metrics::{Gauges, Metrics};
use crate::plan::{
    admissible, gateway_port_admissible, quiet_limit, reads_ready, step, Action, Health,
};
use crate::runtime::{redact, Machine, Runtime, Update};
use crate::share::{self, write_share, SeedFile, SHARE_DIR};
use crate::state::{
    self, is_image_ref, is_machine_id, machine_dir, read_spec, write_spec, IMAGE_DIGEST_FILE,
};
use crate::storage::StorageUse;

// UNIT_BOUNDARY_DESCRIPTION: the machine API behind the HTTP layer: one persistent microVM per vm Agent, converged on the latest spec the controller sent. A PUT stores that spec and makes sure one worker is converging the machine; the worker takes one whole action at a time, and GET reports the action in flight as the machine's state. What a machine is survives the runner on disk — its spec, its port, its share. What the runner is doing to it lives in one entry per machine here and is lost with the process.

// UNIT_BOUNDARY_DESCRIPTION: how often the health prober asks the runtime and the guest about a machine. A machine on its way up is asked often, because the time between its guest answering and the controller hearing of it is the last part of a wake the user waits for. A boot younger than SLOW_BOOT_AFTER is asked every FRESH_BOOT_PROBE: the probe is a connect to a loopback port, cheap but not free, so the tight cadence is kept to the minute in which a guest normally answers. An older boot, or an action that has not started a boot yet, is asked every BOOT_PROBE. A steady one is asked every STEADY_PROBE: a missed answer there only counts towards an unhealthy restart, the soonest of them several misses away (see plan::quiet_limit). A stopped or absent machine is not asked at all, since only an action changes it.
pub const FRESH_BOOT_PROBE: Duration = Duration::from_millis(100);
pub const BOOT_PROBE: Duration = Duration::from_millis(500);
pub const STEADY_PROBE: Duration = Duration::from_secs(10);
const PROBE_TICK: Duration = Duration::from_millis(50);
const PROBES_IN_FLIGHT: usize = 16;

// UNIT_BOUNDARY_DESCRIPTION: the longest a status read waits for the machine's status to change.
pub const STATUS_WAIT_CAP: Duration = Duration::from_secs(30);

// UNIT_BOUNDARY_DESCRIPTION: how long closing the runner waits for the actions already running. They are cancelled first, so the wait covers only work that does not answer cancellation — a VMM call cannot be interrupted part-way.
pub const CLOSE_GRACE: Duration = Duration::from_secs(30);

// UNIT_BOUNDARY_DESCRIPTION: how long closing the runner gives its running machines to stop, all at once, after the actions have ended. A machine is a VMM process of this pod: left running, it is killed with the pod, its guest page cache unwritten. A stop signals the workload, has the guest quiesce its disks and then powers it off, which takes seconds; the rest of this window is for a guest slow to confirm. CLOSE_GRACE and this together must fit inside the termination grace the controller gives the runner pod.
pub const STOP_ON_CLOSE: Duration = Duration::from_secs(40);

// UNIT_BOUNDARY_DESCRIPTION: how long a delete waits for the action in flight on its machine. The delete cancels that action's fetch first, so the wait covers only a VMM call. It stays under the controller's twenty-second request timeout: a delete still waiting then answers 503, and the controller asks again on its next reconcile.
pub const DELETE_WAIT: Duration = Duration::from_secs(15);

// UNIT_BOUNDARY_DESCRIPTION: the longest the runner waits on one start, stop or delete call into the runtime. None of them can be interrupted, and a VMM stuck in the kernel can hold one forever, which would hold the machine's worker, and every delete of it, with it. Past this the call is reported failed and left to finish on its own thread; the runtime's own lock on the machine keeps the next call from running beside it, and a delete waits for it only DELETE_WAIT, as for any call in flight, rather than queue behind it on that lock. The longest legitimate call is a start that boots small and grows: the guest may take smolvm's 180 s to answer, putting the added RAM online 130 s and plugging it RAM_PLUG_WAIT, and a grow that fails then stops the guest, at most platform-init's 15 s for the workload and smolvm's 120 s for the flush, and boots it again whole, up to 180 s more; that is about 11 min, which 12 min covers. A seed's restore runs after the guest answers, so no call waits on it.
pub const RUNTIME_CALL_LIMIT: Duration = Duration::from_secs(12 * 60);

// UNIT_BOUNDARY_DESCRIPTION: how often the runner names the digests its machines boot to the image cache again. Well inside HOLD_LEASE, so one missed refresh never lets a hold lapse.
pub const HOLD_REFRESH: Duration = Duration::from_secs(60);

// UNIT_BOUNDARY_DESCRIPTION: how often the runner looks at how full its claim is, and sheds what it can fetch again while it is short. A machine is refused on a critical claim by a look at the time of the request, not at this cadence.
pub const STORAGE_CHECK: Duration = Duration::from_secs(30);

// UNIT_BOUNDARY_DESCRIPTION: what a runner is given at start, as the flags the controller sets on the runner's Deployment. `images` is the node's image cache service: the image directory is that service's, read-only here, and every image a machine boots that is not staged there is resolved by it. Without it the runner boots only the trees staged in the image directory and fetches nothing.
pub struct Config {
    pub state_dir: PathBuf,
    pub image_dir: PathBuf,
    pub images: Option<Arc<dyn Images>>,
    pub image_budget: i64,
    pub init: Option<PathBuf>,
    pub runc: Option<PathBuf>,
    pub ports: RangeInclusive<u16>,
    pub memory_mib: i32,
    pub reserve_mib: i32,
    pub headroom_mib: i32,
    pub boot_mib: i32,
    pub listen: Option<Arc<Listen>>,
    // UNIT_BOUNDARY_DESCRIPTION: the VM runtime this runner's release was built against, which every machine it starts boots. None where the runner's release names none, which makes no machine foreign.
    pub runtime: Option<String>,
    // UNIT_BOUNDARY_DESCRIPTION: the runner's own cgroup v2 directory, read for memory pressure. None where there is none to read — a runner outside the cluster, or a cgroup v1 node — and then the runner never reports pressure.
    pub cgroup_dir: Option<PathBuf>,
    // UNIT_BOUNDARY_DESCRIPTION: how full the owner's claim is now (see storage::StorageUse), or nothing when it cannot be told, which guards nothing. A function rather than a path, so a test can stand a full claim in for a real one.
    pub measure_storage: Arc<dyn Fn() -> Option<StorageUse> + Send + Sync>,
}

#[derive(Clone)]
struct Failed {
    message: String,
    reason: &'static str,
}

// UNIT_BOUNDARY_DESCRIPTION: a boot the runner waits on until its guest first answers: when it was asked, by which action, the seed its spec expected the home to come from, and the stuck-boot note once the prober writes one. The prober refreshes the note once per SLOW_BOOT_AFTER and not on every probe, because each new message is a new status version and a status write on the Agent.
struct Boot {
    at: Instant,
    action: Action,
    seed: Option<String>,
    note: Option<(String, Instant, Option<&'static str>)>,
}

// UNIT_BOUNDARY_DESCRIPTION: what the runtime and the guest last said about a machine. `error` is set only with the unknown state, when the runtime could not be read.
#[derive(Clone, PartialEq, Eq)]
struct Seen {
    state: State,
    ready: bool,
    error: Option<String>,
}

// UNIT_BOUNDARY_DESCRIPTION: what the runner knows about one machine beyond its files. `asked` counts the specs stored in `desired`, so a worker can tell that a newer one arrived while its action ran. `seeding` is set while a seed is uploaded into the machine's share, and no worker starts while it is. `version` changes whenever the status this entry reports changes, which is what a waiting status read answers on. `looked` counts every change to `seen`, so a probe that ran while something newer was recorded drops its older answer. `secrets` holds every env value this machine was given, because a guest that prints its environment puts them on the console, and the console outlives a spec change. `cancel` is the machine's own child of the runner's lifetime, cancelled by a delete so the action in flight stops waiting on its fetch. `acting_mib` is the memory of the spec the action in flight runs with, which a newer spec stored behind it does not change. `resident_mib` is what the prober last measured the running machine's VMM holding, kept beside `seen` rather than in it, so a figure that moves at every probe does not move the status version and wake every waiting read. `warming_since` is when the machine's last boot began, which admission counts it at the warm-up floor for WARMUP after. `deletes` counts the delete calls in progress, and `deleting` stays set after one gave up waiting, and while any runtime call it waited on still runs, so the worker still takes no further action and no ensure clears it. `calls` is held by every start, stop or delete call into the runtime until that call returns, also after the runner gave up waiting for it, so it counts one more holder per call still running. `gave_up` is when the runner last restarted the machine for going quiet, which holds its next such restart back. `restarts` counts those restarts since the controller last asked the machine stopped: the controller publishes no count for a hibernated Agent, so one kept across the stop would read after the wake as a crash the user never had.
#[derive(Default)]
struct MachineEntry {
    desired: Option<MachineSpec>,
    asked: u64,
    action: Option<Action>,
    converging: bool,
    deleting: bool,
    seeding: bool,
    failure: Option<Failed>,
    health: Health,
    restarts: i32,
    gave_up: Option<Instant>,
    boot: Option<Boot>,
    secrets: Vec<String>,
    seen: Option<Seen>,
    looked: u64,
    probed: Option<Instant>,
    probing: bool,
    version: u64,
    acting_mib: i32,
    resident_mib: Option<i32>,
    warming_since: Option<Instant>,
    cpu: Option<(Instant, u64)>,
    cpu_milli: u64,
    cancel: Option<CancellationToken>,
    deletes: u32,
    calls: Arc<()>,
}

impl MachineEntry {
    fn warming(&self) -> bool {
        self.warming_since
            .is_some_and(|at| at.elapsed() < crate::capacity::WARMUP)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: how often the prober asks about this machine, or None when nothing but an action can change what it would hear.
fn probe_every(entry: &MachineEntry) -> Option<Duration> {
    if entry.deleting {
        return None;
    }
    let booting = entry.boot.as_ref().map(|boot| {
        if boot.at.elapsed() < SLOW_BOOT_AFTER {
            FRESH_BOOT_PROBE
        } else {
            BOOT_PROBE
        }
    });
    if let Some(action) = entry.action {
        return reads_ready(action.state()).then_some(booting.unwrap_or(BOOT_PROBE));
    }
    match &entry.seen {
        None => Some(Duration::ZERO),
        Some(seen) if matches!(seen.state, State::Absent | State::Stopped) => None,
        Some(_) => Some(booting.unwrap_or(STEADY_PROBE)),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's memory pressure as its sampler last read it. `signalled` is when its version last moved while pressure lasted.
#[derive(Default)]
struct Pressure {
    version: u64,
    pressured: bool,
    working_set_mib: i32,
    signalled: Option<Instant>,
}

#[derive(Default)]
struct Machines {
    closed: bool,
    entries: HashMap<String, MachineEntry>,
    pressure: Pressure,
    cpu: crate::cpu::Window,
}

pub struct Server {
    config: Config,
    runtime: Arc<dyn Runtime>,
    forwarder: Forwarder,
    machines: Mutex<Machines>,
    settled: Condvar,
    changed: Condvar,
    versions: AtomicU64,
    admission: Mutex<()>,
    ports: Mutex<()>,
    storage_short: std::sync::atomic::AtomicBool,
    shed_request: Mutex<Option<(u64, String)>>,
    lifetime: CancellationToken,
    work: TaskTracker,
    metrics: Metrics,
}

// UNIT_BOUNDARY_DESCRIPTION: a request the runner refuses outright, with the HTTP status that says whose mistake it is.
#[derive(Debug, PartialEq, Eq)]
pub struct Rejected {
    pub status: u16,
    pub message: String,
}

impl Rejected {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: 400,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: 500,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: 404,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: 409,
            message: message.into(),
        }
    }

    fn insufficient_storage(message: impl Into<String>) -> Self {
        Self {
            status: 507,
            message: message.into(),
        }
    }

    fn too_large(message: impl Into<String>) -> Self {
        Self {
            status: 413,
            message: message.into(),
        }
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: 503,
            message: message.into(),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a spec that reaches a closing runner is not stored, so it must not be answered as if it were: a 200 would tell the controller its spec was taken. The runner's next pod takes it on the next reconcile.
fn shutting_down() -> Rejected {
    Rejected::unavailable("the VM runner is shutting down; the spec was not stored")
}

fn check_id(id: &str) -> Result<(), Rejected> {
    if is_machine_id(id) {
        Ok(())
    } else {
        Err(Rejected::bad_request("invalid machine id"))
    }
}

impl Server {
    // UNIT_BOUNDARY_DESCRIPTION: a runner over its state directory. It must be built inside the tokio runtime that will serve it, because every published port is a task on that runtime. Machines already on disk get their ports published again, since the listeners died with the previous process while the machines' ports did not. Each one the runtime finds running is measured before the runner admits anything, and the prober takes it from there: a runner that took the machines over in a hand-off or a restart would otherwise count each at the warm-up floor until the controller first asked about it, and admit a start into memory its running guests already hold.
    pub fn start(config: Config, runtime: Arc<dyn Runtime>) -> anyhow::Result<Arc<Self>> {
        let forwarder = Forwarder::new(tokio::runtime::Handle::current(), config.listen.clone());
        let lifetime = CancellationToken::new();
        let server = Arc::new(Self {
            config,
            runtime,
            forwarder,
            machines: Mutex::new(Machines::default()),
            settled: Condvar::new(),
            changed: Condvar::new(),
            // UNIT_BOUNDARY_DESCRIPTION: the first version this process hands out is taken from the clock, so a version a caller holds from before a runner restart is not handed out again by the new process.
            versions: AtomicU64::new(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |since| u64::try_from(since.as_micros()).unwrap_or(0)),
            ),
            admission: Mutex::new(()),
            ports: Mutex::new(()),
            storage_short: std::sync::atomic::AtomicBool::new(false),
            shed_request: Mutex::new(None),
            lifetime,
            work: TaskTracker::new(),
            metrics: Metrics::default(),
        });
        for id in state::machine_ids(&server.config.state_dir)? {
            let port = state::port(&server.config.state_dir, &id);
            if port != 0 {
                if let Err(e) = server.forwarder.publish(&id, port) {
                    tracing::warn!(machine = %id, error = %e, "republishing machine port");
                }
            }
            if server.runtime.state(&id).ok() == Some(State::Running) {
                let resident = server.runtime.resident_mib(&id);
                locked(&server.machines)
                    .entries
                    .entry(id)
                    .or_default()
                    .resident_mib = resident;
            }
        }
        server.hold_images();
        let refreshing = Arc::downgrade(&server);
        let lifetime = server.lifetime.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = lifetime.cancelled() => return,
                    _ = tokio::time::sleep(HOLD_REFRESH) => {}
                }
                let Some(server) = refreshing.upgrade() else {
                    return;
                };
                let _ = tokio::task::spawn_blocking(move || server.hold_images()).await;
            }
        });
        let checking = Arc::downgrade(&server);
        let lifetime = server.lifetime.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = lifetime.cancelled() => return,
                    _ = tokio::time::sleep(STORAGE_CHECK) => {}
                }
                let Some(server) = checking.upgrade() else {
                    return;
                };
                let _ = tokio::task::spawn_blocking(move || server.check_storage()).await;
            }
        });
        // UNIT_BOUNDARY_DESCRIPTION: the health prober: one task per runner that starts a probe of each machine worth probing at its cadence, and each probe records what it hears, so a status read never waits on a probe. It holds the server weakly and ends with it, as well as when the runner closes.
        let prober = Arc::downgrade(&server);
        server.background(move |lifetime| {
            while !lifetime.is_cancelled() {
                let Some(server) = prober.upgrade() else {
                    return;
                };
                server.probe_due();
                drop(server);
                std::thread::sleep(PROBE_TICK);
            }
        });
        locked(&server.machines).pressure.version =
            server.versions.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(cgroup) = server.config.cgroup_dir.clone() {
            let sampler = Arc::downgrade(&server);
            server.background(move |lifetime| {
                if let Err(e) = crate::pressure::working_set_mib(&cgroup) {
                    tracing::warn!(error = %format!("{e:#}"), "vm runner: cannot read the runner's cgroup, so it reports no memory pressure");
                    return;
                }
                while !lifetime.is_cancelled() {
                    let Some(server) = sampler.upgrade() else {
                        return;
                    };
                    if let Ok(stat) = crate::cpu::stat(&cgroup) {
                        locked(&server.machines).cpu.push(Instant::now(), stat);
                    }
                    match crate::pressure::working_set_mib(&cgroup) {
                        Ok(mib) => server.sample_pressure(i32::try_from(mib).unwrap_or(i32::MAX)),
                        Err(e) => {
                            tracing::warn!(error = %format!("{e:#}"), "vm runner: reading the runner's cgroup")
                        }
                    }
                    drop(server);
                    std::thread::sleep(crate::pressure::SAMPLE_EVERY);
                }
            });
        }
        Ok(server)
    }

    // UNIT_BOUNDARY_DESCRIPTION: records one sample of the runner's working set. The version moves when pressure starts or ends, and every SIGNAL_EVERY while it lasts. Before it moves, every running machine is measured again, so the statuses the controller reads on the signal say what each machine holds now rather than at its last steady probe.
    fn sample_pressure(&self, working_set_mib: i32) {
        let (was, signalled) = {
            let machines = locked(&self.machines);
            (machines.pressure.pressured, machines.pressure.signalled)
        };
        let now = crate::pressure::pressured(
            i64::from(working_set_mib),
            i64::from(self.memory_limit_mib()),
            was,
        );
        let signal = now != was
            || (now && signalled.is_none_or(|at| at.elapsed() >= crate::pressure::SIGNAL_EVERY));
        if signal && now {
            self.measure_running();
        }
        let mut machines = locked(&self.machines);
        let pressure = &mut machines.pressure;
        pressure.working_set_mib = working_set_mib;
        if signal {
            pressure.pressured = now;
            pressure.signalled = now.then(Instant::now);
            pressure.version = self.versions.fetch_add(1, Ordering::Relaxed) + 1;
            self.changed.notify_all();
        }
    }

    fn measure_running(&self) {
        let running: Vec<String> = locked(&self.machines)
            .entries
            .iter()
            .filter(|(_, e)| e.seen.as_ref().is_some_and(|s| s.state == State::Running))
            .map(|(id, _)| id.clone())
            .collect();
        for id in running {
            let resident = self.runtime.resident_mib(&id);
            if let Some(entry) = locked(&self.machines).entries.get_mut(&id) {
                if resident.is_some() {
                    entry.resident_mib = resident;
                }
            }
        }
    }

    pub fn pressure(&self) -> RunnerPressure {
        let machines = locked(&self.machines);
        RunnerPressure {
            version: machines.pressure.version,
            pressured: machines.pressure.pressured,
            limit_mib: self.memory_limit_mib(),
            working_set_mib: machines.pressure.working_set_mib,
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the long-poll behind a pressure read, as `wait` is for a machine's status: it answers once the pressure version is no longer `since`, or once `timeout`, capped at STATUS_WAIT_CAP, passes.
    pub fn wait_pressure(&self, since: u64, timeout: Duration) -> RunnerPressure {
        let deadline = Instant::now() + timeout.min(STATUS_WAIT_CAP);
        let mut machines = locked(&self.machines);
        while !machines.closed && machines.pressure.version == since {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            machines = match self.changed.wait_timeout(machines, left) {
                Ok((guard, _)) => guard,
                Err(e) => e.into_inner().0,
            };
        }
        drop(machines);
        self.pressure()
    }

    // UNIT_BOUNDARY_DESCRIPTION: stops taking work, cancels what is running, waits up to CLOSE_GRACE for it, and then stops every machine still running within STOP_ON_CLOSE. Cancelling first is what makes the wait short: a fetch allowed twenty minutes ends now and removes its own scratch tree. The machines are stopped as the controller's stop does it, so a runner going away quiesces each guest's disk instead of leaving the pod's kill to cut its power. Ports are dropped last, so an action that finished inside the wait does not leave one bound.
    pub async fn close(self: &Arc<Self>) {
        self.close_within(CLOSE_GRACE, Some(STOP_ON_CLOSE)).await;
    }

    // UNIT_BOUNDARY_DESCRIPTION: closes the runner as close does, but leaves every machine running, for the next runner process in the same pod to adopt. The loader asks for this when it replaces the runner with another release: the VMMs are processes of the pod, not of this process, and a new runner reads their records and republishes their ports as any restarted runner does.
    pub async fn hand_off(self: &Arc<Self>) {
        self.close_within(CLOSE_GRACE, None).await;
    }

    // UNIT_BOUNDARY_DESCRIPTION: closes the runner after its machine API failed to serve. A runner its pod's loader supervises leaves every machine running, as a hand-off does: the loader goes back to the release this one replaced, or starts this one again, and that runner adopts them without a reboot. A pod stop that arrives during that close, through `stopped`, is the loader passing the pod's end on, so the machines are then stopped cleanly after all. A runner with no loader is the pod's last process, so it stops them before the pod's end powers them off.
    pub async fn close_failed(
        self: &Arc<Self>,
        supervised: bool,
        stopped: impl std::future::Future<Output = ()>,
    ) {
        if !supervised {
            return self.close().await;
        }
        tokio::select! {
            biased;
            () = stopped => {
                tracing::info!("vm runner: the pod stops while the runner closes after a failure; stopping its machines");
                self.close().await;
            }
            () = self.hand_off() => {}
        }
    }
    async fn close_within(self: &Arc<Self>, grace: Duration, stopping: Option<Duration>) {
        self.stop_taking_work();
        if tokio::time::timeout(grace, self.work.wait()).await.is_err() {
            tracing::warn!(
                grace_secs = grace.as_secs(),
                "vm runner: machine actions were still running when the runner closed"
            );
        }
        if let Some(stopping) = stopping {
            let server = self.clone();
            let _ = tokio::task::spawn_blocking(move || server.stop_running(stopping)).await;
        }
        self.forwarder.unpublish_all();
        if let Some(images) = self.config.images.clone() {
            let _ = tokio::task::spawn_blocking(move || images.flush()).await;
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: stops every machine the runtime reports running, each on a thread of its own so one slow guest does not spend the others' time, and returns once all have answered or `within` has passed. A machine whose worker is still in a runtime call is left alone: the call holds the machine, and a stop beside it would only queue behind it.
    fn stop_running(self: &Arc<Self>, within: Duration) {
        let deadline = Instant::now() + within;
        let ids = state::machine_ids(&self.config.state_dir).unwrap_or_default();
        let (done, stopped) = std::sync::mpsc::channel();
        let mut asked = 0;
        for id in ids.into_iter().filter(|id| !self.converging(id)) {
            let server = self.clone();
            let done = done.clone();
            let spawned = std::thread::Builder::new()
                .name("close-stop".into())
                .spawn(move || {
                    let result = match server.runtime.state(&id) {
                        Ok(State::Running) => server.stop_machine(&id).map(|()| true),
                        Ok(_) => Ok(false),
                        Err(e) => Err(e),
                    };
                    let _ = done.send((id, result));
                });
            if spawned.is_ok() {
                asked += 1;
            }
        }
        drop(done);
        let mut answered = 0;
        while answered < asked {
            let left = deadline.saturating_duration_since(Instant::now());
            let Ok((id, result)) = stopped.recv_timeout(left) else {
                break;
            };
            answered += 1;
            match result {
                Ok(true) => {
                    tracing::info!(machine = %id, "vm runner: stopped the machine before closing")
                }
                Ok(false) => {}
                Err(e) => {
                    tracing::warn!(machine = %id, error = %format!("{e:#}"), "vm runner: could not stop the machine before closing")
                }
            }
        }
        if answered < asked {
            tracing::warn!(
                left = asked - answered,
                grace_secs = within.as_secs(),
                "vm runner: machines were still stopping when the runner closed"
            );
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the part of closing that does not wait: no new work is taken, what runs is cancelled, and every status read waiting on a change answers now. The HTTP server's drain waits for those reads, so this comes before it.
    pub fn stop_taking_work(&self) {
        locked(&self.machines).closed = true;
        self.changed.notify_all();
        self.forwarder.unpublish_all();
        self.lifetime.cancel();
        self.work.close();
    }

    // UNIT_BOUNDARY_DESCRIPTION: work that belongs to no machine — the disk-template warm-up — joined to the same barrier as a machine's worker, so closing the runner cancels and waits for everything it started. Work offered after close is refused.
    pub fn background(&self, work: impl FnOnce(CancellationToken) + Send + 'static) {
        if locked(&self.machines).closed {
            return;
        }
        let lifetime = self.lifetime.clone();
        self.work.spawn_blocking(move || work(lifetime));
    }

    pub fn list(&self) -> anyhow::Result<Vec<String>> {
        Ok(state::machine_ids(&self.config.state_dir)?
            .into_iter()
            .collect())
    }

    // UNIT_BOUNDARY_DESCRIPTION: takes the controller's desired spec for one machine and answers with its status. The spec replaces any spec not yet acted on. When the machine needs work and no worker is converging it, one is started and the answer reports its first action as the state. A spec that would boot a machine the runner's memory cannot hold is refused here and not stored, so nothing is created for it. While a seed is being uploaded the spec is stored and no worker is started, because a guest booted then would read half a seed; the controller's next ensure after the upload starts it.
    pub fn put(
        self: &Arc<Self>,
        id: &str,
        mut spec: MachineSpec,
    ) -> Result<MachineStatus, Rejected> {
        check_id(id)?;
        admissible(&spec).map_err(Rejected::bad_request)?;
        gateway_port_admissible(&spec, &self.config.ports).map_err(Rejected::bad_request)?;
        {
            let mut machines = locked(&self.machines);
            let entry = machines.entries.entry(id.to_string()).or_default();
            if !spec.running && entry.restarts != 0 {
                entry.restarts = 0;
                self.bump(entry);
            }
            let known = &mut entry.secrets;
            for value in spec.env.values() {
                if !known.contains(value) {
                    known.push(value.clone());
                }
            }
        }
        loop {
            if !self.converging(id) && !self.seen_lately(id) {
                self.observe(id, true);
            }
            let (state, mut status) = self.report(id);
            let action = self.next_action(id, &spec, state, status.ready);
            let converging = self.converging(id);
            let boots = spec.running && (converging || action.is_some_and(|a| a != Action::Stop));
            if boots || action == Some(Action::Create) {
                if let Some(full) = self.storage_critical() {
                    if full.full() || self.writes_much(id, action) {
                        return Ok(self.refuse(id, status, REASON_STORAGE_FULL, full.refusal()));
                    }
                    self.hold_growth(id, &mut spec);
                }
            }
            let _admitting = boots.then(|| locked(&self.admission));
            if boots {
                if let Err(e) = self.room_for(id, &spec) {
                    self.metrics.refused();
                    return Ok(self.refuse(id, status, REASON_OUT_OF_CAPACITY, e.to_string()));
                }
            }
            let mut machines = locked(&self.machines);
            if machines.closed {
                return Err(shutting_down());
            }
            let entry = machines.entries.entry(id.to_string()).or_default();
            if entry.deleting {
                if entry.converging || entry.deletes > 0 || Arc::strong_count(&entry.calls) > 1 {
                    return Ok(status);
                }
                entry.deleting = false;
                entry.cancel = None;
            }
            if converging && !entry.converging {
                continue;
            }
            entry.desired = Some(spec);
            entry.asked += 1;
            if entry.converging || entry.seeding {
                return Ok(status);
            }
            let Some(action) = action else {
                if entry.failure.take().is_some() {
                    self.bump(entry);
                    drop(machines);
                    return Ok(self.status(id));
                }
                return Ok(status);
            };
            entry.converging = true;
            entry.action = Some(action);
            entry.acting_mib = entry.desired.as_ref().map_or(0, |d| d.memory_mib);
            self.bump(entry);
            status.version = entry.version;
            let asked = entry.asked;
            drop(machines);
            let server = self.clone();
            let target = id.to_string();
            self.work
                .spawn_blocking(move || server.converge(&target, action, asked));
            status.state = action.label().to_string();
            status.ready = false;
            return Ok(status);
        }
    }

    fn refuse(
        &self,
        id: &str,
        mut status: MachineStatus,
        reason: &'static str,
        message: String,
    ) -> MachineStatus {
        let mut machines = locked(&self.machines);
        let entry = machines.entries.entry(id.to_string()).or_default();
        entry.failure = Some(Failed {
            message: message.clone(),
            reason,
        });
        self.bump(entry);
        status.version = entry.version;
        status.message = message;
        status.reason = reason.to_string();
        status.ready = false;
        status
    }

    pub fn get(&self, id: &str) -> Result<MachineStatus, Rejected> {
        check_id(id)?;
        Ok(self.status(id))
    }

    // UNIT_BOUNDARY_DESCRIPTION: the long-poll behind a status read: answers as soon as the machine's status version is no longer `since`, or once `timeout`, capped at STATUS_WAIT_CAP, passes with no change. A different version rather than a greater one ends the wait, so a caller holding a version from before a runner restart or a delete is answered at once.
    pub fn wait(&self, id: &str, since: u64, timeout: Duration) -> Result<MachineStatus, Rejected> {
        check_id(id)?;
        let deadline = Instant::now() + timeout.min(STATUS_WAIT_CAP);
        let mut machines = locked(&self.machines);
        while !machines.closed && machines.entries.get(id).map_or(0, |e| e.version) == since {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            machines = match self.changed.wait_timeout(machines, left) {
                Ok((guard, _)) => guard,
                Err(e) => e.into_inner().0,
            };
        }
        drop(machines);
        Ok(self.status(id))
    }

    fn bump(&self, entry: &mut MachineEntry) {
        entry.version = self.versions.fetch_add(1, Ordering::Relaxed) + 1;
        self.changed.notify_all();
    }

    fn end_worker(&self, entry: &mut MachineEntry) {
        entry.converging = false;
        entry.action = None;
        entry.acting_mib = 0;
        self.bump(entry);
    }

    // UNIT_BOUNDARY_DESCRIPTION: removes a machine, its disks and its state, and answers only once they are gone. It marks the machine as being deleted, so its worker takes no further action and any spec stored behind the current one is dropped, cancels the machine's token so an action waiting on a fetch returns now, then waits up to DELETE_WAIT for the action in flight to return. The same wait, polled since such a call returns on a thread that cannot signal it, covers a runtime call the worker gave up on at RUNTIME_CALL_LIMIT, which still holds the runtime's lock on the machine, and the runtime's own delete, which gets only what is left of DELETE_WAIT. A call still running then is answered with a 503, and the delete starts no runtime call of its own behind it, so a VMM stuck for good costs one blocked thread rather than one per retry; the mark stays, so the worker ends when its call returns, and the controller's next delete finds it gone.
    pub fn delete(&self, id: &str) -> Result<(), Rejected> {
        self.delete_within(id, DELETE_WAIT)
    }

    fn delete_within(&self, id: &str, wait: Duration) -> Result<(), Rejected> {
        check_id(id)?;
        let deadline = Instant::now() + wait;
        {
            let mut machines = locked(&self.machines);
            let entry = machines.entries.entry(id.to_string()).or_default();
            entry.deleting = true;
            entry.deletes += 1;
            entry
                .cancel
                .get_or_insert_with(|| self.lifetime.child_token())
                .cancel();
            while let Some(action) = machines
                .entries
                .get(id)
                .filter(|e| e.converging || Arc::strong_count(&e.calls) > 1)
                .map(|e| e.action.filter(|_| e.converging))
            {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    if let Some(entry) = machines.entries.get_mut(id) {
                        entry.deletes -= 1;
                    }
                    let doing = action.map_or("in a runtime call", Action::label);
                    return Err(Rejected::unavailable(format!(
                        "the machine is still {doing}; it is deleted once that returns, so ask again"
                    )));
                }
                machines = match self.settled.wait_timeout(machines, left.min(BOUNDED_TICK)) {
                    Ok((guard, _)) => guard,
                    Err(e) => e.into_inner().0,
                };
            }
        }
        let removed = self.remove(id, deadline);
        {
            let mut machines = locked(&self.machines);
            if removed.is_ok() {
                machines.entries.remove(id);
                self.changed.notify_all();
            } else if let Some(entry) = machines.entries.get_mut(id) {
                entry.deletes -= 1;
                if entry.deletes == 0 && Arc::strong_count(&entry.calls) == 1 {
                    entry.deleting = false;
                    entry.cancel = None;
                }
            }
        }
        removed?;
        self.forwarder.unpublish(id);
        Ok(())
    }

    fn remove(&self, id: &str, deadline: Instant) -> Result<(), Rejected> {
        let runtime = self.runtime.clone();
        let target = id.to_string();
        self.runtime_call(
            id,
            "the runtime's delete",
            deadline.saturating_duration_since(Instant::now()),
            move || runtime.delete(&target),
        )
        .map_err(|e| {
            if self.runtime_calls(id) > 0 {
                Rejected::unavailable(format!(
                    "{e:#}; the machine is deleted once it returns, so ask again"
                ))
            } else {
                Rejected::internal(format!("{e:#}"))
            }
        })?;
        let dir = machine_dir(&self.config.state_dir, id)
            .ok_or_else(|| Rejected::bad_request("invalid machine id"))?;
        match fs::remove_dir_all(&dir) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(Rejected::internal(e.to_string()))
            }
            _ => Ok(()),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: takes the right to write a machine's seed. Only a machine that exists and is stopped with nothing in flight is seeded, because the seed is read by the guest's first boot and a machine that is booting could read it half-written. The claim is held until the returned upload is committed or dropped, and no worker starts meanwhile. The machine's disk size bounds the seed: a home larger than the disk it is restored onto could never fit there. An upload let in by a seed capability rather than the token is held to more, checked under the same claim: see `capability_may_seed`.
    pub fn claim_seed(
        self: &Arc<Self>,
        id: &str,
        capability: Option<Verified>,
    ) -> Result<Seeding, Rejected> {
        check_id(id)?;
        let spec = read_spec(&self.config.state_dir, id)
            .ok_or_else(|| Rejected::not_found(format!("machine {id} does not exist")))?;
        if let Some(full) = self.storage_critical() {
            return Err(Rejected::insufficient_storage(full.refusal()));
        }
        let desired = {
            let mut machines = locked(&self.machines);
            let closed = machines.closed;
            let entry = machines.entries.entry(id.to_string()).or_default();
            if closed || entry.converging || entry.deleting || entry.seeding {
                return Err(Rejected::conflict(format!(
                    "machine {id} is busy; a seed is written only to a stopped machine with nothing in flight"
                )));
            }
            entry.seeding = true;
            entry.desired.clone()
        };
        let mut seeding = Seeding {
            server: self.clone(),
            id: id.to_string(),
            limit: u64::try_from(spec.storage_gib).unwrap_or(0) << 30,
            file: None,
            capability: None,
        };
        match self.runtime.state(id) {
            Ok(State::Stopped) => {}
            Ok(state) => {
                return Err(Rejected::conflict(format!(
                    "machine {id} is {state}; a seed is written only to a stopped machine"
                )))
            }
            Err(e) => return Err(Rejected::internal(format!("{e:#}"))),
        }
        let dir = state::require_machine_dir(&self.config.state_dir, id)
            .map_err(|e| Rejected::bad_request(e.to_string()))?;
        let share = dir.join(SHARE_DIR);
        if let Some(verified) = capability {
            let latest = desired.as_ref().unwrap_or(&spec);
            if let Err(refused) = capability_may_seed(id, latest, &dir, &verified) {
                tracing::warn!(
                    target: "security",
                    event = "seed.deny",
                    machine = %id,
                    capability = %verified.fingerprint,
                    reason = %refused.message,
                    "a seed capability was refused"
                );
                return Err(refused);
            }
            seeding.capability = Some(verified);
        }
        seeding.file = Some(
            SeedFile::create(&share)
                .map_err(|e| Rejected::internal(format!("staging the seed: {e}")))?,
        );
        Ok(seeding)
    }

    // UNIT_BOUNDARY_DESCRIPTION: removes the seed a machine has booted from and, when no upload holds the claim, whatever a runner killed mid-upload staged beside it. The check and the removal share one critical section, so a claim taken meanwhile cannot have its fresh staged file removed under it.
    pub fn remove_seed(&self, id: &str) -> Result<(), Rejected> {
        check_id(id)?;
        let dir = state::require_machine_dir(&self.config.state_dir, id)
            .map_err(|e| Rejected::bad_request(e.to_string()))?;
        let share = dir.join(SHARE_DIR);
        {
            let machines = locked(&self.machines);
            if !machines.entries.get(id).is_some_and(|e| e.seeding) {
                share::remove_staged_seed(&share).map_err(|e| Rejected::internal(e.to_string()))?;
            }
        }
        share::remove_seed(&share)
            .and_then(|()| share::forget_seed_digest(&dir))
            .map_err(|e| Rejected::internal(e.to_string()))
    }

    // UNIT_BOUNDARY_DESCRIPTION: runs one start, stop or delete call into the runtime through `bounded`, holding the machine's `calls` until the call itself returns rather than until the runner stops waiting for it.
    fn runtime_call<T: Send + 'static>(
        &self,
        id: &str,
        what: &str,
        limit: Duration,
        work: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
    ) -> anyhow::Result<T> {
        let held = locked(&self.machines)
            .entries
            .entry(id.to_string())
            .or_default()
            .calls
            .clone();
        bounded(what, Some(limit), None, None, move || {
            let _held = held;
            work()
        })
    }

    fn runtime_calls(&self, id: &str) -> usize {
        locked(&self.machines)
            .entries
            .get(id)
            .map_or(0, |e| Arc::strong_count(&e.calls) - 1)
    }

    fn converging(&self, id: &str) -> bool {
        locked(&self.machines)
            .entries
            .get(id)
            .is_some_and(|e| e.converging)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the worker that brings one machine to its latest spec. It runs one action, and steps again only if a newer spec arrived while that action ran — which is how a stop sent mid-boot is honoured once the boot returns. It never steps again on its own result: an action that succeeds and still leaves the machine short, such as a guest that dies as it boots, is retried on the next reconcile rather than in a tight loop. Each decision to end is taken in the critical section that ends the worker, because a spec a PUT stored between the two would find the worker still marked and start none.
    fn converge(&self, id: &str, first: Action, asked: u64) {
        let mut settle = Settle {
            server: self,
            id,
            armed: true,
        };
        let mut planned = Some((first, asked));
        loop {
            let (action, asked) = match planned.take() {
                Some(planned) => planned,
                None => match self.plan_next(id) {
                    Ok(next) => next,
                    Err(seen) => {
                        if settle.settles(&mut locked(&self.machines), Some(seen)) {
                            return;
                        }
                        continue;
                    }
                },
            };
            let spec = {
                let mut machines = locked(&self.machines);
                if settle.settles(&mut machines, None) {
                    return;
                }
                let Some(entry) = machines.entries.get_mut(id) else {
                    return;
                };
                if entry.asked != asked {
                    continue;
                }
                entry.action = Some(action);
                entry.health.action_started();
                entry.seen = None;
                entry.looked += 1;
                self.bump(entry);
                let spec = entry.desired.clone().unwrap_or_default();
                entry.acting_mib = spec.memory_mib;
                spec
            };
            self.run(id, action, spec);
            if settle.settles(&mut locked(&self.machines), Some(asked)) {
                return;
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the step towards the spec stored while the last action ran, against what the runtime reports now. Nothing to do, or a runtime that cannot be read, answers with the count of specs it planned from, so the worker ends only if no newer spec arrived meanwhile.
    fn plan_next(&self, id: &str) -> Result<(Action, u64), u64> {
        let (desired, asked) = {
            let machines = locked(&self.machines);
            let entry = machines.entries.get(id).ok_or(0u64)?;
            (entry.desired.clone().ok_or(entry.asked)?, entry.asked)
        };
        let seen = self.observe(id, false);
        let state = if seen.error.is_some() {
            State::Unknown
        } else {
            seen.state
        };
        let ready = state == State::Running && seen.ready;
        self.next_action(id, &desired, state, ready)
            .map(|action| (action, asked))
            .ok_or(asked)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the next action for a machine, as plan::step decides it, except that a machine another VM runtime booted is rebooted onto this runner's own when the runtime cannot say what state it is in (see foreign). For any other machine an unknown state is no reason to act.
    fn next_action(
        &self,
        id: &str,
        desired: &MachineSpec,
        state: State,
        ready: bool,
    ) -> Option<Action> {
        if state == State::Unknown && desired.running && self.foreign(id) {
            return Some(Action::Restart { unhealthy: true });
        }
        step(
            read_spec(&self.config.state_dir, id).as_ref(),
            desired,
            state,
            ready,
            self.dead_for_long(id),
        )
    }

    fn run(&self, id: &str, action: Action, mut spec: MachineSpec) {
        let auths = std::mem::take(&mut spec.pull_auths);
        let started = Instant::now();
        let result = match action {
            Action::Stop => self.stop_machine(id),
            Action::Create => self.create(id, &spec, &auths),
            Action::Start | Action::Restart { .. } => self.reshape(id, &spec, &auths, action),
        };
        self.metrics
            .operation(action, started.elapsed(), result.is_ok());
        let failure = result.err().map(|e| {
            let mut message = format!("{e:#}");
            tracing::error!(machine = %id, op = action.label(), error = %message, "machine action failed");
            let mut reason = failure_reason(&e);
            if reason == REASON_BOOT_FAILED {
                let tail = self.console_tail(id);
                if let Some((why, explained)) = self.boot_trouble(&tail) {
                    reason = why;
                    message = format!("{explained}; {message}");
                }
                message = with_console(&message, &tail);
            }
            self.metrics.failed(action, reason);
            Failed { message, reason }
        });
        {
            let mut machines = locked(&self.machines);
            if let Some(entry) = machines.entries.get_mut(id) {
                entry.failure = failure;
                self.bump(entry);
            }
        }
        self.observe(id, false);
    }

    fn create(&self, id: &str, spec: &MachineSpec, auths: &[String]) -> anyhow::Result<()> {
        write_share(
            &self.config.state_dir,
            id,
            spec,
            self.config.init.as_deref(),
            self.config.runc.as_deref(),
        )?;
        let port = {
            let _ports = locked(&self.ports);
            state::allocate_port(&self.config.state_dir, id, self.config.ports.clone())?
        };
        let (image, launch, digest) = self.resolve(id, spec, auths)?;
        self.record_digest(id, digest.as_deref())?;
        let dir = state::require_machine_dir(&self.config.state_dir, id)?;
        self.runtime.create(
            id,
            &Machine {
                spec,
                image: &image,
                host_port: port + LOOPBACK_OFFSET,
                share: &dir.join(SHARE_DIR),
                launch: &launch,
            },
        )?;
        write_spec(&self.config.state_dir, id, spec)?;
        self.forwarder.publish(id, port)?;
        if !spec.running {
            return Ok(());
        }
        self.seed_ready(id, spec)?;
        self.start_machine(id, Action::Create, spec)
    }

    // UNIT_BOUNDARY_DESCRIPTION: brings an existing machine to the spec in place: stopped if running, its record updated, started again — so it keeps its disk and its port, whatever changed. The stored spec is what the record holds, so it is written as the record is, before the boot: a boot that fails leaves the next action comparing against the shape the machine really has. A new image is fetched and its launch read before the machine is touched, so the agent is down for the stop and boot and not for a pull, and a pull that fails leaves it running as it was. The image is also resolved again when the record's tree is gone from the host — evicted, or an image directory moved or relaid under a stopped machine — because a start boots the path the record names and would otherwise fail every time until the image changed. The new digest is recorded only once the old machine is stopped, which is when the cache stops holding the old tree for it.
    fn reshape(
        &self,
        id: &str,
        spec: &MachineSpec,
        auths: &[String],
        action: Action,
    ) -> anyhow::Result<()> {
        self.seed_ready(id, spec)?;
        write_share(
            &self.config.state_dir,
            id,
            spec,
            self.config.init.as_deref(),
            self.config.runc.as_deref(),
        )?;
        let applied = read_spec(&self.config.state_dir, id);
        if spec.running {
            self.hold_images();
        }
        let image = match &applied {
            Some(applied) if applied.image == spec.image && self.runtime.image_present(id)? => None,
            _ => Some(self.resolve(id, spec, auths)?),
        };
        let port = state::port(&self.config.state_dir, id);
        if port != 0 {
            self.forwarder.publish(id, port)?;
        }
        if let Action::Restart { unhealthy } = action {
            if unhealthy {
                if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
                    entry.restarts += 1;
                    entry.gave_up = Some(Instant::now());
                    let quiet = entry
                        .health
                        .quiet_since
                        .and_then(|since| since.elapsed().ok());
                    tracing::warn!(machine = %id, restarts = entry.restarts, quiet_secs = quiet.map_or(0, |q| q.as_secs()), "guest stopped answering; restarting the machine");
                    self.bump(entry);
                }
                self.metrics.unhealthy_restart();
            }
            self.stop_machine(id)?;
        }
        if let Some((_, _, digest)) = &image {
            self.record_digest(id, digest.as_deref())?;
        }
        self.runtime.update(
            id,
            &Update {
                desired: spec,
                applied: applied.as_ref(),
                image: image
                    .as_ref()
                    .map(|(image, launch, _)| (image.as_str(), launch)),
            },
        )?;
        write_spec(&self.config.state_dir, id, spec)?;
        self.start_machine(id, action, spec)
    }

    // UNIT_BOUNDARY_DESCRIPTION: a machine whose spec expects a seed starts only while its share holds exactly that seed, or once its home is known to have come from it. A runner claim lost or recreated, a node that crashed before the upload was durable, or an operator can each take the seed away, and a machine started then would have platform-init refuse the boot at best. Refusing here, under a reason of its own, is what tells the controller to copy the home again rather than wait on a boot that can never succeed. A disk that already holds some other home is refused the same way, since that home is not the one the migration brought. The seed is compared by the digest its upload was answered with and by its size, not read again.
    fn seed_ready(&self, id: &str, spec: &MachineSpec) -> anyhow::Result<()> {
        let Some(expected) = &spec.expect_seed else {
            return Ok(());
        };
        let dir = state::require_machine_dir(&self.config.state_dir, id)?;
        let share = dir.join(SHARE_DIR);
        let from = share::seeded_from(&share);
        if from == expected.sha256 {
            return Ok(());
        }
        let wanted = format!(
            "this machine's home is to be restored from seed {} of {} bytes",
            expected.sha256, expected.bytes
        );
        if share::seeded(&share) {
            let held = if from.is_empty() {
                "a home that came from no seed".to_string()
            } else {
                format!("a home restored from seed {from}")
            };
            return Err(seed_missing(format!(
                "{wanted}, but its disk already holds {held}; it is not started"
            )));
        }
        let size = fs::metadata(share.join(share::SEED_FILE)).map(|m| m.len());
        match (size, share::seed_digest(&dir)) {
            (Ok(size), Some(stored)) if stored == *expected && size == expected.bytes => Ok(()),
            (Err(_), _) => Err(seed_missing(format!(
                "{wanted}, and the runner holds no seed for it; it is not started, so it cannot boot the image's home instead"
            ))),
            (Ok(_), Some(stored)) => Err(seed_missing(format!(
                "{wanted}, but the runner holds seed {} of {} bytes; it is not started",
                stored.sha256, stored.bytes
            ))),
            (Ok(_), None) => Err(seed_missing(format!(
                "{wanted}, but the seed the runner holds has no record of a finished upload; it is not started"
            ))),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: what a machine of this spec boots: the tree an install with no registry staged for the reference, or else the tree the image cache resolves it to, with the launch recorded beside it. If the node's cache service cannot be reached, a reference one of this runner's own machines already boots still boots the tree that machine holds: it is only read, and it was checked for this owner when that machine got it. Anything else the cache cannot serve is refused as an image problem, never booted straight from the registry. The machine stops waiting for the cache once its token is cancelled; the fetch itself is the cache's, may serve other machines of the image, and runs on to its own end.
    fn resolve(
        &self,
        id: &str,
        spec: &MachineSpec,
        auths: &[String],
    ) -> anyhow::Result<(String, ImageLaunch, Option<String>)> {
        let image = &spec.image;
        if !is_image_ref(image) || image.contains("..") {
            anyhow::bail!("invalid image reference {image:?}");
        }
        if let Some((staged, launch)) = self.staged_image(image)? {
            self.metrics.lookup(true);
            return Ok((staged.to_string_lossy().into_owned(), launch, None));
        }
        let Some(images) = self.config.images.clone() else {
            return Err(unusable(format!(
                "{image} is not staged in {}, and this runner has no image cache to fetch it from",
                self.config.image_dir.display()
            )));
        };
        let (reference, asked) = (image.clone(), auths.to_vec());
        let lookup = bounded(
            "fetching the image",
            None,
            Some(&self.cancel_token(id)),
            Some(&self.work),
            move || Ok(images.resolve(&reference, &asked)),
        )?;
        if let Some(fetched) = &lookup.fetched {
            self.metrics
                .fetched(Duration::from_millis(fetched.ms), fetched.ok);
            for bytes in &fetched.freed {
                self.metrics.evicted(*bytes);
            }
            if let Some(used) = fetched.used {
                self.metrics.cache_size(used);
            }
        }
        let resolved = match lookup.resolved {
            Ok(resolved) => resolved,
            Err(e) if lookup.unreachable => {
                let Some(held) = self.held_tree(image) else {
                    return Err(e);
                };
                tracing::warn!(error = %format!("{e:#}"), digest = %held.digest, "image cache: the service cannot be reached, so this machine boots the tree another of this runner's machines holds");
                held
            }
            Err(e) => return Err(e),
        };
        self.metrics.lookup(lookup.fetched.is_none());
        let rootfs = cache::digest_path(&self.config.image_dir, &resolved.digest).join(ROOTFS_DIR);
        Ok((
            rootfs.to_string_lossy().into_owned(),
            resolved.launch,
            Some(resolved.digest),
        ))
    }

    // UNIT_BOUNDARY_DESCRIPTION: the tree one of this runner's machines already boots for this reference — the same reference, or the digest a pinned one names — when its launch record is still beside it.
    fn held_tree(&self, image: &str) -> Option<Resolved> {
        let held = pinned_digest(image)
            .map(str::to_string)
            .filter(|digest| self.held_digests().contains(digest));
        let digest = held.or_else(|| {
            state::machine_ids(&self.config.state_dir)
                .ok()?
                .iter()
                .filter(|id| {
                    read_spec(&self.config.state_dir, id).is_some_and(|s| s.image == image)
                })
                .find_map(|id| self.recorded_digest(id))
        })?;
        let launch = read_launch(&cache::digest_path(&self.config.image_dir, &digest))
            .ok()
            .flatten()?;
        Some(Resolved { digest, launch })
    }

    fn start_machine(&self, id: &str, action: Action, spec: &MachineSpec) -> anyhow::Result<()> {
        if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
            entry.warming_since = Some(Instant::now());
            entry.boot = Some(Boot {
                at: Instant::now(),
                action,
                seed: spec.expect_seed.as_ref().map(|seed| seed.sha256.clone()),
                note: None,
            });
        }
        let started = Instant::now();
        let runtime = self.runtime.clone();
        let target = id.to_string();
        let size = spec.memory_mib;
        let own = self.config.runtime.clone().unwrap_or_default();
        let marker = state::require_machine_dir(&self.config.state_dir, id)?.join(BOOT_WHOLE_FILE);
        let whole = fs::read_to_string(&marker).is_ok_and(|runtime| runtime == own);
        let boot = if self.config.boot_mib > 0 && !whole {
            size.min(self.config.boot_mib)
        } else {
            size
        };
        let port = state::port(&self.config.state_dir, id);
        let result = self.runtime_call(id, "the runtime's start", RUNTIME_CALL_LIMIT, move || {
            boot_and_grow(&*runtime, &target, boot, size, || healthy(port))
        });
        self.metrics
            .start(action, started.elapsed(), result.is_ok());
        if let Ok(true) = result {
            if let Err(e) = crate::files::write(&marker, own.as_bytes(), state::PORT_MODE) {
                tracing::warn!(machine = %id, error = %format!("{e:#}"), "could not record that the machine cannot grow");
            }
        }
        if let (Ok(_), Some(own)) = (&result, &self.config.runtime) {
            state::write_runtime(&self.config.state_dir, id, own)?;
        }
        result.map(|_| ())
    }

    // UNIT_BOUNDARY_DESCRIPTION: a stop ends whatever boot the machine was waited on for. Without this a machine stopped before its guest ever answered would keep its stuck-boot note for as long as it stayed stopped.
    fn stop_machine(&self, id: &str) -> anyhow::Result<()> {
        if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
            if entry.boot.take().is_some_and(|boot| boot.note.is_some()) {
                self.bump(entry);
            }
        }
        let runtime = self.runtime.clone();
        let target = id.to_string();
        self.runtime_call(id, "the runtime's stop", RUNTIME_CALL_LIMIT, move || {
            runtime.stop(&target)
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: the machine's token, made on first use as a child of the runner's lifetime, so closing the runner cancels it as a delete does.
    fn cancel_token(&self, id: &str) -> CancellationToken {
        let mut machines = locked(&self.machines);
        match machines.entries.get_mut(id) {
            Some(entry) => entry
                .cancel
                .get_or_insert_with(|| self.lifetime.child_token())
                .clone(),
            None => self.lifetime.child_token(),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the machine's console, redacted with every env value this runner has been given for it and the ones its applied spec holds, the way a failed smolvm call's output is. A tail this runner cannot redact, because it holds no spec for the machine at all, is not shown.
    fn console_tail(&self, id: &str) -> String {
        self.redacted(id, &self.runtime.console_tail(id))
    }

    fn redacted(&self, id: &str, console: &str) -> String {
        let remembered = locked(&self.machines)
            .entries
            .get(id)
            .map(|e| e.secrets.clone())
            .filter(|secrets| !secrets.is_empty());
        let applied = read_spec(&self.config.state_dir, id);
        if remembered.is_none() && applied.is_none() {
            return String::new();
        }
        let mut secrets = remembered.unwrap_or_default();
        secrets.extend(applied.into_iter().flat_map(|spec| spec.env.into_values()));
        redact(console, secrets.iter().map(String::as_str))
    }

    // UNIT_BOUNDARY_DESCRIPTION: a guest that boots and never answers has no failure to report — its start call returned — so without this the Agent reads not ready for as long as it stays stuck, and why is only on the console. The prober writes the note once the boot is SLOW_BOOT_AFTER old and refreshes it no more often than that. A recorded failure carries its own tail and wins. An answer ends the boot: from then on a probe the guest misses is a health blip, not a boot still waited on, so the note does not come back for it.
    fn note_slow_boot(&self, id: &str) {
        let at = {
            let machines = locked(&self.machines);
            let Some(entry) = machines.entries.get(id) else {
                return;
            };
            let Some(boot) = &entry.boot else {
                return;
            };
            let state = entry
                .action
                .map(Action::state)
                .or(entry.seen.as_ref().map(|seen| seen.state));
            let waiting = entry.failure.is_none()
                && state.is_some_and(reads_ready)
                && !entry.seen.as_ref().is_some_and(|seen| seen.ready);
            let due = boot.at.elapsed() >= SLOW_BOOT_AFTER
                && boot
                    .note
                    .as_ref()
                    .is_none_or(|(_, noted, _)| noted.elapsed() >= SLOW_BOOT_AFTER);
            if !waiting || !due {
                return;
            }
            boot.at
        };
        let tail = self.console_tail(id);
        let (message, reason) = match self.boot_trouble(&tail) {
            Some((why, explained)) => (with_console(&explained, &tail), Some(why)),
            None => (with_console(SLOW_BOOT, &tail), None),
        };
        let mut machines = locked(&self.machines);
        let Some(entry) = machines.entries.get_mut(id) else {
            return;
        };
        let Some(boot) = entry.boot.as_mut().filter(|boot| boot.at == at) else {
            return;
        };
        let changed = boot
            .note
            .as_ref()
            .is_none_or(|(old, _, was)| *old != message || *was != reason);
        boot.note = Some((message, Instant::now(), reason));
        if changed {
            self.bump(entry);
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the scrape, with the gauges read as the runner stands now.
    pub fn metrics_text(&self) -> String {
        let committed = self
            .capacity()
            .committed(
                None,
                &self.committing(),
                &|other| self.known_running(other),
                &|other| self.resident(other),
                &|other| self.warming(other),
            )
            .ok();
        let cgroup = self.config.cgroup_dir.as_deref();
        // UNIT_BOUNDARY_DESCRIPTION: the sampler's last reading, absent until its first sample and wherever there is no cgroup to sample.
        let sampled = cgroup.and_then(|_| {
            let machines = locked(&self.machines);
            (machines.pressure.working_set_mib > 0).then(|| {
                (
                    machines.pressure.working_set_mib,
                    machines.pressure.pressured,
                )
            })
        });
        self.metrics.render(&Gauges {
            budget_bytes: self.config.image_budget,
            limit_mib: self.memory_limit_mib(),
            reserve_mib: self.config.reserve_mib,
            committed_mib: committed,
            storage: (self.config.measure_storage)(),
            cpu: cgroup.and_then(|c| crate::cpu::stat(c).ok()),
            cpu_limit_milli: cgroup.and_then(|c| crate::cpu::limit_milli(c).ok().flatten()),
            working_set_mib: sampled.map(|p| p.0),
            pressured: sampled.map(|p| p.1),
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: the usage read: the claim's use, the memory admission counts against the limit, and each machine's state, measured memory and disk, built from what the runner has recorded like a status is.
    pub fn usage(&self) -> anyhow::Result<RunnerUsage> {
        let committed = self.capacity().committed(
            None,
            &self.committing(),
            &|other| self.known_running(other),
            &|other| self.resident(other),
            &|other| self.warming(other),
        )?;
        let storage = (self.config.measure_storage)().unwrap_or(StorageUse { used: 0, usable: 0 });
        let ids = self.list()?;
        let seed_bytes = ids
            .iter()
            .filter_map(|id| machine_dir(&self.config.state_dir, id))
            .map(|dir| share::seed_bytes(&dir.join(SHARE_DIR)))
            .sum();
        let machines = ids
            .into_iter()
            .map(|id| {
                let status = self.status(&id);
                let cpu_milli = locked(&self.machines)
                    .entries
                    .get(&id)
                    .filter(|e| e.resident_mib.is_some() && status.state == STATE_RUNNING)
                    .map_or(0, |e| e.cpu_milli);
                MachineUsage {
                    disk_used_bytes: self.runtime.disk_used_bytes(&id).unwrap_or(0),
                    cpu_milli,
                    id,
                    state: status.state,
                    used_mib: status.used_mib,
                    disk_gib: status.disk_gib,
                }
            })
            .collect();
        let cpu = self.config.cgroup_dir.as_deref().and_then(|cgroup| {
            let limit_milli = crate::cpu::limit_milli(cgroup).ok().flatten();
            let stall = crate::cpu::pressure_percent(cgroup);
            if limit_milli.is_none() && stall.is_none() {
                return None;
            }
            let (used_milli, throttled_percent) =
                locked(&self.machines).cpu.figures().unwrap_or((0, 0));
            Some(CpuUsage {
                limit_milli: limit_milli.unwrap_or(0),
                used_milli,
                throttled_percent,
                pressure_percent: stall.map(|stall| stall.max(throttled_percent)),
            })
        });
        Ok(RunnerUsage {
            storage: StorageUsage {
                used_bytes: storage.used,
                usable_bytes: storage.usable,
                seed_bytes,
            },
            memory: MemoryUsage {
                limit_mib: self.memory_limit_mib(),
                committed_mib: committed,
            },
            cpu,
            machines,
        })
    }

    fn storage_critical(&self) -> Option<StorageUse> {
        (self.config.measure_storage)().filter(StorageUse::critical)
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether bringing a machine to its spec writes much to the claim: a new machine's disk. A start or restart of an existing machine writes only its logs and what its guest does, so a critical claim still lets it through. An image is fetched onto the node's disk, not the claim.
    fn writes_much(&self, id: &str, action: Option<Action>) -> bool {
        read_spec(&self.config.state_dir, id).is_none() || action == Some(Action::Create)
    }

    // UNIT_BOUNDARY_DESCRIPTION: on a critical claim a machine boots at the disk size it has, since a grow has ext4 fill in new block groups at boot; the larger size waits for a start that finds room, as any size change waits for the next start.
    fn hold_growth(&self, id: &str, spec: &mut MachineSpec) {
        if let Some(applied) = read_spec(&self.config.state_dir, id) {
            spec.storage_gib = spec.storage_gib.min(applied.storage_gib);
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: why a guest that failed to come up failed, when its storage explains it: the owner's claim is critically full or the guest's own disk is full, as its console says. A guest whose writes fail fails its boot with nothing typed in the error, so the storage is what explains it; the claim comes first because a full claim also fails every guest's writes.
    fn boot_trouble(&self, tail: &str) -> Option<(&'static str, String)> {
        if let Some(full) = self.storage_critical() {
            return Some((REASON_STORAGE_FULL, full.refusal()));
        }
        home_full(tail).then(|| {
            (
                REASON_HOME_FULL,
                "This agent's storage is full, so it stops as it starts. Free space by deleting files from another running agent or deleting an agent you no longer need, or request more storage.".to_string(),
            )
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: one look at the claim, every STORAGE_CHECK. Every machine's share gets a new grant of the bytes its guest may still add to the claim (StorageUse::guest_room), which platform-init holds the guest to; a claim that cannot be measured grants nothing, and the guests are then held to nothing. While it is short, every machine's share carries a request that its guest give back scratch: an id and the bytes asked of each running machine, its even part of what brings the claim SHED_STEP_PERCENT back under SHORT_PERCENT. A guest serves each request once, so a new one goes out only when the claim has filled SHED_STEP_PERCENT further since the last: the claim is mostly the agents' homes, which no guest gives back, and repeating the request would only have every guest delete its scratch again and again. What the guests keep beyond that is not the runner's to free.
    fn check_storage(&self) {
        let shares: Vec<(String, PathBuf)> = state::machine_ids(&self.config.state_dir)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|id| {
                let share = machine_dir(&self.config.state_dir, &id)?.join(SHARE_DIR);
                share.is_dir().then_some((id, share))
            })
            .collect();
        let running = locked(&self.machines)
            .entries
            .values()
            .filter(|e| e.seen.as_ref().is_some_and(|s| s.state == State::Running))
            .count();
        let storage = (self.config.measure_storage)();
        let grant = storage.map(|storage| {
            let id = self.versions.fetch_add(1, Ordering::Relaxed);
            format!("{id} {}\n", storage.guest_room(running))
        });
        for (id, share) in &shares {
            if let Err(e) = share::grant_storage_room(share, grant.as_deref()) {
                tracing::warn!(machine = %id, error = %e, "vm runner: cannot grant the machine's guest its room on the claim");
            }
        }
        let Some(storage) = storage else {
            return;
        };
        let was = self.storage_short.load(Ordering::Relaxed);
        let short = storage.short(was);
        self.storage_short.store(short, Ordering::Relaxed);
        let request = {
            let mut current = locked(&self.shed_request);
            let percent = storage.percent();
            if !short {
                *current = None;
            } else if current
                .as_ref()
                .is_none_or(|(at, _)| percent >= at + crate::storage::SHED_STEP_PERCENT)
            {
                let id = self.versions.fetch_add(1, Ordering::Relaxed);
                *current = Some((percent, format!("{id} {}\n", storage.to_shed(running))));
            }
            current.as_ref().map(|(_, text)| text.clone())
        };
        for (id, share) in shares {
            if let Err(e) = share::mark_storage_short(&share, request.as_deref()) {
                tracing::warn!(machine = %id, error = %e, "vm runner: cannot mark the machine's share with the claim's room");
            }
        }
        if short != was {
            tracing::warn!(
                percent = storage.percent(),
                used = storage.used,
                usable = storage.usable,
                short,
                "vm runner: the owner's storage claim changed between short of room and not"
            );
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the tree an install with no registry stages for this reference, beside the node cache's entries and under a name none of them can take, with the launch recorded beside it, which boots in place and before the cache is asked. A `docker save` archive staged under the same name is refused rather than passed over: smolvm flattens an archive inside the guest, which no guest does since platform-init became its init, and `image:stage-vm` stages a tree and removes the archive.
    fn staged_image(&self, image: &str) -> anyhow::Result<Option<(PathBuf, ImageLaunch)>> {
        let tree = cache::staged_path(&self.config.image_dir, image);
        if let Some(launch) = read_launch(&tree).map_err(|e| unusable(format!("{e:#}")))? {
            return Ok(Some((tree.join(ROOTFS_DIR), launch)));
        }
        let archive = cache::archive_path(&self.config.image_dir, image);
        if archive.exists() {
            return Err(unusable(format!(
                "{} is a staged image archive, which the runner does not boot; restage the image with `mise run image:stage-vm`",
                archive.display()
            )));
        }
        Ok(None)
    }

    // UNIT_BOUNDARY_DESCRIPTION: records the digest a machine is about to boot, before it boots, and holds it. The record is what this runner holds after a restart, when it knows its machines only from its state directory. With no digest the record is removed, because that machine boots a staged tree and holds no cache entry.
    fn record_digest(&self, id: &str, digest: Option<&str>) -> anyhow::Result<()> {
        let path = state::require_machine_dir(&self.config.state_dir, id)?.join(IMAGE_DIGEST_FILE);
        match digest {
            None => match fs::remove_file(&path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
                _ => Ok(()),
            },
            Some(digest) => {
                crate::files::write(&path, digest.as_bytes(), 0o644)
                    .map_err(|e| anyhow::anyhow!("recording the image a machine boots: {e}"))?;
                self.hold_images();
                Ok(())
            }
        }
    }

    fn recorded_digest(&self, id: &str) -> Option<String> {
        let dir = machine_dir(&self.config.state_dir, id)?;
        let digest = fs::read_to_string(dir.join(IMAGE_DIGEST_FILE)).ok()?;
        let digest = digest.trim();
        cache::is_digest(digest).then(|| digest.to_string())
    }

    // UNIT_BOUNDARY_DESCRIPTION: the digests this runner's machines boot, read from their records on disk rather than tracked alongside them, because the records outlive the process that wrote them.
    fn held_digests(&self) -> BTreeSet<String> {
        state::machine_ids(&self.config.state_dir)
            .unwrap_or_default()
            .iter()
            .filter_map(|id| self.recorded_digest(id))
            .collect()
    }

    // UNIT_BOUNDARY_DESCRIPTION: holds the digest of every machine that runs or is asked to, so the cache's eviction spares their trees. A stopped machine holds nothing: a hibernated agent would otherwise keep each image a deploy retires on the cache, and its start fetches the tree again when it is gone. A machine counts while the controller last asked for it running, so a wake holds it before the start checks it is there, or while it runs as last recorded or as the runtime says, so a stop in flight still holds the tree its guest reads, and so does every machine a runner adopts after a hand-off or a restart from its first hold, before the controller has sent it anything. It runs at start, after a machine records a new digest, before a start, and every HOLD_REFRESH. A hold that fails is reported and not returned: the machines keep running, and the next refresh tries again inside the lease.
    pub fn hold_images(&self) {
        let held: BTreeSet<String> = state::machine_ids(&self.config.state_dir)
            .unwrap_or_default()
            .iter()
            .filter(|id| {
                let asked = locked(&self.machines)
                    .entries
                    .get(*id)
                    .and_then(|e| e.desired.as_ref())
                    .is_some_and(|d| d.running);
                asked || self.known_running(id)
            })
            .filter_map(|id| self.recorded_digest(id))
            .collect();
        let Some(images) = &self.config.images else {
            return;
        };
        if held.is_empty() {
            return;
        }
        if let Err(e) = images.hold(&held) {
            tracing::warn!(error = %format!("{e:#}"), "image cache: cannot hold the images this runner's machines boot");
        }
    }

    fn memory_limit_mib(&self) -> i32 {
        self.config
            .cgroup_dir
            .as_deref()
            .and_then(crate::pressure::limit_mib)
            .and_then(|mib| i32::try_from(mib).ok())
            .unwrap_or(self.config.memory_mib)
    }

    fn capacity(&self) -> Capacity<'_> {
        Capacity {
            state_dir: &self.config.state_dir,
            limit_mib: self.memory_limit_mib(),
            reserve_mib: self.config.reserve_mib,
            headroom_mib: self.config.headroom_mib,
            boot_mib: self.config.boot_mib,
        }
    }

    fn warming(&self, id: &str) -> bool {
        locked(&self.machines)
            .entries
            .get(id)
            .is_some_and(MachineEntry::warming)
    }

    fn resident(&self, id: &str) -> Option<i32> {
        locked(&self.machines)
            .entries
            .get(id)
            .and_then(|e| e.resident_mib)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the memory each machine a worker is converging holds or is about to. A machine being created has no spec on disk yet, so without this two creates racing each other would both fit into the room for one. What counts is the action in flight as well as the spec stored behind it: a machine still booting holds its memory even when the spec behind the boot is a stop, and a restart may be moving between the applied size and the desired one, so it is counted at the larger of the two.
    fn committing(&self) -> BTreeMap<String, i32> {
        let converging: Vec<(String, Option<i32>, Option<i32>)> = locked(&self.machines)
            .entries
            .iter()
            .filter(|(_, entry)| entry.converging)
            .map(|(id, entry)| {
                let booting = entry
                    .action
                    .filter(|action| *action != Action::Stop)
                    .map(|_| entry.acting_mib);
                let desired = entry
                    .desired
                    .as_ref()
                    .filter(|d| d.running)
                    .map(|d| d.memory_mib);
                (id.clone(), booting, desired)
            })
            .collect();
        converging
            .into_iter()
            .filter(|(_, booting, desired)| booting.is_some() || desired.is_some())
            .map(|(id, booting, desired)| {
                let applied = booting
                    .and_then(|_| read_spec(&self.config.state_dir, &id))
                    .map(|s| s.memory_mib);
                let mib = [booting, desired, applied].into_iter().flatten().max();
                (id, mib.unwrap_or(0))
            })
            .collect()
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the machine fits the runner's memory, counting the machines running and the ones being brought up. Running is what the prober last recorded, so admitting one machine costs no probe per machine.
    fn room_for(&self, id: &str, spec: &MachineSpec) -> anyhow::Result<()> {
        self.capacity().room_for(
            id,
            spec.memory_mib,
            &self.committing(),
            &|other| self.known_running(other),
            &|other| self.resident(other),
            &|other| self.warming(other),
        )
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the machine has been quiet past its limit. A guest that answered is remembered in this process's memory and also in the share's seeded record, which outlives the process. After a hand-off, a runner restart or a crash the memory is empty, so the record is what lets the new runner restart a guest that answered before and went quiet before or during the change.
    fn dead_for_long(&self, id: &str) -> bool {
        let foreign = self.foreign(id);
        let share = machine_dir(&self.config.state_dir, id).map(|dir| dir.join(SHARE_DIR));
        let seeded = share.as_deref().is_some_and(share::seeded);
        locked(&self.machines).entries.get(id).is_some_and(|e| {
            let limit = if copies_disk(e) {
                crate::plan::COPYING_RESTART
            } else {
                quiet_limit(foreign, e.boot.is_none(), e.gave_up.map(|at| at.elapsed()))
            };
            let health = Health {
                ever_ready: e.health.ever_ready || seeded,
                ..e.health
            };
            health.quiet_beyond(SystemTime::now(), limit)
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the machine's running VMM was booted by another VM runtime than this runner's — an older release's, which handed the machine over. A machine with no record of its runtime was started before runtimes were recorded, and counts as foreign. Such a machine is managed as if the two runtimes were compatible; a runtime error on it, or a guest gone quiet past plan::FOREIGN_UNHEALTHY_RESTART, reboots it onto this runner's runtime instead of waiting.
    fn foreign(&self, id: &str) -> bool {
        self.config
            .runtime
            .as_ref()
            .is_some_and(|own| state::runtime(&self.config.state_dir, id).as_ref() != Some(own))
    }

    // UNIT_BOUNDARY_DESCRIPTION: what the runtime and the guest say about the machine now. The guest is asked only in a state its answer may be believed in.
    fn look(&self, id: &str) -> Seen {
        match self.runtime.state(id) {
            Ok(state) => Seen {
                state,
                ready: reads_ready(state) && healthy(state::port(&self.config.state_dir, id)),
                error: None,
            },
            Err(e) => Seen {
                state: State::Unknown,
                ready: false,
                error: Some(format!("{e:#}")),
            },
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether what was last recorded about the machine is as current as the prober keeps it: no older than its probe cadence, or about a stopped or absent machine, which only an action changes. A PUT then plans from that record rather than looking again: a look at a running machine pings its guest agent and asks the guest's health endpoint, which costs a wake's PUT about 100 ms right after the start that already looked, and a quiet guest three seconds. A record that holds a runtime error, or one about a machine being deleted, is looked at again.
    fn seen_lately(&self, id: &str) -> bool {
        locked(&self.machines).entries.get(id).is_some_and(|e| {
            !e.deleting
                && e.seen.as_ref().is_some_and(|seen| seen.error.is_none())
                && probe_every(e)
                    .is_none_or(|every| e.probed.is_some_and(|at| at.elapsed() < every))
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: looks at the machine now and records it. A machine's own worker records what it saw unconditionally; anyone else passes `guarded`, and what they saw is dropped if something newer was recorded while they looked.
    fn observe(&self, id: &str, guarded: bool) -> Seen {
        let guard = guarded.then(|| {
            locked(&self.machines)
                .entries
                .get(id)
                .map_or(0, |e| e.looked)
        });
        let seen = self.look(id);
        self.record(id, seen.clone(), guard);
        seen
    }

    // UNIT_BOUNDARY_DESCRIPTION: stores what was seen, and moves the status version only when the status it reports changes. A machine the runner has no entry for is remembered only once it exists, so asking about names that are not machines here leaves nothing behind, and a probe answering after its machine was deleted puts no entry back. The first answer from the guest ends the boot the runner was waiting on and is timed under the action that started it, before the status moves, so a reader that sees the machine ready also sees how long it took.
    fn record(&self, id: &str, seen: Seen, guard: Option<u64>) {
        // UNIT_BOUNDARY_DESCRIPTION: written before the lock is taken, so a stalled disk holds up only this machine, and before the answer marks it ready, so a status that reads ready reads the record.
        if seen.ready {
            let ending = locked(&self.machines)
                .entries
                .get(id)
                .filter(|e| guard.is_none_or(|looked| looked == e.looked))
                .and_then(|e| e.boot.as_ref().map(|boot| boot.seed.clone()));
            if let Some(seed) = ending {
                self.record_seeded(id, seed.as_deref());
            }
        }
        let mut machines = locked(&self.machines);
        let known = machines.entries.get(id).map(|e| e.looked);
        if guard.is_some_and(|looked| looked != known.unwrap_or(0)) {
            return;
        }
        if seen.state == State::Absent && known.is_none() {
            return;
        }
        let entry = machines.entries.entry(id.to_string()).or_default();
        let answered = if seen.ready { entry.boot.take() } else { None };
        if let Some(boot) = &answered {
            self.metrics.became_ready(boot.action, boot.at.elapsed());
        }
        let mut seen = seen;
        let now = SystemTime::now();
        let settled = entry.action.is_none() && seen.state == State::Running;
        // UNIT_BOUNDARY_DESCRIPTION: an answer counts whatever the machine is doing — a guest that answered while its start call still ran has answered, and would otherwise flap on the first miss after the call returned. A miss counts only for a settled machine: during an action, and in every other state, silence is expected.
        if seen.ready || settled {
            entry.health.observed_running(seen.ready, now);
        }
        seen.ready |= settled && entry.boot.is_none() && entry.health.within_grace(now);
        let mut changed = entry.seen.as_ref() != Some(&seen);
        changed |= answered.as_ref().is_some_and(|boot| boot.note.is_some());
        entry.seen = Some(seen);
        entry.looked += 1;
        entry.probed = Some(Instant::now());
        if changed {
            self.bump(entry);
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: a guest that answers has booted past platform-init, which starts the image only once the agent's home is on the disk. So the first answer of a boot is when the runner records, in the machine's share, that its disk holds a home; from then on platform-init refuses a boot that finds it gone. When the boot expected a seed, the record names it: platform-init starts the image only once the home came from exactly that seed, so the answer proves which seed the home holds, and that is what the status reports as the seed the home came from. Both are learned from the answer rather than read off the disk, because the host does not parse a filesystem a guest has had root on. A record that cannot be written is logged, and the next boot's answer tries again.
    fn record_seeded(&self, id: &str, from: Option<&str>) {
        let Some(share) =
            state::machine_dir(&self.config.state_dir, id).map(|dir| dir.join(SHARE_DIR))
        else {
            return;
        };
        if share.is_dir() && !share::seeded(&share) {
            if let Err(e) = share::record_seeded(&share, from) {
                tracing::warn!(machine = %id, error = %format!("{e:#}"), "could not record that the machine's disk holds a home");
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: one probe of one machine. While an action is in flight the runtime is not asked — the action is the state — but the guest is, because it can answer before the start call that booted it returns. A probe that finds the machine quiet past its limit restarts it at once, by ensuring the latest spec the controller sent, rather than waiting up to a minute for the controller's next reconcile to do the same.
    fn probe(self: &Arc<Self>, id: &str) {
        let Some((action, looked)) = locked(&self.machines)
            .entries
            .get(id)
            .map(|e| (e.action, e.looked))
        else {
            return;
        };
        let seen = match action {
            Some(action) => Seen {
                state: action.state(),
                ready: reads_ready(action.state())
                    && healthy(state::port(&self.config.state_dir, id)),
                error: None,
            },
            None => self.look(id),
        };
        let running = seen.state == State::Running;
        let resident = running.then(|| self.runtime.resident_mib(id)).flatten();
        let cpu = running
            .then(|| self.runtime.cpu_usec(id))
            .flatten()
            .map(|usec| (Instant::now(), usec));
        self.record(id, seen, Some(looked));
        if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
            entry.resident_mib = resident;
            entry.cpu_milli = match (entry.cpu, cpu) {
                (Some((from, before)), Some((to, now))) if now >= before => {
                    let micros = to.duration_since(from).as_micros() as u64;
                    ((now - before) * 1000)
                        .checked_div(micros)
                        .unwrap_or(entry.cpu_milli)
                }
                _ => 0,
            };
            entry.cpu = cpu;
        }
        self.note_slow_boot(id);
        if !self.dead_for_long(id) {
            return;
        }
        let desired = locked(&self.machines)
            .entries
            .get(id)
            .filter(|e| !e.converging && !e.deleting)
            .and_then(|e| e.desired.clone());
        if let Some(spec) = desired {
            let _ = self.put(id, spec);
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: starts a probe of each machine that is due and has none in flight, up to PROBES_IN_FLIGHT at once. Each runs on its own blocking thread, so a guest that hangs its health check costs its own probe the timeout and does not stretch the cadence of every other machine on its way up.
    fn probe_due(self: &Arc<Self>) {
        let due: Vec<String> = {
            let mut machines = locked(&self.machines);
            if machines.closed {
                return;
            }
            let room = PROBES_IN_FLIGHT
                .saturating_sub(machines.entries.values().filter(|e| e.probing).count());
            let due: Vec<String> = machines
                .entries
                .iter()
                .filter(|(_, entry)| {
                    !entry.probing
                        && probe_every(entry).is_some_and(|every| {
                            entry.probed.is_none_or(|at| at.elapsed() >= every)
                        })
                })
                .map(|(id, _)| id.clone())
                .take(room)
                .collect();
            for id in &due {
                if let Some(entry) = machines.entries.get_mut(id) {
                    entry.probing = true;
                }
            }
            due
        };
        for id in due {
            let server = self.clone();
            self.work.spawn_blocking(move || {
                let _probing = Probing {
                    server: &server,
                    id: &id,
                };
                server.probe(&id);
            });
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the machine runs, as last recorded, or as the runtime says when nothing has been recorded yet. The guest is never asked: admission asks this of every machine under its lock, and a silent guest would hold every start for its health timeout.
    fn known_running(&self, id: &str) -> bool {
        let recorded = locked(&self.machines)
            .entries
            .get(id)
            .and_then(|e| e.seen.as_ref().map(|seen| seen.state));
        recorded.or_else(|| self.runtime.state(id).ok()) == Some(State::Running)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what the controller is told about a machine, built from what the runner has recorded: no runtime call and no probe, except for a machine nothing has been recorded about yet. An action in flight is reported as the machine's state. A guest that answers its health endpoint is ready even before the start call that booted it returns — but only on the way up.
    pub fn status(&self, id: &str) -> MachineStatus {
        self.report(id).1
    }

    fn report(&self, id: &str) -> (State, MachineStatus) {
        let unseen = locked(&self.machines)
            .entries
            .get(id)
            .is_none_or(|e| e.action.is_none() && e.seen.is_none());
        let looked = unseen.then(|| self.observe(id, true));
        let port = state::port(&self.config.state_dir, id);
        let applied = read_spec(&self.config.state_dir, id);
        let machines = locked(&self.machines);
        let entry = machines.entries.get(id);
        let action = entry.and_then(|e| e.action);
        let seen = entry.and_then(|e| e.seen.clone()).or(looked);
        let failed = entry.and_then(|e| e.failure.clone());
        let state = action
            .map(Action::state)
            .or(seen.as_ref().map(|seen| seen.state))
            .unwrap_or(State::Absent);
        let mut status = MachineStatus {
            state: state.to_string(),
            reason: failed
                .as_ref()
                .map(|f| f.reason.to_string())
                .unwrap_or_default(),
            restarts: entry.map_or(0, |e| e.restarts),
            port: i32::from(port),
            ready: reads_ready(state) && seen.as_ref().is_some_and(|seen| seen.ready),
            message: failed
                .as_ref()
                .map(|f| f.message.clone())
                .unwrap_or_default(),
            version: entry.map_or(0, |e| e.version),
            ..MachineStatus::default()
        };
        if let Some(spec) = applied {
            status.cpus = spec.cpus;
            status.memory_mib = spec.memory_mib;
            status.disk_gib = spec.storage_gib;
            status.used_mib = entry
                .and_then(|e| e.resident_mib)
                .filter(|_| state == State::Running)
                .unwrap_or(0);
            status.warming = state == State::Running && entry.is_some_and(MachineEntry::warming);
            status.nested = spec.nested_virtualization && self.runtime.nests();
        }
        if state == State::Unknown && status.message.is_empty() {
            status.message = seen.and_then(|seen| seen.error).unwrap_or_default();
        }
        let note = entry
            .and_then(|e| e.boot.as_ref())
            .and_then(|boot| boot.note.as_ref())
            .filter(|_| failed.is_none() && !status.ready && reads_ready(state));
        if failed.is_none() && !status.ready && reads_ready(state) && entry.is_some_and(copies_disk)
        {
            status.reason = REASON_COPYING_DISK.into();
            status.message = COPYING_DISK.into();
        }
        if let Some((note, _, reason)) = note {
            if let Some(reason) = reason {
                status.reason = reason.to_string();
            }
            status.message = if status.message.is_empty() {
                note.clone()
            } else {
                format!("{}; {note}", status.message)
            };
        }
        drop(machines);
        // UNIT_BOUNDARY_DESCRIPTION: read after the lock is let go, so a stalled disk holds up only this read. A guest's first answer writes the seeded record before it marks the machine ready, so a status that read ready above reads the record from that answer.
        let dir = machine_dir(&self.config.state_dir, id);
        status.home_seeded_from = dir
            .as_ref()
            .map(|dir| share::seeded_from(&dir.join(SHARE_DIR)))
            .unwrap_or_default();
        (state, status)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether the boot the runner waits on copies a disk before its guest first answers: its spec expects a migration's seed, which platform-init restores before it starts the image. Such a boot is held up to plan::COPYING_RESTART and reported as REASON_COPYING_DISK, so neither the runner nor the controller takes its silence for a failed start.
fn copies_disk(entry: &MachineEntry) -> bool {
    entry.boot.as_ref().is_some_and(|boot| boot.seed.is_some())
}

const COPYING_DISK: &str =
    "the guest is copying its disk before it starts the agent; a large home can take hours";

// UNIT_BOUNDARY_DESCRIPTION: the VM runtime that could not grow the machine, kept beside its spec. While it names this runner's runtime, the machine boots whole: a guest that cannot grow would otherwise pay a small boot and a failed grow on every start. A runner release with another runtime tries the grow again. It goes with the machine on delete.
pub const BOOT_WHOLE_FILE: &str = "boot-whole";

// UNIT_BOUNDARY_DESCRIPTION: boots a machine with `boot` MiB of guest RAM and then grows it to its `size`, and answers whether the grow failed. A guest's kernel writes a page descriptor for every page of its RAM before it runs anything, and under nested virtualization that costs 65 to 85 ms per GiB, so a 12 GiB machine booted whole spends most of a second on RAM it does not need yet. The grow runs as soon as the start returns, while the workload is starting, and readiness does not wait for it: the prober reports the guest ready when it answers. A machine that cannot grow and whose guest has not answered yet is booted again at its full size. A guest that already answered is left running at its boot size, because the agent reads ready by then, and a reboot would drop a prompt sent to it; its next start boots it whole.
fn boot_and_grow(
    runtime: &dyn Runtime,
    id: &str,
    boot: i32,
    size: i32,
    answered: impl Fn() -> bool,
) -> anyhow::Result<bool> {
    runtime.start(id, boot, size)?;
    if boot == size {
        return Ok(false);
    }
    let Err(e) = runtime.grow(id, size) else {
        return Ok(false);
    };
    if answered() {
        tracing::warn!(machine = id, error = %format!("{e:#}"), boot_mib = boot, memory_mib = size, "the guest could not grow to its size and already answered; it runs at its boot size until its next start");
        return Ok(true);
    }
    tracing::warn!(machine = id, error = %format!("{e:#}"), boot_mib = boot, memory_mib = size, "the guest could not grow to its size; booting it again whole");
    runtime.stop(id)?;
    runtime.start(id, size, size)?;
    Ok(true)
}

// UNIT_BOUNDARY_DESCRIPTION: what a seed capability may seed, beyond the machine it is signed for. The machine must be marked as created for a migration in the latest spec the runner holds for it, so a capability never reaches a machine that is not being migrated. Its disk must hold no home yet — no guest has answered from it — so a capability never replaces a home. A seed already stored but not yet booted from may be replaced: an attempt can store its seed and still fail, its answer lost, and only the next Job's fresh capability can then finish the copy, since the controller removes a seed only once the guest has booted from it. The controller moves past the copy only after a Job succeeds, and drops the migration mark then, so no capability reaches a seed it has accepted. And the capability must not have been spent: each one seeds once, recorded on the runner's claim beside the machine, where it outlives a runner restart.
fn capability_may_seed(
    id: &str,
    latest: &MachineSpec,
    dir: &std::path::Path,
    capability: &Verified,
) -> Result<(), Rejected> {
    let share = dir.join(SHARE_DIR);
    if latest.migration.is_none() {
        return Err(Rejected::conflict(format!(
            "machine {id} is not being migrated; a seed capability seeds only a machine created for a migration"
        )));
    }
    if share::seeded(&share) {
        return Err(Rejected::conflict(format!(
            "machine {id} already holds a home; a seed capability does not replace one"
        )));
    }
    if spent_capabilities(dir).contains(&capability.nonce) {
        return Err(Rejected::conflict(format!(
            "this seed capability was already used on machine {id}; each seeds once"
        )));
    }
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the nonces of the seed capabilities a machine was seeded with, one per line, in its state directory rather than its share, since nothing in the guest has a reason to read them. It goes with the machine on delete.
pub const SPENT_CAPABILITIES_FILE: &str = "seed-capabilities";

fn spent_capabilities(dir: &std::path::Path) -> Vec<String> {
    fs::read_to_string(dir.join(SPENT_CAPABILITIES_FILE))
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

fn spend_capability(dir: &std::path::Path, nonce: &str) -> std::io::Result<()> {
    let mut spent = spent_capabilities(dir);
    spent.push(nonce.to_string());
    crate::files::write(
        &dir.join(SPENT_CAPABILITIES_FILE),
        format!("{}\n", spent.join("\n")).as_bytes(),
        state::SPEC_MODE,
    )
}

// UNIT_BOUNDARY_DESCRIPTION: how often, in bytes written, a seed upload looks at the claim's room. A look is a statvfs, cheap but not free at every chunk of a many-GiB home; the claim can pass the line by at most this much before the upload stops.
const SEED_ROOM_CHECK: u64 = 64 << 20;

// UNIT_BOUNDARY_DESCRIPTION: a seed write the claim had no room for is the owner's storage being full, and is reported as such, with the ways to free it, rather than as the runner's own failure.
fn seed_write_refused(step: &str, e: &std::io::Error) -> Rejected {
    if matches!(e.raw_os_error(), Some(libc::ENOSPC | libc::EDQUOT)) {
        return Rejected::insufficient_storage(format!(
            "{step} the seed: {e}. Your VM agents' shared storage is full. To free space, delete a VM agent you no longer need or files from this agent's home, or request more storage."
        ));
    }
    Rejected::internal(format!("{step} the seed: {e}"))
}

// UNIT_BOUNDARY_DESCRIPTION: one seed upload, holding its machine's seed claim. Every chunk is counted against the machine's disk size before it is written. A commit renames the seed into the share unless the machine was deleted meanwhile; dropped uncommitted, the staged file is removed. Either way the claim is released, so the machine can be booted. `capability` is the seed capability that let the upload in, when the token did not.
pub struct Seeding {
    server: Arc<Server>,
    id: String,
    limit: u64,
    file: Option<SeedFile>,
    capability: Option<Verified>,
}

impl Seeding {
    pub fn write(&mut self, chunk: &[u8]) -> Result<(), Rejected> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| Rejected::internal("the seed was not staged"))?;
        let (before, after) = (
            file.bytes(),
            file.bytes().saturating_add(chunk.len() as u64),
        );
        if after > self.limit {
            return Err(Rejected::too_large(format!(
                "the seed is larger than machine {}'s {} byte disk",
                self.id, self.limit
            )));
        }
        if before / SEED_ROOM_CHECK != after / SEED_ROOM_CHECK {
            if let Some(refusal) =
                (self.server.config.measure_storage)().and_then(|claim| claim.seed_refusal(after))
            {
                return Err(Rejected::insufficient_storage(refusal));
            }
        }
        file.write(chunk)
            .map_err(|e| seed_write_refused("writing", &e))
    }

    // UNIT_BOUNDARY_DESCRIPTION: a capability is spent before the seed is stored, so it never seeds twice even when storing fails; the retry then takes the fresh capability the controller mints for its next Job. Every stored seed goes on the security trail with its size, digest and what let it in, naming a capability only by its fingerprint.
    pub fn commit(mut self) -> Result<SeedResult, Rejected> {
        let file = self
            .file
            .take()
            .ok_or_else(|| Rejected::internal("the seed was not staged"))?;
        let deleting = locked(&self.server.machines)
            .entries
            .get(&self.id)
            .is_none_or(|e| e.deleting);
        if deleting {
            return Err(Rejected::conflict(format!(
                "machine {} was deleted while its seed was uploaded",
                self.id
            )));
        }
        let dir = state::require_machine_dir(&self.server.config.state_dir, &self.id)
            .map_err(|e| Rejected::bad_request(e.to_string()))?;
        if let Some(capability) = &self.capability {
            spend_capability(&dir, &capability.nonce)
                .map_err(|e| Rejected::internal(format!("recording the seed capability: {e}")))?;
        }
        share::forget_seed_digest(&dir)
            .map_err(|e| Rejected::internal(format!("replacing the seed's record: {e}")))?;
        let stored = file
            .commit()
            .map_err(|e| seed_write_refused("storing", &e))?;
        share::record_seed_digest(&dir, &stored)
            .map_err(|e| Rejected::internal(format!("recording the seed: {e:#}")))?;
        let (authority, fingerprint, expires) = match &self.capability {
            Some(c) => ("capability", c.fingerprint.as_str(), c.expires),
            None => ("token", "", 0),
        };
        tracing::info!(
            target: "security",
            event = "seed.accept",
            machine = %self.id,
            bytes = stored.bytes,
            sha256 = %stored.sha256,
            authority,
            capability = fingerprint,
            expires,
            "a seed was stored"
        );
        Ok(stored)
    }
}

impl Drop for Seeding {
    fn drop(&mut self) {
        drop(self.file.take());
        if let Some(entry) = locked(&self.server.machines).entries.get_mut(&self.id) {
            entry.seeding = false;
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: how often a bounded wait looks at its token.
const BOUNDED_TICK: Duration = Duration::from_millis(50);

// UNIT_BOUNDARY_DESCRIPTION: runs `work` on a thread of its own and waits for its answer until `limit` passes or `cancel` is cancelled. Work that cannot be interrupted is then no longer waited on: it runs on to its end and its answer is dropped. With `tracker` the thread joins that barrier, so closing the runner still waits for it. Without one it is a plain thread, which is what a runtime call needs: one stuck in the kernel then never holds up the close. A panic in `work` is an error here, not a panic of the caller.
fn bounded<T: Send + 'static>(
    what: &str,
    limit: Option<Duration>,
    cancel: Option<&CancellationToken>,
    tracker: Option<&TaskTracker>,
    work: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> anyhow::Result<T> {
    let (answer, answered) = std::sync::mpsc::sync_channel(1);
    let run = move || {
        let _ = answer.send(work());
    };
    match tracker {
        Some(tracker) => drop(tracker.spawn_blocking(run)),
        None => drop(
            std::thread::Builder::new()
                .name("bounded".into())
                .spawn(run)?,
        ),
    }
    let deadline = limit.map(|limit| Instant::now() + limit);
    loop {
        let tick = deadline.map_or(BOUNDED_TICK, |deadline| {
            deadline
                .saturating_duration_since(Instant::now())
                .min(BOUNDED_TICK)
        });
        if tick.is_zero() {
            anyhow::bail!(
                "{what} did not return within {}s",
                limit.unwrap_or_default().as_secs()
            );
        }
        match answered.recv_timeout(tick) {
            Ok(result) => return result,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                anyhow::bail!("{what} ended without an answer")
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if cancel.is_some_and(CancellationToken::is_cancelled) {
                    anyhow::bail!("{what} was cancelled: the machine is being deleted or the runner is closing");
                }
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: clears a machine's probing mark when its probe ends, however it ends. A probe that panicked would otherwise leave the mark set, and the prober never probes that machine again.
struct Probing<'a> {
    server: &'a Server,
    id: &'a str,
}

impl Drop for Probing<'_> {
    fn drop(&mut self) {
        if let Some(entry) = locked(&self.server.machines).entries.get_mut(self.id) {
            entry.probing = false;
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: ends a machine's worker. On the worker's own ways out it ends it under the lock that decided to, and is disarmed; dropped still armed — a panic — it ends the worker on the way out, so a delete waiting for the worker is never left waiting and the next spec can start a new one.
struct Settle<'a> {
    server: &'a Server,
    id: &'a str,
    armed: bool,
}

impl Settle<'_> {
    // UNIT_BOUNDARY_DESCRIPTION: whether the worker is done — the runner closed, the machine deleted or gone, or, given `asked`, no spec arrived after the `asked`-th — and if so ends it while the caller still holds the lock. A PUT then either lands first and is acted on, or lands after and starts a worker of its own.
    fn settles(&mut self, machines: &mut Machines, asked: Option<u64>) -> bool {
        let closed = machines.closed;
        let Some(entry) = machines.entries.get_mut(self.id) else {
            self.armed = false;
            return true;
        };
        if !closed && !entry.deleting && asked != Some(entry.asked) {
            return false;
        }
        self.server.end_worker(entry);
        self.armed = false;
        true
    }
}

impl Drop for Settle<'_> {
    fn drop(&mut self) {
        if self.armed {
            if let Some(entry) = locked(&self.server.machines).entries.get_mut(self.id) {
                self.server.end_worker(entry);
            }
        }
        self.server.settled.notify_all();
    }
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
