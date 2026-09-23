use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::ops::RangeInclusive;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};

use ipnet::IpNet;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::api::{
    MachineSpec, MachineStatus, REASON_BOOT_FAILED, REASON_OUT_OF_CAPACITY, STATE_ABSENT,
    STATE_CREATING, STATE_RESTARTING, STATE_RUNNING, STATE_STARTING, STATE_STOPPED, STATE_STOPPING,
    STATE_UNKNOWN,
};
use crate::cache::{self, repository, REF_FRESH};
use crate::capacity::Capacity;
use crate::console::{with_console, SLOW_BOOT, SLOW_BOOT_AFTER};
use crate::fetch::{self, egress_changed, failure_reason, unusable};
use crate::forward::{healthy, Forwarder, Listen, LOOPBACK_OFFSET};
use crate::imagecache::ImageCache;
use crate::launch::{launch_from_archive, read_launch, ImageLaunch};
use crate::metrics::{Gauges, Metrics};
use crate::plan::{self, admissible, image_changed, needs_restart, reads_ready, Health};
use crate::runtime::{redact, Machine, Runtime};
use crate::share::{write_share, SHARE_DIR};
use crate::state::{
    self, is_image_ref, is_machine_id, machine_dir, read_spec, write_spec, IMAGE_DIGEST_FILE,
};

// UNIT_BOUNDARY_DESCRIPTION: the machine API behind the HTTP layer: one persistent microVM per vm Agent, driven to the shape the controller asks for. Every PUT is planned against what the machine is doing now and the planned operation runs in the background, one at a time per machine, while GET reports it as the machine's state. What a machine is survives the runner on disk — its spec, its port, its share — and what the runner is doing to it lives here and is lost with the process, which is why a restarted runner rebuilds only what the disk can tell it.

// UNIT_BOUNDARY_DESCRIPTION: how long a machine's state from the runtime is reused. The controller polls a starting machine every half second, and each answer costs a probe of the guest agent, while the state barely moves at that rate. Only the state is reused: whether the guest answers its health endpoint is asked every time.
pub const STATE_TTL: Duration = Duration::from_secs(1);

// UNIT_BOUNDARY_DESCRIPTION: how long closing the runner waits for the operations already running. They are cancelled first, so the wait covers only work that does not answer cancellation — a VMM call cannot be interrupted part-way.
pub const CLOSE_GRACE: Duration = Duration::from_secs(30);

pub use crate::imagecache::ROOTFS_DIR;

// UNIT_BOUNDARY_DESCRIPTION: what a runner is given at start, as the flags the controller sets on the runner's Deployment.
pub struct Config {
    pub state_dir: PathBuf,
    pub image_dir: PathBuf,
    pub runner_id: String,
    pub image_budget: i64,
    pub crane: String,
    pub init: Option<PathBuf>,
    pub ports: RangeInclusive<u16>,
    pub memory_mib: i32,
    pub reserve_mib: i32,
    pub allow_from: Vec<IpNet>,
    pub pinned: Vec<String>,
    pub listen: Option<Arc<Listen>>,
}

#[derive(Clone)]
struct Failed {
    message: String,
    reason: &'static str,
}

