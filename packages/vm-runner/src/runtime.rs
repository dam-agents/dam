use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::api::{ImageLaunch, MachineSpec};
use crate::guest::INIT_PATH;

// UNIT_BOUNDARY_DESCRIPTION: what the runner asks of the hypervisor, and the rules that do not depend on which one answers. The server plans machines against this trait, so it can be tested without KVM against a fake, and the embedded smolvm implementation is the only code that talks to the VMM. Everything here is the Go runner's `Smolvm` type restated: how a machine's workload is assembled, how its env is updated, when its disk grows, and how a VMM that outlived its stop is found and taken down.
pub trait Runtime: Send + Sync {
    // UNIT_BOUNDARY_DESCRIPTION: one of the api states `absent`, `stopped` or `running`. Only those three: whether an operation is in flight is the server's knowledge, not the hypervisor's.
    fn state(&self, id: &str) -> anyhow::Result<&'static str>;
    fn create(&self, id: &str, machine: &Machine<'_>) -> anyhow::Result<()>;
    // UNIT_BOUNDARY_DESCRIPTION: applies a new size and env to a stopped machine. `applied` is the spec the machine was last written with, which is what says which env keys the controller has since dropped and whether the disk has to grow.
    fn update(
        &self,
        id: &str,
        desired: &MachineSpec,
        applied: Option<&MachineSpec>,
    ) -> anyhow::Result<()>;
    fn start(&self, id: &str) -> anyhow::Result<()>;
    fn stop(&self, id: &str) -> anyhow::Result<()>;
    fn delete(&self, id: &str) -> anyhow::Result<()>;
    // UNIT_BOUNDARY_DESCRIPTION: whether the machine's storage disk can be grown. A disk the Go runner made at smolvm's default size is a qcow2 overlay over the shipped template, and neither smolvm nor this runner can grow one — so a larger size is refused before the machine is touched, rather than recorded and never applied.
    fn storage_growable(&self, _id: &str) -> bool {
        true
    }
}

// UNIT_BOUNDARY_DESCRIPTION: everything a create needs beyond the spec. `image` is what the machine boots: an unpacked cache tree or a cached archive, both absolute paths, or a registry reference when neither exists. `share` is the host directory the guest mounts read-only at the share path, and `host_port` the loopback port the guest's agent port is published on.
pub struct Machine<'a> {
    pub spec: &'a MachineSpec,
    pub image: &'a str,
    pub host_port: u16,
    pub share: &'a Path,
    pub launch: Option<&'a ImageLaunch>,
}

// UNIT_BOUNDARY_DESCRIPTION: the port the guest's agent listens on. The runner publishes it on a loopback port of its own and forwards the machine's published port there.
pub const GUEST_AGENT_PORT: u16 = 8080;

// UNIT_BOUNDARY_DESCRIPTION: the largest image archive a machine may boot from. smolvm refuses archives over 8 GiB by default, and agent images with their toolchains are bigger than that.
pub const MAX_IMAGE_BYTES: u64 = 16 << 30;

// UNIT_BOUNDARY_DESCRIPTION: how long a stopped machine's VMM may keep its disks. Long enough for the guest to checkpoint its journal and let go, short enough that a VMM which will never exit is killed rather than waited on.
pub const VMM_EXIT_WAIT: Duration = Duration::from_secs(10);

// UNIT_BOUNDARY_DESCRIPTION: the duration past which an operation is logged as slow. A create is tens of milliseconds and a start under a second, so only the operations worth reading reach the warning.
pub const SLOW_OP: Duration = Duration::from_secs(2);

pub const IMAGE_LAUNCH_UNKNOWN: &str =
    "this image names no entrypoint, so a machine would boot to a filesystem with nothing running in it";

// UNIT_BOUNDARY_DESCRIPTION: the files a VMM leaves in a machine's directory while it runs. A start removes them once the old VMM is gone, because a socket or lock left by a VMM that died with its runner makes the next boot believe the machine is still up.
pub const STALE_RUNTIME_FILES: [&str; 5] = [
    "agent.ready",
    "agent.sock",
    "control.sock",
    "vm.lock",
    "agent.pid",
];

