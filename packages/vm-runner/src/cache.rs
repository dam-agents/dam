use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};

// UNIT_BOUNDARY_DESCRIPTION: the image cache is not this process's data structure, it is a protocol between every process that mounts the directory — which on a node cache is one runner per owner, plus the preloader. So this is a second implementation of something the Go runner already implements, and the two have to agree exactly: an entry one of them counts and the other does not is an entry one of them deletes while the other's guest has it mounted as its root filesystem. Every name, format and window below is therefore matched against packages/controller/pkg/vmrunner/server.go and digest.go by the tests, not merely written to resemble it.

// UNIT_BOUNDARY_DESCRIPTION: where each process publishes what its own machines hold, one file per runner named after it. Read by every other process before it evicts anything.
pub const HOLDERS_DIR: &str = ".holders";

// UNIT_BOUNDARY_DESCRIPTION: an unpack in progress, named apart from a finished entry and dot-prefixed so neither entry pattern can match it — a half-written tree must never be counted as one a machine can boot.
pub const PARTIAL_PREFIX: &str = ".unpack-";

// UNIT_BOUNDARY_DESCRIPTION: how long a holders file is believed after its last write. Machines are processes of the runner that made them, so a runner that stopped refreshing has no machines left running and its claims are safe to ignore.
pub const HOLDER_STALE: Duration = Duration::from_secs(30 * 60);

// UNIT_BOUNDARY_DESCRIPTION: the longest a single image fetch may run. Nothing finishes an unpack after twice this, so a scratch tree older than PARTIAL_STALE belonged to a process that died holding it.
pub const PULL_TIMEOUT: Duration = Duration::from_secs(20 * 60);
pub const PARTIAL_STALE: Duration = Duration::from_secs(2 * 20 * 60);

// UNIT_BOUNDARY_DESCRIPTION: the root of the cache's second format, where an entry is named by the digest of the image it holds. It is dot-prefixed so the patterns of the first format cannot match it: a process that knows only the first format never counts, evicts or prunes anything under it.
pub const DIGEST_ROOT: &str = ".v2";

// UNIT_BOUNDARY_DESCRIPTION: the index from a reference to the digest it last resolved to, inside the digest root. One file per reference, named by a hash of the reference, and its mtime is when the resolution was made.
pub const REFS_DIR: &str = "refs";

// UNIT_BOUNDARY_DESCRIPTION: how long a tag's resolution is trusted without asking the registry again. It also decides when an index file whose tree is gone may be removed.
pub const REF_FRESH: Duration = Duration::from_secs(10 * 60);

// UNIT_BOUNDARY_DESCRIPTION: an image reference becomes a directory name by replacing the three characters a reference may carry that a path segment must not. Nothing is escaped, so two references that differ only in those characters collide — which is the Go runner's behaviour and therefore this one's, because the two must name the same entry for the same image or each will fetch what the other already has.
pub fn cache_path(image_dir: &Path, image: &str) -> PathBuf {
    image_dir.join(image.replace(['/', ':', '@'], "_"))
}

// UNIT_BOUNDARY_DESCRIPTION: whether a string is a digest this cache can name an entry by: `sha256:` and 64 lower-case hex digits. Hand-written against the Go pattern and pinned to it by a test.
pub fn is_digest(digest: &str) -> bool {
    digest.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64 && hex.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
    })
}

// UNIT_BOUNDARY_DESCRIPTION: whether a name under the digest root is an entry: a digest with its colon replaced, so it is a single path segment.
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
    image_dir
        .join(DIGEST_ROOT)
        .join(digest.replacen(':', "_", 1))
}

