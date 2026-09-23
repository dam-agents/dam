use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::cache::{self, digest_path, pinned_digest, repository, PARTIAL_PREFIX};
use crate::command;
use crate::fetch::{self, first_lines, unusable, DockerConfig, ANONYMOUS, RESOLVE_TIMEOUT};
use crate::files;
use crate::launch::{launch_from_config, read_launch, ImageLaunch, LAUNCH_FILE};
use crate::state::is_image_ref;
use crate::{elapsed_ms, locked};

// UNIT_BOUNDARY_DESCRIPTION: the one writer of an image cache directory: the node's image cache service, or the runner that owns its claim. It resolves a reference to a digest, fetches and unpacks that digest once for every machine of it, and evicts inside a budget. Everything it has to remember between requests — what a tag resolved to, which entries anyone may boot, which entries machines are running — is in this process's memory, because no other process writes the directory and so none has to read it.
pub struct ImageCache {
    config: CacheConfig,
    opened: Instant,
    memory: Mutex<Memory>,
    fetching: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

pub const ROOTFS_DIR: &str = "rootfs";

// UNIT_BOUNDARY_DESCRIPTION: how long a tag's resolution is trusted without asking the registry again.
pub const REF_FRESH: Duration = Duration::from_secs(10 * 60);

// UNIT_BOUNDARY_DESCRIPTION: how long a hold keeps an entry from eviction after the holder last named it. A runner names every digest its machines boot at least once a minute, so a hold lapses only for a runner that has stopped, and its machines stopped with it.
pub const HOLD_LEASE: Duration = Duration::from_secs(5 * 60);

// UNIT_BOUNDARY_DESCRIPTION: how the cache is opened. `pins` are references held for as long as the cache is open: the harness images the service preloads. `check_access` is set where the cache is shared by owners: an entry that was not proven readable without credentials is then served only to a caller whose own credentials read its manifest. `hold_grace` is how long after opening nothing is evicted, which gives every runner time to name what it holds again after the service restarts and forgets.
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
}

