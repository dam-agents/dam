use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

use tokio_util::sync::CancellationToken;

use crate::cache::{self, cache_path, PARTIAL_PREFIX};
use crate::fetch::{self, unusable};
use crate::launch::{launch_from_config, read_launch, LAUNCH_FILE};
use crate::state::is_image_ref;

// UNIT_BOUNDARY_DESCRIPTION: one process's hand in the image cache — a runner, or the preloader that fills a node directory before any runner exists. The cache is a protocol between every process that mounts the directory, so this is its one implementation: how an image is fetched and unpacked, how a finished unpack is claimed, what this process tells the others it holds, and what it may evict. Whatever a process holds of its own is passed in by the caller, because only the caller knows: a runner reads its machines' specs, the preloader holds nothing but its pins.
pub struct ImageCache {
    pub dir: PathBuf,
    pub owner: String,
    pub budget: i64,
    pub crane: String,
    pub pinned: Vec<String>,
    pub lifetime: CancellationToken,
}

pub const ROOTFS_DIR: &str = "rootfs";

impl ImageCache {
    pub fn entry(&self, reference: &str) -> PathBuf {
        cache_path(&self.dir, reference)
    }

    // UNIT_BOUNDARY_DESCRIPTION: both names an image may be cached under — the unpacked tree and the archive an earlier release left — so holding one holds the other.
    pub fn both_names(&self, reference: &str) -> [PathBuf; 2] {
        let base = self.entry(reference);
        [PathBuf::from(format!("{}.tar", base.display())), base]
    }

    pub fn pinned(&self) -> BTreeSet<PathBuf> {
        self.pinned
            .iter()
            .filter(|reference| is_image_ref(reference) && !reference.contains(".."))
            .flat_map(|reference| self.both_names(reference))
            .collect()
    }

    // UNIT_BOUNDARY_DESCRIPTION: tells the other processes on the directory what this one holds: its own entries and its pins. Refreshed after every operation, because a claim is believed only while it keeps being written.
    pub fn publish(&self, own: &BTreeSet<PathBuf>) {
        let mut held = own.clone();
        held.extend(self.pinned());
        cache::publish_holders(&self.dir, &self.owner, &held);
    }

    // UNIT_BOUNDARY_DESCRIPTION: fetches an image and unpacks it once for every machine of it to boot, then trims the cache to its budget. What the image says to run is written beside the tree, and its presence is what marks the entry complete. `busy` is what this process's other machines hold, which a stale entry may not be replaced out from under; `own` is everything this process holds, spared by the trim.
    pub fn fetch(
        &self,
        reference: &str,
        busy: &BTreeSet<PathBuf>,
        own: &BTreeSet<PathBuf>,
    ) -> anyhow::Result<Trim> {
        let cached = self.entry(reference);
        fs::create_dir_all(&self.dir)?;
        let scratch = Scratch::new(&self.dir)?;
        fs::create_dir(scratch.path().join(ROOTFS_DIR))?;
        let started = Instant::now();
        let config =
            fetch::read_config(&self.crane, reference, &self.lifetime).inspect_err(|_| {
                tracing::warn!(
                    image = reference,
                    duration_ms = elapsed_ms(started),
                    "image config fetch failed"
                );
            })?;
        let launch = launch_from_config(&config)
            .map_err(|e| unusable(format!("reading the config of {reference}: {e:#}")))?;
        fetch::unpack(
            &self.crane,
            reference,
            &scratch.path().join(ROOTFS_DIR),
            &self.lifetime,
        )?;
        fs::write(
            scratch.path().join(LAUNCH_FILE),
            serde_json::to_vec(&launch)?,
        )?;
        tracing::info!(
            image = reference,
            duration_ms = elapsed_ms(started),
            bytes = cache::dir_size(scratch.path()),
            "image unpacked into the shared cache"
        );
        self.claim(scratch.path(), &cached, busy)?;
        Ok(self.evict(own, Some(&cached)))
    }

    // UNIT_BOUNDARY_DESCRIPTION: puts a finished unpack in place. Processes on one node directory may unpack the same image at once, so a loser that finds a complete entry keeps it — both wrote the same image. An entry with no launch record is from a release that stored none, and is replaced unless a machine here or elsewhere is running from it.
    fn claim(&self, scratch: &Path, cached: &Path, busy: &BTreeSet<PathBuf>) -> anyhow::Result<()> {
        match fs::rename(scratch, cached) {
            Ok(()) => return Ok(()),
            Err(e) if !matches!(e.raw_os_error(), Some(libc::EEXIST) | Some(libc::ENOTEMPTY)) => {
                return Err(e.into());
            }
            Err(_) => {}
        }
        if matches!(read_launch(cached), Ok(Some(_))) {
            return Ok(());
        }
        if busy.contains(cached) || cache::held_elsewhere(&self.dir, &self.owner).contains(cached) {
            anyhow::bail!(
                "{} is the image of a machine that is already running, and it predates the launch this release records beside a tree: stop that machine before creating another from this image",
                cached.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
            );
        }
        fs::remove_dir_all(cached)?;
        fs::rename(scratch, cached)?;
        Ok(())
    }

    // UNIT_BOUNDARY_DESCRIPTION: trims the cache to its budget, oldest write first, sparing what this process holds, its pins, and every claim another process published. Goes over budget rather than free an image something is running from.
    pub fn evict(&self, own: &BTreeSet<PathBuf>, keep: Option<&Path>) -> Trim {
        let mut mine = own.clone();
        mine.extend(self.pinned());
        let spared = cache::spared(&mine, &cache::held_elsewhere(&self.dir, &self.owner));
        let mut trim = Trim::default();
        for evicted in cache::evict(&self.dir, keep, self.budget, &spared) {
            tracing::info!(
                image = %evicted.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                bytes = evicted.size,
                "image cache: evicted an image to stay inside the volume"
            );
            trim.freed.push(evicted.size);
        }
        if self.budget > 0 {
            let used: u64 = cache::entries(&self.dir).iter().map(|e| e.size).sum();
            trim.used = Some(used);
            if used > self.budget as u64 {
                tracing::warn!(
                    bytes = used,
                    budget = self.budget,
                    "image cache: over its stated budget, and every image left is one a machine is running from"
                );
            }
        }
        trim
    }
}

// UNIT_BOUNDARY_DESCRIPTION: what one eviction pass did: the size of each image it removed, and what the cache held after it, when it was weighed against a budget at all.
#[derive(Debug, Default)]
pub struct Trim {
    pub freed: Vec<u64>,
    pub used: Option<u64>,
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

// UNIT_BOUNDARY_DESCRIPTION: an unpack in progress, named apart from any finished entry and dot-prefixed so the cache patterns never count it. It removes itself when dropped — on every path out of a fetch, including a cancelled one — and a tree a killed process left is reclaimed by eviction once it is older than any fetch may run.
struct Scratch(PathBuf);

impl Scratch {
    fn new(parent: &Path) -> anyhow::Result<Self> {
        for attempt in 0..100u32 {
            let nanos = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or_default();
            let path = parent.join(format!(
                "{PARTIAL_PREFIX}{}-{nanos:x}-{attempt}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        anyhow::bail!("no free scratch directory in {}", parent.display())
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
