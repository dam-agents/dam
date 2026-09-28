use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::api::{MachineSpec, SeedResult};
use crate::files;
use crate::state::machine_dir;

// UNIT_BOUNDARY_DESCRIPTION: the one thing a machine gets from its runner other than its disks. It holds platform-init, which is the machine's entrypoint, and the CA the guest must trust. It is a live host directory, and the command line naming it is fixed when the machine is created, so rewriting the share is how a CA the controller has rotated becomes the CA the next boot trusts — there is no other way to reach inside a machine that already exists. platform-init is copied rather than linked because the guest reads this directory through the VMM, which has no host filesystem to follow a link into.

// UNIT_BOUNDARY_DESCRIPTION: the share's name inside a machine's state directory. The guest sees it mounted at guest::SHARE_PATH, so this name is private to the host side, while everything below it is the contract platform-init reads.
pub const SHARE_DIR: &str = "share";

pub const CA_DIR: &str = "ca";
pub const CA_FILE: &str = "ca.crt";
pub const INIT_FILE: &str = "init";

// UNIT_BOUNDARY_DESCRIPTION: the seed a migrated agent's home is restored from, read by the guest at guest::SHARE_SEED_FILE. write_share never touches it, because the share is rewritten on every ensure and a seed uploaded before the first boot must still be there when that boot reads it.
pub const SEED_FILE: &str = "seed.tar";

// UNIT_BOUNDARY_DESCRIPTION: the seed is read by platform-init as root in the guest, through the VMM, which serves the share with the runner's own credentials; world-readable is what the rest of the share is, and nothing in the guest writes to it.
pub const SEED_MODE: u32 = 0o644;

// UNIT_BOUNDARY_DESCRIPTION: the share's record that this machine's disk has held the agent's home, which platform-init reads at guest::SEEDED_PATH. The runner writes it the first time the machine's guest answers, which it does only after platform-init has put the home on the disk, and nothing removes it but the machine's delete: its whole point is to outlive a home that smolvm formatted away.
pub const SEEDED_FILE: &str = "seeded";

// UNIT_BOUNDARY_DESCRIPTION: the modes the share's CA is written with, stated rather than left to the umask: an install with a tighter umask would otherwise give the guest a CA directory it cannot traverse, and two installs would write one machine's share differently.
pub const CA_DIR_MODE: u32 = 0o755;
pub const CA_MODE: u32 = 0o644;

// UNIT_BOUNDARY_DESCRIPTION: platform-init is exec'd by the guest, so the executable bit is not cosmetic: a machine handed a share whose init cannot run boots with its disk unmounted and no agent in it. The mode is set on the staged file after the copy as well as at create, because a create does not change the mode of a file that already exists — and a scratch file left behind by a killed runner is exactly the one that already exists.
pub const INIT_MODE: u32 = 0o755;

// UNIT_BOUNDARY_DESCRIPTION: init is written beside itself and renamed over, so a machine reading the share while it is rewritten sees the old binary or the new one and never a half of either. The rename is within one directory, which is what makes it atomic.
pub const STAGED_SUFFIX: &str = ".new";

pub fn write_share(
    state_dir: &Path,
    id: &str,
    spec: &MachineSpec,
    init: Option<&Path>,
) -> anyhow::Result<()> {
    let base =
        machine_dir(state_dir, id).ok_or_else(|| anyhow::anyhow!("invalid machine id {id:?}"))?;
    let share = base.join(SHARE_DIR);
    let ca = share.join(CA_DIR);
    files::create_dir(&ca, CA_DIR_MODE)?;
    files::write(&ca.join(CA_FILE), spec.ca_cert.as_bytes(), CA_MODE)?;
    copy_init(init, &share.join(INIT_FILE))
}

pub fn seeded(share: &Path) -> bool {
    share.join(SEEDED_FILE).exists()
}

pub fn record_seeded(share: &Path) -> anyhow::Result<()> {
    files::write(&share.join(SEEDED_FILE), b"", CA_MODE)?;
    tracing::info!(share = %share.display(), "the storage disk holds a home; a boot that finds it gone is refused from now on");
    Ok(())
}

