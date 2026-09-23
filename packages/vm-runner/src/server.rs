use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::ops::RangeInclusive;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};

use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::api::{MachineSpec, MachineStatus, State, REASON_BOOT_FAILED, REASON_OUT_OF_CAPACITY};
use crate::cache::{self, pinned_digest, REF_FRESH};
use crate::cacheapi::CacheClient;
use crate::capacity::Capacity;
use crate::console::{with_console, SLOW_BOOT, SLOW_BOOT_AFTER};
use crate::fetch::{failure_reason, unusable};
use crate::forward::{healthy, Forwarder, Listen, LOOPBACK_OFFSET};
use crate::imagecache::{CacheConfig, ImageCache, Images, Resolved, HOLD_LEASE};
use crate::launch::{launch_from_archive, read_launch, ImageLaunch};
use crate::metrics::{Gauges, Metrics};
use crate::plan::{admissible, reads_ready, step, Action, Health};
use crate::runtime::{redact, Machine, Runtime, Update};
use crate::share::{write_share, SHARE_DIR};
use crate::state::{
    self, is_image_ref, is_machine_id, machine_dir, read_spec, write_spec, IMAGE_DIGEST_FILE,
};

// UNIT_BOUNDARY_DESCRIPTION: the machine API behind the HTTP layer: one persistent microVM per vm Agent, converged on the latest spec the controller sent. A PUT stores that spec and makes sure one worker is converging the machine; the worker takes one whole action at a time, and GET reports the action in flight as the machine's state. What a machine is survives the runner on disk — its spec, its port, its share. What the runner is doing to it lives in one entry per machine here and is lost with the process.

// UNIT_BOUNDARY_DESCRIPTION: how long a machine's state from the runtime is reused. The controller polls a booting machine every half second and admission reads every other machine's state, and each read probes the guest agent, while the state barely moves at that rate. Whether the guest answers its health endpoint is still asked every time.
pub const STATE_TTL: Duration = Duration::from_secs(1);

// UNIT_BOUNDARY_DESCRIPTION: how long closing the runner waits for the actions already running. They are cancelled first, so the wait covers only work that does not answer cancellation — a VMM call cannot be interrupted part-way.
pub const CLOSE_GRACE: Duration = Duration::from_secs(30);

pub use crate::imagecache::ROOTFS_DIR;

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

// UNIT_BOUNDARY_DESCRIPTION: a boot the runner waits on until its guest first answers: when it was asked, by which action, and the stuck-boot note once one is written. The note is kept, not rebuilt on each poll, because a message that changed twice a second would be a status write twice a second.
struct Boot {
    at: Instant,
    action: Action,
    note: Option<(String, Instant)>,
}

