use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};

// UNIT_BOUNDARY_DESCRIPTION: the image cache is not this process's data structure, it is a protocol between every process that mounts the directory — which on a node cache is one runner per owner, plus the preloader. Every process has to agree exactly: an entry one of them counts and another does not is an entry one of them deletes while the other's guest has it mounted as its root filesystem. Every name, format and window below is therefore pinned by a test, not merely written down once.

// UNIT_BOUNDARY_DESCRIPTION: where each process publishes what its own machines hold, one file per runner named after it. Read by every other process before it evicts anything.
pub const HOLDERS_DIR: &str = ".holders";

// UNIT_BOUNDARY_DESCRIPTION: an unpack in progress, named apart from a finished entry and dot-prefixed so the entry pattern cannot match it — a half-written tree must never be counted as one a machine can boot.
pub const PARTIAL_PREFIX: &str = ".unpack-";

// UNIT_BOUNDARY_DESCRIPTION: how long a holders file is believed after its last write. Machines are processes of the runner that made them, so a runner that stopped refreshing has no machines left running and its claims are safe to ignore.
pub const HOLDER_STALE: Duration = Duration::from_secs(30 * 60);

// UNIT_BOUNDARY_DESCRIPTION: the longest a single image fetch may run. Nothing finishes an unpack after twice this, so a scratch tree older than PARTIAL_STALE belonged to a process that died holding it.
pub const PULL_TIMEOUT: Duration = Duration::from_secs(20 * 60);
pub const PARTIAL_STALE: Duration = Duration::from_secs(2 * 20 * 60);

// UNIT_BOUNDARY_DESCRIPTION: the index from a reference to the digest it last resolved to. One file per reference, named by a hash of the reference, and its mtime is when the resolution was made.
pub const REFS_DIR: &str = "refs";

// UNIT_BOUNDARY_DESCRIPTION: how long a tag's resolution is trusted without asking the registry again. It also decides when an index file whose tree is gone may be removed.
pub const REF_FRESH: Duration = Duration::from_secs(10 * 60);

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

// UNIT_BOUNDARY_DESCRIPTION: where the index keeps what a reference resolved to: the hex SHA-256 of the whole reference. It is hashed rather than escaped, because an escaping names two different references alike, and an index that did would boot one image under the other's name.
pub fn ref_path(image_dir: &Path, image: &str) -> PathBuf {
    let hex: String = Sha256::digest(image.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    image_dir.join(REFS_DIR).join(hex)
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

// UNIT_BOUNDARY_DESCRIPTION: publishes what this process holds, as names relative to the image directory, one per line, sorted. Written to a `.new` file and renamed, because a reader that caught a partial write would read a shorter claim than the truth and evict what it did not see. Failure is reported and not returned: a runner that cannot publish still runs its machines, and the cost is that another may evict an image it holds.
pub fn publish_holders(image_dir: &Path, runner_id: &str, held: &BTreeSet<PathBuf>) {
    if runner_id.is_empty() {
        return;
    }
    let dir = image_dir.join(HOLDERS_DIR);
    if let Err(e) = fs::create_dir_all(&dir) {
        tracing::warn!(error = %e, "image cache: cannot publish this runner's claims");
        return;
    }
    let mut names: Vec<String> = held
        .iter()
        .filter_map(|path| path.strip_prefix(image_dir).ok())
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty() && !name.starts_with(".."))
        .collect();
    names.sort();
    let path = dir.join(runner_id);
    let staged = dir.join(format!("{runner_id}.new"));
    if let Err(e) = fs::write(&staged, names.join("\n")) {
        tracing::warn!(error = %e, "image cache: cannot publish this runner's claims");
        return;
    }
    if let Err(e) = fs::rename(&staged, &path) {
        let _ = fs::remove_file(&staged);
        tracing::warn!(error = %e, "image cache: cannot publish this runner's claims");
    }
}

// UNIT_BOUNDARY_DESCRIPTION: every other process's claims on this directory, as full paths. This process's own file is skipped, because every caller reads its own machines directly and that read is current where a published snapshot is not. A file older than HOLDER_STALE is deleted rather than believed: its writer is gone, and with it the machines that were holding those images. A file that cannot be read is skipped entirely — treating it as claiming nothing is what would delete somebody's rootfs, so it is instead left to its mtime to expire.
pub fn held_elsewhere(image_dir: &Path, runner_id: &str) -> BTreeSet<PathBuf> {
    let mut held = BTreeSet::new();
    let Ok(entries) = fs::read_dir(image_dir.join(HOLDERS_DIR)) else {
        return held;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".new") || entry.file_type().map(|k| k.is_dir()).unwrap_or(true) {
            continue;
        }
        if !runner_id.is_empty() && name == runner_id {
            continue;
        }
        let path = entry.path();
        if older_than(&path, HOLDER_STALE) {
            let _ = fs::remove_file(&path);
            continue;
        }
        let Ok(body) = fs::read_to_string(&path) else {
            continue;
        };
        for claimed in body.split('\n') {
            let claimed = claimed.trim();
            if !claimed.is_empty() {
                held.insert(image_dir.join(claimed));
            }
        }
    }
    held
}

