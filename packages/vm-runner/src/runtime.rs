use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::Context;
use smolvm::storage::STORAGE_DISK_FILENAME;

use crate::api::{MachineSpec, State};
use crate::guest::INIT_PATH;
use crate::launch::ImageLaunch;

// UNIT_BOUNDARY_DESCRIPTION: what the runner asks of the hypervisor, and the rules that do not depend on which one answers. The server drives machines through this trait, so it can be tested without KVM against a fake, and the embedded smolvm implementation is the only code that talks to the VMM. Everything here is the hypervisor-independent half: how a machine's workload is assembled, how its env is updated, when its disk grows, and how a VMM that outlived its stop is found and taken down.
pub trait Runtime: Send + Sync {
    // UNIT_BOUNDARY_DESCRIPTION: `Absent`, `Stopped` or `Running`, and only those: whether an action is in flight is the server's knowledge, not the hypervisor's.
    fn state(&self, id: &str) -> anyhow::Result<State>;
    fn create(&self, id: &str, machine: &Machine<'_>) -> anyhow::Result<()>;
    fn update(&self, id: &str, update: &Update<'_>) -> anyhow::Result<()>;
    fn start(&self, id: &str) -> anyhow::Result<()>;
    fn stop(&self, id: &str) -> anyhow::Result<()>;
    fn delete(&self, id: &str) -> anyhow::Result<()>;
    // UNIT_BOUNDARY_DESCRIPTION: whether what the machine's record names to boot is still on the host. The record holds a path when the machine boots a cache tree or a staged archive, and the hypervisor reads that path at every start, so a tree evicted or relaid under a stopped machine fails every start until the record is rewritten. A registry reference is not a path and is always present.
    fn image_present(&self, id: &str) -> anyhow::Result<bool>;
    // UNIT_BOUNDARY_DESCRIPTION: the end of the machine's console as printable text, unredacted, or nothing when the runtime keeps none.
    fn console_tail(&self, _id: &str) -> String {
        String::new()
    }
    // UNIT_BOUNDARY_DESCRIPTION: how much host memory the machine's VMM holds now, or nothing when no VMM runs or the runtime cannot tell. Guests hand freed memory back to the host, so this is what the machine uses, well below its size, and what admission and the runner's memory request count it at.
    fn resident_mib(&self, _id: &str) -> Option<i32> {
        None
    }
    // UNIT_BOUNDARY_DESCRIPTION: whether this runner gives the machines that ask for it the node's virtualization extensions: its install lets it, and the node's KVM allows it. A runtime that cannot nest says no, and a machine that asks boots without them.
    fn nests(&self) -> bool {
        false
    }
}

// UNIT_BOUNDARY_DESCRIPTION: everything a create needs beyond the spec. `image` is what the machine boots: an unpacked cache tree or a staged archive, both absolute paths, or a registry reference when neither exists. `share` is the host directory the guest mounts read-only at the share path, and `host_port` the loopback port the guest's agent port is published on.
pub struct Machine<'a> {
    pub spec: &'a MachineSpec,
    pub image: &'a str,
    pub host_port: u16,
    pub share: &'a Path,
    pub launch: &'a ImageLaunch,
}

// UNIT_BOUNDARY_DESCRIPTION: the new shape of a stopped machine, written to its record in place so its disk and port stay. `applied` is the spec it last had, which says which env keys the controller has since dropped and whether the disk must grow. `image` is set when the machine moves to another image: what it boots now, named as for a create, and the launch that image names.
pub struct Update<'a> {
    pub desired: &'a MachineSpec,
    pub applied: Option<&'a MachineSpec>,
    pub image: Option<(&'a str, &'a ImageLaunch)>,
}

// UNIT_BOUNDARY_DESCRIPTION: the port the guest's agent listens on. The runner publishes it on a loopback port of its own and forwards the machine's published port there.
pub const GUEST_AGENT_PORT: u16 = 8080;

