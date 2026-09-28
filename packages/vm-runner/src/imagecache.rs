use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::cache::{
    self, digest_path, entry_digest, pinned_digest, repository, Entry, PARTIAL_PREFIX, PULL_TIMEOUT,
};
use crate::fetch::{
    self, first_lines, host_platform, out_of_capacity, unusable, ANONYMOUS, RESOLVE_TIMEOUT,
};
use crate::files;
use crate::launch::{launch_from_config, read_launch, ImageLaunch, LAUNCH_FILE};
use crate::state::is_image_ref;
use crate::{elapsed_ms, locked};

// UNIT_BOUNDARY_DESCRIPTION: the one writer of an image cache directory: the node's image cache service, or the runner that owns its claim. It resolves a reference to a digest, fetches and unpacks that digest once for every machine of it, and evicts inside a budget. What it has to remember between requests — what a tag resolved to, which entries anyone may boot, which entries machines are running, what each entry weighs, what fetches are under way — is in this process's memory, because no other process writes the directory and so none has to read it. The one fact kept on disk is where each tree came from, because a later caller's access is checked against it.
pub struct ImageCache {
    config: CacheConfig,
    opened: Instant,
    memory: Mutex<Memory>,
    measuring: Mutex<()>,
    fetching: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

pub const ROOTFS_DIR: &str = "rootfs";

// UNIT_BOUNDARY_DESCRIPTION: the record beside a tree of where it came from: the platform it was unpacked for, and every repository a fetch of it was proven from. Runners never read it; the writer checks a caller's access against it.
pub const ORIGIN_FILE: &str = "origin.json";

// UNIT_BOUNDARY_DESCRIPTION: how long a tag's resolution is trusted without asking the registry again.
pub const REF_FRESH: Duration = Duration::from_secs(10 * 60);

// UNIT_BOUNDARY_DESCRIPTION: the longest one resolve may take, from the request to the answer: every registry read and probe it makes, and the fetch, share this one deadline. A resolve that waits for another caller's fetch of the same digest waits inside it too, since that fetch started earlier under a deadline of its own. The runner's client waits a little longer than this, so a slow service is told apart from a lost one.
pub const RESOLVE_DEADLINE: Duration = Duration::from_secs(PULL_TIMEOUT.as_secs() + 5 * 60);

// UNIT_BOUNDARY_DESCRIPTION: the most digests one hold may name. A runner names only what its own machines boot, which is a few dozen at most; the cap bounds what one caller can make the service remember.
pub const HOLDS_PER_CALL: usize = 1024;

// UNIT_BOUNDARY_DESCRIPTION: how far past its budget a node cache may grow before it refuses to fetch: its budget and half again. Holds keep a tree from eviction, and every runner on the node may hold or resolve any digest over the one socket, so without a ceiling one compromised runner could fill the node's disk with trees nobody may evict. A runner's own cache has no ceiling: it serves one owner, on that owner's claim.
pub fn node_fetch_ceiling(budget: i64) -> Option<u64> {
    let budget = u64::try_from(budget).ok().filter(|b| *b > 0)?;
    Some(budget.saturating_add(budget / 2))
}

// UNIT_BOUNDARY_DESCRIPTION: how long a hold keeps an entry from eviction after the holder last named it. A runner names every digest its machines boot at least once a minute, so a hold lapses only for a runner that has stopped, and its machines stopped with it.
pub const HOLD_LEASE: Duration = Duration::from_secs(5 * 60);

// UNIT_BOUNDARY_DESCRIPTION: how the cache is opened. `pins` are references held for as long as the cache is open: the harness images the service preloads. `check_access` is set where the cache is shared by owners: an entry that was not proven readable without credentials is then served only to a caller whose own credentials read it where it came from. `hold_grace` is how long after opening nothing is evicted, which gives every runner time to name what it holds again after the service restarts and forgets. `fetch_ceiling` is the size past which a fetch is refused.
pub struct CacheConfig {
    pub dir: PathBuf,
    pub budget: i64,
    pub crane: String,
    pub pins: Vec<String>,
    pub lifetime: CancellationToken,
    pub check_access: bool,
    pub ref_fresh: Duration,
    pub hold_lease: Duration,
    pub hold_grace: Duration,
    pub fetch_ceiling: Option<u64>,
}

#[derive(Default)]
struct Memory {
    refs: HashMap<String, (String, Instant)>,
    public: HashSet<String>,
    holds: HashMap<String, Instant>,
    entries: HashMap<PathBuf, Entry>,
    in_flight: u64,
    measured: bool,
}

// UNIT_BOUNDARY_DESCRIPTION: what a machine of a reference boots: the digest its tree is stored under, and what the image says to run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resolved {
    pub digest: String,
    pub launch: ImageLaunch,
}