// UNIT_BOUNDARY_DESCRIPTION: reclaims the scratch trees a killed fetch left. Invisible as well as abandoned — the entry pattern does not match a dot-prefixed name, so those bytes are counted against no budget and chosen for no eviction — which is why this runs before anything is measured. Only a tree older than any fetch may run is taken, so a fetch still running elsewhere on the node keeps its own.
pub fn prune_partial_unpacks(dir: &Path) {
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
        let path = entry.path();
        if older_than(&path, PARTIAL_STALE) {
            if let Err(e) = fs::remove_dir_all(&path) {
                tracing::warn!(path = %name, error = %e, "image cache: reclaiming what an interrupted fetch left behind");
            }
        }
    }
}

fn older_than(path: &Path, window: Duration) -> bool {
    let Ok(modified) = fs::metadata(path).and_then(|m| m.modified()) else {
        return false;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age > window)
        .unwrap_or(false)
}

// UNIT_BOUNDARY_DESCRIPTION: removes the index files that no longer save anything: stale, and pointing at a tree that is gone. A file the reader cannot parse is removed once stale too, which is also what reclaims a staged write a killed process left.
pub fn prune_refs(dir: &Path) {
    let refs = dir.join(REFS_DIR);
    let Ok(entries) = fs::read_dir(&refs) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_type().map(|k| k.is_dir()).unwrap_or(true) || !older_than(&path, REF_FRESH) {
            continue;
        }
        let Ok(body) = fs::read(&path) else {
            continue;
        };
        let target = serde_json::from_slice::<RefRecord>(&body)
            .ok()
            .filter(|record| is_digest(&record.digest))
            .map(|record| digest_path(dir, &record.digest));
        if target.is_some_and(|tree| tree.exists()) {
            continue;
        }
        let _ = fs::remove_file(&path);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one index file: the reference it answers for and the digest that reference resolved to. The reference is kept so a reader can refuse a record that answers for some other reference.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RefRecord {
    #[serde(rename = "ref")]
    pub image: String,
    pub digest: String,
}

// UNIT_BOUNDARY_DESCRIPTION: one entry as eviction sees it — where it is, what it costs, and when it was written, which is the order entries are taken in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub path: PathBuf,
    pub size: u64,
    pub modified: SystemTime,
}

// UNIT_BOUNDARY_DESCRIPTION: the cache's entries, oldest write first, which is the order eviction takes them in. Each is measured by walking its tree. Anything not named like a digest entry is not an entry at all, which is how a scratch tree, a staged archive, the index and the holders directory are passed over rather than deleted.
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