// UNIT_BOUNDARY_DESCRIPTION: the file in a machine's smolvm directory naming the host loopback port its guest may reach at its gateway address. The runner writes it; the machine's VMM, which is this binary started with `_boot-vm`, reads it beside its boot config.
pub const GATEWAY_HOST_PORT_FILE: &str = "platform-gateway-host-port";

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

// UNIT_BOUNDARY_DESCRIPTION: the root overlay of smolvm's guest agent in both of the forms smolvm writes it — a qcow2 over the shipped template, or a raw disk whenever smolvm cannot overlay the template — and the marker that says it was formatted. All three go, so the next boot formats a fresh root whichever form this one had.
pub const OVERLAY_FILES: [&str; 3] = ["overlay.qcow2", "overlay.raw", "overlay.formatted"];

// UNIT_BOUNDARY_DESCRIPTION: what the guest runs and with what, as the create hands it to smolvm.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workload {
    pub env: Vec<(String, String)>,
    pub workdir: Option<String>,
    pub command: Vec<String>,
}

// UNIT_BOUNDARY_DESCRIPTION: the guest's command and environment. platform-init runs first and starts the image's own entrypoint, so the image's entrypoint, command, env and working directory all come from its launch record. The platform's env wins over the image's, because it is what makes the guest an agent. The env is sorted by key so two creates of one spec write one record.
pub fn workload(spec: &MachineSpec, launch: &ImageLaunch) -> anyhow::Result<Workload> {
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

// UNIT_BOUNDARY_DESCRIPTION: a stopped machine's env after an update. With the image's own env known it is built again from the image and the desired spec, by the rule a create follows, so a key the controller stops overriding goes back to the image's value — dropping an override of PATH leaves the image's PATH, not none. Without it, keys the controller has dropped since the last write are removed and every key it sends is set, and keys only the image named are kept, because the controller never sent them and so never dropped them.
pub fn updated_env(
    current: &[(String, String)],
    applied: Option<&MachineSpec>,
    desired: &MachineSpec,
    image_env: Option<&[String]>,
) -> Vec<(String, String)> {
    if let Some(image_env) = image_env {
        let mut env = image_values(image_env);
        env.extend(desired.env.iter().map(|(k, v)| (k.clone(), v.clone())));
        return env.into_iter().collect();
    }
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

fn image_values(image_env: &[String]) -> BTreeMap<String, String> {
    image_env
        .iter()
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: the env the image a machine boots names, read from the launch record beside the tree it boots — a cache entry or a staged tree, whose `rootfs` sits next to that record. A machine booted from an archive has no record beside its image, and gives nothing.
pub fn image_env_beside(rootfs: &Path) -> Option<Vec<String>> {
    crate::launch::read_launch(rootfs.parent()?)
        .ok()
        .flatten()
        .map(|launch| launch.env)
}

// UNIT_BOUNDARY_DESCRIPTION: the size in GiB the storage disk grows to, or nothing. It is decided from the disk's own size in bytes, not from the applied spec: a spec lost, unreadable or written ahead of a grow that failed says nothing true about the disk, and a grow decided from it would be skipped. A disk can grow and cannot shrink, so a smaller request leaves it alone.
pub fn grown_storage(disk_bytes: u64, desired: &MachineSpec) -> Option<u64> {
    let want = u64::try_from(desired.storage_gib).ok()?;
    (disk_bytes < want << 30).then_some(want)
}

// UNIT_BOUNDARY_DESCRIPTION: removes the Agent's secret values from text that may reach the Agent's status or a log line. The longest value goes first, so a value that is the start of a longer one cannot cut that one short and leave its tail readable. A value spanning lines — a key, a certificate — reaches a console one line at a time, so each of its lines is removed as well as the whole. Values, and lines, of three characters or fewer are left alone: replacing them would mangle ordinary words and hide nothing, so a Secret that short is not protected here at all.
pub fn redact<'a>(text: &str, secrets: impl IntoIterator<Item = &'a str>) -> String {
    let mut needles: Vec<&str> = secrets
        .into_iter()
        .flat_map(|secret| std::iter::once(secret).chain(secret.lines().map(str::trim)))
        .filter(|needle| needle.len() > 3)
        .collect();
    needles.sort_unstable_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
    needles.dedup();
    let mut out = text.to_string();
    for needle in needles {
        out = out.replace(needle, "***");
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

// UNIT_BOUNDARY_DESCRIPTION: waits up to `limit` for the VMMs holding the machine's directory to exit, and returns the ones still there: those its command line names, and those in `seen`, found before a stop. A VMM's command line goes blank the moment it starts exiting, while its threads still hold its disks and published ports until the last of them exits — so a VMM the runner killed itself, or whose stop it went past, is only found through `seen`. smolvm's own stop waits for every thread since 1.18. A start issued before then is refused in a way that looks like a machine that can never start, or cannot bind the machine's port. A machine that is really stopped answers at once.
pub fn vmms_left(proc_root: &Path, vm_dir: &Path, mut seen: Vec<i32>, limit: Duration) -> Vec<i32> {
    let deadline = Instant::now() + limit;
    loop {
        seen.extend(orphan_pids(proc_root, vm_dir));
        seen.sort_unstable();
        seen.dedup();
        seen.retain(|&pid| !exited(proc_root, pid));
        if seen.is_empty() || Instant::now() >= deadline {
            return seen;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a process has let go of everything once it is gone, or is a zombie with no thread left beside it. A zombie main thread alone is not enough: the threads it leaves share its open files and close them only when the last one exits.
fn exited(proc_root: &Path, pid: i32) -> bool {
    let dir = proc_root.join(pid.to_string());
    let zombie = fs::read_to_string(dir.join("stat")).is_ok_and(|stat| {
        matches!(
            stat.rsplit_once(") ")
                .and_then(|(_, fields)| fields.split_ascii_whitespace().next()),
            Some("Z" | "X")
        )
    });
    !dir.exists()
        || (zombie && fs::read_dir(dir.join("task")).is_ok_and(|tasks| tasks.count() <= 1))
}

pub fn kill_orphans(proc_root: &Path, vm_dir: &Path) {
    for pid in orphan_pids(proc_root, vm_dir) {
        // SAFETY: kill(2) takes no pointers; a pid that has already exited returns ESRCH, which is ignored.
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: throws away the machine's root overlay, which is the root of smolvm's own guest agent and not the image's. The image's root is an overlay on the storage disk that smolvm keeps, and platform-init replaces it with a fresh one on every boot; that is what keeps a machine to HOME and nothing else. Discarding this one still means every boot starts the guest agent from the shipped template, so an agent root that was left corrupt, or written by an older runner, is never booted again. It runs after a stop and again before a start, because a machine that died with its runner never got the stop. Nothing is removed while a VMM still holds the disks.
pub fn discard_overlay(id: &str, proc_root: &Path, vm_dir: &Path, vmms: Vec<i32>) {
    if !vm_dir.is_dir() {
        return;
    }
    if !vmms_left(proc_root, vm_dir, vmms, VMM_EXIT_WAIT).is_empty() {
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

// UNIT_BOUNDARY_DESCRIPTION: where ext4 keeps its magic number: the superblock starts 1024 bytes into the disk, and its magic, 0xEF53 little-endian, is 56 bytes into the superblock.
const EXT4_MAGIC_OFFSET: u64 = 1024 + 56;

// UNIT_BOUNDARY_DESCRIPTION: marks a storage disk that holds a filesystem as formatted when its marker is missing, so smolvm never copies its template over it. smolvm copies the template over any storage disk without the marker at every start, and it writes the marker only once that copy has also been resized to the size asked for. A resize that fails — on a host without resize2fs, every disk smaller than the template — leaves a disk without the marker, and every later start then replaced it, and the agent's home on it, with the template. A disk with an ext4 superblock was formatted whatever its marker says, so it is marked here. Only a disk that holds no filesystem yet, the sparse file a create makes, is left for smolvm to format.
fn keep_formatted_storage(id: &str, vm_dir: &Path) -> anyhow::Result<()> {
    let disk = vm_dir.join(STORAGE_DISK_FILENAME);
    let marker = disk.with_extension("formatted");
    if marker.exists() || !holds_ext4(&disk)? {
        return Ok(());
    }
    tracing::warn!(
        machine = id,
        "the storage disk holds a filesystem but no format marker; marking it so it is never copied over"
    );
    fs::write(&marker, "1").with_context(|| format!("marking {} formatted", disk.display()))
}

fn holds_ext4(disk: &Path) -> anyhow::Result<bool> {
    use std::os::unix::fs::FileExt;
    let file = match fs::File::open(disk) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e).with_context(|| format!("reading {}", disk.display())),
    };
    let mut magic = [0; 2];
    match file.read_exact_at(&mut magic, EXT4_MAGIC_OFFSET) {
        Ok(()) => Ok(magic == [0x53, 0xEF]),
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
        Err(e) => Err(e).with_context(|| format!("reading {}", disk.display())),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: how long a VMM killed with SIGKILL may take to be gone. A process leaves at once unless it is stuck in the kernel, and one stuck there keeps the disks open however long it is waited on.
pub const KILLED_EXIT_WAIT: Duration = Duration::from_secs(1);

// UNIT_BOUNDARY_DESCRIPTION: prepares a machine's directory for a fresh boot: any VMM still holding it is waited out for `wait` and then killed, the files a dead VMM leaves are removed, the overlay is discarded, a storage disk that holds a filesystem is marked formatted, and the console an earlier boot wrote is emptied. A VMM that outlives even SIGKILL — stuck in uninterruptible sleep on its disk — fails the start instead: its lock and sockets are what keep a second VMM off the same storage disk, and a second VMM writing that disk under the first corrupts the agent's home.
pub fn clear_for_start(
    id: &str,
    proc_root: &Path,
    vm_dir: &Path,
    vmms: Vec<i32>,
    wait: Duration,
) -> anyhow::Result<()> {
    if !vm_dir.is_dir() {
        return Ok(());
    }
    let left = vmms_left(proc_root, vm_dir, vmms, wait);
    if !left.is_empty() {
        kill_orphans(proc_root, vm_dir);
        let left = vmms_left(proc_root, vm_dir, left, KILLED_EXIT_WAIT);
        if !left.is_empty() {
            anyhow::bail!(
                "machine '{id}': its previous VMM (pid {left:?}) still holds the machine's disks after SIGKILL, likely stuck in the kernel; refusing to boot a second VMM on the same disk"
            );
        }
    }
    for file in STALE_RUNTIME_FILES {
        let _ = fs::remove_file(vm_dir.join(file));
    }
    discard_overlay(id, proc_root, vm_dir, Vec::new());
    keep_formatted_storage(id, vm_dir)?;
    crate::console::clear_console(id, vm_dir);
    Ok(())
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
    let duration_ms = crate::elapsed_ms(started);
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
    use crate::testdir::TempDir;
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

    // TEST_SCENARIO: platform-init has to be the machine's entrypoint on every boot, or the agent's home is never mounted and its work is lost at the first stop. It runs first and starts what the image names — entrypoint then command — from the working directory the image names.
    #[test]
    fn platform_init_runs_first_and_hands_off_to_what_the_image_names() {
        let w = workload(
            &spec_with_env(&[]),
            &launch(&["/entry", "-x"], &["serve"], &[], "/app"),
        )
        .unwrap();
        assert_eq!(w.command, vec![INIT_PATH, "/entry", "-x", "serve"]);
        assert_eq!(w.workdir.as_deref(), Some("/app"));

        let bare = workload(&spec_with_env(&[]), &launch(&[], &["run"], &[], "")).unwrap();
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
            &launch(
                &["/entry"],
                &[],
                &["HOME=/root", "PATH=/usr/bin", "NOEQUALS"],
                "",
            ),
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

    // TEST_SCENARIO: a machine whose image names nothing to run would boot and wait for an exec that never comes, with nothing saying why. It is refused instead, and the refusal reaches the Agent's status, so its wording is pinned.
    #[test]
    fn a_machine_with_nothing_to_run_is_refused() {
        let empty = workload(&spec_with_env(&[]), &launch(&[], &[], &["A=b"], "/"))
            .unwrap_err()
            .to_string();
        assert_eq!(
            empty,
            "this image names no entrypoint, so a machine would boot to a filesystem with nothing running in it"
        );
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
            updated_env(&current, Some(&applied), &desired, None),
            vec![
                ("NEW".to_string(), "x".to_string()),
                ("PATH".to_string(), "/usr/bin".to_string()),
                ("TOKEN".to_string(), "v2".to_string()),
            ]
        );
        assert_eq!(
            updated_env(&current, None, &desired, None).len(),
            4,
            "with no applied spec nothing is known to have been dropped"
        );
    }

    // TEST_SCENARIO: an Agent that overrode a key its image also sets, and then stopped overriding it, must get the image's value back. Removing the key would leave a machine with no PATH at all. With the image's env known, an update gives the env a create of the same spec would.
    #[test]
    fn an_update_that_drops_an_override_restores_the_images_value() {
        let image_env = [
            "PATH=/usr/local/bin:/usr/bin".to_string(),
            "A=image".to_string(),
        ];
        let applied = spec_with_env(&[("PATH", "/custom"), ("TOKEN", "v1")]);
        let desired = spec_with_env(&[("TOKEN", "v2")]);
        let current = vec![
            ("A".to_string(), "image".to_string()),
            ("PATH".to_string(), "/custom".to_string()),
            ("TOKEN".to_string(), "v1".to_string()),
        ];
        let updated = updated_env(&current, Some(&applied), &desired, Some(&image_env));
        assert_eq!(
            updated,
            vec![
                ("A".to_string(), "image".to_string()),
                ("PATH".to_string(), "/usr/local/bin:/usr/bin".to_string()),
                ("TOKEN".to_string(), "v2".to_string()),
            ]
        );
        let launch = launch(
            &["/entry"],
            &[],
            &image_env.each_ref().map(|s| s.as_str()),
            "/",
        );
        assert_eq!(updated, workload(&desired, &launch).unwrap().env);

        let dir = crate::testdir::TempDir::new("image-env");
        fs::create_dir_all(dir.path().join("rootfs")).unwrap();
        fs::write(
            dir.path().join(crate::launch::LAUNCH_FILE),
            r#"{"cmd":["serve"],"env":["PATH=/bin"]}"#,
        )
        .unwrap();
        assert_eq!(
            image_env_beside(&dir.path().join("rootfs")),
            Some(vec!["PATH=/bin".to_string()])
        );
        assert_eq!(
            image_env_beside(&dir.path().join("archives/archive.tar")),
            None
        );
    }

    // TEST_SCENARIO: a disk can grow and cannot shrink, so an update names a storage size only when the request is larger than the disk actually is. Anything else would either fail the update or, worse, look like a shrink that silently did nothing. The disk's own size decides, so a disk a lost spec or a failed grow left smaller than its spec claims still grows.
    #[test]
    fn storage_grows_only_when_the_disk_is_smaller_than_asked() {
        let mut desired = spec_with_env(&[]);
        desired.storage_gib = 20;
        assert_eq!(grown_storage(10 << 30, &desired), Some(20));
        assert_eq!(grown_storage((20 << 30) - 1, &desired), Some(20));
        assert_eq!(grown_storage(20 << 30, &desired), None);
        desired.storage_gib = 5;
        assert_eq!(grown_storage(10 << 30, &desired), None);
    }

    // TEST_SCENARIO: a VMM stuck in the kernel outlives SIGKILL and still holds the machine's disks. Clearing its lock and sockets would let a second VMM boot on the same storage disk beside it, so the start fails and says why, and the files that keep the second VMM out stay. A directory no VMM holds is cleared as before.
    #[test]
    fn a_start_refuses_a_disk_a_vmm_that_survived_sigkill_still_holds() {
        let proc = TempDir::new("stuck-proc");
        let vm = TempDir::new("stuck-vm");
        fs::write(vm.path().join("vm.lock"), "").unwrap();
        process(
            &proc,
            i32::MAX - 7,
            &format!(
                "/proc/self/exe\0_boot-vm\0{}/boot-config.json",
                vm.path().display()
            ),
        );

        let refused = clear_for_start(
            "m1",
            proc.path(),
            vm.path(),
            Vec::new(),
            Duration::from_millis(50),
        )
        .unwrap_err()
        .to_string();
        assert!(
            refused.contains("still holds the machine's disks after SIGKILL"),
            "{refused}"
        );
        assert!(
            vm.path().join("vm.lock").exists(),
            "the lock of the live VMM was removed"
        );

        fs::remove_dir_all(proc.path().join((i32::MAX - 7).to_string())).unwrap();
        clear_for_start(
            "m1",
            proc.path(),
            vm.path(),
            Vec::new(),
            Duration::from_millis(50),
        )
        .unwrap();
        assert!(!vm.path().join("vm.lock").exists());
    }

    // TEST_SCENARIO: an operator's Secret reaches the guest through the env, and a failure's text reaches the Agent's status. Every value long enough to mean something is replaced; a short one is left, since replacing `on` would mangle the sentence and hide nothing.
    #[test]
    fn secret_values_are_removed_from_failures() {
        assert_eq!(
            redact("token hunter2 rejected on port", ["hunter2", "on"]),
            "token *** rejected on port"
        );
    }

    // TEST_SCENARIO: one value is the start of another, and replacing the shorter first would leave the longer one's tail in the status. The longer goes first, whatever order the env gave them in.
    #[test]
    fn a_value_that_starts_another_does_not_leave_its_tail() {
        assert_eq!(
            redact("key=abcd-efgh-ijkl", ["abcd", "abcd-efgh-ijkl"]),
            "key=***"
        );
    }

    // TEST_SCENARIO: a key or certificate spans lines, and a console prints it a line at a time, with its own line endings and indentation, so the whole value never appears as one string. Each of its lines is removed on its own; a line too short to mean anything is left, as a short value is.
    #[test]
    fn each_line_of_a_multi_line_value_is_removed() {
        let key = "-----BEGIN KEY-----\nMIIEsecretline1\nMIIEsecretline2\nab\n-----END KEY-----";
        let console =
            "boot: -----BEGIN KEY-----\r\n  MIIEsecretline1\r\n  MIIEsecretline2\r\nab\r\n";
        let out = redact(console, [key]);
        assert!(!out.contains("secretline"), "{out}");
        assert!(
            out.contains("ab"),
            "a two-character line is not a secret on its own"
        );
    }

    // TEST_SCENARIO: a machine's VMM is found by its directory on the command line. Of three processes only the one naming this machine's directory is its VMM — not one for a machine whose directory name merely starts the same way, and not the runner itself.
    #[test]
    fn a_vmm_is_found_by_its_machines_directory_and_no_other() {
        let proc = TempDir::new("orphans");
        let dir = PathBuf::from("/home/smolvm/.cache/smolvm/vms/abc123");
        process(
            &proc,
            100,
            "/proc/self/exe\0_boot-vm\0/home/smolvm/.cache/smolvm/vms/abc123/boot-config.json",
        );
        process(
            &proc,
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
        process(
            &proc,
            100,
            "/proc/self/exe\0_boot-vm\0/home/smolvm/.cache/smolvm/vms/abc123/boot-config.json",
        );

        let started = Instant::now();
        assert_eq!(
            vmms_left(proc.path(), &dir, Vec::new(), Duration::from_millis(150)),
            vec![100]
        );
        assert!(started.elapsed() >= Duration::from_millis(150));

        fs::remove_dir_all(proc.path().join("100")).unwrap();
        let started = Instant::now();
        assert!(vmms_left(proc.path(), &dir, Vec::new(), Duration::from_secs(10)).is_empty());
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    // TEST_SCENARIO: a stopped VMM's command line goes blank while it is still exiting: first still running, then with its main thread a zombie while another thread still holds the machine's published port. A VMM seen before the stop is waited out through both, and counts as gone only once its last thread is.
    #[test]
    fn a_stopped_vmm_is_waited_out_until_its_last_thread_exits() {
        let proc = TempDir::new("exiting");
        let dir = PathBuf::from("/home/smolvm/.cache/smolvm/vms/abc123");
        let vmm = proc.path().join("100");
        process(&proc, 100, "");
        fs::create_dir_all(vmm.join("task/100")).unwrap();
        let wait = Duration::from_millis(60);

        fs::write(vmm.join("stat"), "100 (VM:dam-platform) R 2 100").unwrap();
        assert_eq!(vmms_left(proc.path(), &dir, vec![100], wait), vec![100]);

        fs::write(vmm.join("stat"), "100 (VM:dam-platform) Z 2 100").unwrap();
        fs::create_dir_all(vmm.join("task/101")).unwrap();
        assert_eq!(vmms_left(proc.path(), &dir, vec![100], wait), vec![100]);
        assert!(
            vmms_left(proc.path(), &dir, Vec::new(), wait).is_empty(),
            "a blank command line names no machine"
        );

        fs::remove_dir(vmm.join("task/101")).unwrap();
        assert!(vmms_left(proc.path(), &dir, vec![100], wait).is_empty());
    }

    // TEST_SCENARIO: the root overlay is discarded in whichever form smolvm wrote it, and only once no VMM holds it. The storage disk, which is the agent's home, is never touched.
    #[test]
    fn the_overlay_goes_and_the_storage_disk_stays() {
        let proc = TempDir::new("discard-proc");
        let vm = TempDir::new("discard-vm");
        for file in OVERLAY_FILES.iter().chain(&["storage.raw"]) {
            fs::write(vm.path().join(file), "x").unwrap();
        }
        discard_overlay("m1", proc.path(), vm.path(), Vec::new());
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

    // TEST_SCENARIO: a machine's directory outlives the runner process that made it, and a VMM that died with its runner leaves its sockets, lock and pid file in it. What a start clears and what a discard removes is pinned to the names smolvm writes, so a renamed entry here does not leave a stale socket in place and the next boot believing the machine is still up.
    #[test]
    fn a_start_clears_the_files_a_vmm_leaves_behind() {
        assert_eq!(
            STALE_RUNTIME_FILES,
            [
                "agent.ready",
                "agent.sock",
                "control.sock",
                "vm.lock",
                "agent.pid",
            ]
        );
        assert_eq!(
            OVERLAY_FILES,
            ["overlay.qcow2", "overlay.raw", "overlay.formatted"]
        );
    }

    // TEST_SCENARIO: the windows and sizes machines are run to. A shorter VMM wait kills a guest mid-checkpoint, a smaller archive cap refuses an image that booted before, and the guest agent's port is where every machine's guest listens; each is pinned so a change to it is deliberate.
    #[test]
    fn the_waits_and_caps_are_pinned() {
        assert_eq!(VMM_EXIT_WAIT, Duration::from_secs(10));
        assert_eq!(SLOW_OP, Duration::from_secs(2));
        assert_eq!(MAX_IMAGE_BYTES, 16 * 1024 * 1024 * 1024);
        assert_eq!(GUEST_AGENT_PORT, 8080);
    }

    fn process(proc: &TempDir, pid: i32, cmdline: &str) {
        let dir = proc.path().join(pid.to_string());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("cmdline"), cmdline).unwrap();
    }
}
