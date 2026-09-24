use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

// UNIT_BOUNDARY_DESCRIPTION: the image cache directory as eviction and a boot read it: how an entry is named, what counts as one, and how the cache is trimmed to its budget. Exactly one process writes a cache directory — the node's image cache service, or the one runner that owns a claim — so nothing here coordinates with another writer. Runners on a node directory only read it, through a read-only mount.

// UNIT_BOUNDARY_DESCRIPTION: an unpack in progress, named apart from a finished entry and dot-prefixed so the entry pattern cannot match it — a half-written tree must never be counted as one a machine can boot.
pub const PARTIAL_PREFIX: &str = ".unpack-";

// UNIT_BOUNDARY_DESCRIPTION: the longest a single image fetch may run.
pub const PULL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

// UNIT_BOUNDARY_DESCRIPTION: where an install with no registry stages the `docker save` archive of an image: the reference with the three characters a path segment must not carry replaced by an underscore, and `.tar` after it. `cluster:install` writes the archive under this name, so both must replace the same characters. The runner only reads these archives, and eviction never counts one.
pub fn archive_path(image_dir: &Path, image: &str) -> PathBuf {
    image_dir.join(format!("{}.tar", image.replace(['/', ':', '@'], "_")))
}

// UNIT_BOUNDARY_DESCRIPTION: whether a string is a digest this cache can name an entry by: `sha256:` and 64 lower-case hex digits. Hand-written rather than a regex, and pinned by a test.
pub fn is_digest(digest: &str) -> bool {
    digest.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64 && hex.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
    })
}

// UNIT_BOUNDARY_DESCRIPTION: whether a name in the image directory is an entry: a digest with its colon replaced, so it is a single path segment.
pub fn is_digest_entry(name: &str) -> bool {
    name.strip_prefix("sha256_")
        .is_some_and(|hex| is_digest(&format!("sha256:{hex}")))
}

// UNIT_BOUNDARY_DESCRIPTION: the digest a reference names itself, if it names one this cache can key an entry by. A tag beside the digest is ignored, because the digest is what the registry serves.
pub fn pinned_digest(image: &str) -> Option<&str> {
    let (_, digest) = image.split_once('@')?;
    is_digest(digest).then_some(digest)
}

// UNIT_BOUNDARY_DESCRIPTION: a reference without its tag or digest, which a fetch by digest is addressed to. A colon before the last slash is a registry port and not a tag.
pub fn repository(image: &str) -> &str {
    let name = image.split_once('@').map_or(image, |(name, _)| name);
    match (name.rfind(':'), name.rfind('/')) {
        (Some(colon), Some(slash)) if colon > slash => &name[..colon],
        (Some(colon), None) => &name[..colon],
        _ => name,
    }
}

pub fn digest_path(image_dir: &Path, digest: &str) -> PathBuf {
    image_dir.join(digest.replacen(':', "_", 1))
}

pub fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
            Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

// UNIT_BOUNDARY_DESCRIPTION: removes every scratch tree in the directory. The one writer calls this as it opens the cache, before it starts a fetch of its own, so any scratch tree there is one an earlier process was killed while filling. Those bytes are counted against no budget and chosen for no eviction, so nothing else would ever free them.
pub fn reclaim_scratch(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(PARTIAL_PREFIX)
            || !entry.file_type().map(|k| k.is_dir()).unwrap_or(false)
        {
            continue;
        }
        if let Err(e) = fs::remove_dir_all(entry.path()) {
            tracing::warn!(path = %name, error = %e, "image cache: reclaiming what an interrupted fetch left behind");
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one entry as eviction sees it — where it is, what it costs, and when it was written, which is the order entries are taken in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub path: PathBuf,
    pub size: u64,
    pub modified: SystemTime,
}

// UNIT_BOUNDARY_DESCRIPTION: the cache's entries, oldest write first, which is the order eviction takes them in. Each is measured by walking its tree. Anything not named like a digest entry is not an entry at all, which is how a scratch tree, a staged archive and the service's socket are passed over rather than deleted.
pub fn entries(dir: &Path) -> Vec<Entry> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut all: Vec<Entry> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !entry.file_type().ok()?.is_dir() || !is_digest_entry(&name) {
                return None;
            }
            Some(Entry {
                size: dir_size(&entry.path()),
                modified: entry.metadata().ok()?.modified().ok()?,
                path: entry.path(),
            })
        })
        .collect();
    all.sort_by_key(|entry| entry.modified);
    all
}