#[derive(Default)]
struct Memory {
    refs: HashMap<String, (String, Instant)>,
    public: HashSet<String>,
    holds: HashMap<String, Instant>,
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
    fn failed(e: anyhow::Error) -> Self {
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

impl ImageCache {
    // UNIT_BOUNDARY_DESCRIPTION: opens the directory as its only writer. A scratch tree already there was left by a writer that died, so it is removed now. A directory mounted read-only, as the staged archives are, opens too: nothing is written there until a fetch, and that fetch fails with a message naming the directory.
    pub fn open(config: CacheConfig) -> Self {
        let _ = fs::create_dir_all(&config.dir);
        cache::reclaim_scratch(&config.dir);
        Self {
            config,
            opened: Instant::now(),
            memory: Mutex::new(Memory::default()),
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

    // UNIT_BOUNDARY_DESCRIPTION: the digest a machine created now from this reference should boot. A pinned reference is never resolved, because it cannot move. A tag resolved within `fresh` is answered from memory; otherwise the registry is asked with each of the caller's credentials in turn. A registry that cannot answer gives the digest the tag last resolved to, so an outage boots what was cached before; a tag never resolved here is refused with what the registry said.
    fn digest_for(
        &self,
        reference: &str,
        fresh: Duration,
        auths: &[String],
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
            let credentials = DockerConfig::new(auth).ok()?;
            match command::output(
                credentials.apply(
                    Command::new(&self.config.crane)
                        .arg("digest")
                        .arg(reference),
                ),
                Instant::now() + RESOLVE_TIMEOUT,
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

    // UNIT_BOUNDARY_DESCRIPTION: resolves a reference, fetches its digest when the cache lacks it, and holds the entry for the caller before anything else, so no eviction can take it between this answer and the caller's next hold. Two callers after one missing digest fetch it once: the second waits for the first and then finds it cached. A cached entry is checked against the caller's credentials when the cache is shared.
    pub fn resolve_with(&self, reference: &str, auths: &[String], fresh: Duration) -> Lookup {
        if !is_image_ref(reference) || reference.contains("..") {
            return Lookup::failed(unusable(format!(
                "{:?} is not an image reference",
                logged(reference)
            )));
        }
        let digest = match self.digest_for(reference, fresh, auths) {
            Ok(digest) => digest,
            Err(e) => return Lookup::failed(e),
        };
        self.hold_one(&digest);
        let pinned = format!("{}@{digest}", repository(reference));
        let entry = self.digest_entry(&digest);
        let gate = self.fetch_gate(&digest);
        let _fetching = locked(&gate);
        match read_launch(&entry) {
            Ok(Some(launch)) => {
                let checked = self.may_reuse(&pinned, &digest, auths);
                Lookup {
                    resolved: checked.map(|()| Resolved { digest, launch }),
                    fetched: None,
                    unreachable: false,
                }
            }
            Ok(None) if self.config.crane.is_empty() => Lookup::failed(unusable(format!(
                "{} is not cached, and this cache has no crane to fetch it with",
                logged(reference)
            ))),
            Ok(None) => {
                let started = Instant::now();
                let fetched = self.fetch(&pinned, auths, &entry, &digest);
                let mut report = Fetched {
                    ms: elapsed_ms(started),
                    ok: fetched.is_ok(),
                    ..Fetched::default()
                };
                let resolved = fetched.map(|launch| {
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
            Err(e) => Lookup::failed(e.context(format!("reading the cached launch of {digest}"))),
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

    // UNIT_BOUNDARY_DESCRIPTION: fetches an image into the entry `cached` and unpacks it. `reference` names a digest, so the tree is the image that digest names even if a tag moves while the fetch runs. What the image says to run is written beside the tree, and its presence is what marks the entry complete; the entry is renamed into place whole. `auths` are tried in order, and the layers come with the one that read the config. An entry fetched with no credential, or one an anonymous read also reaches, is public: any caller may boot it.
    fn fetch(
        &self,
        reference: &str,
        auths: &[String],
        cached: &Path,
        digest: &str,
    ) -> anyhow::Result<ImageLaunch> {
        let crane = &self.config.crane;
        let lifetime = &self.config.lifetime;
        let scratch = Scratch::new(&self.config.dir)?;
        fs::create_dir(scratch.path().join(ROOTFS_DIR))?;
        let started = Instant::now();
        let (config, used) =
            fetch::read_config(crane, reference, auths, lifetime).inspect_err(|_| {
                tracing::warn!(
                    image = reference,
                    duration_ms = elapsed_ms(started),
                    "image config fetch failed"
                );
            })?;
        let launch = launch_from_config(&config)
            .map_err(|e| unusable(format!("reading the config of {reference}: {e:#}")))?;
        fetch::unpack(
            crane,
            reference,
            &scratch.path().join(ROOTFS_DIR),
            &used,
            lifetime,
        )?;
        fs::write(
            scratch.path().join(LAUNCH_FILE),
            serde_json::to_vec(&launch)?,
        )?;
        let public = !self.config.check_access
            || used.is_empty()
            || fetch::readable(crane, reference, ANONYMOUS, lifetime);
        tracing::info!(
            image = reference,
            duration_ms = elapsed_ms(started),
            bytes = cache::dir_size(scratch.path()),
            public,
            "image unpacked into the cache"
        );
        match fs::rename(scratch.path(), cached) {
            Err(e) if !matches!(e.raw_os_error(), Some(libc::EEXIST) | Some(libc::ENOTEMPTY)) => {
                return Err(e.into())
            }
            _ => {}
        }
        if public {
            locked(&self.memory).public.insert(digest.to_string());
        }
        Ok(launch)
    }

    // UNIT_BOUNDARY_DESCRIPTION: a cache hit is a boot the registry never saw, so on a shared cache an entry that is not known to be public is served only after an anonymous read, or one of the caller's credentials in the order they were sent, still reads the image's manifest. The anonymous read comes first for every caller, so an install whose default pull Secrets give every machine a credential still learns an image is public. It fails closed: a registry that cannot be reached refuses the boot. What is known to be public is kept in memory only, so after a restart every entry is checked once again.
    fn may_reuse(&self, reference: &str, digest: &str, auths: &[String]) -> anyhow::Result<()> {
        if !self.config.check_access || locked(&self.memory).public.contains(digest) {
            return Ok(());
        }
        let crane = &self.config.crane;
        let lifetime = &self.config.lifetime;
        if crane.is_empty() {
            return Err(unusable(format!(
                "{reference} is cached, and this cache has no crane to check the caller may read it"
            )));
        }
        if fetch::readable(crane, reference, ANONYMOUS, lifetime) {
            locked(&self.memory).public.insert(digest.to_string());
            return Ok(());
        }
        if auths
            .iter()
            .any(|auth| fetch::readable(crane, reference, auth, lifetime))
        {
            return Ok(());
        }
        Err(unusable(format!(
            "{reference} is cached from a private registry, and this machine's pull credentials cannot read its manifest"
        )))
    }

    // UNIT_BOUNDARY_DESCRIPTION: holds each digest for another HOLD_LEASE. A hold only ever extends: a caller cannot drop what another holds, so a runner that sends a short list, or a wrong one, never frees a tree another owner's machine runs from.
    pub fn hold(&self, digests: &BTreeSet<String>) {
        let now = Instant::now();
        let mut memory = locked(&self.memory);
        for digest in digests.iter().filter(|d| cache::is_digest(d)) {
            memory.holds.insert(digest.clone(), now);
        }
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

    // UNIT_BOUNDARY_DESCRIPTION: trims the cache to its budget, oldest write first, sparing what is held. It runs under the memory lock, so a resolve that holds an entry either lands before the trim reads the holds, or waits until the trim is done and finds the entry gone and fetches it again. Nothing is evicted during the grace after opening, while runners have not yet named what they hold again. Goes over budget rather than free an image something is running from.
    pub fn evict(&self, keep: Option<&Path>) -> Trim {
        let mut memory = locked(&self.memory);
        let mut trim = Trim::default();
        if self.opened.elapsed() >= self.config.hold_grace {
            let held = self.held(&mut memory);
            for evicted in cache::evict(&self.config.dir, keep, self.config.budget, &held) {
                if let Some(name) = evicted.path.file_name() {
                    let name = name.to_string_lossy();
                    if let Some(hex) = name.strip_prefix("sha256_") {
                        memory.public.remove(&format!("sha256:{hex}"));
                    }
                }
                tracing::info!(
                    image = %evicted.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                    bytes = evicted.size,
                    "image cache: evicted an image to stay inside the budget"
                );
                trim.freed.push(evicted.size);
            }
        }
        if self.config.budget > 0 {
            let used: u64 = cache::entries(&self.config.dir)
                .iter()
                .map(|e| e.size)
                .sum();
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
        ImageCache::hold(self, digests);
        Ok(())
    }
}

fn logged(reference: &str) -> String {
    reference.replace(['\n', '\r'], " ")
}

// UNIT_BOUNDARY_DESCRIPTION: an unpack in progress, named apart from any finished entry and dot-prefixed so the cache patterns never count it. It removes itself when dropped — on every path out of a fetch, including a cancelled one — and a tree a killed process left is reclaimed when the cache is next opened.
struct Scratch(PathBuf);

impl Scratch {
    fn new(parent: &Path) -> anyhow::Result<Self> {
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