// UNIT_BOUNDARY_DESCRIPTION: where the index keeps what a reference resolved to: the hex SHA-256 of the whole reference. The escaping of the first format is not used, because it names two different references alike, and an index that did would boot one image under the other's name.
pub fn ref_path(image_dir: &Path, image: &str) -> PathBuf {
    let hex: String = Sha256::digest(image.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    image_dir.join(DIGEST_ROOT).join(REFS_DIR).join(hex)
}

// UNIT_BOUNDARY_DESCRIPTION: whether a name is an unpacked entry. Hand-written rather than a regex so the crate carries no matcher of its own, and pinned against the Go pattern by a test: first character alphanumeric, the rest alphanumeric or one of `.`, `_`, `-`, and at most 255 characters. The leading class is what excludes a dot-prefixed scratch tree.
pub fn is_cached_image(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() || name.chars().count() > 255 {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

// UNIT_BOUNDARY_DESCRIPTION: whether a name is an archive an earlier release cached. The same shape with a `.tar` suffix, which the suffix itself satisfies, so the check is the entry rule plus the ending.
pub fn is_cached_archive(name: &str) -> bool {
    name.ends_with(".tar") && is_cached_image(name)
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

// UNIT_BOUNDARY_DESCRIPTION: publishes what this process holds, as names relative to the image directory, one per line, sorted. An entry of the first format is a bare name and one under the digest root carries the root, so a reader that joins a name to the directory finds either. Written to a `.new` file and renamed, because a reader that caught a partial write would read a shorter claim than the truth and evict what it did not see. Failure is reported and not returned: a runner that cannot publish still runs its machines, and the cost is that another may evict an image it holds.
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

// UNIT_BOUNDARY_DESCRIPTION: reclaims the scratch trees a killed fetch left. Invisible as well as abandoned — neither entry pattern matches a dot-prefixed name, so those bytes are counted against no budget and chosen for no eviction — which is why this runs before anything is measured. Only a tree older than any fetch may run is taken, so a fetch still running elsewhere on the node keeps its own.
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
    let refs = dir.join(DIGEST_ROOT).join(REFS_DIR);
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

// UNIT_BOUNDARY_DESCRIPTION: the cache's entries in both formats, oldest write first, which is the order eviction takes them in. A directory is measured by walking it and a file by its own size; anything matching none of the patterns is not an entry at all, which is how a scratch tree, the index and the holders directory are passed over rather than deleted.
pub fn entries(dir: &Path) -> Vec<Entry> {
    let mut all = first_format_entries(dir);
    if let Ok(read) = fs::read_dir(dir.join(DIGEST_ROOT)) {
        all.extend(read.flatten().filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !entry.file_type().ok()?.is_dir() || !is_digest_entry(&name) {
                return None;
            }
            Some(Entry {
                size: dir_size(&entry.path()),
                modified: entry.metadata().ok()?.modified().ok()?,
                path: entry.path(),
            })
        }));
    }
    all.sort_by_key(|entry| entry.modified);
    all
}

fn first_format_entries(dir: &Path) -> Vec<Entry> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    read.flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = entry.file_type().ok()?;
            let metadata = entry.metadata().ok()?;
            let size = if kind.is_dir() && is_cached_image(&name) {
                dir_size(&entry.path())
            } else if !kind.is_dir() && is_cached_archive(&name) {
                metadata.len()
            } else {
                return None;
            };
            Some(Entry {
                path: entry.path(),
                size,
                modified: metadata.modified().ok()?,
            })
        })
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: takes entries oldest-first until the cache is inside its budget, sparing anything held. A budget of zero or less evicts nothing, because the runner is refused rather than started without one and a preloader pass with none has nothing to weigh against. Going over budget is the outcome when everything left is held: an image a machine is running is never freed to make room, and the caller reports it rather than taking one.
pub fn evict(
    dir: &Path,
    keep: Option<&Path>,
    budget: i64,
    in_use: &BTreeSet<PathBuf>,
) -> Vec<PathBuf> {
    prune_partial_unpacks(dir);
    prune_partial_unpacks(&dir.join(DIGEST_ROOT));
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
        let removed = if entry.path.is_dir() {
            fs::remove_dir_all(&entry.path)
        } else {
            fs::remove_file(&entry.path)
        };
        if removed.is_err() {
            continue;
        }
        used = used.saturating_sub(entry.size);
        evicted.push(entry.path);
    }
    evicted
}