#[derive(Default)]
struct Inner {
    closed: bool,
    pending: HashMap<String, &'static str>,
    seq: HashMap<String, u64>,
    served: HashMap<String, u64>,
    committing: BTreeMap<String, i32>,
    failures: HashMap<String, Failed>,
    gens: HashMap<String, u64>,
    restarts: HashMap<String, i32>,
    health: HashMap<String, Health>,
    last_state: HashMap<String, (&'static str, Instant)>,
    started_at: HashMap<String, Instant>,
    // UNIT_BOUNDARY_DESCRIPTION: the start each machine was last asked for, until its guest first answers, so the time to that answer is recorded once and under the operation that asked.
    awaiting: HashMap<String, &'static str>,
    // UNIT_BOUNDARY_DESCRIPTION: the note a machine that is stuck booting carries, and when it was written. Kept rather than rebuilt on every status, because the controller polls a starting machine twice a second and a message that changed each time would be a status write each time.
    slow_boots: HashMap<String, (String, Instant)>,
    // UNIT_BOUNDARY_DESCRIPTION: every env value this runner has been given for each machine. An operator's Secret reaches the guest in its environment, and a guest that prints its environment puts those values on the console; the console outlives a spec change, so values a machine no longer has are kept too.
    secrets: HashMap<String, Vec<String>>,
}

pub struct Server {
    config: Config,
    cache: ImageCache,
    runtime: Arc<dyn Runtime>,
    forwarder: Forwarder,
    inner: Mutex<Inner>,
    turns: Condvar,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    ports: Mutex<()>,
    lifetime: CancellationToken,
    work: TaskTracker,
    metrics: Metrics,
}

// UNIT_BOUNDARY_DESCRIPTION: a request the runner refuses outright, before planning anything, with the HTTP status that says whose mistake it is.
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
        let forwarder = Forwarder::new(
            tokio::runtime::Handle::current(),
            config.allow_from.clone(),
            config.listen.clone(),
        );
        let lifetime = CancellationToken::new();
        let cache = ImageCache {
            dir: config.image_dir.clone(),
            owner: config.runner_id.clone(),
            budget: config.image_budget,
            crane: config.crane.clone(),
            pinned: config.pinned.clone(),
            lifetime: lifetime.clone(),
        };
        let server = Arc::new(Self {
            config,
            cache,
            runtime,
            forwarder,
            inner: Mutex::new(Inner::default()),
            turns: Condvar::new(),
            locks: Mutex::new(HashMap::new()),
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
        server.publish_holders();
        Ok(server)
    }

    // UNIT_BOUNDARY_DESCRIPTION: stops taking operations, cancels the ones running, and waits up to CLOSE_GRACE for them. Cancelling first is what makes the wait short: a fetch allowed twenty minutes ends now and removes its own scratch tree. Ports are dropped last, so an operation that finished inside the wait does not leave one bound.
    pub async fn close(&self) {
        locked(&self.inner).closed = true;
        self.forwarder.unpublish_all();
        self.lifetime.cancel();
        self.work.close();
        if tokio::time::timeout(CLOSE_GRACE, self.work.wait())
            .await
            .is_err()
        {
            tracing::warn!(
                grace_secs = CLOSE_GRACE.as_secs(),
                "vm runner: machine operations were still running when the runner closed"
            );
        }
        self.forwarder.unpublish_all();
    }

    // UNIT_BOUNDARY_DESCRIPTION: work that belongs to no machine — the disk-template warm-up — joined to the same barrier as a machine operation, so closing the runner cancels and waits for everything it started. Work offered after close is refused.
    pub fn background(&self, work: impl FnOnce(CancellationToken) + Send + 'static) {
        if locked(&self.inner).closed {
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

    // UNIT_BOUNDARY_DESCRIPTION: takes the controller's desired shape for one machine and answers with its status. When the machine needs work the work is started in the background and the answer reports the operation as its state; a machine that does not fit the runner's memory is refused here, before anything is created.
    pub fn put(self: &Arc<Self>, id: &str, spec: MachineSpec) -> Result<MachineStatus, Rejected> {
        if !is_machine_id(id) {
            return Err(Rejected::bad_request("invalid machine id"));
        }
        admissible(&spec).map_err(Rejected::bad_request)?;
        self.remember_secrets(id, &spec);
        let mut status = self.status(id);
        let applied = read_spec(&self.config.state_dir, id);
        let dead_for_long = self.dead_for_long(id);
        let Some(planned) = plan::plan(
            applied.as_ref(),
            &spec,
            &status.state,
            status.ready,
            dead_for_long,
        ) else {
            return Ok(status);
        };
        if planned.op != STATE_STOPPING {
            if let Err(e) = self.room_for(id, &spec) {
                self.metrics.refused();
                let message = e.to_string();
                locked(&self.inner).failures.insert(
                    id.to_string(),
                    Failed {
                        message: message.clone(),
                        reason: REASON_OUT_OF_CAPACITY,
                    },
                );
                status.message = message;
                status.reason = REASON_OUT_OF_CAPACITY.to_string();
                status.ready = false;
                return Ok(status);
            }
            locked(&self.inner)
                .committing
                .insert(id.to_string(), spec.memory_mib);
        }
        let restart = planned.op == STATE_RESTARTING;
        let unhealthy = planned.unhealthy;
        let server = self.clone();
        let target = id.to_string();
        self.spawn(id, planned.op, move || {
            server.ensure(&target, spec, restart, unhealthy)
        });
        status.state = planned.op.to_string();
        status.ready = false;
        Ok(status)
    }

    pub fn get(&self, id: &str) -> Result<MachineStatus, Rejected> {
        if !is_machine_id(id) {
            return Err(Rejected::bad_request("invalid machine id"));
        }
        Ok(self.status(id))
    }

    // UNIT_BOUNDARY_DESCRIPTION: removes a machine, its disks and its state. It takes the machine's lock, so it waits for the operation running and then drops every operation queued behind it — the generation it bumps is what a queued operation checks before it runs.
    pub fn delete(&self, id: &str) -> Result<(), Rejected> {
        if !is_machine_id(id) {
            return Err(Rejected::bad_request("invalid machine id"));
        }
        let lock = self.lock(id);
        let _held = locked(&lock);
        *locked(&self.inner).gens.entry(id.to_string()).or_default() += 1;
        let state = self
            .runtime
            .state(id)
            .map_err(|e| Rejected::internal(format!("{e:#}")))?;
        if state != STATE_ABSENT {
            self.runtime
                .delete(id)
                .map_err(|e| Rejected::internal(format!("{e:#}")))?;
        }
        self.runtime
            .discard_kept_storage(id)
            .map_err(|e| Rejected::internal(format!("{e:#}")))?;
        let dir = machine_dir(&self.config.state_dir, id)
            .ok_or_else(|| Rejected::bad_request("invalid machine id"))?;
        match fs::remove_dir_all(&dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(Rejected::internal(e.to_string())),
        }
        {
            let mut inner = locked(&self.inner);
            inner.failures.remove(id);
            inner.restarts.remove(id);
            inner.health.remove(id);
            inner.last_state.remove(id);
            inner.started_at.remove(id);
            inner.awaiting.remove(id);
            inner.slow_boots.remove(id);
            inner.secrets.remove(id);
        }
        self.forwarder.unpublish(id);
        self.publish_holders();
        Ok(())
    }

    fn lock(&self, id: &str) -> Arc<Mutex<()>> {
        locked(&self.locks)
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    // UNIT_BOUNDARY_DESCRIPTION: runs one operation in the background, after the ones already queued for the machine and in the order they were queued. The order is a ticket taken here, when the operation is queued, and not the order the worker threads happen to reach the machine's lock: two threads started a moment apart can take the lock in either order, and a stop queued behind a boot that runs first leaves running a machine the controller asked to stop. Each clears only its own markers, so a boot that finishes does not erase the stop queued behind it. An operation refused because the runner is closing releases the memory its caller reserved for it.
    fn spawn(
        self: &Arc<Self>,
        id: &str,
        op: &'static str,
        work: impl FnOnce() -> anyhow::Result<()> + Send + 'static,
    ) {
        let (seq, generation) = {
            let mut inner = locked(&self.inner);
            if inner.closed {
                inner.committing.remove(id);
                return;
            }
            let seq = {
                let next = inner.seq.entry(id.to_string()).or_default();
                *next += 1;
                *next
            };
            inner.pending.insert(id.to_string(), op);
            inner
                .health
                .entry(id.to_string())
                .or_default()
                .operation_started();
            (seq, inner.gens.get(id).copied().unwrap_or_default())
        };
        let server = self.clone();
        let id = id.to_string();
        self.work.spawn_blocking(move || {
            let _turn = server.wait_turn(&id, seq);
            let lock = server.lock(&id);
            let _held = locked(&lock);
            let gone = locked(&server.inner)
                .gens
                .get(&id)
                .copied()
                .unwrap_or_default()
                != generation;
            let result = if gone {
                Ok(())
            } else {
                let started = Instant::now();
                let result = work();
                server
                    .metrics
                    .operation(op, started.elapsed(), result.is_ok());
                result
            };
            let failed = result.err().map(|e| {
                let mut message = format!("{e:#}");
                tracing::error!(machine = %id, op, error = %message, "machine operation failed");
                let reason = failure_reason(&e);
                server.metrics.failed(op, reason);
                if reason == REASON_BOOT_FAILED {
                    message = with_console(&message, &server.console_tail(&id));
                }
                Failed { message, reason }
            });
            let mut inner = locked(&server.inner);
            if inner.seq.get(&id) == Some(&seq) {
                inner.pending.remove(&id);
                inner.committing.remove(&id);
            }
            match failed {
                None => {
                    inner.failures.remove(&id);
                }
                Some(failed) => {
                    inner.failures.insert(id, failed);
                }
            }
        });
    }

    fn wait_turn(&self, id: &str, ticket: u64) -> Turn<'_> {
        let mut inner = locked(&self.inner);
        while inner.served.get(id).copied().unwrap_or_default() + 1 != ticket {
            inner = self.turns.wait(inner).unwrap_or_else(|e| e.into_inner());
        }
        Turn {
            server: self,
            id: id.to_string(),
            ticket,
        }
    }

    fn ensure(
        &self,
        id: &str,
        mut spec: MachineSpec,
        restart: bool,
        unhealthy: bool,
    ) -> anyhow::Result<()> {
        let auths = std::mem::take(&mut spec.pull_auths);
        let result = self.ensure_inner(id, &spec, &auths, restart, unhealthy);
        self.publish_holders();
        result
    }

    fn ensure_inner(
        &self,
        id: &str,
        spec: &MachineSpec,
        auths: &[String],
        restart: bool,
        unhealthy: bool,
    ) -> anyhow::Result<()> {
        let mut state = self.machine_state(id)?;
        if !spec.running {
            if state == STATE_RUNNING {
                self.forget_state(id);
                self.stop_machine(id)?;
            }
            return Ok(());
        }
        write_share(
            &self.config.state_dir,
            id,
            spec,
            self.config.init.as_deref(),
        )?;
        let applied = read_spec(&self.config.state_dir, id);
        if state == STATE_ABSENT {
            self.create(id, spec, auths)?;
            return write_spec(&self.config.state_dir, id, spec);
        }
        if let Some(applied) = &applied {
            if plan::egress_changed(applied, spec) {
                if state == STATE_RUNNING {
                    self.forget_state(id);
                    self.stop_machine(id)?;
                }
                return Err(egress_changed(format!(
                    "this machine may only reach [{}], but its gateway is now [{}] — recreate the agent",
                    applied.allow_cidrs.join(" "),
                    spec.allow_cidrs.join(" ")
                )));
            }
        }
        if let Some(applied) = &applied {
            if image_changed(applied, spec) {
                return self.recreate(id, spec, state, auths);
            }
        }
        let port = state::port(&self.config.state_dir, id);
        if port != 0 {
            self.forwarder.publish(id, port)?;
        }
        let mut op = STATE_STARTING;
        if state == STATE_RUNNING
            && (restart || applied.as_ref().is_none_or(|a| needs_restart(a, spec)))
        {
            if unhealthy {
                *locked(&self.inner)
                    .restarts
                    .entry(id.to_string())
                    .or_default() += 1;
                self.metrics.unhealthy_restart();
            }
            op = STATE_RESTARTING;
            self.forget_state(id);
            self.stop_machine(id)?;
            state = STATE_STOPPED;
        }
        if state == STATE_STOPPED {
            self.forget_state(id);
            self.runtime.update(id, spec, applied.as_ref())?;
            self.start_machine(id, op)?;
        }
        write_spec(&self.config.state_dir, id, spec)
    }

    fn create(&self, id: &str, spec: &MachineSpec, auths: &[String]) -> anyhow::Result<()> {
        let (port, image, launch, digest) = self.resolve(id, spec, auths)?;
        self.boot(id, spec, port, &image, &launch, digest.as_deref())
    }

    // UNIT_BOUNDARY_DESCRIPTION: moves a machine to a new image. The new image is fetched and its launch read while the old machine still runs, so the agent is down for the stop, the recreate and the boot and not for a pull, and a pull that fails leaves the old machine as it was. The port file is kept, so the recreated machine publishes on the port its Service already maps to. The old image stays held while this runs, because the stored spec names it until the new machine has booted; it is rewritten only after that, and the holders published after it release the old image.
    fn recreate(
        &self,
        id: &str,
        spec: &MachineSpec,
        state: &str,
        auths: &[String],
    ) -> anyhow::Result<()> {
        let (port, image, launch, digest) = self.resolve(id, spec, auths)?;
        self.forget_state(id);
        if state == STATE_RUNNING {
            self.stop_machine(id)?;
        }
        self.runtime.delete_keeping_storage(id)?;
        self.boot(id, spec, port, &image, &launch, digest.as_deref())?;
        write_spec(&self.config.state_dir, id, spec)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what a machine of this spec boots, and on which port. What it boots is decided in order: the digest entry in the cache when its launch record is there, a fresh fetch into that entry, an archive an install with no registry staged in the image directory, and last the registry reference itself with its launch read from the registry. A tree with no launch record is never booted from, because it would boot with nothing running in it.
    fn resolve(
        &self,
        id: &str,
        spec: &MachineSpec,
        auths: &[String],
    ) -> anyhow::Result<(u16, String, ImageLaunch, Option<String>)> {
        let port = {
            let _ports = locked(&self.ports);
            state::allocate_port(&self.config.state_dir, id, self.config.ports.clone())?
        };
        let mut image = spec.image.clone();
        if !is_image_ref(&image) || image.contains("..") {
            anyhow::bail!("invalid image reference {image:?}");
        }
        let mut digest = self.cache.resolve_digest(&image, REF_FRESH, auths);
        let booted = match self.digest_image(&image, digest.as_deref(), auths) {
            Ok(Some(found)) => Some(found),
            fetched => {
                let staged = self.staged_archive(&image)?;
                if digest.is_none() {
                    self.metrics.lookup(staged.is_some());
                }
                match (staged, fetched) {
                    (Some(staged), fetched) => {
                        if let Err(e) = fetched {
                            tracing::warn!(image = %image, error = %format!("{e:#}"), "image cache: the digest entry could not be fetched, booting the staged archive");
                        }
                        digest = None;
                        Some(staged)
                    }
                    (None, Err(e)) => return Err(e),
                    (None, Ok(_)) => None,
                }
            }
        };
        let (cached, launch) = match booted {
            Some((cached, launch)) => (Some(cached), launch),
            None => {
                if let Some(digest) = &digest {
                    image = format!("{}@{digest}", repository(&image));
                }
                let launch =
                    fetch::launch_from_registry(&self.config.crane, &image, auths, &self.lifetime)?;
                (None, launch)
            }
        };
        if let Some(cached) = cached.filter(|path| path.exists()) {
            image = cached.to_string_lossy().into_owned();
        }
        Ok((port, image, launch, digest))
    }

    fn boot(
        &self,
        id: &str,
        spec: &MachineSpec,
        port: u16,
        image: &str,
        launch: &ImageLaunch,
        digest: Option<&str>,
    ) -> anyhow::Result<()> {
        self.record_digest(id, digest)?;
        let dir = machine_dir(&self.config.state_dir, id)
            .ok_or_else(|| anyhow::anyhow!("invalid machine id {id:?}"))?;
        self.forget_state(id);
        self.runtime.create(
            id,
            &Machine {
                spec,
                image,
                host_port: port + LOOPBACK_OFFSET,
                share: &dir.join(SHARE_DIR),
                launch: Some(launch),
            },
        )?;
        self.forwarder.publish(id, port)?;
        self.start_machine(id, STATE_CREATING)
    }

    fn start_machine(&self, id: &str, op: &'static str) -> anyhow::Result<()> {
        self.mark_starting(id, op);
        let started = Instant::now();
        let result = self.runtime.start(id);
        self.metrics.start(op, started.elapsed(), result.is_ok());
        result
    }

    fn remember_secrets(&self, id: &str, spec: &MachineSpec) {
        let mut inner = locked(&self.inner);
        let known = inner.secrets.entry(id.to_string()).or_default();
        for value in spec.env.values() {
            if !known.contains(value) {
                known.push(value.clone());
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the machine's console, redacted with every env value this runner has been given for it and the ones its applied spec holds, the way a failed smolvm call's output is. A tail this runner cannot redact, because it holds no spec for the machine at all, is not shown.
    fn console_tail(&self, id: &str) -> String {
        let remembered = locked(&self.inner).secrets.get(id).cloned();
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

    // UNIT_BOUNDARY_DESCRIPTION: a guest that boots and never answers has no failure to report — its start call returned — so without this the Agent reads not ready for as long as it stays stuck, and why is only on the console. A recorded failure carries its own tail and wins; a new start or an answer clears the note. An answer also drops the start stamp: from then on the machine is up, and a probe it misses later is a health blip, not a boot still waited on, so neither the note nor `startingMs` comes back for it. The start stamp is read under the same lock as the start it belongs to, so a start that lands mid-poll cannot pair one boot's watch with another's stamp and lose the ready-latency sample.
    fn watch_boot(&self, id: &str, status: &mut MachineStatus, no_failure: bool) {
        let (op, note, started_at) = {
            let mut inner = locked(&self.inner);
            let op = inner.awaiting.get(id).copied();
            let started_at = inner.started_at.get(id).copied();
            if status.ready {
                inner.awaiting.remove(id);
                inner.slow_boots.remove(id);
                inner.started_at.remove(id);
            }
            (op, inner.slow_boots.get(id).cloned(), started_at)
        };
        let Some(at) = started_at else {
            return;
        };
        if status.ready {
            if let Some(op) = op {
                self.metrics.became_ready(op, at.elapsed());
            }
            return;
        }
        if !no_failure || at.elapsed() < SLOW_BOOT_AFTER {
            return;
        }
        let note = match note {
            Some((message, noted)) if noted.elapsed() < SLOW_BOOT_AFTER => message,
            _ => {
                let message = with_console(SLOW_BOOT, &self.console_tail(id));
                let mut inner = locked(&self.inner);
                if inner.started_at.get(id) == Some(&at) {
                    inner
                        .slow_boots
                        .insert(id.to_string(), (message.clone(), Instant::now()));
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
        let committing = locked(&self.inner).committing.clone();
        let committed = Capacity {
            state_dir: &self.config.state_dir,
            limit_mib: self.config.memory_mib,
            reserve_mib: self.config.reserve_mib,
        }
        .committed(None, &committing, &|other: &str| {
            matches!(self.machine_state(other), Ok(STATE_RUNNING))
        })
        .ok();
        self.metrics.render(&Gauges {
            budget_bytes: self.config.image_budget,
            limit_mib: self.config.memory_mib,
            reserve_mib: self.config.reserve_mib,
            committed_mib: committed,
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: the tree a machine of this digest boots, fetched into the cache if it is not there. None, with no error, means the cache cannot serve the create: no digest was known, or there is no crane to fetch with, and the caller tries a staged archive.
    fn digest_image(
        &self,
        image: &str,
        digest: Option<&str>,
        auths: &[String],
    ) -> anyhow::Result<Option<(PathBuf, ImageLaunch)>> {
        let Some(digest) = digest else {
            return Ok(None);
        };
        let entry = self.cache.digest_entry(digest);
        let pinned = format!("{}@{digest}", repository(image));
        let mut launch = read_launch(&entry)?;
        if launch.is_some() {
            self.cache.may_reuse(&pinned, &entry, auths)?;
        }
        self.metrics.lookup(launch.is_some());
        if launch.is_none() && !self.config.crane.is_empty() {
            let started = Instant::now();
            let fetched = self
                .cache
                .fetch(&pinned, auths, &entry, &self.images_in_use());
            self.metrics.fetched(started.elapsed(), fetched.is_ok());
            let trim = fetched?;
            for bytes in trim.freed {
                self.metrics.evicted(bytes);
            }
            if let Some(used) = trim.used {
                self.metrics.cache_size(used);
            }
            launch = read_launch(&entry)?;
        }
        Ok(launch.map(|launch| (entry.join(ROOTFS_DIR), launch)))
    }

    // UNIT_BOUNDARY_DESCRIPTION: the `docker save` archive an install with no registry stages for this reference, with the launch read out of the archive's own config. The directory is mounted read-only in that mode, so the digest entry can never be fetched there and this is what the machine boots.
    fn staged_archive(&self, image: &str) -> anyhow::Result<Option<(PathBuf, ImageLaunch)>> {
        let archive = cache::archive_path(&self.config.image_dir, image);
        if !archive.exists() {
            return Ok(None);
        }
        let launch = launch_from_archive(&archive).map_err(|e| unusable(format!("{e:#}")))?;
        Ok(Some((archive, launch)))
    }

    // UNIT_BOUNDARY_DESCRIPTION: records the digest a machine is about to boot, before it boots, and publishes it: a machine that started with no record is one whose tree another runner may evict. With no digest the record is removed, because that machine boots from a staged archive or straight from the registry, and holds no cache entry.
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
                self.publish_holders();
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

    // UNIT_BOUNDARY_DESCRIPTION: the cache entries this runner's machines hold, read from their state on disk rather than tracked alongside them, because that state outlives the process that wrote it. A machine holds the digest entry it booted, by its record.
    fn images_in_use(&self) -> BTreeSet<PathBuf> {
        state::machine_ids(&self.config.state_dir)
            .unwrap_or_default()
            .iter()
            .filter_map(|id| self.recorded_digest(id))
            .map(|digest| self.cache.digest_entry(&digest))
            .collect()
    }

    pub fn publish_holders(&self) {
        self.cache.publish(&self.images_in_use());
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the machine fits the runner's memory, counting the machines running and the ones being created, which have no spec on disk yet. Running is read through the state cache, so admitting one machine costs no probe per machine when the controller has just asked.
    fn room_for(&self, id: &str, spec: &MachineSpec) -> anyhow::Result<()> {
        let committing = locked(&self.inner).committing.clone();
        Capacity {
            state_dir: &self.config.state_dir,
            limit_mib: self.config.memory_mib,
            reserve_mib: self.config.reserve_mib,
        }
        .room_for(id, spec.memory_mib, &committing, &|other: &str| {
            matches!(self.machine_state(other), Ok(STATE_RUNNING))
        })
    }

    fn dead_for_long(&self, id: &str) -> bool {
        locked(&self.inner)
            .health
            .get(id)
            .is_some_and(|h| h.dead_for_long(SystemTime::now()))
    }

    fn mark_starting(&self, id: &str, op: &'static str) {
        let mut inner = locked(&self.inner);
        inner.started_at.insert(id.to_string(), Instant::now());
        inner.awaiting.insert(id.to_string(), op);
        inner.slow_boots.remove(id);
    }

    fn forget_state(&self, id: &str) {
        locked(&self.inner).last_state.remove(id);
    }

    // UNIT_BOUNDARY_DESCRIPTION: a stop ends whatever boot the machine was waited on for. Without this a machine stopped before its guest ever answered kept its start stamp, and so reported a growing `startingMs` for as long as it stayed stopped.
    fn stop_machine(&self, id: &str) -> anyhow::Result<()> {
        {
            let mut inner = locked(&self.inner);
            inner.started_at.remove(id);
            inner.awaiting.remove(id);
            inner.slow_boots.remove(id);
        }
        self.runtime.stop(id)
    }

    fn machine_state(&self, id: &str) -> anyhow::Result<&'static str> {
        if let Some((state, at)) = locked(&self.inner).last_state.get(id).copied() {
            if at.elapsed() < STATE_TTL {
                return Ok(state);
            }
        }
        let state = self.runtime.state(id)?;
        locked(&self.inner)
            .last_state
            .insert(id.to_string(), (state, Instant::now()));
        Ok(state)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what the controller is told about a machine. An operation in flight is reported as the machine's state. A guest that answers its health endpoint is ready even before the start call that booted it returns — but only on the way up: a restart's old guest and a stopping one answer until they die.
    pub fn status(&self, id: &str) -> MachineStatus {
        let (pending, failed, restarts, started_at) = {
            let inner = locked(&self.inner);
            (
                inner.pending.get(id).copied(),
                inner.failures.get(id).cloned(),
                inner.restarts.get(id).copied().unwrap_or_default(),
                inner.started_at.get(id).copied(),
            )
        };
        let port = state::port(&self.config.state_dir, id);
        let no_failure = failed.is_none();
        let mut status = MachineStatus {
            state: STATE_ABSENT.to_string(),
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
        match pending {
            Some(op) => status.state = op.to_string(),
            None => match self.machine_state(id) {
                Ok(state) => status.state = state.to_string(),
                Err(e) => {
                    status.state = STATE_UNKNOWN.to_string();
                    if status.message.is_empty() {
                        status.message = format!("{e:#}");
                    }
                    return status;
                }
            },
        }
        if reads_ready(&status.state) {
            status.ready = healthy(port);
            self.watch_boot(id, &mut status, no_failure);
        }
        if status.state == STATE_RUNNING {
            locked(&self.inner)
                .health
                .entry(id.to_string())
                .or_default()
                .observed_running(status.ready, SystemTime::now());
        }
        status
    }
}

// UNIT_BOUNDARY_DESCRIPTION: an operation's place in its machine's queue. Dropping it hands the machine to the next ticket, on every path out of the operation including a panic, so one failed operation cannot stall every operation queued behind it.
struct Turn<'a> {
    server: &'a Server,
    id: String,
    ticket: u64,
}

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        locked(&self.server.inner)
            .served
            .insert(self.id.clone(), self.ticket);
        self.server.turns.notify_all();
    }
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