// UNIT_BOUNDARY_DESCRIPTION: what a fetch cost when a resolve had to make one: how long it ran, whether it worked, the size of each entry the trim after it evicted, and what the cache held after that trim.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Fetched {
    pub ms: u64,
    pub ok: bool,
    #[serde(default)]
    pub freed: Vec<u64>,
    #[serde(default)]
    pub used: Option<u64>,
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to one resolve. `fetched` is set when the entry was not cached, so the runner can count a hit, a miss and the fetch. `unreachable` is set only by a client that never reached the cache, which is the one failure where a runner may still boot a tree it already holds.
pub struct Lookup {
    pub resolved: anyhow::Result<Resolved>,
    pub fetched: Option<Fetched>,
    pub unreachable: bool,
}

impl Lookup {
    pub fn failed(e: anyhow::Error) -> Self {
        Self {
            resolved: Err(e),
            fetched: None,
            unreachable: false,
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the image cache as a runner uses it, whether the cache is in its own process or is the node's service at the other end of a socket. `hold` names every digest the runner's machines boot, and must be called again within HOLD_LEASE to keep them.
pub trait Images: Send + Sync {
    fn resolve(&self, reference: &str, auths: &[String]) -> Lookup;
    fn hold(&self, digests: &BTreeSet<String>) -> anyhow::Result<()>;
}

// UNIT_BOUNDARY_DESCRIPTION: what one eviction pass did: the size of each image it removed, and what the cache held after it, when it was weighed against a budget at all.
#[derive(Debug, Default)]
pub struct Trim {
    pub freed: Vec<u64>,
    pub used: Option<u64>,
}

// UNIT_BOUNDARY_DESCRIPTION: where a tree came from. An empty platform is a tree an older writer unpacked before this was recorded: it is taken to be this host's, and it has no repository any caller's access can be checked against until a fetch proves one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Origin {
    pub platform: String,
    pub repositories: BTreeSet<String>,
}

fn read_origin(entry: &Path) -> anyhow::Result<Origin> {
    match fs::read(entry.join(ORIGIN_FILE)) {
        Ok(encoded) => Ok(serde_json::from_slice(&encoded)?),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Origin::default()),
        Err(e) => Err(e.into()),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether a cached tree may be reused without a fetch: `Granted`, or `Unproven` when the caller names the digest in a repository it was never fetched from and its credentials read none it was. An unproven caller fetches the digest from its own repository, which is what proves the registry gives it those bytes.
enum Reuse {
    Granted,
    Unproven,
}

// UNIT_BOUNDARY_DESCRIPTION: what a fetch learned before it downloads anything: what the image says to run, the credential the registry accepted, and the compressed size its manifest names.
struct Prepared {
    launch: ImageLaunch,
    auth: String,
    floor: Option<u64>,
}

impl ImageCache {
    // UNIT_BOUNDARY_DESCRIPTION: opens the directory as its only writer. A scratch tree already there was left by a writer that died, mid-fetch or mid-eviction, so it is removed now. A directory mounted read-only, as the staged archives are, opens too: nothing is written there until a fetch, and that fetch fails with a message naming the directory.
    pub fn open(config: CacheConfig) -> Self {
        let _ = fs::create_dir_all(&config.dir);
        cache::reclaim_scratch(&config.dir);
        Self {
            config,
            opened: Instant::now(),
            memory: Mutex::new(Memory::default()),
            measuring: Mutex::new(()),
            fetching: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    fn dir(&self) -> &Path {
        &self.config.dir
    }

    fn digest_entry(&self, digest: &str) -> PathBuf {
        digest_path(&self.config.dir, digest)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the digest a machine created now from this reference should boot. A pinned reference is never resolved, because it cannot move. A tag resolved within `fresh` is answered from memory; otherwise the registry is asked with each of the caller's credentials in turn, for this host's platform. A registry that cannot answer gives the digest the tag last resolved to, so an outage boots what was cached before; a tag never resolved here is refused with what the registry said.
    fn digest_for(
        &self,
        reference: &str,
        fresh: Duration,
        auths: &[String],
        deadline: Instant,
    ) -> anyhow::Result<String> {
        if let Some(digest) = pinned_digest(reference) {
            return Ok(digest.to_string());
        }
        let known = locked(&self.memory).refs.get(reference).cloned();
        if let Some((digest, at)) = &known {
            if at.elapsed() < fresh {
                return Ok(digest.clone());
            }
        }
        let known = known.map(|(digest, _)| digest);
        if self.config.crane.is_empty() {
            return known.ok_or_else(|| {
                unusable(format!(
                    "{} was never resolved here, and this cache has no crane to ask the registry",
                    logged(reference)
                ))
            });
        }
        let mut last = String::new();
        let answer = fetch::in_turn(auths).iter().find_map(|auth| {
            match fetch::crane_output(
                &self.config.crane,
                "digest",
                &[reference],
                auth,
                fetch::within(RESOLVE_TIMEOUT, deadline),
                &self.config.lifetime,
            ) {
                Ok(out) => Some(String::from_utf8_lossy(&out).trim().to_string())
                    .filter(|digest| cache::is_digest(digest)),
                Err(e) => {
                    last = format!("{e:#}");
                    None
                }
            }
        });
        let Some(digest) = answer else {
            let Some(known) = known else {
                return Err(unusable(format!(
                    "resolving {}: {}",
                    logged(reference),
                    first_lines(&last)
                )));
            };
            tracing::warn!(image = %logged(reference), digest = %known, "image cache: the registry could not resolve a tag, so it boots the digest the tag last resolved to");
            return Ok(known);
        };
        locked(&self.memory)
            .refs
            .insert(reference.to_string(), (digest.clone(), Instant::now()));
        Ok(digest)
    }

    // UNIT_BOUNDARY_DESCRIPTION: resolves a reference, fetches its digest when the cache lacks it, and holds the entry for the caller once it is on disk and before the answer goes back, so no eviction can take it between this answer and the caller's next hold. A resolve that fails holds nothing. Two callers after one missing digest fetch it once: the second waits for the first and then finds it cached. A cached entry is checked against the caller's credentials when the cache is shared. A tree that is incomplete, or was unpacked for another platform, is fetched again.
    pub fn resolve_with(&self, reference: &str, auths: &[String], fresh: Duration) -> Lookup {
        if !is_image_ref(reference) || reference.contains("..") {
            return Lookup::failed(unusable(format!(
                "{:?} is not an image reference",
                logged(reference)
            )));
        }
        let deadline = Instant::now() + RESOLVE_DEADLINE;
        let digest = match self.digest_for(reference, fresh, auths, deadline) {
            Ok(digest) => digest,
            Err(e) => return Lookup::failed(e),
        };
        let repo = repository(reference);
        let pinned = format!("{repo}@{digest}");
        let entry = self.digest_entry(&digest);
        let gate = self.fetch_gate(&digest);
        let _fetching = locked(&gate);
        let cached = match self.cached(&entry) {
            Ok(cached) => cached,
            Err(e) => {
                return Lookup::failed(e.context(format!("reading the cached launch of {digest}")))
            }
        };
        if let Some((launch, origin)) = cached {
            match self.may_reuse(repo, &digest, &origin, auths, deadline) {
                Ok(Reuse::Granted) => {
                    self.hold_one(&digest);
                    return Lookup {
                        resolved: Ok(Resolved { digest, launch }),
                        fetched: None,
                        unreachable: false,
                    };
                }
                Ok(Reuse::Unproven) => {}
                Err(e) => return Lookup::failed(e),
            }
        }
        if self.config.crane.is_empty() {
            return Lookup::failed(unusable(format!(
                "{} is not cached, and this cache has no crane to fetch it with",
                logged(reference)
            )));
        }
        let started = Instant::now();
        let prepared = match self.prepare(&pinned, auths, deadline) {
            Ok(prepared) => prepared,
            Err(e) => {
                return Lookup {
                    resolved: Err(e),
                    fetched: Some(Fetched {
                        ms: elapsed_ms(started),
                        ..Fetched::default()
                    }),
                    unreachable: false,
                }
            }
        };
        let reserved = match self.admit(prepared.floor) {
            Ok(reserved) => reserved,
            Err(e) => return Lookup::failed(e),
        };
        let fetched = self.fetch(&pinned, &entry, &digest, &prepared, deadline);
        drop(reserved);
        let mut report = Fetched {
            ms: elapsed_ms(started),
            ok: fetched.is_ok(),
            ..Fetched::default()
        };
        let resolved = fetched.map(|launch| {
            self.hold_one(&digest);
            let trim = self.evict(Some(&entry));
            report.freed = trim.freed;
            report.used = trim.used;
            Resolved { digest, launch }
        });
        Lookup {
            resolved,
            fetched: Some(report),
            unreachable: false,
        }
    }

    fn fetch_gate(&self, digest: &str) -> Arc<Mutex<()>> {
        let mut fetching = locked(&self.fetching);
        fetching.retain(|_, gate| Arc::strong_count(gate) > 1);
        fetching.entry(digest.to_string()).or_default().clone()
    }

    fn hold_one(&self, digest: &str) {
        locked(&self.memory)
            .holds
            .insert(digest.to_string(), Instant::now());
    }

    // UNIT_BOUNDARY_DESCRIPTION: the launch and origin of a complete tree this host can boot, or nothing. A tree with no launch record beside it, or one whose records do not parse, is not complete, and one unpacked for another platform is not this host's: a claim that moved to a node of another architecture holds trees of the old one, and a pinned index digest names both. A record that cannot be read at all is an error, since fetching again would not fix the disk.
    fn cached(&self, entry: &Path) -> anyhow::Result<Option<(ImageLaunch, Origin)>> {
        let unparsable = |e: &anyhow::Error| e.downcast_ref::<serde_json::Error>().is_some();
        let launch = match read_launch(entry) {
            Ok(Some(launch)) => launch,
            Ok(None) => return Ok(None),
            Err(e) if unparsable(&e) => return Ok(None),
            Err(e) => return Err(e),
        };
        let origin = match read_origin(entry) {
            Ok(origin) => origin,
            Err(e) if unparsable(&e) => return Ok(None),
            Err(e) => return Err(e),
        };
        if !origin.platform.is_empty() && origin.platform != host_platform() {
            return Ok(None);
        }
        Ok(Some((launch, origin)))
    }

    // UNIT_BOUNDARY_DESCRIPTION: a cache hit is a boot the registry never saw, so on a shared cache an entry that is not known to be public is served only after a registry still gives it to the caller where it came from: an anonymous read of one of its origin repositories first, which marks it public, then each of the caller's credentials against each origin in turn. The repository the caller names is never what is asked, because anyone can name any digest under a registry of their own that answers every read. A caller whose repository is not an origin and whose credentials read none is unproven rather than refused, and fetches the digest itself. It fails closed: a registry that cannot be reached refuses the boot. What is known to be public is kept in memory only, so after a restart every entry is checked once again.
    fn may_reuse(
        &self,
        caller_repo: &str,
        digest: &str,
        origin: &Origin,
        auths: &[String],
        deadline: Instant,
    ) -> anyhow::Result<Reuse> {
        if !self.config.check_access || locked(&self.memory).public.contains(digest) {
            return Ok(Reuse::Granted);
        }
        let crane = &self.config.crane;
        let lifetime = &self.config.lifetime;
        let named = format!("{caller_repo}@{digest}");
        if crane.is_empty() {
            return Err(unusable(format!(
                "{named} is cached, and this cache has no crane to check the caller may read it"
            )));
        }
        let origins: Vec<String> = origin
            .repositories
            .iter()
            .map(|repo| format!("{repo}@{digest}"))
            .collect();
        if origins
            .iter()
            .any(|at| fetch::readable(crane, at, ANONYMOUS, deadline, lifetime))
        {
            locked(&self.memory).public.insert(digest.to_string());
            return Ok(Reuse::Granted);
        }
        if auths.iter().any(|auth| {
            origins
                .iter()
                .any(|at| fetch::readable(crane, at, auth, deadline, lifetime))
        }) {
            return Ok(Reuse::Granted);
        }
        if origin.repositories.contains(caller_repo) {
            return Err(unusable(format!(
                "{named} is cached from a private registry, and this machine's pull credentials cannot read its manifest"
            )));
        }
        Ok(Reuse::Unproven)
    }

    fn prepare(
        &self,
        reference: &str,
        auths: &[String],
        deadline: Instant,
    ) -> anyhow::Result<Prepared> {
        let crane = &self.config.crane;
        let lifetime = &self.config.lifetime;
        let started = Instant::now();
        let (config, auth) = fetch::read_config(crane, reference, auths, deadline, lifetime)
            .inspect_err(|_| {
                tracing::warn!(
                    image = reference,
                    duration_ms = elapsed_ms(started),
                    "image config fetch failed"
                );
            })?;
        let launch = launch_from_config(&config)
            .map_err(|e| unusable(format!("reading the config of {reference}: {e:#}")))?;
        let floor = fetch::compressed_size(crane, reference, &auth, deadline, lifetime);
        Ok(Prepared {
            launch,
            auth,
            floor,
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: admits one fetch. The filesystem must have room for at least the image's compressed size. A node cache must not be past its ceiling counting every fetch already under way at what it reserved, so fetches that start together cannot each find the cache under its ceiling and together fill the disk: once the fetches in flight take it past the ceiling, the next is refused. Only a cache whose every other tree is held gets there, so that refusal is logged as an error for the operator: some runner holds more than its machines can be running. What this reserves is released when the returned reservation is dropped, once the entry is weighed in or the fetch has failed.
    fn admit(&self, floor: Option<u64>) -> anyhow::Result<Reservation<'_>> {
        let floor = floor.unwrap_or(0);
        if let Some(free) = fetch::free_bytes(&self.config.dir) {
            if free < floor {
                return Err(out_of_capacity(format!(
                    "the image needs at least {floor} bytes, and the filesystem holding the image cache has {free} free"
                )));
            }
        }
        let used = self.used();
        let mut memory = locked(&self.memory);
        if let Some(ceiling) = self.config.fetch_ceiling {
            let committed = used.saturating_add(memory.in_flight);
            if committed > ceiling {
                tracing::error!(
                    bytes = used,
                    in_flight = memory.in_flight,
                    budget = self.config.budget,
                    ceiling,
                    "image cache: refusing to fetch, the cache is past its ceiling and every tree in it is held"
                );
                return Err(out_of_capacity(format!(
                    "the node's image cache holds {used} bytes and is fetching {} more against a budget of {}, all of them held by running machines, so no other image can be fetched there now",
                    memory.in_flight, self.config.budget
                )));
            }
        }
        memory.in_flight = memory.in_flight.saturating_add(floor);
        Ok(Reservation {
            cache: self,
            bytes: floor,
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: fetches an image into the entry `cached` and unpacks it. `reference` names a digest, so the tree is the image that digest names even if a tag moves while the fetch runs. What the image says to run and where it came from are written beside the tree, the launch record's presence is what marks the entry complete, and the whole scratch tree reaches the disk before it is renamed into place, so a crash leaves either no entry or a whole one. The layers come with the credential that read the config. An entry fetched anonymously, or one an anonymous read also reaches, is public: any caller may boot it.
    fn fetch(
        &self,
        reference: &str,
        cached: &Path,
        digest: &str,
        prepared: &Prepared,
        deadline: Instant,
    ) -> anyhow::Result<ImageLaunch> {
        let crane = &self.config.crane;
        let lifetime = &self.config.lifetime;
        let scratch = Scratch::new(&self.config.dir).map_err(|e| written(e, "a scratch tree"))?;
        let rootfs = scratch.path().join(ROOTFS_DIR);
        files::create_dir(&rootfs, 0o755).map_err(|e| written(e, "a scratch tree"))?;
        let started = Instant::now();
        fetch::unpack(
            crane,
            reference,
            &rootfs,
            &prepared.auth,
            deadline,
            lifetime,
        )?;
        files::write(
            &scratch.path().join(LAUNCH_FILE),
            &serde_json::to_vec(&prepared.launch)?,
            0o644,
        )
        .map_err(|e| written(e, "the launch record"))?;
        let origin = Origin {
            platform: host_platform(),
            repositories: [repository(reference).to_string()].into(),
        };
        files::write(
            &scratch.path().join(ORIGIN_FILE),
            &serde_json::to_vec(&origin)?,
            0o644,
        )
        .map_err(|e| written(e, "the origin record"))?;
        let public = !self.config.check_access
            || prepared.auth.is_empty()
            || prepared.auth == ANONYMOUS
            || fetch::readable(crane, reference, ANONYMOUS, deadline, lifetime);
        sync_filesystem(scratch.path()).map_err(|e| written(e, "the unpacked tree"))?;
        let size = cache::dir_size(scratch.path());
        tracing::info!(
            image = reference,
            duration_ms = elapsed_ms(started),
            bytes = size,
            public,
            "image unpacked into the cache"
        );
        self.install(scratch, cached, &origin)?;
        let mut memory = locked(&self.memory);
        memory
            .entries
            .entry(cached.to_path_buf())
            .or_insert_with(|| Entry {
                path: cached.to_path_buf(),
                size,
                modified: SystemTime::now(),
            });
        if public {
            memory.public.insert(digest.to_string());
        }
        Ok(prepared.launch.clone())
    }

    // UNIT_BOUNDARY_DESCRIPTION: renames a finished scratch tree into place. The one writer holds the entry's fetch gate, so what is already there is one of three things. Nothing: the rename is the whole of it. A complete tree of this host's platform, which a caller that had to prove its access fetched again: that tree stays, the fetched copy is dropped, and the caller's repository joins its origins. Anything else — a tree with no launch record, or one unpacked for another platform — is one no machine on this host can be booting, so it is moved aside whole and deleted, and the rename is tried again. A stale tree is never left in place to be served as the new one.
    fn install(&self, scratch: Scratch, entry: &Path, origin: &Origin) -> anyhow::Result<()> {
        for _ in 0..2 {
            match fs::rename(scratch.path(), entry) {
                Ok(()) => {
                    sync_dir(&self.config.dir).map_err(|e| written(e, "the cache directory"))?;
                    return Ok(());
                }
                Err(e) if matches!(e.raw_os_error(), Some(libc::EEXIST | libc::ENOTEMPTY)) => {}
                Err(e) => return Err(written(e, "the new entry")),
            }
            match self.cached(entry)? {
                Some((_, existing)) => return self.add_origins(entry, existing, origin),
                None => {
                    tracing::warn!(entry = %entry.display(), "image cache: replacing a tree that is incomplete or of another platform");
                    drop(
                        self.discard(entry)
                            .map_err(|e| written(e, "a stale entry"))?,
                    );
                }
            }
        }
        Err(anyhow::anyhow!(
            "{} could not be put in place: the directory kept one there",
            entry.display()
        ))
    }

    fn add_origins(&self, entry: &Path, existing: Origin, fetched: &Origin) -> anyhow::Result<()> {
        let mut merged = existing.clone();
        merged
            .repositories
            .extend(fetched.repositories.iter().cloned());
        if merged == existing {
            return Ok(());
        }
        let next = entry.join(format!("{ORIGIN_FILE}.new"));
        files::write(&next, &serde_json::to_vec(&merged)?, 0o644)
            .map_err(|e| written(e, "the origin record"))?;
        fs::rename(&next, entry.join(ORIGIN_FILE)).map_err(|e| written(e, "the origin record"))?;
        sync_dir(entry).map_err(|e| written(e, "the origin record"))?;
        Ok(())
    }

    // UNIT_BOUNDARY_DESCRIPTION: takes an entry out of the cache in one step: it is renamed to a scratch name, which no lookup matches, and the scratch that comes back deletes the tree when it is dropped. A writer killed while deleting leaves a scratch tree, reclaimed when the cache is next opened — never a half-deleted tree under the entry's own name, which would be served as complete. An entry already gone gives nothing.
    fn discard(&self, entry: &Path) -> io::Result<Option<Scratch>> {
        let aside = Scratch::new(&self.config.dir)?;
        match fs::rename(entry, aside.path()) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        }
        sync_dir(&self.config.dir)?;
        Ok(Some(aside))
    }

    // UNIT_BOUNDARY_DESCRIPTION: holds each digest for another HOLD_LEASE. A hold only ever extends: a caller cannot drop what another holds, so a runner that sends a short list, or a wrong one, never frees a tree another owner's machine runs from. Only a digest with an entry on disk is held, and a call naming more than HOLDS_PER_CALL is refused, so what callers can make the service remember is bounded by what the directory holds.
    pub fn hold(&self, digests: &BTreeSet<String>) -> anyhow::Result<()> {
        anyhow::ensure!(
            digests.len() <= HOLDS_PER_CALL,
            "a hold names {} digests, more than the {HOLDS_PER_CALL} one call may",
            digests.len()
        );
        let present: Vec<&String> = digests
            .iter()
            .filter(|d| cache::is_digest(d) && self.digest_entry(d).is_dir())
            .collect();
        let now = Instant::now();
        let mut memory = locked(&self.memory);
        for digest in present {
            memory.holds.insert(digest.clone(), now);
        }
        Ok(())
    }

    // UNIT_BOUNDARY_DESCRIPTION: what eviction must spare: every hold still inside its lease, and the digest each pin last resolved to. Lapsed holds are forgotten here.
    fn held(&self, memory: &mut Memory) -> BTreeSet<PathBuf> {
        let lease = self.config.hold_lease;
        memory.holds.retain(|_, at| at.elapsed() < lease);
        let mut held: BTreeSet<PathBuf> =
            memory.holds.keys().map(|d| self.digest_entry(d)).collect();
        for pin in &self.config.pins {
            let digest = pinned_digest(pin)
                .map(str::to_string)
                .or_else(|| memory.refs.get(pin).map(|(digest, _)| digest.clone()));
            if let Some(digest) = digest {
                held.insert(self.digest_entry(&digest));
            }
        }
        held
    }

    // UNIT_BOUNDARY_DESCRIPTION: weighs every entry already in the directory, once, the first time the cache needs its size. The trees are walked outside the memory lock, so a hold or a resolve never waits on the walk; an entry written since opening was weighed as it was written and keeps that weight.
    fn measure(&self) {
        if locked(&self.memory).measured {
            return;
        }
        let _measuring = locked(&self.measuring);
        if locked(&self.memory).measured {
            return;
        }
        let found = cache::entries(&self.config.dir);
        let mut memory = locked(&self.memory);
        for entry in found {
            memory.entries.entry(entry.path.clone()).or_insert(entry);
        }
        memory.measured = true;
    }

    fn used(&self) -> u64 {
        self.measure();
        locked(&self.memory).entries.values().map(|e| e.size).sum()
    }

    // UNIT_BOUNDARY_DESCRIPTION: trims the cache to its budget, oldest write first, sparing what is held. The victims are chosen under the memory lock from the weights kept there, and deleted outside it. Nothing is evicted during the grace after opening, while runners have not yet named what they hold again. Goes over budget rather than free an image something is running from.
    pub fn evict(&self, keep: Option<&Path>) -> Trim {
        self.measure();
        let mut trim = Trim::default();
        let chosen = {
            let mut memory = locked(&self.memory);
            if self.opened.elapsed() < self.config.hold_grace {
                Vec::new()
            } else {
                let held = self.held(&mut memory);
                let all = memory.entries.values().cloned().collect();
                cache::choose(all, keep, self.config.budget, &held)
            }
        };
        for victim in chosen {
            if !self.remove(&victim) {
                continue;
            }
            tracing::info!(
                image = %victim.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                bytes = victim.size,
                "image cache: evicted an image to stay inside the budget"
            );
            trim.freed.push(victim.size);
        }
        if self.config.budget > 0 {
            let used = self.used();
            trim.used = Some(used);
            if used > self.config.budget as u64 {
                tracing::warn!(
                    bytes = used,
                    budget = self.config.budget,
                    "image cache: over its stated budget, and every image left is one a machine is running from or a pin"
                );
            }
        }
        trim
    }

    // UNIT_BOUNDARY_DESCRIPTION: takes one chosen entry out of the cache, with the entry's fetch gate taken so no resolve reads the tree while it goes. A resolve of the digest that comes after waits on the gate, then finds the entry gone and fetches it again. An entry a resolve is reading now, or one held since it was chosen, is passed over: a resolve holds its digest before it lets go of the gate, so a hold is either seen here or its resolve still has the gate. The tree is renamed away under the gate and deleted after it is let go. An entry that cannot be renamed away stays, whole, and is counted as it was.
    fn remove(&self, victim: &Entry) -> bool {
        let Some(digest) = entry_digest(&victim.path) else {
            return false;
        };
        let gate = self.fetch_gate(&digest);
        let Ok(resolving) = gate.try_lock() else {
            return false;
        };
        if self.held(&mut locked(&self.memory)).contains(&victim.path) {
            return false;
        }
        let aside = match self.discard(&victim.path) {
            Ok(aside) => aside,
            Err(e) => {
                tracing::warn!(image = %digest, error = %e, "image cache: evicting an image");
                return false;
            }
        };
        {
            let mut memory = locked(&self.memory);
            memory.entries.remove(&victim.path);
            memory.public.remove(&digest);
        }
        drop(resolving);
        drop(aside);
        true
    }

    // UNIT_BOUNDARY_DESCRIPTION: one preload pass over the pins. Each tag is resolved again on every pass, so a tag that moved is fetched under its new digest and the pin moves with it; the old digest's tree is then held only by the machines still running it. The directory is trimmed every pass, not only after a fetch, because the cache outlives every runner that fetched into it.
    pub fn preload(&self, auths: &[String]) {
        for reference in &self.config.pins {
            if self.config.lifetime.is_cancelled() {
                return;
            }
            let lookup = self.resolve_with(reference, auths, Duration::ZERO);
            if let Err(e) = lookup.resolved {
                tracing::warn!(image = %logged(reference), error = %format!("{e:#}"), "image cache: preloading an image this install ships");
            }
        }
        self.evict(None);
    }
}

impl Images for ImageCache {
    fn resolve(&self, reference: &str, auths: &[String]) -> Lookup {
        self.resolve_with(reference, auths, self.config.ref_fresh)
    }

    fn hold(&self, digests: &BTreeSet<String>) -> anyhow::Result<()> {
        ImageCache::hold(self, digests)
    }
}

fn logged(reference: &str) -> String {
    reference.replace(['\n', '\r'], " ")
}

// UNIT_BOUNDARY_DESCRIPTION: a write into the cache that failed. A full disk or an exhausted quota is a capacity problem, reported as the runner being out of room rather than as a boot to retry; anything else says what was being written.
fn written(e: io::Error, what: &str) -> anyhow::Error {
    if matches!(e.raw_os_error(), Some(libc::ENOSPC | libc::EDQUOT)) {
        return out_of_capacity(format!(
            "the image cache ran out of disk writing {what}: {e}"
        ));
    }
    anyhow::anyhow!("writing {what} into the image cache: {e}")
}

// UNIT_BOUNDARY_DESCRIPTION: flushes the whole filesystem holding `path`: every file of an unpacked tree at once, which is one call where a sync of each file would be one per file. It reports a write the disk failed.
fn sync_filesystem(path: &Path) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    let dir = fs::File::open(path)?;
    // SAFETY: syncfs takes a file descriptor and no pointers, and `dir` keeps it open for the call.
    if unsafe { libc::syncfs(dir.as_raw_fd()) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn sync_dir(path: &Path) -> io::Result<()> {
    fs::File::open(path)?.sync_all()
}

// UNIT_BOUNDARY_DESCRIPTION: bytes a fetch in flight has reserved against a node cache's ceiling, given back when it is dropped.
struct Reservation<'a> {
    cache: &'a ImageCache,
    bytes: u64,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        let mut memory = locked(&self.cache.memory);
        memory.in_flight = memory.in_flight.saturating_sub(self.bytes);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a tree that is no entry: an unpack in progress, or an evicted entry on its way out. It is named apart from any finished entry and dot-prefixed so the cache patterns never count it. It removes itself when dropped — on every path out of a fetch, including a cancelled one — and a tree a killed process left is reclaimed when the cache is next opened.
struct Scratch(PathBuf);

impl Scratch {
    fn new(parent: &Path) -> io::Result<Self> {
        fs::create_dir_all(parent)?;
        Ok(Self(files::create_unique_dir(
            parent,
            PARTIAL_PREFIX,
            0o777,
        )?))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
#[path = "imagecache_tests.rs"]
mod tests;