// UNIT_BOUNDARY_DESCRIPTION: what the runner knows about one machine beyond its files. `asked` counts the specs stored in `desired`, so a worker can tell that a newer one arrived while its action ran. `secrets` holds every env value this machine was given, because a guest that prints its environment puts them on the console, and the console outlives a spec change.
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
    observed: Option<(State, Instant)>,
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

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
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
            })),
        };
        let server = Arc::new(Self {
            config,
            images,
            runtime,
            forwarder,
            machines: Mutex::new(Machines::default()),
            settled: Condvar::new(),
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
        Ok(server)
    }

    // UNIT_BOUNDARY_DESCRIPTION: stops taking work, cancels what is running, and waits up to CLOSE_GRACE for it. Cancelling first is what makes the wait short: a fetch allowed twenty minutes ends now and removes its own scratch tree. Ports are dropped last, so an action that finished inside the wait does not leave one bound.
    pub async fn close(&self) {
        locked(&self.machines).closed = true;
        self.forwarder.unpublish_all();
        self.lifetime.cancel();
        self.work.close();
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
        locked(&self.machines)
            .entries
            .entry(id.to_string())
            .or_default()
            .failure = Some(Failed {
            message: message.clone(),
            reason: REASON_OUT_OF_CAPACITY,
        });
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

    // UNIT_BOUNDARY_DESCRIPTION: the worker that brings one machine to its latest spec. It runs one action, and steps again only if a newer spec arrived while that action ran — which is how a stop sent mid-boot is honoured once the boot returns. It never steps again on its own result: an action that succeeds and still leaves the machine short, such as a guest that dies as it boots, is retried on the next reconcile rather than in a tight loop.
    fn converge(&self, id: &str, first: Action, asked: u64) {
        let _done = Settle { server: self, id };
        let mut planned = Some((first, asked));
        loop {
            let (action, asked) = match planned.take() {
                Some(planned) => planned,
                None => match self.plan_next(id) {
                    Some(next) => next,
                    None => return,
                },
            };
            let spec = {
                let mut machines = locked(&self.machines);
                if machines.closed {
                    return;
                }
                let Some(entry) = machines.entries.get_mut(id) else {
                    return;
                };
                if entry.deleting {
                    return;
                }
                if entry.asked != asked {
                    continue;
                }
                entry.action = Some(action);
                entry.health.action_started();
                entry.desired.clone().unwrap_or_default()
            };
            self.run(id, action, spec);
            let machines = locked(&self.machines);
            if machines.closed
                || machines
                    .entries
                    .get(id)
                    .is_none_or(|e| e.deleting || e.asked == asked)
            {
                return;
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the step towards the spec stored while the last action ran, against what the runtime reports now. Nothing to do ends the worker, but only while no newer spec has arrived during the planning itself, or that spec would wait for the next reconcile with no worker to act on it.
    fn plan_next(&self, id: &str) -> Option<(Action, u64)> {
        loop {
            let (desired, asked) = {
                let machines = locked(&self.machines);
                let entry = machines.entries.get(id)?;
                (entry.desired.clone()?, entry.asked)
            };
            self.forget_state(id);
            let state = self.observed(id).ok()?;
            let ready = state == State::Running && healthy(state::port(&self.config.state_dir, id));
            let applied = read_spec(&self.config.state_dir, id);
            if let Some(action) = step(
                applied.as_ref(),
                &desired,
                state,
                ready,
                self.dead_for_long(id),
            ) {
                return Some((action, asked));
            }
            let machines = locked(&self.machines);
            if machines.entries.get(id).is_none_or(|e| e.asked == asked) {
                return None;
            }
        }
    }

    fn run(&self, id: &str, action: Action, mut spec: MachineSpec) {
        let auths = std::mem::take(&mut spec.pull_auths);
        self.forget_state(id);
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
        let mut machines = locked(&self.machines);
        if let Some(entry) = machines.entries.get_mut(id) {
            entry.failure = failure;
            entry.observed = None;
        }
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
        self.forwarder.publish(id, port)?;
        self.start_machine(id, Action::Create)?;
        write_spec(&self.config.state_dir, id, spec)
    }

    // UNIT_BOUNDARY_DESCRIPTION: brings an existing machine to the spec in place: stopped if running, its record updated, started again — so it keeps its disk and its port, whatever changed. A new image is fetched and its launch read before the machine is touched, so the agent is down for the stop and boot and not for a pull, and a pull that fails leaves it running as it was. The new digest is recorded only once the old machine is stopped, which is when the cache stops holding the old tree for it.
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
            Some(applied) if applied.image != spec.image => Some(self.resolve(spec, auths)?),
            _ => None,
        };
        let port = state::port(&self.config.state_dir, id);
        if port != 0 {
            self.forwarder.publish(id, port)?;
        }
        if let Action::Restart { unhealthy } = action {
            if unhealthy {
                if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
                    entry.restarts += 1;
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
        self.start_machine(id, action)?;
        write_spec(&self.config.state_dir, id, spec)
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
        if let Some((archive, launch)) = self.staged_archive(image)? {
            self.metrics.lookup(true);
            return Ok((archive.to_string_lossy().into_owned(), launch, None));
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

    // UNIT_BOUNDARY_DESCRIPTION: a stop ends whatever boot the machine was waited on for. Without this a machine stopped before its guest ever answered would report a growing `startingMs` for as long as it stayed stopped.
    fn stop_machine(&self, id: &str) -> anyhow::Result<()> {
        if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
            entry.boot = None;
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

    // UNIT_BOUNDARY_DESCRIPTION: a guest that boots and never answers has no failure to report — its start call returned — so without this the Agent reads not ready for as long as it stays stuck, and why is only on the console. A recorded failure carries its own tail and wins. An answer ends the boot: from then on a probe the guest misses is a health blip, not a boot still waited on, so neither the note nor `startingMs` comes back for it.
    fn watch_boot(&self, id: &str, status: &mut MachineStatus, no_failure: bool) {
        let (at, action, note) = {
            let mut machines = locked(&self.machines);
            let Some(entry) = machines.entries.get_mut(id) else {
                return;
            };
            let Some(boot) = &entry.boot else {
                return;
            };
            let seen = (boot.at, boot.action, boot.note.clone());
            if status.ready {
                entry.boot = None;
            }
            seen
        };
        if status.ready {
            self.metrics.became_ready(action.label(), at.elapsed());
            return;
        }
        if !no_failure || at.elapsed() < SLOW_BOOT_AFTER {
            return;
        }
        let note = match note {
            Some((message, noted)) if noted.elapsed() < SLOW_BOOT_AFTER => message,
            _ => {
                let message = with_console(SLOW_BOOT, &self.console_tail(id));
                let mut machines = locked(&self.machines);
                if let Some(boot) = machines
                    .entries
                    .get_mut(id)
                    .and_then(|e| e.boot.as_mut())
                    .filter(|boot| boot.at == at)
                {
                    boot.note = Some((message.clone(), Instant::now()));
                }
                message
            }
        };
        if status.message.is_empty() {
            status.message = note;
        } else {
            status.message = format!("{}; {note}", status.message);
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the scrape, with the gauges read as the runner stands now.
    pub fn metrics_text(&self) -> String {
        let committed = self
            .capacity()
            .committed(None, &self.committing(), &|other: &str| {
                matches!(self.observed(other), Ok(State::Running))
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
    fn staged_archive(&self, image: &str) -> anyhow::Result<Option<(PathBuf, ImageLaunch)>> {
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

    // UNIT_BOUNDARY_DESCRIPTION: whether the machine fits the runner's memory, counting the machines running and the ones being brought up. Running is read through the state cache, so admitting one machine costs no probe per machine when the controller has just asked.
    fn room_for(&self, id: &str, spec: &MachineSpec) -> anyhow::Result<()> {
        self.capacity()
            .room_for(id, spec.memory_mib, &self.committing(), &|other: &str| {
                matches!(self.observed(other), Ok(State::Running))
            })
    }

    fn dead_for_long(&self, id: &str) -> bool {
        locked(&self.machines)
            .entries
            .get(id)
            .is_some_and(|e| e.health.dead_for_long(SystemTime::now()))
    }

    fn forget_state(&self, id: &str) {
        if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
            entry.observed = None;
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the machine's state as the runtime reports it, reused for STATE_TTL. A machine the runner has no entry for is remembered only once it exists, so asking about names that are not machines here leaves nothing behind.
    fn observed(&self, id: &str) -> anyhow::Result<State> {
        if let Some((state, at)) = locked(&self.machines)
            .entries
            .get(id)
            .and_then(|e| e.observed)
        {
            if at.elapsed() < STATE_TTL {
                return Ok(state);
            }
        }
        let state = self.runtime.state(id)?;
        let mut machines = locked(&self.machines);
        if state != State::Absent || machines.entries.contains_key(id) {
            machines.entries.entry(id.to_string()).or_default().observed =
                Some((state, Instant::now()));
        }
        Ok(state)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what the controller is told about a machine. An action in flight is reported as the machine's state. A guest that answers its health endpoint is ready even before the start call that booted it returns — but only on the way up.
    pub fn status(&self, id: &str) -> MachineStatus {
        self.report(id).1
    }

    fn report(&self, id: &str) -> (State, MachineStatus) {
        let (action, failed, restarts, started_at) = {
            let machines = locked(&self.machines);
            match machines.entries.get(id) {
                Some(entry) => (
                    entry.action,
                    entry.failure.clone(),
                    entry.restarts,
                    entry.boot.as_ref().map(|boot| boot.at),
                ),
                None => (None, None, 0, None),
            }
        };
        let port = state::port(&self.config.state_dir, id);
        let no_failure = failed.is_none();
        let mut status = MachineStatus {
            state: State::Absent.to_string(),
            reason: failed
                .as_ref()
                .map(|f| f.reason.to_string())
                .unwrap_or_default(),
            restarts,
            port: i32::from(port),
            message: failed.map(|f| f.message).unwrap_or_default(),
            starting_ms: started_at
                .map(|at| i64::try_from(at.elapsed().as_millis()).unwrap_or(i64::MAX))
                .unwrap_or_default(),
            ..MachineStatus::default()
        };
        if let Some(spec) = read_spec(&self.config.state_dir, id) {
            status.cpus = spec.cpus;
            status.memory_mib = spec.memory_mib;
        }
        let state = match action {
            Some(action) => action.state(),
            None => match self.observed(id) {
                Ok(state) => state,
                Err(e) => {
                    status.state = State::Unknown.to_string();
                    if status.message.is_empty() {
                        status.message = format!("{e:#}");
                    }
                    return (State::Unknown, status);
                }
            },
        };
        status.state = state.to_string();
        if reads_ready(state) {
            status.ready = healthy(port);
            self.watch_boot(id, &mut status, no_failure);
        }
        if state == State::Running {
            if let Some(entry) = locked(&self.machines).entries.get_mut(id) {
                entry
                    .health
                    .observed_running(status.ready, SystemTime::now());
            }
        }
        (state, status)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: ends a machine's worker on every path out of it, a panic included, so a delete waiting for the worker is never left waiting and the next spec can start a new one.
struct Settle<'a> {
    server: &'a Server,
    id: &'a str,
}

impl Drop for Settle<'_> {
    fn drop(&mut self) {
        if let Some(entry) = locked(&self.server.machines).entries.get_mut(self.id) {
            entry.converging = false;
            entry.action = None;
        }
        self.server.settled.notify_all();
    }
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
