use std::fs;
use std::io;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use crate::api::MachineSpec;
use crate::files;
use crate::state::machine_dir;

// UNIT_BOUNDARY_DESCRIPTION: the one thing a machine gets from its runner other than its disks. It holds platform-init, which is the machine's entrypoint, and the CA the guest must trust. It is a live host directory, and the command line naming it is fixed when the machine is created, so rewriting the share is how a CA the controller has rotated becomes the CA the next boot trusts — there is no other way to reach inside a machine that already exists. platform-init is copied rather than linked because the guest reads this directory through the VMM, which has no host filesystem to follow a link into.

// UNIT_BOUNDARY_DESCRIPTION: the share's name inside a machine's state directory. The guest sees it mounted at guest::SHARE_PATH, so this name is private to the host side, while everything below it is the contract platform-init reads.
pub const SHARE_DIR: &str = "share";

pub const CA_DIR: &str = "ca";
pub const CA_FILE: &str = "ca.crt";
pub const INIT_FILE: &str = "init";

// UNIT_BOUNDARY_DESCRIPTION: the modes the Go runner states for the share's CA. Stated here too rather than left to the umask: an install with a tighter umask would otherwise give the guest a CA directory it cannot traverse, and the two runners would write one machine's share differently.
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
    // UNIT_BOUNDARY_DESCRIPTION: reporting a write that failed late is part of the copy, not cleanup after it: renaming past it would put a truncated binary where the machine's entrypoint goes — reported as success, and found only by the guest, at its next boot. Go's `copyInit` checks its close for this and removes the staged file when it fails; Rust's close reports nothing, so `sync_all` stands in for it here, one leg stricter because it also waits for the bytes to reach the disk.
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

fn staged_path(to: &Path) -> PathBuf {
    let mut staged = to.as_os_str().to_os_string();
    staged.push(STAGED_SUFFIX);
    PathBuf::from(staged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{gosource, guest};

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
    }

    // TEST_SCENARIO: the Go runner and this one write the share of the same machine — a rollout replaces one with the other while machines exist. The directory name is the runner's own, so the Go const is read rather than copied: a machine whose share the next runner writes beside the old one keeps booting against a directory nobody updates, and its CA stops being rotated with no error anywhere.
    #[test]
    fn the_go_runner_writes_the_share_under_the_same_name() {
        let go = gosource::read("server.go");
        assert_eq!(
            gosource::const_value(&go, "shareDir").as_deref(),
            Some(SHARE_DIR),
            "the two runners no longer write one machine's share"
        );
    }

    // TEST_SCENARIO: the share's CA file is not named only between this module and platform-init. The controller puts `/etc/platform/ca/ca.crt` in the agent's own environment as NODE_EXTRA_CA_CERTS, a package away, and platform-init binds the share's ca directory to exactly that guest path. So the file name is an end-to-end contract: rename it on this side and the agent's runtime is pointed at a file that is not there, which fails as every outbound TLS call refusing the platform's own certificate.
    #[test]
    fn the_ca_is_named_what_the_agents_environment_points_at() {
        let go = gosource::read("server.go");
        assert!(
            go.contains(&format!(
                "filepath.Join(share, \"{CA_DIR}\", \"{CA_FILE}\")"
            )),
            "the two runners no longer write one machine's CA to the same place"
        );

        let resources = gosource::read_in("reconciler", "resources.go");
        assert!(
            resources.contains(&format!("\"{}/{CA_FILE}\"", guest::GUEST_CA_DIR)),
            "NODE_EXTRA_CA_CERTS no longer names {}/{CA_FILE}, so the agent trusts nothing the platform signed",
            guest::GUEST_CA_DIR
        );
    }

    // TEST_SCENARIO: the Go runner reports the close of both share files — `copyInit` treats a failed close as a failed copy and removes the staged file, and `os.WriteFile` returns the close error for the CA. A close is where a write that failed late is reported, so dropping it renames a truncated entrypoint into place and calls it success. This module does the same, by `sync_all` rather than a bare close; that behaviour has no test of its own, because a late write error needs a filesystem a unit test cannot make, so what is pinned here is the requirement it exists to meet.
    #[test]
    fn the_go_runner_treats_a_failed_close_as_a_failed_write() {
        let go = gosource::read("server.go");
        assert!(
            go.contains("if err := destination.Close(); err != nil {"),
            "copyInit no longer fails on a close, so this module is stricter than the contract it copies"
        );
        assert!(
            go.contains("os.WriteFile(filepath.Join(share,"),
            "the CA is no longer written with a call that reports its close"
        );
    }

    // TEST_SCENARIO: the modes the share is written with, stated on both sides rather than taken from whatever umask the runner happens to run under. A tighter umask would otherwise give the guest a CA directory it cannot traverse, and would have the two runners write one machine's share differently.
    #[test]
    fn the_share_is_written_with_the_modes_the_go_runner_states() {
        let go = gosource::read("server.go");
        assert!(
            go.contains(&format!("\"ca\"), 0o{:o})", CA_DIR_MODE)),
            "the Go runner no longer makes the CA directory {CA_DIR_MODE:o}"
        );
        assert!(
            go.contains(&format!("[]byte(spec.CACert), 0o{:o})", CA_MODE)),
            "the Go runner no longer writes the CA {CA_MODE:o}"
        );

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
        assert_eq!(mode_of(&share.join(CA_DIR)), CA_DIR_MODE);
        assert_eq!(mode_of(&share.join(CA_DIR).join(CA_FILE)), CA_MODE);
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

    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("vm-runner-share-{}-{name}", std::process::id()));
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
