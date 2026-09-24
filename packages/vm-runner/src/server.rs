use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::ops::RangeInclusive;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::api::{MachineSpec, MachineStatus, State, REASON_BOOT_FAILED, REASON_OUT_OF_CAPACITY};
use crate::cache::{self, pinned_digest};
use crate::cacheapi::CacheClient;
use crate::capacity::Capacity;
use crate::console::{with_console, SLOW_BOOT, SLOW_BOOT_AFTER};
use crate::fetch::{failure_reason, unusable};
use crate::forward::{healthy, Forwarder, Listen, LOOPBACK_OFFSET};
use crate::imagecache::{
    CacheConfig, ImageCache, Images, Resolved, HOLD_LEASE, REF_FRESH, ROOTFS_DIR,
};
use crate::launch::{launch_from_archive, read_launch, ImageLaunch};
use crate::locked;
use crate::metrics::{Gauges, Metrics};
use crate::plan::{admissible, reads_ready, step, Action, Health};
use crate::runtime::{redact, Machine, Runtime, Update};
use crate::share::{write_share, SHARE_DIR};
use crate::state::{
    self, is_image_ref, is_machine_id, machine_dir, read_spec, write_spec, IMAGE_DIGEST_FILE,
};

// UNIT_BOUNDARY_DESCRIPTION: the machine API behind the HTTP layer: one persistent microVM per vm Agent, converged on the latest spec the controller sent. A PUT stores that spec and makes sure one worker is converging the machine; the worker takes one whole action at a time, and GET reports the action in flight as the machine's state. What a machine is survives the runner on disk — its spec, its port, its share. What the runner is doing to it lives in one entry per machine here and is lost with the process.

// UNIT_BOUNDARY_DESCRIPTION: how often the health prober asks the runtime and the guest about a machine. A machine on its way up is asked often, because the time between its guest answering and the controller hearing of it is the last part of a wake the user waits for. A steady one is asked rarely: a missed answer there only counts towards an unhealthy restart minutes away. A stopped or absent machine is not asked at all, since only an action changes it.
pub const BOOT_PROBE: Duration = Duration::from_millis(500);
pub const STEADY_PROBE: Duration = Duration::from_secs(10);
const PROBE_TICK: Duration = Duration::from_millis(100);
const PROBES_IN_FLIGHT: usize = 16;

// UNIT_BOUNDARY_DESCRIPTION: the longest a status read waits for the machine's status to change.
pub const STATUS_WAIT_CAP: Duration = Duration::from_secs(30);

// UNIT_BOUNDARY_DESCRIPTION: how long closing the runner waits for the actions already running. They are cancelled first, so the wait covers only work that does not answer cancellation — a VMM call cannot be interrupted part-way.
pub const CLOSE_GRACE: Duration = Duration::from_secs(30);

// UNIT_BOUNDARY_DESCRIPTION: how often the runner names the digests its machines boot to the image cache again. Well inside HOLD_LEASE, so one missed refresh never lets a hold lapse.
pub const HOLD_REFRESH: Duration = Duration::from_secs(60);

// UNIT_BOUNDARY_DESCRIPTION: what a runner is given at start, as the flags the controller sets on the runner's Deployment. With `image_cache_socket` the image directory is the node's cache, read-only here, and every image is resolved by the node's service; without it the runner is the one writer of its own cache.
pub struct Config {
    pub state_dir: PathBuf,
    pub image_dir: PathBuf,
    pub image_cache_socket: Option<PathBuf>,
    pub image_budget: i64,
    pub crane: String,
    pub init: Option<PathBuf>,
    pub ports: RangeInclusive<u16>,
    pub memory_mib: i32,
    pub reserve_mib: i32,
    pub listen: Option<Arc<Listen>>,
}

#[derive(Clone)]
struct Failed {
    message: String,
    reason: &'static str,
}

// UNIT_BOUNDARY_DESCRIPTION: a boot the runner waits on until its guest first answers: when it was asked, by which action, and the stuck-boot note once the prober writes one. The prober refreshes the note once per SLOW_BOOT_AFTER and not on every probe, because each new message is a new status version and a status write on the Agent.
struct Boot {
    at: Instant,
    action: Action,
    note: Option<(String, Instant)>,
}

// UNIT_BOUNDARY_DESCRIPTION: what the runtime and the guest last said about a machine. `error` is set only with the unknown state, when the runtime could not be read.
#[derive(Clone, PartialEq, Eq)]
struct Seen {
    state: State,
    ready: bool,
    error: Option<String>,
}

