use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::api::MachineSpec;
use crate::files;

// UNIT_BOUNDARY_DESCRIPTION: what a machine leaves on disk, which is what lets a runner be restarted without losing the machines it was running. Every answer here is read from the filesystem rather than from memory, because the machines outlive the process that made them: a spec on disk says what a machine was asked to be, its port file says where it is published, and the directory's existence says it is this runner's at all. The Go runner reads the same files in the same formats, and a rollout runs both against one state directory, so the names and shapes are pinned against server.go by the tests.

// UNIT_BOUNDARY_DESCRIPTION: the spec a machine was created with, kept beside it so a runner that restarts can tell a machine that already matches from one that has to be reshaped.
pub const SPEC_FILE: &str = "spec.json";

// UNIT_BOUNDARY_DESCRIPTION: the published port, kept as a file rather than in memory because the allocator reads every machine's to find a free one, and a runner that forgot them would hand out a port another machine is already published on.
pub const PORT_FILE: &str = "port";

// UNIT_BOUNDARY_DESCRIPTION: the digest a machine was created from, kept beside its spec. The spec keeps the reference the controller asked for, and a tag no longer says which tree a machine has mounted once it has moved, so eviction reads this file to know which digest entry the machine holds.
pub const IMAGE_DIGEST_FILE: &str = "image-digest";

// UNIT_BOUNDARY_DESCRIPTION: the mode the port file is written with. Stated rather than left to the umask so the two runners write one machine's state the same way whatever umask each was started under.
pub const PORT_MODE: u32 = 0o644;

// UNIT_BOUNDARY_DESCRIPTION: the mode the spec is written with, named because it is the exception: every other file this runner writes is world-readable, and this one is not, because its env holds the Agent's secrets in plaintext.
pub const SPEC_MODE: u32 = 0o600;

// UNIT_BOUNDARY_DESCRIPTION: whether a name is one this runner will keep state under. Hand-written against the Go pattern and pinned to it by a test: lower-case alphanumeric to start, then lower-case alphanumeric or a dash, at most 63 characters. It is the guard that keeps an id out of the parent directory — a machine directory is this name joined to the state directory and nothing else, so a name that escaped would let a request write anywhere the runner can.
pub fn is_machine_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let lower_alnum = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    if !lower_alnum(first) || id.chars().count() > 63 {
        return false;
    }
    chars.all(|c| lower_alnum(c) || c == '-')
}

// UNIT_BOUNDARY_DESCRIPTION: where a machine's state lives, or nothing when the name is not one this runner accepts. Refusing is the whole point: the directory is the state directory joined to a caller-supplied name.
pub fn machine_dir(state_dir: &Path, id: &str) -> Option<PathBuf> {
    is_machine_id(id).then(|| state_dir.join(id))
}

// UNIT_BOUNDARY_DESCRIPTION: the machines this runner has state for, which is the answer to what it is running — not a list it keeps, because it is restarted and the machines are not. A state directory that does not exist yet is no machines rather than an error, since that is a runner that has not made one.
pub fn machine_ids(state_dir: &Path) -> std::io::Result<BTreeSet<String>> {
    let entries = match fs::read_dir(state_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeSet::new()),
        Err(e) => return Err(e),
    };
    Ok(entries
        .flatten()
        .filter(|entry| entry.file_type().map(|k| k.is_dir()).unwrap_or(false))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| is_machine_id(name))
        .collect())
}

// UNIT_BOUNDARY_DESCRIPTION: the spec a machine was created with, or nothing — unreadable, unparseable and untrustworthy are one answer here, because every caller does the same thing with them. The image is checked on the way out rather than only on the way in: this file is read back by a later process, and a reference that could name a path outside the cache is refused however it got there.
pub fn read_spec(state_dir: &Path, id: &str) -> Option<MachineSpec> {
    let body = fs::read(machine_dir(state_dir, id)?.join(SPEC_FILE)).ok()?;
    let spec: MachineSpec = serde_json::from_slice(&body).ok()?;
    if !spec.image.is_empty() && !is_image_ref(&spec.image) {
        return None;
    }
    if spec.image.contains("..") {
        return None;
    }
    Some(spec)
}

// UNIT_BOUNDARY_DESCRIPTION: whether a reference is one a cache entry can be named after. Hand-written against the Go pattern and pinned to it by a test. The `..` a caller might hide in a reference is refused separately, by the reader, because this pattern admits the dots a tag legitimately carries.
pub fn is_image_ref(image: &str) -> bool {
    let mut chars = image.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() || image.chars().count() > 255 {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | ':' | '@' | '-'))
}