// UNIT_BOUNDARY_DESCRIPTION: the machine's root overlay in both of the forms smolvm writes it — a qcow2 over the shipped template, or a raw disk whenever smolvm cannot overlay the template — and the marker that says it was formatted. All three go, so the next boot formats a fresh root whichever form this one had.
pub const OVERLAY_FILES: [&str; 3] = ["overlay.qcow2", "overlay.raw", "overlay.formatted"];

// UNIT_BOUNDARY_DESCRIPTION: what the guest runs and with what, as the create hands it to smolvm.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workload {
    pub env: Vec<(String, String)>,
    pub workdir: Option<String>,
    pub command: Vec<String>,
}

// UNIT_BOUNDARY_DESCRIPTION: the guest's command and environment. platform-init runs first and execs the image's own entrypoint, so the image's entrypoint, command, env and working directory all come from its launch record. The platform's env wins over the image's, because it is what makes the guest an agent. The env is sorted by key so two creates of one spec write one record.
pub fn workload(spec: &MachineSpec, launch: Option<&ImageLaunch>) -> anyhow::Result<Workload> {
    let Some(launch) = launch else {
        anyhow::bail!(IMAGE_LAUNCH_UNKNOWN);
    };
    let mut env: BTreeMap<String, String> = launch
        .env
        .iter()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    env.extend(spec.env.iter().map(|(k, v)| (k.clone(), v.clone())));
    let image_command: Vec<String> = launch
        .entrypoint
        .iter()
        .chain(&launch.cmd)
        .cloned()
        .collect();
    if image_command.is_empty() {
        anyhow::bail!(IMAGE_LAUNCH_UNKNOWN);
    }
    let mut command = vec![INIT_PATH.to_string()];
    command.extend(image_command);
    Ok(Workload {
        env: env.into_iter().collect(),
        workdir: (!launch.working_dir.is_empty()).then(|| launch.working_dir.clone()),
        command,
    })
}

// UNIT_BOUNDARY_DESCRIPTION: a stopped machine's env after an update. Keys the controller has dropped since the last write are removed, and every key it sends is set. Keys that only the image named are kept, because the controller never sent them and so never dropped them.
pub fn updated_env(
    current: &[(String, String)],
    applied: Option<&MachineSpec>,
    desired: &MachineSpec,
) -> Vec<(String, String)> {
    let mut env: BTreeMap<String, String> = current.iter().cloned().collect();
    if let Some(applied) = applied {
        for key in applied.env.keys() {
            if !desired.env.contains_key(key) {
                env.remove(key);
            }
        }
    }
    env.extend(desired.env.iter().map(|(k, v)| (k.clone(), v.clone())));
    env.into_iter().collect()
}

// UNIT_BOUNDARY_DESCRIPTION: the size the storage disk grows to, or nothing. A disk can grow and cannot shrink, so a smaller request leaves it alone. With no applied spec there is nothing known to grow from.
pub fn grown_storage(applied: Option<&MachineSpec>, desired: &MachineSpec) -> Option<u64> {
    if applied?.storage_gib < desired.storage_gib {
        u64::try_from(desired.storage_gib).ok()
    } else {
        None
    }
}

// UNIT_BOUNDARY_DESCRIPTION: removes the Agent's secret values from text that may reach the Agent's status or a log line. Values of three characters or fewer are left alone: replacing them would mangle ordinary words and hide nothing.
pub fn redact<'a>(text: &str, secrets: impl IntoIterator<Item = &'a str>) -> String {
    let mut out = text.to_string();
    for secret in secrets {
        if secret.len() > 3 {
            out = out.replace(secret, "***");
        }
    }
    out
}