// UNIT_BOUNDARY_DESCRIPTION: what the runner knows about one machine beyond its files. `asked` counts the specs stored in `desired`, so a worker can tell that a newer one arrived while its action ran. `version` changes whenever the status this entry reports changes, which is what a waiting status read answers on. `looked` counts every change to `seen`, so a probe that ran while something newer was recorded drops its older answer. `secrets` holds every env value this machine was given, because a guest that prints its environment puts them on the console, and the console outlives a spec change.
#[derive(Default)]
struct MachineEntry {
    desired: Option<MachineSpec>,
    asked: u64,
    action: Option<Action>,
    converging: bool,
    deleting: bool,
    failure: Option<Failed>,
    health: Health,
    restarts: i32,
    boot: Option<Boot>,
    secrets: Vec<String>,
    seen: Option<Seen>,
    looked: u64,
    probed: Option<Instant>,
    probing: bool,
    version: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: how often the prober asks about this machine, or None when nothing but an action can change what it would hear.
fn probe_every(entry: &MachineEntry) -> Option<Duration> {
    if entry.deleting {
        return None;
    }
    if let Some(action) = entry.action {
        return reads_ready(action.state()).then_some(BOOT_PROBE);
    }
    match &entry.seen {
        None => Some(Duration::ZERO),
        Some(seen) if matches!(seen.state, State::Absent | State::Stopped) => None,
        Some(_) if entry.boot.is_some() => Some(BOOT_PROBE),
        Some(_) => Some(STEADY_PROBE),
    }
}

#[derive(Default)]
struct Machines {
    closed: bool,
    entries: HashMap<String, MachineEntry>,
}

pub struct Server {
    config: Config,
    images: Arc<dyn Images>,
    runtime: Arc<dyn Runtime>,
    forwarder: Forwarder,
    machines: Mutex<Machines>,
    settled: Condvar,
    changed: Condvar,
    versions: AtomicU64,
    admission: Mutex<()>,
    ports: Mutex<()>,
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
}

impl Server {
    // UNIT_BOUNDARY_DESCRIPTION: a runner over its state directory. It must be built inside the tokio runtime that will serve it, because every published port is a task on that runtime. Machines already on disk get their ports published again, since the listeners died with the previous process while the machines' ports did not.
    pub fn start(config: Config, runtime: Arc<dyn Runtime>) -> anyhow::Result<Arc<Self>> {
        let forwarder = Forwarder::new(tokio::runtime::Handle::current(), config.listen.clone());
        let lifetime = CancellationToken::new();
        let images: Arc<dyn Images> = match &config.image_cache_socket {
            Some(socket) => Arc::new(CacheClient::new(socket.clone())),
            None => Arc::new(ImageCache::open(CacheConfig {
                dir: config.image_dir.clone(),
                budget: config.image_budget,
                crane: config.crane.clone(),
                pins: Vec::new(),
                lifetime: lifetime.clone(),
                check_access: false,
                ref_fresh: REF_FRESH,
                hold_lease: HOLD_LEASE,
                hold_grace: Duration::ZERO,
                fetch_ceiling: None,
            })),
        };
        let server = Arc::new(Self {
            config,
            images,
            runtime,
            forwarder,
            machines: Mutex::new(Machines::default()),
            settled: Condvar::new(),
            changed: Condvar::new(),
            versions: AtomicU64::new(first_version()),
            admission: Mutex::new(()),
            ports: Mutex::new(()),
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
        let prober = Arc::downgrade(&server);
        server.background(move |lifetime| probe_until_closed(&prober, &lifetime));
        Ok(server)
    }

    // UNIT_BOUNDARY_DESCRIPTION: stops taking work, cancels what is running, and waits up to CLOSE_GRACE for it. Cancelling first is what makes the wait short: a fetch allowed twenty minutes ends now and removes its own scratch tree. Ports are dropped last, so an action that finished inside the wait does not leave one bound.
    pub async fn close(&self) {
        self.stop_taking_work();
        if tokio::time::timeout(CLOSE_GRACE, self.work.wait())
            .await
            .is_err()
        {
            tracing::warn!(
                grace_secs = CLOSE_GRACE.as_secs(),
                "vm runner: machine actions were still running when the runner closed"
            );
        }
        self.forwarder.unpublish_all();
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

    // UNIT_BOUNDARY_DESCRIPTION: takes the controller's desired spec for one machine and answers with its status. The spec replaces any spec not yet acted on. When the machine needs work and no worker is converging it, one is started and the answer reports its first action as the state. A spec that would boot a machine the runner's memory cannot hold is refused here and not stored, so nothing is created for it.
    pub fn put(self: &Arc<Self>, id: &str, spec: MachineSpec) -> Result<MachineStatus, Rejected> {
        if !is_machine_id(id) {
            return Err(Rejected::bad_request("invalid machine id"));
        }
        admissible(&spec).map_err(Rejected::bad_request)?;
        self.remember_secrets(id, &spec);
        loop {
            if !self.converging(id) {
                self.observe(id, true);
            }
            let (state, mut status) = self.report(id);
            let action = step(
                read_spec(&self.config.state_dir, id).as_ref(),
                &spec,
                state,
                status.ready,
                self.dead_for_long(id),
            );
            let converging = self.converging(id);
            let boots = if converging {
                spec.running
            } else {
                action.is_some_and(|a| a != Action::Stop)
            };
            let _admitting = boots.then(|| locked(&self.admission));
            if boots {
                if let Err(e) = self.room_for(id, &spec) {
                    return Ok(self.refuse(id, status, e.to_string()));
                }
            }
            let mut machines = locked(&self.machines);
            if machines.closed {
                return Ok(status);
            }
            let entry = machines.entries.entry(id.to_string()).or_default();
            if entry.deleting {
                return Ok(status);
            }
            if converging && !entry.converging {
                continue;
            }
            entry.desired = Some(spec);
            entry.asked += 1;
            if entry.converging {
                return Ok(status);
            }
            let Some(action) = action else {
                return Ok(status);
            };
            entry.converging = true;
            entry.action = Some(action);
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

    fn refuse(&self, id: &str, mut status: MachineStatus, message: String) -> MachineStatus {
        self.metrics.refused();
        let mut machines = locked(&self.machines);
        let entry = machines.entries.entry(id.to_string()).or_default();
        entry.failure = Some(Failed {
            message: message.clone(),
            reason: REASON_OUT_OF_CAPACITY,
        });
        self.bump(entry);
        status.version = entry.version;
        status.message = message;
        status.reason = REASON_OUT_OF_CAPACITY.to_string();
        status.ready = false;
        status
    }

    pub fn get(&self, id: &str) -> Result<MachineStatus, Rejected> {
        if !is_machine_id(id) {
            return Err(Rejected::bad_request("invalid machine id"));
        }
        Ok(self.status(id))
    }

    // UNIT_BOUNDARY_DESCRIPTION: the long-poll behind a status read: answers as soon as the machine's status version is no longer `since`, or once `timeout`, capped at STATUS_WAIT_CAP, passes with no change. A different version rather than a greater one ends the wait, so a caller holding a version from before a runner restart or a delete is answered at once.
    pub fn wait(&self, id: &str, since: u64, timeout: Duration) -> Result<MachineStatus, Rejected> {
        if !is_machine_id(id) {
            return Err(Rejected::bad_request("invalid machine id"));
        }
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

    // UNIT_BOUNDARY_DESCRIPTION: removes a machine, its disks and its state, and answers only once they are gone. It marks the machine as being deleted, so its worker takes no further action and any spec stored behind the current one is dropped, then waits for the action in flight to return.
    pub fn delete(&self, id: &str) -> Result<(), Rejected> {
        if !is_machine_id(id) {
            return Err(Rejected::bad_request("invalid machine id"));
        }
        {
            let mut machines = locked(&self.machines);
            machines.entries.entry(id.to_string()).or_default().deleting = true;
            while machines.entries.get(id).is_some_and(|e| e.converging) {
                machines = self
                    .settled
                    .wait(machines)
                    .unwrap_or_else(|e| e.into_inner());
            }
        }
        let removed = self.remove(id);
        {
            let mut machines = locked(&self.machines);
            if removed.is_ok() {
                machines.entries.remove(id);
                self.changed.notify_all();
            } else if let Some(entry) = machines.entries.get_mut(id) {
                entry.deleting = false;
            }
        }
        removed?;
        self.forwarder.unpublish(id);
        Ok(())
    }

    fn remove(&self, id: &str) -> Result<(), Rejected> {
        let internal = |e: anyhow::Error| Rejected::internal(format!("{e:#}"));
        if self.runtime.state(id).map_err(internal)? != State::Absent {
            self.runtime.delete(id).map_err(internal)?;
        }
        let dir = machine_dir(&self.config.state_dir, id)
            .ok_or_else(|| Rejected::bad_request("invalid machine id"))?;
        match fs::remove_dir_all(&dir) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(Rejected::internal(e.to_string()))
            }
            _ => Ok(()),
        }
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
                entry.desired.clone().unwrap_or_default()
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
        if seen.error.is_some() {
            return Err(asked);
        }
        let state = seen.state;
        let ready = state == State::Running && seen.ready;
        let applied = read_spec(&self.config.state_dir, id);
        step(
            applied.as_ref(),
            &desired,
            state,
            ready,
            self.dead_for_long(id),
        )
        .map(|action| (action, asked))
        .ok_or(asked)
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
            .operation(action.label(), started.elapsed(), result.is_ok());
        let failure = result.err().map(|e| {
            let mut message = format!("{e:#}");
            tracing::error!(machine = %id, op = action.label(), error = %message, "machine action failed");
            let reason = failure_reason(&e);
            self.metrics.failed(action.label(), reason);
            if reason == REASON_BOOT_FAILED {
                message = with_console(&message, &self.console_tail(id));
            }
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
        )?;
        let port = {
            let _ports = locked(&self.ports);
            state::allocate_port(&self.config.state_dir, id, self.config.ports.clone())?
        };
        let (image, launch, digest) = self.resolve(spec, auths)?;
        self.record_digest(id, digest.as_deref())?;
        let dir = machine_dir(&self.config.state_dir, id)
            .ok_or_else(|| anyhow::anyhow!("invalid machine id {id:?}"))?;
        self.runtime.create(
            id,
            &Machine {
                spec,
                image: &image,
                host_port: port + LOOPBACK_OFFSET,
                share: &dir.join(SHARE_DIR),
                launch: Some(&launch),
            },
        )?;
        write_spec(&self.config.state_dir, id, spec)?;
        self.forwarder.publish(id, port)?;
        self.start_machine(id, Action::Create)
    }

    // UNIT_BOUNDARY_DESCRIPTION: brings an existing machine to the spec in place: stopped if running, its record updated, started again — so it keeps its disk and its port, whatever changed. The stored spec is what the record holds, so it is written as the record is, before the boot: a boot that fails leaves the next action comparing against the shape the machine really has. A new image is fetched and its launch read before the machine is touched, so the agent is down for the stop and boot and not for a pull, and a pull that fails leaves it running as it was. The new digest is recorded only once the old machine is stopped, which is when the cache stops holding the old tree for it.
    fn reshape(
        &self,
        id: &str,
        spec: &MachineSpec,
        auths: &[String],
        action: Action,
    ) -> anyhow::Result<()> {
        write_share(
            &self.config.state_dir,
            id,
            spec,
            self.config.init.as_deref(),
        )?;
        let applied = read_spec(&self.config.state_dir, id);
        let image = match &applied {
            Some(applied) if applied.image == spec.image => None,
            _ => Some(self.resolve(spec, auths)?),
        };
        let port = state::port(&self.config.state_dir, id);
        if port != 0 {
            self.forwarder.publish(id, port)?;
        }
        if let Action::Restart { unhealthy } = action {
            if unhealthy {
                if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
                    entry.restarts += 1;
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
        self.start_machine(id, action)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what a machine of this spec boots: the archive an install with no registry staged for the reference, or else the tree the image cache resolves it to, with the launch recorded beside it. If the node's cache service cannot be reached, a reference one of this runner's own machines already boots still boots the tree that machine holds: it is only read, and it was checked for this owner when that machine got it. Anything else the cache cannot serve is refused as an image problem, never booted straight from the registry.
    fn resolve(
        &self,
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
        let lookup = self.images.resolve(image, auths);
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

    fn start_machine(&self, id: &str, action: Action) -> anyhow::Result<()> {
        if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
            entry.boot = Some(Boot {
                at: Instant::now(),
                action,
                note: None,
            });
        }
        let started = Instant::now();
        let result = self.runtime.start(id);
        self.metrics
            .start(action.label(), started.elapsed(), result.is_ok());
        result
    }

    // UNIT_BOUNDARY_DESCRIPTION: a stop ends whatever boot the machine was waited on for. Without this a machine stopped before its guest ever answered would keep its stuck-boot note for as long as it stayed stopped.
    fn stop_machine(&self, id: &str) -> anyhow::Result<()> {
        if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
            if entry.boot.take().is_some_and(|boot| boot.note.is_some()) {
                self.bump(entry);
            }
        }
        self.runtime.stop(id)
    }

    fn remember_secrets(&self, id: &str, spec: &MachineSpec) {
        let mut machines = locked(&self.machines);
        let known = &mut machines.entries.entry(id.to_string()).or_default().secrets;
        for value in spec.env.values() {
            if !known.contains(value) {
                known.push(value.clone());
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the machine's console, redacted with every env value this runner has been given for it and the ones its applied spec holds, the way a failed smolvm call's output is. A tail this runner cannot redact, because it holds no spec for the machine at all, is not shown.
    fn console_tail(&self, id: &str) -> String {
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
        redact(
            &self.runtime.console_tail(id),
            secrets.iter().map(String::as_str),
        )
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
                    .is_none_or(|(_, noted)| noted.elapsed() >= SLOW_BOOT_AFTER);
            if !waiting || !due {
                return;
            }
            boot.at
        };
        let message = with_console(SLOW_BOOT, &self.console_tail(id));
        let mut machines = locked(&self.machines);
        let Some(entry) = machines.entries.get_mut(id) else {
            return;
        };
        let Some(boot) = entry.boot.as_mut().filter(|boot| boot.at == at) else {
            return;
        };
        let changed = boot.note.as_ref().is_none_or(|(old, _)| *old != message);
        boot.note = Some((message, Instant::now()));
        if changed {
            self.bump(entry);
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the scrape, with the gauges read as the runner stands now.
    pub fn metrics_text(&self) -> String {
        let committed = self
            .capacity()
            .committed(None, &self.committing(), &|other: &str| {
                matches!(self.known_state(other), Ok(State::Running))
            })
            .ok();
        self.metrics.render(&Gauges {
            budget_bytes: self.config.image_budget,
            limit_mib: self.config.memory_mib,
            reserve_mib: self.config.reserve_mib,
            committed_mib: committed,
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: the `docker save` archive an install with no registry stages for this reference, with the launch read out of the archive's own config. The directory is mounted read-only in that mode, so nothing can be fetched there and this is what the machine boots.
    fn staged_image(&self, image: &str) -> anyhow::Result<Option<(PathBuf, ImageLaunch)>> {
        // UNIT_BOUNDARY_DESCRIPTION: a staged tree wins over an archive of the same name: the tree boots in place, where the archive is flattened inside every guest on its first boot, under smolvm's fixed pull window, which a slow host outran.
        let tree = cache::staged_path(&self.config.image_dir, image);
        if let Some(launch) = read_launch(&tree).map_err(|e| unusable(format!("{e:#}")))? {
            return Ok(Some((tree.join(ROOTFS_DIR), launch)));
        }
        let archive = cache::archive_path(&self.config.image_dir, image);
        if !archive.exists() {
            return Ok(None);
        }
        let launch = launch_from_archive(&archive).map_err(|e| unusable(format!("{e:#}")))?;
        Ok(Some((archive, launch)))
    }

    // UNIT_BOUNDARY_DESCRIPTION: records the digest a machine is about to boot, before it boots, and holds it. The record is what this runner holds after a restart, when it knows its machines only from its state directory. With no digest the record is removed, because that machine boots from a staged archive and holds no cache entry.
    fn record_digest(&self, id: &str, digest: Option<&str>) -> anyhow::Result<()> {
        let dir = machine_dir(&self.config.state_dir, id)
            .ok_or_else(|| anyhow::anyhow!("invalid machine id {id:?}"))?;
        let path = dir.join(IMAGE_DIGEST_FILE);
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

    // UNIT_BOUNDARY_DESCRIPTION: holds every digest this runner's machines boot, so the cache's eviction spares their trees. It runs at start, after a machine records a new digest, and every HOLD_REFRESH. A hold that fails is reported and not returned: the machines keep running, and the next refresh tries again inside the lease.
    pub fn hold_images(&self) {
        let held = self.held_digests();
        if held.is_empty() {
            return;
        }
        if let Err(e) = self.images.hold(&held) {
            tracing::warn!(error = %format!("{e:#}"), "image cache: cannot hold the images this runner's machines boot");
        }
    }

    fn capacity(&self) -> Capacity<'_> {
        Capacity {
            state_dir: &self.config.state_dir,
            limit_mib: self.config.memory_mib,
            reserve_mib: self.config.reserve_mib,
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the memory each machine a worker is bringing up has asked for. A machine being created has no spec on disk yet, so without this two creates racing each other would both fit into the room for one.
    fn committing(&self) -> BTreeMap<String, i32> {
        locked(&self.machines)
            .entries
            .iter()
            .filter(|(_, entry)| entry.converging)
            .filter_map(|(id, entry)| {
                let desired = entry.desired.as_ref().filter(|d| d.running)?;
                Some((id.clone(), desired.memory_mib))
            })
            .collect()
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the machine fits the runner's memory, counting the machines running and the ones being brought up. Running is what the prober last recorded, so admitting one machine costs no probe per machine.
    fn room_for(&self, id: &str, spec: &MachineSpec) -> anyhow::Result<()> {
        self.capacity()
            .room_for(id, spec.memory_mib, &self.committing(), &|other: &str| {
                matches!(self.known_state(other), Ok(State::Running))
            })
    }

    fn dead_for_long(&self, id: &str) -> bool {
        locked(&self.machines)
            .entries
            .get(id)
            .is_some_and(|e| e.health.dead_for_long(SystemTime::now()))
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

    // UNIT_BOUNDARY_DESCRIPTION: stores what was seen, and moves the status version only when the status it reports changes. A machine the runner has no entry for is remembered only once it exists, so asking about names that are not machines here leaves nothing behind, and a probe answering after its machine was deleted puts no entry back. The first answer from the guest ends the boot the runner was waiting on and is timed under the action that started it.
    fn record(&self, id: &str, seen: Seen, guard: Option<u64>) {
        let answered = {
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
            answered
        };
        if let Some(boot) = answered {
            self.metrics
                .became_ready(boot.action.label(), boot.at.elapsed());
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: one probe of one machine. While an action is in flight the runtime is not asked — the action is the state — but the guest is, because it can answer before the start call that booted it returns.
    fn probe(&self, id: &str) {
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
        self.record(id, seen, Some(looked));
        self.note_slow_boot(id);
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
                server.probe(&id);
                if let Some(entry) = locked(&server.machines).entries.get_mut(&id) {
                    entry.probing = false;
                }
            });
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the machine's state as last recorded, looked at now only when nothing has been recorded yet.
    fn known_state(&self, id: &str) -> anyhow::Result<State> {
        let recorded = locked(&self.machines)
            .entries
            .get(id)
            .and_then(|e| e.seen.clone());
        let seen = recorded.unwrap_or_else(|| self.observe(id, true));
        match seen.error {
            Some(error) => Err(anyhow::anyhow!(error)),
            None => Ok(seen.state),
        }
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
        }
        if state == State::Unknown && status.message.is_empty() {
            status.message = seen.and_then(|seen| seen.error).unwrap_or_default();
        }
        let note = entry
            .and_then(|e| e.boot.as_ref())
            .and_then(|boot| boot.note.as_ref())
            .filter(|_| failed.is_none() && !status.ready && reads_ready(state));
        if let Some((note, _)) = note {
            status.message = if status.message.is_empty() {
                note.clone()
            } else {
                format!("{}; {note}", status.message)
            };
        }
        (state, status)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the first version this process hands out, taken from the clock, so a version a caller holds from before a runner restart is not handed out again by the new process.
fn first_version() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| u64::try_from(since.as_micros()).unwrap_or(0))
}

// UNIT_BOUNDARY_DESCRIPTION: the health prober: one task per runner that starts a probe of each machine worth probing at its cadence, and each probe records what it hears, so a status read never waits on a probe. It holds the server weakly and ends with it, as well as when the runner closes.
fn probe_until_closed(server: &Weak<Server>, lifetime: &CancellationToken) {
    while !lifetime.is_cancelled() {
        let Some(server) = server.upgrade() else {
            return;
        };
        server.probe_due();
        drop(server);
        std::thread::sleep(PROBE_TICK);
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
        entry.converging = false;
        entry.action = None;
        self.server.bump(entry);
        self.armed = false;
        true
    }
}

impl Drop for Settle<'_> {
    fn drop(&mut self) {
        if self.armed {
            if let Some(entry) = locked(&self.server.machines).entries.get_mut(self.id) {
                entry.converging = false;
                entry.action = None;
                self.server.bump(entry);
            }
        }
        self.server.settled.notify_all();
    }
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