// UNIT_BOUNDARY_DESCRIPTION: records what a machine was created with. The running flag is cleared first, deliberately: this file says what shape the machine has, never whether it should be up, and a runner that restarted and believed a stale flag would start machines an owner had stopped. The registry credential is cleared too: it is sent only so that the image can be fetched, and a stored copy would keep a credential on the state volume for as long as the machine exists.
// UNIT_BOUNDARY_DESCRIPTION: written 0600, which is the one restrictive mode the Go runner uses anywhere, and the reason is inside the file: a spec's env carries the values of the Agent's secretRef Secret, copied in whole by the controller, so this is the only piece of machine state holding secret material in plaintext. An ordinary write takes the process umask and lands 0644 — what every other file here is, and a leak in this one. The mode is set on an existing file too, where the Go runner leaves whatever it finds: the one place this port is deliberately stricter than what it copies, because a mode is not a protocol between the two runners and no reader is worse off for it being tighter.
pub fn write_spec(state_dir: &Path, id: &str, spec: &MachineSpec) -> anyhow::Result<()> {
    let dir =
        machine_dir(state_dir, id).ok_or_else(|| anyhow::anyhow!("invalid machine id {id:?}"))?;
    let mut stored = spec.clone();
    stored.running = false;
    stored.pull_auth.clear();
    files::write(
        &dir.join(SPEC_FILE),
        &serde_json::to_vec(&stored)?,
        SPEC_MODE,
    )?;
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the port a machine is published on, or zero for one that has none. Zero rather than an error because every caller treats an unreadable port as a machine that has not been given one, and the allocator counts on that to leave it free.
pub fn port(state_dir: &Path, id: &str) -> u16 {
    let Some(dir) = machine_dir(state_dir, id) else {
        return 0;
    };
    fs::read_to_string(dir.join(PORT_FILE))
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0)
}