pub fn copy_init(init: Option<&Path>, to: &Path) -> anyhow::Result<()> {
    let init = init.ok_or_else(|| {
        anyhow::anyhow!(
            "no platform-init binary configured, so a machine would boot with its disk unmounted"
        )
    })?;
    let mut source =
        fs::File::open(init).map_err(|e| anyhow::anyhow!("reading platform-init: {e}"))?;
    let staged = staged_path(to);
    let mut destination = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(INIT_MODE)
        .open(&staged)?;
    // UNIT_BOUNDARY_DESCRIPTION: reporting a write that failed late is part of the copy, not cleanup after it: renaming past it would put a truncated binary where the machine's entrypoint goes — reported as success, and found only by the guest, at its next boot. A close is where such an error surfaces, and Rust's close reports nothing, so `sync_all` stands in for it here, one leg stricter because it also waits for the bytes to reach the disk.
    let copied = io::copy(&mut source, &mut destination)
        .and_then(|_| destination.set_permissions(fs::Permissions::from_mode(INIT_MODE)))
        .and_then(|()| destination.sync_all());
    drop(destination);
    if let Err(e) = copied {
        let _ = fs::remove_file(&staged);
        return Err(e.into());
    }
    fs::rename(&staged, to)?;
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: a seed being uploaded. It is written beside SEED_FILE and renamed over it only once every byte is on the disk, so a guest never reads half a seed and an upload that fails leaves the seed that was there, or none. The SHA-256 and byte count are taken as the bytes are written, because the seed can be many GiB and reading it back would cost a second pass over all of them. Dropped without `commit`, it removes its staged file.
pub struct SeedFile {
    file: fs::File,
    staged: PathBuf,
    to: PathBuf,
    hasher: Sha256,
    bytes: u64,
    committed: bool,
}

impl SeedFile {
    pub fn create(share: &Path) -> io::Result<Self> {
        let to = share.join(SEED_FILE);
        let staged = staged_path(&to);
        let file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(SEED_MODE)
            .open(&staged)?;
        let seed = Self {
            file,
            staged,
            to,
            hasher: Sha256::new(),
            bytes: 0,
            committed: false,
        };
        seed.file
            .set_permissions(fs::Permissions::from_mode(SEED_MODE))?;
        Ok(seed)
    }

    pub fn bytes(&self) -> u64 {
        self.bytes
    }

    pub fn write(&mut self, chunk: &[u8]) -> io::Result<()> {
        self.file.write_all(chunk)?;
        self.hasher.update(chunk);
        self.bytes += chunk.len() as u64;
        Ok(())
    }

    pub fn commit(mut self) -> io::Result<SeedResult> {
        self.file.sync_all()?;
        fs::rename(&self.staged, &self.to)?;
        self.committed = true;
        Ok(SeedResult {
            bytes: self.bytes,
            sha256: format!("{:x}", self.hasher.clone().finalize()),
        })
    }
}

impl Drop for SeedFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.staged);
        }
    }
}