// UNIT_BOUNDARY_DESCRIPTION: takes entries oldest-first until the cache is inside its budget, sparing anything held. A budget of zero or less evicts nothing, because the runner is refused rather than started without one and a preloader pass with none has nothing to weigh against. Going over budget is the outcome when everything left is held: an image a machine is running is never freed to make room, and the caller reports it rather than taking one.
pub fn evict(
    dir: &Path,
    keep: Option<&Path>,
    budget: i64,
    in_use: &BTreeSet<PathBuf>,
) -> Vec<Entry> {
    prune_partial_unpacks(dir);
    prune_refs(dir);
    if budget <= 0 {
        return Vec::new();
    }
    let all = entries(dir);
    let mut used: u64 = all.iter().map(|entry| entry.size).sum();
    let mut evicted = Vec::new();
    for entry in all {
        if used <= budget as u64 {
            break;
        }
        if Some(entry.path.as_path()) == keep || in_use.contains(&entry.path) {
            continue;
        }
        if fs::remove_dir_all(&entry.path).is_err() {
            continue;
        }
        used = used.saturating_sub(entry.size);
        evicted.push(entry);
    }
    evicted
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: the claims directory and the scratch prefix are names on a shared directory, read by every runner and preloader on the node. A rename has to fail here rather than on a node, where the symptom is one process evicting a tree another's guest is running from.
    #[test]
    fn the_claims_directory_and_the_scratch_prefix_keep_their_names() {
        assert_eq!(
            HOLDERS_DIR, ".holders",
            "the directory every process publishes its claims in"
        );
        assert_eq!(
            PARTIAL_PREFIX, ".unpack-",
            "the prefix that keeps a half-written tree out of the entry pattern"
        );
    }

    // TEST_SCENARIO: the three windows are what each process on the directory believes about the others' claims. Shorten the claim window in one binary alone and it starts deleting claim files the others still refresh on the old schedule — one process then evicts an unpacked tree another's guest is running from, which is the harm the module comment names.
    #[test]
    fn the_claim_windows_are_the_ones_every_process_on_the_directory_believes() {
        let minutes = |n: u64| Duration::from_secs(n * 60);
        assert_eq!(HOLDER_STALE, minutes(30), "how long a claim is believed");
        assert_eq!(PULL_TIMEOUT, minutes(20), "how long one fetch may run");
        assert_eq!(
            PARTIAL_STALE,
            minutes(40),
            "when a scratch tree is somebody's abandoned work"
        );
    }

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

    // TEST_SCENARIO: a claim is published for another process to read, so what matters is the bytes on disk: names relative to the image directory, one per line, sorted, and no half-written file ever visible under the real name.
    #[test]
    fn a_claim_is_published_as_sorted_names_through_a_staged_rename() {
        let dir = tempdir();
        let held = [
            digest_path(dir.path(), &digest('b')),
            digest_path(dir.path(), &digest('a')),
        ]
        .into_iter()
        .collect::<BTreeSet<_>>();

        publish_holders(dir.path(), "runner-a", &held);

        let body = fs::read_to_string(dir.path().join(HOLDERS_DIR).join("runner-a")).unwrap();
        assert_eq!(body, format!("{}\n{}", entry_name('a'), entry_name('b')));
        assert!(
            !dir.path().join(HOLDERS_DIR).join("runner-a.new").exists(),
            "the staging file is renamed, not left beside the claim where a reader would see two"
        );
        assert_eq!(
            held_elsewhere(dir.path(), "runner-b"),
            held,
            "a reader joins each name back to the entry it claims"
        );
    }

    // TEST_SCENARIO: a runner reads every other process's claims and skips its own, because it knows its own machines directly and that read is current where a published snapshot is not. It must also skip a staging file, which is a claim mid-write and not a claim.
    #[test]
    fn a_reader_takes_the_other_claims_and_not_its_own() {
        let dir = tempdir();
        let holders = dir.path().join(HOLDERS_DIR);
        fs::create_dir_all(&holders).unwrap();
        fs::write(holders.join("runner-a"), "mine").unwrap();
        fs::write(holders.join("runner-b"), "theirs\nalso-theirs\n").unwrap();
        fs::write(holders.join("runner-c.new"), "half-written").unwrap();

        let held = held_elsewhere(dir.path(), "runner-a");

        assert_eq!(
            held,
            [dir.path().join("theirs"), dir.path().join("also-theirs")]
                .into_iter()
                .collect::<BTreeSet<_>>()
        );
    }

    // TEST_SCENARIO: a claim is believed only while it is refreshed. One that has gone stale is deleted rather than merely ignored, because the process that wrote it is gone and its machines with it, and leaving the file would pin images nothing can boot from for as long as the directory lives.
    #[test]
    fn a_stale_claim_is_dropped_and_deleted() {
        let dir = tempdir();
        let holders = dir.path().join(HOLDERS_DIR);
        fs::create_dir_all(&holders).unwrap();
        let stale = holders.join("runner-gone");
        fs::write(&stale, "held-by-nobody").unwrap();
        backdate(&stale, HOLDER_STALE * 2);

        assert!(held_elsewhere(dir.path(), "runner-a").is_empty());
        assert!(
            !stale.exists(),
            "a claim whose writer is gone is removed, not left to be re-read"
        );
    }

    // TEST_SCENARIO: eviction takes the oldest write first and stops as soon as the cache is inside its budget, and it never takes an entry something holds — which is the whole safety property, because an unpacked image is the root filesystem of every machine running it. Nothing that is not named like an entry is counted or taken: not the index, not a staged archive.
    #[test]
    fn eviction_takes_the_oldest_unheld_entries_until_it_is_inside_the_budget() {
        let dir = tempdir();
        let oldest = entry_of(dir.path(), &entry_name('a'), 1024, Duration::from_secs(300));
        let held = entry_of(dir.path(), &entry_name('b'), 1024, Duration::from_secs(200));
        let newest = entry_of(dir.path(), &entry_name('c'), 1024, Duration::from_secs(100));
        fs::create_dir_all(dir.path().join(REFS_DIR)).unwrap();
        let archive = archive_path(dir.path(), "quay.io/x/vm:1");
        fs::write(&archive, vec![0u8; 4096]).unwrap();

        let in_use = [held.clone()].into_iter().collect::<BTreeSet<_>>();
        let evicted = evict(dir.path(), None, 2500, &in_use);

        assert_eq!(
            evicted.into_iter().map(|e| e.path).collect::<Vec<_>>(),
            vec![oldest.clone()],
            "the oldest write goes first, and only until it fits"
        );
        assert!(!oldest.exists());
        assert!(
            held.exists(),
            "an entry a machine is running from is never taken"
        );
        assert!(newest.exists());
        assert!(
            dir.path().join(REFS_DIR).exists(),
            "the index is not an entry"
        );
        assert!(archive.exists(), "nor is a staged archive");
    }

    // TEST_SCENARIO: when everything left is held there is nothing to take, and the cache stays over its budget rather than freeing a running machine's filesystem. Going over is the reported outcome; taking one is not an outcome at all.
    #[test]
    fn eviction_goes_over_budget_rather_than_take_a_held_entry() {
        let dir = tempdir();
        let held = entry_of(dir.path(), &entry_name('a'), 4096, Duration::from_secs(300));
        let in_use = [held.clone()].into_iter().collect::<BTreeSet<_>>();

        assert!(evict(dir.path(), None, 1, &in_use).is_empty());
        assert!(held.exists());
    }

    // TEST_SCENARIO: the scratch tree of a killed fetch is invisible to the budget and to eviction, so reclaiming it is eviction's first act rather than something it can weigh. A tree young enough to belong to a fetch still running is left alone, on a directory shared with processes this one knows nothing about.
    #[test]
    fn eviction_reclaims_an_abandoned_scratch_tree_and_spares_a_live_one() {
        let dir = tempdir();
        let abandoned = entry_of(dir.path(), ".unpack-abandoned", 4096, PARTIAL_STALE * 2);
        let running = entry_of(dir.path(), ".unpack-running", 4096, Duration::from_secs(1));

        evict(dir.path(), None, 1 << 30, &BTreeSet::new());

        assert!(
            !abandoned.exists(),
            "no fetch runs for twice its own timeout"
        );
        assert!(
            running.exists(),
            "a fetch elsewhere on the node keeps its scratch tree"
        );
    }

    // TEST_SCENARIO: the index directory is where every process on the node looks up what a tag resolved to, and the trust window is how long each of them believes an index file. An index directory named differently is a tag resolved again beside the answer already there, and a different window is a tag resolved on a schedule the other processes do not share.
    #[test]
    fn the_index_keeps_its_directory_and_window() {
        assert_eq!(REFS_DIR, "refs");
        assert_eq!(REF_FRESH, Duration::from_secs(10 * 60));
    }

    const DIGEST: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

    fn digest(hex: char) -> String {
        format!("sha256:{}", hex.to_string().repeat(64))
    }

    fn entry_name(hex: char) -> String {
        format!("sha256_{}", hex.to_string().repeat(64))
    }

    // TEST_SCENARIO: the index file for a reference is found by hashing the reference, so every process on the directory finds the same file only if they agree on the hash byte for byte. The value is the SHA-256 of the reference text, checked against a hash computed outside the runner, and a digest entry is the digest with its one colon replaced.
    #[test]
    fn a_reference_names_one_index_file_and_a_digest_one_entry() {
        let dir = Path::new("/images");
        assert_eq!(
            ref_path(dir, "quay.io/x/vm:1"),
            dir.join("refs/17c7481dc14ad29b0ce7071724d8db96cab34a2165937a86c52db163611ae6d4"),
            "sha256sum of the reference text"
        );
        assert_ne!(
            ref_path(dir, "quay.io/a/b:1"),
            ref_path(dir, "quay.io/a_b:1"),
            "two references an escaping would name alike get two index files"
        );
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
        assert!(!is_digest_entry(REFS_DIR));
        assert!(!is_digest_entry(HOLDERS_DIR));
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

    // TEST_SCENARIO: an index file outlives the tree it points at, and one that is stale and points at nothing saves nothing. It is removed, while a fresh one and one whose tree is still there are kept.
    #[test]
    fn a_stale_index_file_whose_tree_is_gone_is_removed() {
        let dir = tempdir();
        let write = |image: &str, digest: &str, age: Duration| {
            let path = ref_path(dir.path(), image);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let record = RefRecord {
                image: image.into(),
                digest: digest.into(),
            };
            fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
            backdate(&path, age);
            path
        };
        let gone = write("quay.io/x/gone:1", DIGEST, REF_FRESH * 2);
        let other = digest('2');
        let kept = write("quay.io/x/kept:1", &other, REF_FRESH * 2);
        fs::create_dir_all(digest_path(dir.path(), &other)).unwrap();
        let fresh = write("quay.io/x/fresh:1", DIGEST, Duration::from_secs(1));

        prune_refs(dir.path());

        assert!(!gone.exists());
        assert!(kept.exists());
        assert!(fresh.exists());
        assert_eq!(
            fs::read_to_string(&kept).unwrap(),
            format!(r#"{{"ref":"quay.io/x/kept:1","digest":"{other}"}}"#),
            "the bytes every process on the directory reads"
        );
    }

    fn tempdir() -> TempDir {
        TempDir::new()
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

    // UNIT_BOUNDARY_DESCRIPTION: a directory removed when the test ends. Written here rather than taken as a dependency because it is four lines and the crate's only other use for one would be the same four.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "vm-runner-cache-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
