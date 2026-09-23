use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime};

use tokio_util::sync::CancellationToken;

use crate::cache::{
    self, cache_path, digest_path, pinned_digest, ref_path, RefRecord, PARTIAL_PREFIX,
};
use crate::command;
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

// UNIT_BOUNDARY_DESCRIPTION: a resolution is a manifest HEAD and nothing else. A registry that has not answered in a minute is treated as down, so a create falls back to the last digest the tag resolved to rather than waiting out the pull timeout.
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(60);

impl ImageCache {
    pub fn entry(&self, reference: &str) -> PathBuf {
        cache_path(&self.dir, reference)
    }

    // UNIT_BOUNDARY_DESCRIPTION: both names an image may be cached under — the unpacked tree and the archive an earlier release left — so holding one holds the other.
    pub fn both_names(&self, reference: &str) -> [PathBuf; 2] {
        let base = self.entry(reference);
        [PathBuf::from(format!("{}.tar", base.display())), base]
    }

    pub fn digest_entry(&self, digest: &str) -> PathBuf {
        digest_path(&self.dir, digest)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what the pins hold: for each image, the digest entry its reference last resolved to, and the tree and the archive an earlier release named after the reference — still held because an archive an earlier release cached still boots a machine, and evicting it would cost the install the only copy it has.
    pub fn pinned(&self) -> BTreeSet<PathBuf> {
        let mut held = BTreeSet::new();
        for reference in &self.pinned {
            if !is_image_ref(reference) || reference.contains("..") {
                continue;
            }
            held.extend(self.both_names(reference));
            if let Some(digest) = self.known_digest(reference) {
                held.insert(self.digest_entry(&digest));
            }
        }
        held
    }

    // UNIT_BOUNDARY_DESCRIPTION: the digest this reference last resolved to on this directory, and when. The record names its own reference, and one that names another is not believed, so a hash collision or a hand-edited file cannot boot the wrong image.
    fn read_ref(&self, reference: &str) -> Option<(String, SystemTime)> {
        let path = ref_path(&self.dir, reference);
        let at = fs::metadata(&path).ok()?.modified().ok()?;
        let record: RefRecord = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
        (record.image == reference && cache::is_digest(&record.digest))
            .then_some((record.digest, at))
    }

    // UNIT_BOUNDARY_DESCRIPTION: written under a staged name and renamed, so a reader in another process never reads half a record.
    fn write_ref(&self, reference: &str, digest: &str) -> anyhow::Result<()> {
        let path = ref_path(&self.dir, reference);
        let dir = path.parent().unwrap_or(&self.dir);
        fs::create_dir_all(dir)?;
        let staged = dir.join(format!(".new-{}-{}", std::process::id(), nanos()));
        let body = serde_json::to_vec(&RefRecord {
            image: reference.to_string(),
            digest: digest.to_string(),
        })?;
        let written =
            crate::files::write(&staged, &body, 0o644).and_then(|()| fs::rename(&staged, &path));
        if written.is_err() {
            let _ = fs::remove_file(&staged);
        }
        Ok(written?)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the digest a known reference names: a pinned reference its own, a tag the one it last resolved to however long ago. It is what an entry is held under by something that only knows the reference.
    pub fn known_digest(&self, reference: &str) -> Option<String> {
        if let Some(digest) = pinned_digest(reference) {
            return Some(digest.to_string());
        }
        self.read_ref(reference).map(|(digest, _)| digest)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the digest a machine created now from this reference should boot. A pinned reference is never resolved, because it cannot move. A tag resolved within `fresh` is taken from the index; otherwise the registry is asked and the answer written to the index for every process on the directory. A registry that cannot answer boots the digest the tag last resolved to, so an outage boots what was cached before. None means the tag was never resolved here and cannot be now, and the caller falls back to the first format.
    pub fn resolve_digest(&self, reference: &str, fresh: Duration) -> Option<String> {
        if let Some(digest) = pinned_digest(reference) {
            return Some(digest.to_string());
        }
        let known = self.read_ref(reference);
        if let Some((digest, at)) = &known {
            if at.elapsed().is_ok_and(|age| age < fresh) {
                return Some(digest.clone());
            }
        }
        let known = known.map(|(digest, _)| digest);
        if self.crane.is_empty() {
            return known;
        }
        let logged = reference.replace(['\n', '\r'], " ");
        let answer = command::output(
            Command::new(&self.crane).arg("digest").arg(reference),
            Instant::now() + RESOLVE_TIMEOUT,
            &self.lifetime,
        )
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|digest| cache::is_digest(digest));
        let Some(digest) = answer else {
            if let Some(known) = &known {
                tracing::warn!(image = %logged, digest = %known, "image cache: the registry could not resolve a tag, so it boots the digest the tag last resolved to");
            }
            return known;
        };
        if let Err(e) = self.write_ref(reference, &digest) {
            tracing::warn!(image = %logged, error = %format!("{e:#}"), "image cache: cannot record what a tag resolved to");
        }
        Some(digest)
    }

    // UNIT_BOUNDARY_DESCRIPTION: tells the other processes on the directory what this one holds: its own entries and its pins. Refreshed after every operation, because a claim is believed only while it keeps being written.
    pub fn publish(&self, own: &BTreeSet<PathBuf>) {
        let mut held = own.clone();
        held.extend(self.pinned());
        cache::publish_holders(&self.dir, &self.owner, &held);
    }

    // UNIT_BOUNDARY_DESCRIPTION: fetches an image into the entry `cached` and unpacks it once for every machine of it to boot, then trims the cache to its budget. `reference` names a digest, so the tree is the image that digest names even if a tag moves while the fetch runs. What the image says to run is written beside the tree, and its presence is what marks the entry complete. `busy` is what this process's other machines hold, which a stale entry may not be replaced out from under; `own` is everything this process holds, spared by the trim.
    pub fn fetch(
        &self,
        reference: &str,
        cached: &Path,
        busy: &BTreeSet<PathBuf>,
        own: &BTreeSet<PathBuf>,
    ) -> anyhow::Result<Trim> {
        let parent = cached.parent().unwrap_or(&self.dir);
        fs::create_dir_all(parent)?;
        let scratch = Scratch::new(parent)?;
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
        self.claim(scratch.path(), cached, busy)?;
        Ok(self.evict(own, Some(cached)))
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

fn nanos() -> u32 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or_default()
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