// UNIT_BOUNDARY_DESCRIPTION: the union a caller evicts against — what its own machines hold, plus what every other process on the directory published. An entry claimed elsewhere is spared under both names, because a release that cached an archive and one that cached a tree name the same image differently and the claim carries only one of them.
pub fn spared(own: &BTreeSet<PathBuf>, elsewhere: &BTreeSet<PathBuf>) -> BTreeSet<PathBuf> {
    let mut spared = own.clone();
    for path in elsewhere {
        spared.insert(path.clone());
        spared.insert(PathBuf::from(format!("{}.tar", path.display())));
    }
    spared
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;

    // TEST_SCENARIO: this module and the Go runner are two implementations of one on-disk protocol, and they share a directory during any rollout that replaces one with the other. Nothing at compile time relates them, so the names and windows are compared against server.go itself: a rename or a retimed window on either side has to fail here rather than on a node, where the symptom is one process evicting a tree the other's guest is running from.
    #[test]
    fn the_go_runner_names_the_same_things() {
        let go = gosource::read("server.go");

        assert_eq!(
            gosource::const_value(&go, "holdersDir").as_deref(),
            Some(HOLDERS_DIR),
            "the directory both processes publish their claims in"
        );
        assert_eq!(
            gosource::const_value(&go, "partialPrefix").as_deref(),
            Some(PARTIAL_PREFIX),
            "the prefix that keeps a half-written tree out of both entry patterns"
        );
    }

    // TEST_SCENARIO: the three windows are what each process believes about the other's claims, and nothing relates the two copies at compile time. Shorten holderStale in server.go alone and the Go runner starts deleting claim files this runner still believes — one process then evicts an unpacked tree the other's guest is running from, which is the harm the module comment names. The names were compared here from the start and the windows were not, though the scenario above said both were.
    #[test]
    fn the_go_runner_waits_the_same_lengths_of_time() {
        let go = gosource::read("server.go");

        for (name, ours, what) in [
            ("holderStale", HOLDER_STALE, "how long a claim is believed"),
            ("pullTimeout", PULL_TIMEOUT, "how long one fetch may run"),
            (
                "partialStale",
                PARTIAL_STALE,
                "when a scratch tree is somebody's abandoned work",
            ),
        ] {
            assert_eq!(
                gosource::duration_value(&go, name),
                Some(ours),
                "{name} — {what} — is no longer the same on both sides"
            );
        }
    }

    // TEST_SCENARIO: the window reader is only worth having if a declaration it cannot parse fails the comparison rather than passing it. Go writes these as expressions, not literals, so the shapes it accepts and refuses are the whole guarantee — a reader that returned something plausible for a form it had not understood would agree with a file it never read.
    #[test]
    fn a_window_the_reader_cannot_parse_is_not_silently_agreed_with() {
        let minutes = |n: u64| Duration::from_secs(n * 60);

        assert_eq!(
            gosource::duration_value("\tholderStale = 30 * time.Minute", "holderStale"),
            Some(minutes(30))
        );
        assert_eq!(
            gosource::duration_value(
                "\tpullTimeout = 20 * time.Minute\n\tpartialStale = 2 * pullTimeout",
                "partialStale"
            ),
            Some(minutes(40)),
            "one window stated in terms of another"
        );

        assert_eq!(
            gosource::duration_value("\tholderStale = 30 * time.Minute", "pullTimeout"),
            None,
            "a window that is not there"
        );
        assert_eq!(
            gosource::duration_value("\tstateTTL = time.Second", "stateTTL"),
            None,
            "a bare unit is a form this reader does not claim to understand"
        );
        assert_eq!(
            gosource::duration_value("\tholderStale = 30 * time.Fortnight", "holderStale"),
            None,
            "an unknown unit is refused rather than guessed at"
        );
        assert_eq!(
            gosource::duration_value("\tholderStale = quietWindow", "holderStale"),
            None,
            "and so is an alias with no count"
        );
        assert_eq!(
            gosource::duration_value("\ta = 2 * b\n\tb = 2 * a", "a"),
            None,
            "a pair that refer to each other ends rather than runs forever"
        );
    }

    // TEST_SCENARIO: the entry patterns decide what is counted against the budget and what may be evicted, so a matcher that admits one name more or less than the Go one is a matcher that deletes something the other side is protecting. It is hand-written here, which is only safe while the pattern it was written against is still the pattern in force.
    #[test]
    fn the_entry_patterns_are_the_ones_this_matcher_was_written_against() {
        let go = gosource::read("server.go");

        assert_eq!(
            gosource::regexp_source(&go, "cachedImage").as_deref(),
            Some(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$"),
            "is_cached_image is hand-written against this pattern and has to be rewritten with it"
        );
        assert_eq!(
            gosource::regexp_source(&go, "cachedArchive").as_deref(),
            Some(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}\.tar$"),
            "is_cached_archive likewise"
        );
    }

    // TEST_SCENARIO: the three characters a reference carries that a path segment cannot. Replacing a different set, or escaping where Go does not, gives the same image two names — so each process fetches what the other already has, and neither sees the other's claim on it.
    #[test]
    fn a_reference_becomes_the_same_entry_name_on_both_sides() {
        let go = gosource::read("server.go");
        assert_eq!(
            gosource::call_args_in(&go, "(s *Server) cachePath", "strings.NewReplacer(").as_deref(),
            Some(r#""/", "_", ":", "_", "@", "_""#),
            "cache_path replaces exactly these and must change with them"
        );

        let dir = Path::new("/images");
        assert_eq!(
            cache_path(dir, "quay.io/dam-agents/agent:1.2.3"),
            dir.join("quay.io_dam-agents_agent_1.2.3")
        );
        assert_eq!(
            cache_path(dir, "quay.io/x@sha256:abc"),
            dir.join("quay.io_x_sha256_abc")
        );
    }

    // TEST_SCENARIO: the matcher's edges, where a wrong answer is a deleted rootfs or a leaked tree. A dot-prefixed name is the one that matters most: it is how a scratch tree stays out of the budget, and admitting one here would make eviction take a fetch that is still running.
    #[test]
    fn the_matcher_admits_an_entry_and_refuses_everything_else() {
        assert!(is_cached_image("quay.io_x_vm_1"));
        assert!(is_cached_image("a"));
        assert!(is_cached_image(&"a".repeat(255)));

        assert!(!is_cached_image(""));
        assert!(
            !is_cached_image(&"a".repeat(256)),
            "the pattern caps at 255"
        );
        assert!(
            !is_cached_image(".unpack-123"),
            "a scratch tree is not an entry"
        );
        assert!(!is_cached_image(".holders"), "nor is the claims directory");
        assert!(!is_cached_image("-leading-dash"));
        assert!(!is_cached_image("has/slash"));
        assert!(!is_cached_image("has space"));

        assert!(is_cached_archive("quay.io_x_vm_1.tar"));
        assert!(
            !is_cached_archive("quay.io_x_vm_1"),
            "a tree is not an archive"
        );
        assert!(!is_cached_archive(".unpack-1.tar"));
    }

    // TEST_SCENARIO: a claim is published for another process to read, so what matters is the bytes on disk: basenames, one per line, sorted, and no half-written file ever visible under the real name.
    #[test]
    fn a_claim_is_published_as_sorted_basenames_through_a_staged_rename() {
        let dir = tempdir();
        let held = [
            dir.path().join("quay.io_x_second_1"),
            dir.path().join("quay.io_x_first_1"),
        ]
        .into_iter()
        .collect::<BTreeSet<_>>();

        publish_holders(dir.path(), "runner-a", &held);

        let body = fs::read_to_string(dir.path().join(HOLDERS_DIR).join("runner-a")).unwrap();
        assert_eq!(body, "quay.io_x_first_1\nquay.io_x_second_1");
        assert!(
            !dir.path().join(HOLDERS_DIR).join("runner-a.new").exists(),
            "the staging file is renamed, not left beside the claim where a reader would see two"
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

    // TEST_SCENARIO: eviction takes the oldest write first and stops as soon as the cache is inside its budget, and it never takes an entry something holds — which is the whole safety property, because an unpacked image is the root filesystem of every machine running it.
    #[test]
    fn eviction_takes_the_oldest_unheld_entries_until_it_is_inside_the_budget() {
        let dir = tempdir();
        let oldest = entry_of(
            dir.path(),
            "quay.io_x_oldest_1",
            1024,
            Duration::from_secs(300),
        );
        let held = entry_of(
            dir.path(),
            "quay.io_x_held_1",
            1024,
            Duration::from_secs(200),
        );
        let newest = entry_of(
            dir.path(),
            "quay.io_x_newest_1",
            1024,
            Duration::from_secs(100),
        );

        let in_use = [held.clone()].into_iter().collect::<BTreeSet<_>>();
        let evicted = evict(dir.path(), None, 2500, &in_use);

        assert_eq!(
            evicted,
            vec![oldest.clone()],
            "the oldest write goes first, and only until it fits"
        );
        assert!(!oldest.exists());
        assert!(
            held.exists(),
            "an entry a machine is running from is never taken"
        );
        assert!(newest.exists());
    }

    // TEST_SCENARIO: when everything left is held there is nothing to take, and the cache stays over its budget rather than freeing a running machine's filesystem. Going over is the reported outcome; taking one is not an outcome at all.
    #[test]
    fn eviction_goes_over_budget_rather_than_take_a_held_entry() {
        let dir = tempdir();
        let held = entry_of(
            dir.path(),
            "quay.io_x_held_1",
            4096,
            Duration::from_secs(300),
        );
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

    // TEST_SCENARIO: a claim names one entry, but a release that cached an archive and one that cached a tree name the same image differently. Sparing only the name written down would let a runner take the other form out from under the machine reading it.
    #[test]
    fn a_claim_elsewhere_spares_both_forms_of_the_entry() {
        let own = [PathBuf::from("/images/mine")].into_iter().collect();
        let elsewhere = [PathBuf::from("/images/theirs")].into_iter().collect();

        let spared = spared(&own, &elsewhere);

        assert!(spared.contains(Path::new("/images/mine")));
        assert!(spared.contains(Path::new("/images/theirs")));
        assert!(
            spared.contains(Path::new("/images/theirs.tar")),
            "the archive form of the same image"
        );
    }

    // TEST_SCENARIO: the digest root is where both runners put an entry keyed by digest, and a process of either kind reads the other's index during a rollout. A root, an index directory or a window named differently on one side is an entry each side fetches again, and a trust window that differs is a tag each side resolves on its own schedule.
    #[test]
    fn the_go_runner_keys_entries_by_digest_the_same_way() {
        let go = gosource::read("digest.go");

        assert_eq!(
            gosource::const_value(&go, "digestRoot").as_deref(),
            Some(DIGEST_ROOT)
        );
        assert_eq!(
            gosource::const_value(&go, "refsDir").as_deref(),
            Some(REFS_DIR)
        );
        assert_eq!(gosource::duration_value(&go, "refFresh"), Some(REF_FRESH));
        assert_eq!(
            gosource::regexp_source(&go, "imageDigest").as_deref(),
            Some(r"^sha256:[a-f0-9]{64}$"),
            "is_digest is hand-written against this pattern"
        );
        assert_eq!(
            gosource::regexp_source(&go, "digestEntry").as_deref(),
            Some(r"^sha256_[a-f0-9]{64}$"),
            "is_digest_entry likewise"
        );
        assert_eq!(
            gosource::call_args_in(&go, "(s *Server) digestPath", "strings.Replace(").as_deref(),
            Some(r#"digest, ":", "_", 1"#),
            "digest_path replaces the first colon and nothing else"
        );
        let names_refs = gosource::function_body(&go, "(s *Server) refPath")
            .expect("digest.go still names an index file");
        assert!(
            names_refs.contains("sha256.Sum256([]byte(ref))")
                && names_refs.contains("hex.EncodeToString(sum[:])"),
            "ref_path hashes the whole reference to lower-case hex, as refPath does: {names_refs}"
        );
        assert_eq!(
            gosource::struct_fields(&go, "refRecord"),
            vec![
                gosource::GoField {
                    json: "ref".into(),
                    omitempty: false
                },
                gosource::GoField {
                    json: "digest".into(),
                    omitempty: false
                },
            ],
            "an index file is read by both runners"
        );
    }

    // TEST_SCENARIO: a claim is read by every process on the directory, and a claim on a digest entry has to name the root as well as the entry or a reader joins it to the wrong place and spares nothing. Both runners publish names relative to the image directory.
    #[test]
    fn the_go_runner_publishes_claims_relative_to_the_directory() {
        let go = gosource::read("server.go");
        let publishes = gosource::function_body(&go, "(s *Server) publishHolders")
            .expect("server.go still publishes claims");
        assert!(
            publishes.contains("filepath.Rel(s.ImageDir, path)"),
            "publish_holders strips the image directory, as publishHolders does: {publishes}"
        );

        let dir = tempdir();
        let held = [
            dir.path().join("quay.io_x_old_1"),
            digest_path(dir.path(), DIGEST),
        ]
        .into_iter()
        .collect::<BTreeSet<_>>();
        publish_holders(dir.path(), "runner-a", &held);
        let body = fs::read_to_string(dir.path().join(HOLDERS_DIR).join("runner-a")).unwrap();
        assert_eq!(
            body,
            format!(".v2/sha256_{}\nquay.io_x_old_1", "1".repeat(64))
        );
        assert_eq!(
            held_elsewhere(dir.path(), "runner-b"),
            held,
            "a reader joins either kind of name back to the entry it claims"
        );
    }

    const DIGEST: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

    // TEST_SCENARIO: the index file for a reference is found by hashing the reference, so the two runners agree on the file only if they agree on the hash byte for byte. The value is the SHA-256 of the reference text, checked against a hash computed outside either runner.
    #[test]
    fn a_reference_names_the_same_index_file_on_both_sides() {
        let dir = Path::new("/images");
        assert_eq!(
            ref_path(dir, "quay.io/x/vm:1"),
            dir.join(".v2/refs/17c7481dc14ad29b0ce7071724d8db96cab34a2165937a86c52db163611ae6d4"),
            "sha256sum of the reference text"
        );
        assert_ne!(
            ref_path(dir, "quay.io/a/b:1"),
            ref_path(dir, "quay.io/a_b:1"),
            "two references the first format names alike get two index files"
        );
        assert_eq!(
            digest_path(dir, DIGEST),
            dir.join(format!(".v2/sha256_{}", "1".repeat(64)))
        );
    }

    // TEST_SCENARIO: the matchers for a digest and for a digest entry decide what is booted and what is evicted under the digest root. A digest with upper-case hex, another algorithm or the wrong length is not one this cache names an entry by.
    #[test]
    fn only_a_sha256_digest_names_an_entry() {
        assert!(is_digest(DIGEST));
        assert!(!is_digest(&DIGEST.to_uppercase()));
        assert!(!is_digest("sha512:abc"));
        assert!(!is_digest(&DIGEST[..70]));
        assert!(is_digest_entry(&format!("sha256_{}", "a".repeat(64))));
        assert!(!is_digest_entry(REFS_DIR));
        assert!(!is_digest_entry(".unpack-1"));

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

    // TEST_SCENARIO: the budget covers both formats, so an entry under the digest root is counted and evicted by the same oldest-first rule, and a held one is spared the same way. Nothing else under the root is an entry: not the index, not a scratch tree.
    #[test]
    fn eviction_weighs_both_formats_together() {
        let dir = tempdir();
        let root = dir.path().join(DIGEST_ROOT);
        let oldest = entry_of(
            &root,
            &format!("sha256_{}", "a".repeat(64)),
            1024,
            Duration::from_secs(300),
        );
        let held = entry_of(
            &root,
            &format!("sha256_{}", "b".repeat(64)),
            1024,
            Duration::from_secs(200),
        );
        let legacy = entry_of(
            dir.path(),
            "quay.io_x_old_1",
            1024,
            Duration::from_secs(100),
        );
        fs::create_dir_all(root.join(REFS_DIR)).unwrap();

        let in_use = [held.clone()].into_iter().collect::<BTreeSet<_>>();
        let evicted = evict(dir.path(), None, 2500, &in_use);

        assert_eq!(evicted, vec![oldest]);
        assert!(held.exists());
        assert!(legacy.exists());
        assert!(root.join(REFS_DIR).exists(), "the index is not an entry");
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
        let other = format!("sha256:{}", "2".repeat(64));
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
            "the bytes are the ones the Go runner writes"
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