// UNIT_BOUNDARY_DESCRIPTION: chooses entries oldest-first until the cache would be inside its budget, sparing anything held. It only chooses: the caller deletes, outside any lock a resolve or a hold waits on. A budget of zero or less evicts nothing, because a cache is refused rather than opened without one. Going over budget is the outcome when everything left is held: an image a machine is running is never freed to make room, and the caller reports it rather than taking one.
pub fn choose(
    mut all: Vec<Entry>,
    keep: Option<&Path>,
    budget: i64,
    in_use: &BTreeSet<PathBuf>,
) -> Vec<Entry> {
    if budget <= 0 {
        return Vec::new();
    }
    all.sort_by_key(|entry| entry.modified);
    let mut used: u64 = all.iter().map(|entry| entry.size).sum();
    let mut chosen = Vec::new();
    for entry in all {
        if used <= budget as u64 {
            break;
        }
        if Some(entry.path.as_path()) == keep || in_use.contains(&entry.path) {
            continue;
        }
        used = used.saturating_sub(entry.size);
        chosen.push(entry);
    }
    chosen
}

// UNIT_BOUNDARY_DESCRIPTION: the digest an entry's directory is named for.
pub fn entry_digest(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    is_digest_entry(name).then(|| name.replacen('_', ":", 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir;

    // TEST_SCENARIO: an install with no registry stages each image's archive under a name `cluster:install` makes by replacing the three characters a reference carries that a path segment cannot. The runner has to look for the same name, or it finds no archive and the machine has nothing to boot.
    #[test]
    fn a_staged_archive_is_named_after_its_reference() {
        let dir = Path::new("/images");
        assert_eq!(
            archive_path(dir, "quay.io/dam-agents/agent:1.2.3"),
            dir.join("quay.io_dam-agents_agent_1.2.3.tar")
        );
        assert_eq!(
            archive_path(dir, "quay.io/x@sha256:abc"),
            dir.join("quay.io_x_sha256_abc.tar")
        );
    }

    // TEST_SCENARIO: eviction takes the oldest write first and stops as soon as the cache is inside its budget, and it never takes an entry something holds — which is the whole safety property, because an unpacked image is the root filesystem of every machine running it. Nothing that is not named like an entry is counted or taken, such as a staged archive.
    #[test]
    fn eviction_takes_the_oldest_unheld_entries_until_it_is_inside_the_budget() {
        let dir = TempDir::new("cache");
        let oldest = entry_of(dir.path(), &entry_name('a'), 1024, Duration::from_secs(300));
        let held = entry_of(dir.path(), &entry_name('b'), 1024, Duration::from_secs(200));
        let newest = entry_of(dir.path(), &entry_name('c'), 1024, Duration::from_secs(100));
        let archive = archive_path(dir.path(), "quay.io/x/vm:1");
        fs::write(&archive, vec![0u8; 4096]).unwrap();

        let in_use = [held.clone()].into_iter().collect::<BTreeSet<_>>();
        let found = entries(dir.path());
        assert_eq!(found.len(), 3, "a staged archive is not an entry");
        let chosen = choose(found, None, 2500, &in_use);

        assert_eq!(
            chosen.into_iter().map(|e| e.path).collect::<Vec<_>>(),
            vec![oldest.clone()],
            "the oldest write goes first, only until it fits, and never one a machine is running from"
        );
        assert!(
            oldest.exists() && newest.exists(),
            "choosing deletes nothing"
        );
        assert_eq!(
            entry_digest(&oldest).as_deref(),
            Some(format!("sha256:{}", "a".repeat(64)).as_str())
        );
    }

    // TEST_SCENARIO: when everything left is held there is nothing to take, and the cache stays over its budget rather than freeing a running machine's filesystem. Going over is the reported outcome; taking one is not an outcome at all.
    #[test]
    fn eviction_goes_over_budget_rather_than_take_a_held_entry() {
        let dir = TempDir::new("cache");
        let held = entry_of(dir.path(), &entry_name('a'), 4096, Duration::from_secs(300));
        let in_use = [held.clone()].into_iter().collect::<BTreeSet<_>>();

        assert!(choose(entries(dir.path()), None, 1, &in_use).is_empty());
    }

    // TEST_SCENARIO: a scratch tree is invisible to the budget and to eviction, so the one writer removes every one it finds when it opens the cache. It is the only writer, so any scratch tree there belongs to a process that is gone. Finished entries stay.
    #[test]
    fn opening_the_cache_reclaims_every_scratch_tree() {
        let dir = TempDir::new("cache");
        let abandoned = entry_of(
            dir.path(),
            ".unpack-abandoned",
            4096,
            Duration::from_secs(1),
        );
        let kept = entry_of(dir.path(), &entry_name('a'), 16, Duration::from_secs(1));

        reclaim_scratch(dir.path());

        assert!(!abandoned.exists());
        assert!(kept.exists());
    }

    const DIGEST: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

    fn entry_name(hex: char) -> String {
        format!("sha256_{}", hex.to_string().repeat(64))
    }

    // TEST_SCENARIO: a digest entry is the digest with its one colon replaced, so it is a single path segment. The runner builds the path from its own mount of the directory, so both sides must build the same name.
    #[test]
    fn a_digest_names_one_entry() {
        let dir = Path::new("/images");
        assert_eq!(
            digest_path(dir, DIGEST),
            dir.join(format!("sha256_{}", "1".repeat(64)))
        );
    }

    // TEST_SCENARIO: the matchers for a digest and for a digest entry decide what is booted and what is evicted. A digest with upper-case hex, another algorithm or the wrong length is not one this cache names an entry by, and nothing else in the directory is an entry.
    #[test]
    fn only_a_sha256_digest_names_an_entry() {
        assert!(is_digest(DIGEST));
        assert!(!is_digest(&DIGEST.to_uppercase()));
        assert!(!is_digest("sha512:abc"));
        assert!(!is_digest(&DIGEST[..70]));
        assert!(is_digest_entry(&entry_name('a')));
        assert!(!is_digest_entry(".cache.sock"));
        assert!(!is_digest_entry(".unpack-1"));
        assert!(!is_digest_entry("quay.io_x_vm_1.tar"));

        assert_eq!(
            pinned_digest(&format!("quay.io/x/vm@{DIGEST}")),
            Some(DIGEST)
        );
        assert_eq!(
            pinned_digest(&format!("quay.io/x/vm:1@{DIGEST}")),
            Some(DIGEST)
        );
        assert_eq!(pinned_digest("quay.io/x/vm:1"), None);
        assert_eq!(repository("quay.io/x/vm:1"), "quay.io/x/vm");
        assert_eq!(
            repository(&format!("quay.io/x/vm@{DIGEST}")),
            "quay.io/x/vm"
        );
        assert_eq!(repository("localhost:5000/vm:1"), "localhost:5000/vm");
        assert_eq!(repository("localhost:5000/vm"), "localhost:5000/vm");
        assert_eq!(repository("vm:1"), "vm");
    }

    fn entry_of(dir: &Path, name: &str, bytes: usize, age: Duration) -> PathBuf {
        let path = dir.join(name);
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("rootfs"), vec![0u8; bytes]).unwrap();
        backdate(&path, age);
        path
    }

    fn backdate(path: &Path, age: Duration) {
        let when = SystemTime::now() - age;
        filetime::set_file_mtime(path, filetime::FileTime::from_system_time(when)).unwrap();
    }
}