pub fn remove_seed(share: &Path) -> io::Result<()> {
    match fs::remove_file(share.join(SEED_FILE)) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

fn staged_path(to: &Path) -> PathBuf {
    let mut staged = to.as_os_str().to_os_string();
    staged.push(STAGED_SUFFIX);
    PathBuf::from(staged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guest;
    use crate::testdir::TempDir;

    // TEST_SCENARIO: the share is the one place the host and the inside of a machine meet on a path. The host writes this layout and platform-init reads it at the paths in guest.rs, so the two are one contract written in two places: a share whose CA sits somewhere else is a guest that trusts nothing the platform signed, and an init at another name is a machine that boots with no agent in it.
    #[test]
    fn the_share_holds_what_the_guest_goes_looking_for() {
        assert_eq!(
            guest::INIT_PATH,
            format!("{}/{INIT_FILE}", guest::SHARE_PATH),
            "platform-init is fetched from a path this module does not write"
        );
        assert_eq!(
            guest::SHARE_CA_DIR,
            format!("{}/{CA_DIR}", guest::SHARE_PATH),
            "the guest binds a CA directory this module does not write"
        );
        assert_eq!(
            guest::SEEDED_PATH,
            format!("{}/{SEEDED_FILE}", guest::SHARE_PATH),
            "the guest looks for the seeded record where this module does not write it"
        );
    }

    // TEST_SCENARIO: the seeded record is what lets platform-init refuse a disk smolvm has reformatted, so it must survive everything the share goes through while the machine exists: every ensure rewrites the share, and a rewrite that dropped the record would let the next boot seed a fresh home over the lost one without a word.
    #[test]
    fn the_seeded_record_outlives_every_rewrite_of_the_share() {
        let dir = TempDir::new("seeded");
        let init = dir.path().join("platform-init");
        fs::write(&init, b"init").unwrap();
        let spec = MachineSpec {
            ca_cert: "ca".into(),
            ..Default::default()
        };
        write_share(dir.path(), "agent-a", &spec, Some(&init)).unwrap();
        let share = dir.path().join("agent-a").join(SHARE_DIR);
        assert!(!seeded(&share));

        record_seeded(&share).unwrap();
        write_share(dir.path(), "agent-a", &spec, Some(&init)).unwrap();
        assert!(seeded(&share));
        assert_eq!(
            mode_of(&share.join(SEEDED_FILE)),
            CA_MODE,
            "the guest reads it"
        );
    }

    // TEST_SCENARIO: the share's CA file is not named only between this module and platform-init. The controller puts the guest's CA file in the agent's own environment as NODE_EXTRA_CA_CERTS, and platform-init binds the share's ca directory to exactly that guest path. So the file name is an end-to-end contract: rename it on this side and the agent's runtime is pointed at a file that is not there, which fails as every outbound TLS call refusing the platform's own certificate. The controller's tests hold its environment to the same fixture.
    #[test]
    fn the_ca_is_named_what_the_agents_environment_points_at() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/contract/guest.json");
        let fixture: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(path).unwrap_or_else(|e| panic!("reading {path}: {e}")),
        )
        .expect("the guest fixture is JSON");
        assert_eq!(
            fixture["caFile"],
            format!("{}/{CA_FILE}", guest::GUEST_CA_DIR),
            "the agent's environment names a CA file the share does not write"
        );
    }

    // TEST_SCENARIO: the modes the share is written with, stated rather than taken from whatever umask the runner happens to run under. A tighter umask would otherwise give the guest a CA directory it cannot traverse.
    #[test]
    fn the_share_is_written_with_stated_modes_rather_than_the_umask() {
        let dir = TempDir::new("modes");
        let init = dir.path().join("platform-init");
        fs::write(&init, b"init").unwrap();
        write_share(
            dir.path(),
            "agent-a",
            &MachineSpec {
                ca_cert: "ca".into(),
                ..Default::default()
            },
            Some(&init),
        )
        .unwrap();

        let share = dir.path().join("agent-a").join(SHARE_DIR);
        assert_eq!(mode_of(&share.join(CA_DIR)), 0o755);
        assert_eq!(mode_of(&share.join(CA_DIR).join(CA_FILE)), 0o644);
    }

    // TEST_SCENARIO: what a machine is given. The CA is what the controller sent, and init is a copy of the configured binary that the guest can actually exec — the mode is asserted because nothing on this side would notice it missing, and the machine that does notice comes up with its disk unmounted.
    #[test]
    fn a_share_carries_the_ca_and_an_init_that_can_run() {
        let dir = TempDir::new("carries");
        let init = dir.path().join("platform-init");
        fs::write(&init, b"#!/bin/true\n").unwrap();

        write_share(
            dir.path(),
            "agent-a",
            &MachineSpec {
                ca_cert: "-----BEGIN CERTIFICATE-----\nfirst\n".into(),
                ..Default::default()
            },
            Some(&init),
        )
        .unwrap();

        let share = dir.path().join("agent-a").join(SHARE_DIR);
        assert_eq!(
            fs::read_to_string(share.join(CA_DIR).join(CA_FILE)).unwrap(),
            "-----BEGIN CERTIFICATE-----\nfirst\n"
        );
        assert_eq!(fs::read(share.join(INIT_FILE)).unwrap(), b"#!/bin/true\n");
        assert_eq!(
            mode_of(&share.join(INIT_FILE)),
            INIT_MODE,
            "the guest execs this file"
        );
        assert!(
            !share.join(format!("{INIT_FILE}{STAGED_SUFFIX}")).exists(),
            "the scratch copy was left in the share the guest reads"
        );
    }

    // TEST_SCENARIO: the share is rewritten on every ensure, and that is the only way a rotated CA reaches a machine that already exists — the command line naming the share was fixed when the machine was created. A rewrite that kept the first CA would leave long-lived machines trusting a certificate the platform has retired, which shows up as every egress failing at once, long after the rotation.
    #[test]
    fn rewriting_a_share_replaces_the_ca_a_running_machine_reads() {
        let dir = TempDir::new("rotate");
        let init = dir.path().join("platform-init");
        fs::write(&init, b"first init").unwrap();

        let share_with = |cert: &str| {
            write_share(
                dir.path(),
                "agent-a",
                &MachineSpec {
                    ca_cert: cert.into(),
                    ..Default::default()
                },
                Some(&init),
            )
            .unwrap();
        };

        share_with("old ca");
        fs::write(&init, b"second init").unwrap();
        share_with("rotated ca");

        let share = dir.path().join("agent-a").join(SHARE_DIR);
        assert_eq!(
            fs::read_to_string(share.join(CA_DIR).join(CA_FILE)).unwrap(),
            "rotated ca"
        );
        assert_eq!(
            fs::read(share.join(INIT_FILE)).unwrap(),
            b"second init",
            "and a runner that was upgraded ships its own init to the machines it inherited"
        );
    }

    // TEST_SCENARIO: a runner killed mid-copy leaves the scratch file behind with whatever mode the umask gave it. The next copy opens that same file, and a create does not change the mode of a file that exists — so without setting it explicitly the machine gets an init it cannot exec, from a crash that happened on some earlier day.
    #[test]
    fn an_init_staged_by_a_runner_that_died_does_not_arrive_unexecutable() {
        let dir = TempDir::new("stale-stage");
        let init = dir.path().join("platform-init");
        fs::write(&init, b"real init").unwrap();
        let to = dir.path().join("init");
        let staged = dir.path().join(format!("init{STAGED_SUFFIX}"));
        fs::write(&staged, b"half a binary").unwrap();
        fs::set_permissions(&staged, fs::Permissions::from_mode(0o644)).unwrap();

        copy_init(Some(&init), &to).unwrap();

        assert_eq!(fs::read(&to).unwrap(), b"real init");
        assert_eq!(mode_of(&to), INIT_MODE, "the guest cannot exec this");
    }

    // TEST_SCENARIO: a machine with no init is a machine that boots with its disk unmounted and does its work where nothing survives a stop. Both ways of not having one — none configured, and one configured that is not there — are refusals, before any machine is created.
    #[test]
    fn a_machine_that_would_have_no_entrypoint_is_refused() {
        let dir = TempDir::new("no-init");
        let to = dir.path().join("init");

        let unconfigured = copy_init(None, &to).unwrap_err().to_string();
        assert!(
            unconfigured.contains("platform-init"),
            "the refusal does not say what is missing: {unconfigured}"
        );

        let missing = copy_init(Some(&dir.path().join("absent")), &to)
            .unwrap_err()
            .to_string();
        assert!(
            missing.contains("platform-init"),
            "the refusal does not say what is missing: {missing}"
        );
        assert!(!to.exists(), "a machine was given something to exec anyway");
    }

    // TEST_SCENARIO: the share's path is the state directory joined to a name the caller chose, exactly like the machine directory it sits in, so it is refused on the same terms. A share written for `..` would put an executable and a trusted CA one level up, where the next machine created would read them.
    #[test]
    fn a_name_that_could_leave_the_state_directory_gets_no_share() {
        let dir = TempDir::new("escape");
        let init = dir.path().join("platform-init");
        fs::write(&init, b"init").unwrap();

        assert!(
            write_share(dir.path(), "..", &MachineSpec::default(), Some(&init)).is_err(),
            "a share was written outside the machine directory"
        );
        assert!(write_share(dir.path(), "Agent", &MachineSpec::default(), Some(&init)).is_err());
        assert!(!dir.path().join(SHARE_DIR).exists());
    }

    // TEST_SCENARIO: the runner stores the seed under one name and platform-init reads it under another path, in another binary. Only the file name is shared, so it is held here to the guest's path: a seed stored under any other name is a migrated agent that boots with the image's home, and nothing fails to say so.
    #[test]
    fn the_seed_is_stored_where_the_guest_reads_it() {
        assert_eq!(
            guest::SHARE_SEED_FILE,
            format!("{}/{SEED_FILE}", guest::SHARE_PATH),
            "platform-init reads a seed this module does not write"
        );
    }

    // TEST_SCENARIO: the share is rewritten on every ensure, so a seed uploaded to a stopped machine meets at least one more rewrite before the machine boots — the ensure that starts it. A rewrite that removed the seed would boot every migrated agent with the image's home instead of its own.
    #[test]
    fn rewriting_a_share_keeps_the_seed() {
        let dir = TempDir::new("keeps-seed");
        let init = dir.path().join("platform-init");
        fs::write(&init, b"init").unwrap();
        let spec = MachineSpec {
            ca_cert: "ca".into(),
            ..Default::default()
        };
        write_share(dir.path(), "agent-a", &spec, Some(&init)).unwrap();
        let share = dir.path().join("agent-a").join(SHARE_DIR);
        let mut seed = SeedFile::create(&share).unwrap();
        seed.write(b"a tar").unwrap();
        seed.commit().unwrap();

        write_share(dir.path(), "agent-a", &spec, Some(&init)).unwrap();

        assert_eq!(fs::read(share.join(SEED_FILE)).unwrap(), b"a tar");
    }

    // TEST_SCENARIO: what an upload stores and what it answers. The digest and the byte count are of exactly the bytes written, the seed gets its stated mode, and no staged file is left in the share the guest reads.
    #[test]
    fn a_committed_seed_is_whole_and_counted() {
        let dir = TempDir::new("seed-commit");
        let mut seed = SeedFile::create(dir.path()).unwrap();
        seed.write(b"te").unwrap();
        seed.write(b"st").unwrap();
        assert_eq!(seed.bytes(), 4);
        let result = seed.commit().unwrap();

        assert_eq!(
            result,
            SeedResult {
                bytes: 4,
                sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
            }
        );
        assert_eq!(fs::read(dir.path().join(SEED_FILE)).unwrap(), b"test");
        assert_eq!(mode_of(&dir.path().join(SEED_FILE)), SEED_MODE);
        assert!(!dir
            .path()
            .join(format!("{SEED_FILE}{STAGED_SUFFIX}"))
            .exists());
    }

    // TEST_SCENARIO: an upload that fails part-way is dropped without a commit. It must leave the seed that was there before and no staged file: a half seed in the share is a home restored from half a volume.
    #[test]
    fn an_abandoned_upload_leaves_the_old_seed_and_no_scratch() {
        let dir = TempDir::new("seed-abandon");
        fs::write(dir.path().join(SEED_FILE), b"old").unwrap();
        let mut seed = SeedFile::create(dir.path()).unwrap();
        seed.write(b"half of a new").unwrap();
        drop(seed);

        assert_eq!(fs::read(dir.path().join(SEED_FILE)).unwrap(), b"old");
        assert!(!dir
            .path()
            .join(format!("{SEED_FILE}{STAGED_SUFFIX}"))
            .exists());
        remove_seed(dir.path()).unwrap();
        remove_seed(dir.path()).unwrap();
        assert!(!dir.path().join(SEED_FILE).exists());
    }

    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }
}