// UNIT_BOUNDARY_DESCRIPTION: the processes still holding a machine's directory. Every VMM smolvm spawns names its machine's directory on its command line, so this finds a VMM a previous runner process left behind as well as one of ours. The trailing slash keeps a machine from matching another whose directory name it prefixes.
pub fn orphan_pids(proc_root: &Path, vm_dir: &Path) -> Vec<i32> {
    let dir = vm_dir.to_string_lossy();
    if dir.is_empty() {
        return Vec::new();
    }
    let needle = format!("{dir}/");
    let Ok(entries) = fs::read_dir(proc_root) else {
        return Vec::new();
    };
    let mut pids: Vec<i32> = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let pid: i32 = e.file_name().to_str()?.parse().ok()?;
            let cmdline = fs::read(e.path().join("cmdline")).ok()?;
            String::from_utf8_lossy(&cmdline)
                .contains(&needle)
                .then_some(pid)
        })
        .collect();
    pids.sort_unstable();
    pids
}

// UNIT_BOUNDARY_DESCRIPTION: waits until no VMM holds the machine's directory, up to `limit`. A stop returns as soon as the guest is asked to go, and a start issued while the old VMM still holds the disks is refused in a way that looks like a machine that can never start. A machine that is really stopped answers at once.
pub fn vmm_gone(proc_root: &Path, vm_dir: &Path, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    while !orphan_pids(proc_root, vm_dir).is_empty() {
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    true
}

pub fn kill_orphans(proc_root: &Path, vm_dir: &Path) {
    for pid in orphan_pids(proc_root, vm_dir) {
        // SAFETY: kill(2) takes no pointers; a pid that has already exited returns ESRCH, which is ignored.
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: throws away the machine's root overlay. A machine keeps HOME and nothing else, and this is what makes that rule exact: a kept overlay would make software installed outside HOME look persistent until the first boot that had to discard a corrupt one. It runs after a stop and again before a start, because a machine that died with its runner never got the stop. Nothing is removed while a VMM still holds the disks.
pub fn discard_overlay(id: &str, proc_root: &Path, vm_dir: &Path) {
    if !vm_dir.is_dir() {
        return;
    }
    if !vmm_gone(proc_root, vm_dir, VMM_EXIT_WAIT) {
        tracing::warn!(
            machine = id,
            "machine still has a VMM holding its disks; leaving the root overlay in place"
        );
        return;
    }
    for file in OVERLAY_FILES {
        match fs::remove_file(vm_dir.join(file)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                tracing::warn!(machine = id, file, error = %e, "could not discard the root overlay")
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: prepares a machine's directory for a fresh boot: any VMM still holding it is waited out and then killed, the files a dead VMM leaves are removed, and the overlay is discarded.
pub fn clear_for_start(id: &str, proc_root: &Path, vm_dir: &Path) {
    if !vm_dir.is_dir() {
        return;
    }
    if !vmm_gone(proc_root, vm_dir, VMM_EXIT_WAIT) {
        kill_orphans(proc_root, vm_dir);
        let _ = vmm_gone(proc_root, vm_dir, Duration::from_secs(1));
    }
    for file in STALE_RUNTIME_FILES {
        let _ = fs::remove_file(vm_dir.join(file));
    }
    discard_overlay(id, proc_root, vm_dir);
}

// UNIT_BOUNDARY_DESCRIPTION: runs one machine operation and logs it with its duration: info for every operation, a warning when it was slow or failed. The error is redacted because an operator's Secret reaches the guest through the env, and smolvm's own errors may echo the record they were given.
pub fn timed<T>(
    op: &str,
    id: &str,
    secrets: &[&str],
    run: impl FnOnce() -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let started = Instant::now();
    let result = run();
    let elapsed = started.elapsed();
    let duration_ms = u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX);
    match result {
        Ok(value) => {
            if elapsed > SLOW_OP {
                tracing::warn!(op, machine = id, duration_ms, "machine operation was slow");
            } else {
                tracing::info!(op, machine = id, duration_ms, "machine operation");
            }
            Ok(value)
        }
        Err(e) => {
            tracing::warn!(op, machine = id, duration_ms, "machine operation failed");
            let message = redact(&format!("{e:#}"), secrets.iter().copied());
            Err(anyhow::anyhow!("smolvm machine {op}: {message}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;
    use std::path::PathBuf;

    fn spec_with_env(env: &[(&str, &str)]) -> MachineSpec {
        MachineSpec {
            image: "quay.io/x/vm:1".into(),
            cpus: 2,
            memory_mib: 2048,
            storage_gib: 10,
            env: env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            running: true,
            ..MachineSpec::default()
        }
    }

    fn launch(entrypoint: &[&str], cmd: &[&str], env: &[&str], workdir: &str) -> ImageLaunch {
        ImageLaunch {
            entrypoint: entrypoint.iter().map(|s| s.to_string()).collect(),
            cmd: cmd.iter().map(|s| s.to_string()).collect(),
            env: env.iter().map(|s| s.to_string()).collect(),
            working_dir: workdir.into(),
        }
    }

    // TEST_SCENARIO: platform-init has to be the machine's entrypoint on every boot, or the agent's home is never mounted and its work is lost at the first stop. It runs first and execs what the image names — entrypoint then command — from the working directory the image names.
    #[test]
    fn platform_init_runs_first_and_hands_off_to_what_the_image_names() {
        let w = workload(
            &spec_with_env(&[]),
            Some(&launch(&["/entry", "-x"], &["serve"], &[], "/app")),
        )
        .unwrap();
        assert_eq!(w.command, vec![INIT_PATH, "/entry", "-x", "serve"]);
        assert_eq!(w.workdir.as_deref(), Some("/app"));

        let bare = workload(&spec_with_env(&[]), Some(&launch(&[], &["run"], &[], ""))).unwrap();
        assert_eq!(bare.command, vec![INIT_PATH, "run"]);
        assert_eq!(
            bare.workdir, None,
            "an image with no working directory states none"
        );
    }

    // TEST_SCENARIO: the image's env and the platform's env are merged before either reaches smolvm, so which one wins is decided here and not by the order smolvm applies them. The platform's wins: HOME, the proxy and the backend marker are what make the guest an agent.
    #[test]
    fn the_platforms_env_wins_over_the_images() {
        let w = workload(
            &spec_with_env(&[("HOME", "/home/agent"), ("PLATFORM_BACKEND", "vm")]),
            Some(&launch(
                &["/entry"],
                &[],
                &["HOME=/root", "PATH=/usr/bin", "NOEQUALS"],
                "",
            )),
        )
        .unwrap();
        assert_eq!(
            w.env,
            vec![
                ("HOME".to_string(), "/home/agent".to_string()),
                ("PATH".to_string(), "/usr/bin".to_string()),
                ("PLATFORM_BACKEND".to_string(), "vm".to_string()),
            ]
        );
    }

    // TEST_SCENARIO: a machine whose image names nothing to run would boot and wait for an exec that never comes, with nothing saying why. It is refused instead, in the Go runner's words, whether the launch is missing or empty.
    #[test]
    fn a_machine_with_nothing_to_run_is_refused_in_the_go_runners_words() {
        let go = gosource::read("smolvm.go");
        let theirs = go
            .lines()
            .find_map(|line| {
                line.strip_prefix("var errImageLaunchUnknown = errors.New(")?
                    .strip_suffix(')')
                    .and_then(gosource::unquote)
            })
            .expect("smolvm.go still names errImageLaunchUnknown");
        assert_eq!(IMAGE_LAUNCH_UNKNOWN, theirs);

        let none = workload(&spec_with_env(&[]), None).unwrap_err().to_string();
        let empty = workload(&spec_with_env(&[]), Some(&launch(&[], &[], &["A=b"], "/")))
            .unwrap_err()
            .to_string();
        assert_eq!(none, IMAGE_LAUNCH_UNKNOWN);
        assert_eq!(empty, IMAGE_LAUNCH_UNKNOWN);
    }

    // TEST_SCENARIO: an update must drop what the controller stopped sending, or a Secret key removed from an Agent stays in its guest forever. It must also keep what only the image set, which the controller never sent and so never removed.
    #[test]
    fn an_update_drops_keys_the_controller_removed_and_keeps_the_images() {
        let current = vec![
            ("OLD".to_string(), "gone".to_string()),
            ("PATH".to_string(), "/usr/bin".to_string()),
            ("TOKEN".to_string(), "v1".to_string()),
        ];
        let applied = spec_with_env(&[("OLD", "gone"), ("TOKEN", "v1")]);
        let desired = spec_with_env(&[("TOKEN", "v2"), ("NEW", "x")]);
        assert_eq!(
            updated_env(&current, Some(&applied), &desired),
            vec![
                ("NEW".to_string(), "x".to_string()),
                ("PATH".to_string(), "/usr/bin".to_string()),
                ("TOKEN".to_string(), "v2".to_string()),
            ]
        );
        assert_eq!(
            updated_env(&current, None, &desired).len(),
            4,
            "with no applied spec nothing is known to have been dropped"
        );
    }

    // TEST_SCENARIO: a disk can grow and cannot shrink, so an update names a storage size only when the request is larger than what the machine has. Anything else would either fail the update or, worse, look like a shrink that silently did nothing.
    #[test]
    fn storage_grows_only_when_asked_for_more() {
        let mut applied = spec_with_env(&[]);
        let mut desired = spec_with_env(&[]);
        applied.storage_gib = 10;
        desired.storage_gib = 20;
        assert_eq!(grown_storage(Some(&applied), &desired), Some(20));
        desired.storage_gib = 10;
        assert_eq!(grown_storage(Some(&applied), &desired), None);
        desired.storage_gib = 5;
        assert_eq!(grown_storage(Some(&applied), &desired), None);
        assert_eq!(grown_storage(None, &desired), None);
    }

    // TEST_SCENARIO: an operator's Secret reaches the guest through the env, and a failure's text reaches the Agent's status. Every value long enough to mean something is replaced; a short one is left, since replacing `on` would mangle the sentence and hide nothing.
    #[test]
    fn secret_values_are_removed_from_failures() {
        assert_eq!(
            redact("token hunter2 rejected on port", ["hunter2", "on"]),
            "token *** rejected on port"
        );
        let go = gosource::read("smolvm.go");
        assert!(
            gosource::function_body(&go, "redact")
                .expect("smolvm.go still redacts")
                .contains("len(v) > 3"),
            "the Go runner no longer skips the same short values"
        );
    }

    // TEST_SCENARIO: a machine's VMM is found by its directory on the command line. Of three processes only the one naming this machine's directory is its VMM — not one for a machine whose directory name merely starts the same way, and not the runner itself.
    #[test]
    fn a_vmm_is_found_by_its_machines_directory_and_no_other() {
        let proc = TempDir::new("orphans");
        let dir = PathBuf::from("/home/smolvm/.cache/smolvm/vms/abc123");
        proc.process(
            100,
            "/proc/self/exe\0_boot-vm\0/home/smolvm/.cache/smolvm/vms/abc123/boot-config.json",
        );
        proc.process(
            101,
            "/proc/self/exe\0_boot-vm\0/home/smolvm/.cache/smolvm/vms/abc1234/boot-config.json",
        );
        fs::create_dir_all(proc.path().join("self")).unwrap();
        fs::write(proc.path().join("self/cmdline"), "vm-runner").unwrap();

        assert_eq!(orphan_pids(proc.path(), &dir), vec![100]);
        assert!(orphan_pids(proc.path(), Path::new("")).is_empty());
    }

    // TEST_SCENARIO: a start issued while the previous VMM still holds the disks is refused, which looks exactly like a machine that can never start. The wait is what breaks that, and a machine that is really stopped must not pay for it — both halves are asserted, since a wait that always returned true would pass the second alone.
    #[test]
    fn a_start_waits_for_the_vmm_its_stop_left_behind() {
        let proc = TempDir::new("gone");
        let dir = PathBuf::from("/home/smolvm/.cache/smolvm/vms/abc123");
        proc.process(
            100,
            "/proc/self/exe\0_boot-vm\0/home/smolvm/.cache/smolvm/vms/abc123/boot-config.json",
        );

        let started = Instant::now();
        assert!(!vmm_gone(proc.path(), &dir, Duration::from_millis(150)));
        assert!(started.elapsed() >= Duration::from_millis(150));

        fs::remove_dir_all(proc.path().join("100")).unwrap();
        let started = Instant::now();
        assert!(vmm_gone(proc.path(), &dir, Duration::from_secs(10)));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    // TEST_SCENARIO: the root overlay is discarded in whichever form smolvm wrote it, and only once no VMM holds it. The storage disk, which is the agent's home, is never touched.
    #[test]
    fn the_overlay_goes_and_the_storage_disk_stays() {
        let proc = TempDir::new("discard-proc");
        let vm = TempDir::new("discard-vm");
        for file in OVERLAY_FILES.iter().chain(&["storage.raw"]) {
            fs::write(vm.path().join(file), "x").unwrap();
        }
        discard_overlay("m1", proc.path(), vm.path());
        for file in OVERLAY_FILES {
            assert!(
                !vm.path().join(file).exists(),
                "{file} survived the discard"
            );
        }
        assert!(
            vm.path().join("storage.raw").exists(),
            "the agent's disk was discarded"
        );
    }

    // TEST_SCENARIO: the Go runner and this one share a machine's directory during the cutover, so both must clear the same files before a boot and discard the same overlay. The Rust side is a superset only where the Go side is fixed in the same change.
    #[test]
    fn the_go_runner_clears_the_same_files() {
        let go = gosource::read("smolvm.go");
        let start = gosource::literals_in(&go, "(r *Smolvm) Start");
        for file in STALE_RUNTIME_FILES {
            assert!(
                start.iter().any(|l| l == file),
                "the Go runner no longer clears {file}"
            );
        }
        assert_eq!(
            start.iter().filter(|l| l.contains('.')).count(),
            STALE_RUNTIME_FILES.len(),
            "the Go runner clears a file this runner does not"
        );

        let discard = gosource::literals_in(&go, "discardOverlay");
        for file in OVERLAY_FILES {
            assert!(
                discard.iter().any(|l| l == file),
                "the Go runner no longer discards {file}"
            );
        }
        assert_eq!(
            discard.iter().filter(|l| l.starts_with("overlay.")).count(),
            OVERLAY_FILES.len()
        );
    }

    // TEST_SCENARIO: the windows and sizes both runners work to. A VMM waited on for a different time, or an archive cap that differs, is one runner refusing what the other accepts.
    #[test]
    fn the_go_runner_waits_and_caps_the_same() {
        let go = gosource::read("smolvm.go");
        assert_eq!(
            gosource::duration_value(&go, "vmmExitWait"),
            Some(VMM_EXIT_WAIT)
        );
        assert_eq!(gosource::duration_value(&go, "slowOp"), Some(SLOW_OP));
        assert!(
            gosource::literals_in(&go, "(r *Smolvm) Create")
                .iter()
                .any(|l| l == "16GiB"),
            "the Go runner no longer caps archives at 16GiB"
        );
        assert_eq!(MAX_IMAGE_BYTES, 16 * 1024 * 1024 * 1024);
        let server = gosource::read("server.go");
        assert_eq!(
            gosource::int_value(&server, "guestAgentPort"),
            Some(u64::from(GUEST_AGENT_PORT))
        );
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("vm-runner-runtime-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn process(&self, pid: i32, cmdline: &str) {
            let dir = self.0.join(pid.to_string());
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("cmdline"), cmdline).unwrap();
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