// UNIT_BOUNDARY_DESCRIPTION: gives a machine a port from the runner's range and writes it down, or returns the one it already has. Which ports are taken is read from the other machines' files rather than from memory, for the same reason as everything else here: the runner is restarted and they are not, and one that allocated from an empty memory would publish two machines on one port.
// UNIT_BOUNDARY_DESCRIPTION: the caller must hold a lock across this, and this function cannot check that it does. Reading which ports are taken and writing the chosen one are two steps, so two allocations that interleave choose the same free port and both write it — two machines published on one port, and the second one unreachable. The Go runner holds the runner-wide mutex around the whole of allocatePort; the layer that owns that lock is not ported yet, which is the only reason this is safe today: nothing but a test calls it.
// UNIT_BOUNDARY_DESCRIPTION: the machine's directory has to exist already, as it does for the Go runner — `ensure` writes the share first, and that is what creates it. Creating it here instead would let a caller that never set the machine up leave a directory behind that `machine_ids` reads as a machine and the allocator counts, holding a port for something that does not exist.
pub fn allocate_port(
    state_dir: &Path,
    id: &str,
    range: std::ops::RangeInclusive<u16>,
) -> anyhow::Result<u16> {
    if let existing @ 1.. = port(state_dir, id) {
        return Ok(existing);
    }
    let dir =
        machine_dir(state_dir, id).ok_or_else(|| anyhow::anyhow!("invalid machine id {id:?}"))?;
    let taken: BTreeSet<u16> = machine_ids(state_dir)
        .unwrap_or_default()
        .iter()
        .map(|other| port(state_dir, other))
        .collect();
    let free = range
        .into_iter()
        .find(|candidate| !taken.contains(candidate))
        .ok_or_else(|| anyhow::anyhow!("no free machine port"))?;
    files::write(&dir.join(PORT_FILE), free.to_string().as_bytes(), PORT_MODE)?;
    Ok(free)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;
    use std::os::unix::fs::PermissionsExt;

    // TEST_SCENARIO: this module and the Go runner read and write one state directory, and a rollout that replaces one with the other runs both against it. A file named differently is a machine the new runner cannot see — which it would then recreate, on a port it believes free, over a disk another machine is using. Each name is read out of the call that writes it, and each mode out of the body of the function that writes it, rather than looked for anywhere in the file: `server.go` holds other strings and other modes, and a guard that would be satisfied by an unrelated one somewhere else is not the guard its failure message claims to be.
    #[test]
    fn the_go_runner_writes_the_same_files_with_the_same_modes() {
        let go = gosource::read("server.go");

        let spec = gosource::call_args_in(&go, "(s *Server) writeSpec", "os.WriteFile(")
            .expect("server.go still writes a machine's spec");
        assert!(
            spec.contains(&format!("\"{SPEC_FILE}\"")),
            "writeSpec no longer writes {SPEC_FILE}, so the two runners no longer read one machine's spec: {spec}"
        );

        let port = gosource::call_args_in(&go, "(s *Server) allocatePort", "os.WriteFile(")
            .expect("server.go still writes a machine's port");
        assert!(
            port.contains(&format!("\"{PORT_FILE}\"")),
            "allocatePort no longer writes {PORT_FILE}, so the two runners no longer agree where a machine is published: {port}"
        );

        let writes_spec = gosource::function_body(&go, "(s *Server) writeSpec")
            .expect("server.go still has a writeSpec");
        assert!(
            writes_spec.contains(&format!("\"{SPEC_FILE}\"), b, 0o{:o})", SPEC_MODE)),
            "writeSpec no longer writes the spec {SPEC_MODE:o}, which is the one file here holding the Agent's secrets: {writes_spec}"
        );

        let allocates_port = gosource::function_body(&go, "(s *Server) allocatePort")
            .expect("server.go still has an allocatePort");
        assert!(
            allocates_port.contains(&format!(
                "\"{PORT_FILE}\"), []byte(strconv.Itoa(p)), 0o{:o})",
                PORT_MODE
            )),
            "allocatePort no longer writes the port file {PORT_MODE:o}: {allocates_port}"
        );
    }

    // TEST_SCENARIO: a machine's recorded digest is what keeps its tree held once its tag has moved, and a rollout runs both runners over one state directory. A record named differently is a machine the other runner reads as holding nothing under the digest root, so it evicts that machine's rootfs.
    #[test]
    fn the_go_runner_records_a_machines_digest_under_the_same_name() {
        let go = gosource::read("digest.go");
        assert_eq!(
            gosource::const_value(&go, "imageDigestFile").as_deref(),
            Some(IMAGE_DIGEST_FILE)
        );
    }

    // TEST_SCENARIO: the modes this module writes with, checked on the files themselves rather than trusted to the constants. Both go through the shared writer, which states the mode instead of taking the umask — so an install with a tighter umask writes the same state directory as one with the usual umask, and as the Go runner.
    #[test]
    fn a_machines_state_is_written_with_the_modes_the_go_runner_states() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path().join("agent-a")).unwrap();

        write_spec(dir.path(), "agent-a", &MachineSpec::default()).unwrap();
        allocate_port(dir.path(), "agent-a", 31000..=31000).unwrap();

        let mode_of = |name: &str| {
            fs::metadata(dir.path().join("agent-a").join(name))
                .unwrap()
                .permissions()
                .mode()
                & 0o777
        };
        assert_eq!(mode_of(SPEC_FILE), SPEC_MODE);
        assert_eq!(mode_of(PORT_FILE), PORT_MODE);
    }

    // TEST_SCENARIO: both matchers here are hand-written, which is only safe while the patterns they were written against are still the patterns in force. The machine id one is the guard that keeps a caller-supplied name from escaping the state directory, so a widened pattern is a path traversal and not a cosmetic change.
    #[test]
    fn the_patterns_are_the_ones_these_matchers_were_written_against() {
        let go = gosource::read("server.go");
        assert_eq!(
            gosource::regexp_source(&go, "machineID").as_deref(),
            Some(r"^[a-z0-9][a-z0-9-]{0,62}$"),
            "is_machine_id is hand-written against this and has to be rewritten with it"
        );
        assert_eq!(
            gosource::regexp_source(&go, "imageRef").as_deref(),
            Some(r"^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$"),
            "is_image_ref likewise"
        );
    }

    // TEST_SCENARIO: a machine directory is the state directory joined to a name the caller chose, so the name is the only thing between a request and the rest of the filesystem. Every shape that could leave the directory is refused, and the ordinary ones are not.
    #[test]
    fn a_name_that_could_leave_the_state_directory_is_refused() {
        assert!(is_machine_id("agent-a"));
        assert!(is_machine_id("a"));
        assert!(is_machine_id("0"));
        assert!(is_machine_id(&"a".repeat(63)));

        assert!(!is_machine_id(""));
        assert!(!is_machine_id(&"a".repeat(64)), "the pattern caps at 63");
        assert!(!is_machine_id(".."), "the one that matters most");
        assert!(!is_machine_id("../escape"));
        assert!(!is_machine_id("has/slash"));
        assert!(!is_machine_id("Agent"), "upper case is not in the pattern");
        assert!(!is_machine_id("-leading"));
        assert!(!is_machine_id("has_underscore"));

        assert_eq!(machine_dir(Path::new("/state"), ".."), None);
        assert_eq!(
            machine_dir(Path::new("/state"), "agent-a"),
            Some(PathBuf::from("/state/agent-a"))
        );
    }

    // TEST_SCENARIO: a spec is read back by a later process, possibly a later release, so it is checked on the way out and not only on the way in. A reference that could name something outside the cache is refused however it came to be on disk — the file is as untrusted as the request that made it.
    #[test]
    fn a_spec_naming_an_image_that_could_escape_the_cache_does_not_read_back() {
        let dir = TempDir::new();
        let state = dir.path();
        fs::create_dir_all(state.join("agent-a")).unwrap();

        let write = |image: &str| {
            let spec = MachineSpec {
                image: image.to_string(),
                ..Default::default()
            };
            fs::write(
                state.join("agent-a").join(SPEC_FILE),
                serde_json::to_vec(&spec).unwrap(),
            )
            .unwrap();
        };

        write("quay.io/x/vm:1");
        assert_eq!(read_spec(state, "agent-a").unwrap().image, "quay.io/x/vm:1");

        write("../../etc/passwd");
        assert!(
            read_spec(state, "agent-a").is_none(),
            "a traversal in the reference"
        );

        write("quay.io/x/../../../vm:1");
        assert!(
            read_spec(state, "agent-a").is_none(),
            "and one buried inside a plausible one"
        );

        write("has space");
        assert!(read_spec(state, "agent-a").is_none());

        fs::write(state.join("agent-a").join(SPEC_FILE), b"not json").unwrap();
        assert!(read_spec(state, "agent-a").is_none());
    }

    // TEST_SCENARIO: a spec's env carries the values of the Agent's secretRef Secret, which the controller copies in whole, so this file holds secret material in plaintext — and it is the only piece of machine state that does. An ordinary write takes the process umask and lands world-readable, which is what every other file here is and what this one must not be. The Go runner writes it 0600 and writes nothing else in the package that way; the mode is asserted rather than assumed, because nothing downstream would notice it drifting.
    #[test]
    fn the_spec_is_not_readable_by_anyone_but_the_runner() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path().join("agent-a")).unwrap();

        write_spec(
            dir.path(),
            "agent-a",
            &MachineSpec {
                image: "quay.io/x/vm:1".into(),
                env: [("ANTHROPIC_API_KEY".to_string(), "sk-secret".to_string())]
                    .into_iter()
                    .collect(),
                ..Default::default()
            },
        )
        .unwrap();

        let mode = fs::metadata(dir.path().join("agent-a").join(SPEC_FILE))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(
            mode, 0o600,
            "the machine's secrets are readable by every uid on the node"
        );
    }

    // TEST_SCENARIO: a spec left behind by an earlier release, or by anything else, is rewritten with the mode it should have had. The Go runner leaves an existing file's mode alone, which is the one place this port is stricter than what it copies — a tighter mode breaks no reader, and this file holds secrets.
    #[test]
    fn a_spec_that_was_already_world_readable_is_tightened_on_the_next_write() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path().join("agent-a")).unwrap();
        let path = dir.path().join("agent-a").join(SPEC_FILE);
        fs::write(&path, b"{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        write_spec(dir.path(), "agent-a", &MachineSpec::default()).unwrap();

        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600,
            "a spec that was already loose stayed loose"
        );
    }

    // TEST_SCENARIO: the stored spec says what shape a machine has, never whether it should be up. A runner restarting reads these files to learn what it is running, and one that believed a stale running flag would start machines their owner had stopped.
    #[test]
    fn a_stored_spec_never_says_the_machine_should_be_running() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path().join("agent-a")).unwrap();

        write_spec(
            dir.path(),
            "agent-a",
            &MachineSpec {
                image: "quay.io/x/vm:1".into(),
                memory_mib: 2048,
                running: true,
                ..Default::default()
            },
        )
        .unwrap();

        let read = read_spec(dir.path(), "agent-a").unwrap();
        assert!(
            !read.running,
            "the running flag was stored and would outlive the intent that set it"
        );
        assert_eq!(
            read.memory_mib, 2048,
            "while the shape is what the file is for"
        );
    }

    // TEST_SCENARIO: the controller sends the machine's registry credential on every spec, so that the runner can fetch a private image. The credential is for the fetch only. A stored spec that kept it would put a registry credential on the state volume for as long as the machine exists, and the Go runner clears it in writeSpec for the same reason.
    #[test]
    fn a_stored_spec_never_keeps_the_registry_credential() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path().join("agent-a")).unwrap();

        write_spec(
            dir.path(),
            "agent-a",
            &MachineSpec {
                image: "quay.io/x/vm:1".into(),
                pull_auth: "{\"auths\":{\"quay.io\":{\"auth\":\"c2VjcmV0\"}}}".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let body = fs::read_to_string(dir.path().join("agent-a").join(SPEC_FILE)).unwrap();
        assert!(
            !body.contains("c2VjcmV0") && !body.contains("pullAuth"),
            "the registry credential was stored with the spec: {body}"
        );
        let go = gosource::read("server.go");
        let writes_spec = gosource::function_body(&go, "(s *Server) writeSpec")
            .expect("server.go still has a writeSpec");
        assert!(
            writes_spec.contains("spec.PullAuth = \"\""),
            "the Go runner no longer clears the credential before it stores a spec: {writes_spec}"
        );
    }

    // TEST_SCENARIO: ports are allocated from what the other machines' files say, not from memory, because the runner is restarted and the machines are not. A machine that already has one keeps it — a restart that reassigned ports would publish a machine somewhere its controller is not looking.
    #[test]
    fn a_port_is_allocated_around_the_ones_on_disk_and_never_reassigned() {
        let dir = TempDir::new();
        let state = dir.path();
        for id in ["agent-a", "agent-b"] {
            fs::create_dir_all(state.join(id)).unwrap();
        }

        let first = allocate_port(state, "agent-a", 31000..=31001).unwrap();
        let second = allocate_port(state, "agent-b", 31000..=31001).unwrap();
        assert_eq!(
            (first, second),
            (31000, 31001),
            "each machine gets one of the range"
        );

        assert_eq!(
            allocate_port(state, "agent-a", 31000..=31001).unwrap(),
            31000,
            "a machine that has a port keeps it rather than being moved"
        );

        fs::create_dir_all(state.join("agent-c")).unwrap();
        assert!(
            allocate_port(state, "agent-c", 31000..=31001).is_err(),
            "a full range is refused rather than doubling up on a published port"
        );
    }

    // TEST_SCENARIO: a port belongs to a machine that exists. The Go runner writes the share before it ever allocates, so the directory is always there by then; a port file written into a directory this function had created itself would leave something `machine_ids` reads as a machine — holding a port, counted by the allocator, with no spec and no share behind it.
    #[test]
    fn a_machine_that_was_never_set_up_gets_no_port_and_no_directory() {
        let dir = TempDir::new();

        assert!(
            allocate_port(dir.path(), "agent-a", 31000..=31001).is_err(),
            "a port was allocated for a machine that does not exist"
        );
        assert!(
            !dir.path().join("agent-a").exists(),
            "and the allocation invented the machine's directory"
        );
        assert!(machine_ids(dir.path()).unwrap().is_empty());
    }

    // TEST_SCENARIO: a runner reads its machines off the disk, so whatever else is in the state directory must not read as one. That includes the names it would itself refuse, which is what stops a stray directory becoming a machine nothing can address.
    #[test]
    fn only_directories_named_like_machines_read_as_machines() {
        let dir = TempDir::new();
        let state = dir.path();
        fs::create_dir_all(state.join("agent-a")).unwrap();
        fs::create_dir_all(state.join("Not-A-Machine")).unwrap();
        fs::write(state.join("agent-b"), "a file, not a machine").unwrap();

        assert_eq!(
            machine_ids(state).unwrap(),
            ["agent-a".to_string()].into_iter().collect::<BTreeSet<_>>()
        );

        assert!(
            machine_ids(&state.join("never-created"))
                .unwrap()
                .is_empty(),
            "a runner that has made no machine yet has none, rather than failing to say"
        );
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "vm-runner-state-{}-{:?}",
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
