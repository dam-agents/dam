use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::Context;
use smolvm::storage::STORAGE_DISK_FILENAME;

use crate::api::{MachineSpec, State};
use crate::launch::ImageLaunch;

// UNIT_BOUNDARY_DESCRIPTION: what the runner asks of the hypervisor, and the rules that do not depend on which one answers. The server drives machines through this trait, so it can be tested without KVM against a fake, and the embedded smolvm implementation is the only code that talks to the VMM. Everything here is the hypervisor-independent half: how a machine's workload is assembled, how its env is updated, when its disk grows, and how a VMM that outlived its stop is found and taken down.
pub trait Runtime: Send + Sync {
    // UNIT_BOUNDARY_DESCRIPTION: `Absent`, `Stopped` or `Running`, and only those: whether an action is in flight is the server's knowledge, not the hypervisor's.
    fn state(&self, id: &str) -> anyhow::Result<State>;
    fn create(&self, id: &str, machine: &Machine<'_>) -> anyhow::Result<()>;
    fn update(&self, id: &str, update: &Update<'_>) -> anyhow::Result<()>;
    // UNIT_BOUNDARY_DESCRIPTION: boots a stopped machine with `boot_mib` of guest RAM, which may be less than its size `memory_mib`; `grow` adds the rest once the guest is up.
    fn start(&self, id: &str, boot_mib: i32, memory_mib: i32) -> anyhow::Result<()>;
    // UNIT_BOUNDARY_DESCRIPTION: adds guest RAM to a running machine until it has `memory_mib`, and has the guest put it to use. A runtime that cannot grow a machine fails, and the machine boots at its size from then on.
    fn grow(&self, _id: &str, _memory_mib: i32) -> anyhow::Result<()> {
        anyhow::bail!("this runtime cannot grow a running machine")
    }
    fn stop(&self, id: &str) -> anyhow::Result<()>;
    fn delete(&self, id: &str) -> anyhow::Result<()>;
    // UNIT_BOUNDARY_DESCRIPTION: whether what the machine's record names to boot is still on the host. The record holds a path when the machine boots a cache tree or a staged tree, and the hypervisor reads that path at every start, so a tree evicted or relaid under a stopped machine fails every start until the record is rewritten. A registry reference is not a path and is always present.
    fn image_present(&self, id: &str) -> anyhow::Result<bool>;
    // UNIT_BOUNDARY_DESCRIPTION: the end of the machine's console as printable text, unredacted, or nothing when the runtime keeps none.
    fn console_tail(&self, _id: &str) -> String {
        String::new()
    }
    // UNIT_BOUNDARY_DESCRIPTION: how much host memory the machine's VMM holds now, or nothing when no VMM runs or the runtime cannot tell. Guests hand freed memory back to the host, so this is what the machine uses, well below its size, and what admission and the runner's memory request count it at.
    fn resident_mib(&self, _id: &str) -> Option<i32> {
        None
    }
    // UNIT_BOUNDARY_DESCRIPTION: whether a VMM process holds the machine's directory now. It is the only evidence that a machine nothing has looked at is up, and its launch record cannot be read: only the process that booted it says whether it runs. A runtime that cannot look says yes, since a failed look has not shown that no VMM holds the machine, and reading it as stopped hands a live machine's room to the next start.
    fn holds_vmm(&self, _id: &str) -> bool {
        false
    }
    // UNIT_BOUNDARY_DESCRIPTION: the CPU time the machine's VMM has used since it started, in microseconds, or nothing when no VMM runs or the runtime cannot tell. Two readings a probe apart give the machine's share of the runner's CPU.
    fn cpu_usec(&self, _id: &str) -> Option<u64> {
        None
    }
    // UNIT_BOUNDARY_DESCRIPTION: the bytes the machine's files take on the runner's claim, by the blocks allocated rather than their length: every disk is sparse and as large as the owner's whole pool, so only what was written is the machine's share of it. Nothing when the runtime cannot tell.
    fn disk_used_bytes(&self, _id: &str) -> Option<u64> {
        None
    }
    // UNIT_BOUNDARY_DESCRIPTION: whether this runner gives the machines that ask for it the node's virtualization extensions: its install lets it, and the node's KVM allows it. A runtime that cannot nest says no, and a machine that asks boots without them.
    fn nests(&self) -> bool {
        false
    }
    // UNIT_BOUNDARY_DESCRIPTION: the process of the machine's running VMM, or nothing when no VMM runs or the runtime keeps none — including one that is still booting, whose record the runtime may not have written yet, so a machine the kernel or its own filter kills during a boot is still named. The runner reaps that process itself, so it learns the signal that ended it, and a pid that now belongs to another process is never returned as this machine's.
    fn vmm_pid(&self, _id: &str) -> Option<i32> {
        None
    }

    // UNIT_BOUNDARY_DESCRIPTION: the signal that ended the VMM of `pid`, when the runtime's own code reaped it: a boot being waited on and a sweep of the runtime's children both read the status of a process this runner also watches, and the status word is read once. The signal is kept rather than dropped with it, and offered once. `None` for a process that exited on its own, one still running, and one whose status nothing here read.
    fn vmm_exit_signal(&self, _pid: i32) -> Option<i32> {
        None
    }
}

// UNIT_BOUNDARY_DESCRIPTION: everything a create needs beyond the spec. `image` is what the machine boots: an unpacked cache tree or a staged tree, both absolute paths, or a registry reference when neither exists. `share` is the host directory the guest mounts read-only at the share path, and `host_port` the loopback port the guest's agent port is published on.
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
// UNIT_BOUNDARY_DESCRIPTION: the file in a machine's smolvm directory naming the guest agent root its VMM boots, which lies in the runtime the runner booted it on. The runner writes it before each start, beside the boot config the VMM deletes once read, so it lasts as long as the VMM; the loader reads it to keep that runtime in the pod (see release::booted_from).
pub const AGENT_ROOTFS_FILE: &str = "platform-agent-rootfs";
// UNIT_BOUNDARY_DESCRIPTION: the file smolvm leaves when a launch fails because its VMM was killed: the pid on its first line and the signal on its second. The status word is read once, and the pid file the boot is waited on goes with the launch, so this record is the only naming of a kill during a boot; the runner reports it as the reason the machine restarted, and the next start removes it.
pub const LAUNCH_EXIT_FILE: &str = "launch-exit";

// UNIT_BOUNDARY_DESCRIPTION: how long a stopped machine's VMM may keep its disks. Long enough for the guest to checkpoint its journal and let go, short enough that a VMM which will never exit is killed rather than waited on.
pub const VMM_EXIT_WAIT: Duration = Duration::from_secs(10);

// UNIT_BOUNDARY_DESCRIPTION: the duration past which an operation is logged as slow. A create is tens of milliseconds and a start under a second, so only the operations worth reading reach the warning.
pub const SLOW_OP: Duration = Duration::from_secs(2);

pub const IMAGE_LAUNCH_UNKNOWN: &str =
    "this image names no entrypoint, so a machine would boot to a filesystem with nothing running in it";

// UNIT_BOUNDARY_DESCRIPTION: the files a VMM leaves in a machine's directory while it runs. A start removes them once the old VMM is gone, because a socket or lock left by a VMM that died with its runner makes the next boot believe the machine is still up.
pub const STALE_RUNTIME_FILES: [&str; 6] = [
    "agent.ready",
    "agent.sock",
    "control.sock",
    "vm.lock",
    "agent.pid",
    LAUNCH_EXIT_FILE,
];

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
    Ok(Workload {
        env: env.into_iter().collect(),
        workdir: (!launch.working_dir.is_empty()).then(|| launch.working_dir.clone()),
        command: image_command,
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

// UNIT_BOUNDARY_DESCRIPTION: the env the image a machine boots names, read from the launch record beside the tree it boots — a cache entry or a staged tree, whose `rootfs` sits next to that record.
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

// UNIT_BOUNDARY_DESCRIPTION: the processes a scan of the host names as holding a machine's directory, and the count of this user's processes the kernel would not describe at all. A process that answered nothing every time it was read, and is not gone, is not named, since `kill_orphans` signals every process a scan names; it is counted instead, so a caller deciding whether a machine is free can tell a look that saw every process from one that did not.
#[derive(Debug, Default)]
pub struct Orphans {
    pub named: Vec<Orphan>,
    pub unknown: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Orphan {
    pub pid: i32,
    // UNIT_BOUNDARY_DESCRIPTION: the kernel's name for the process whose arguments were read, verified unchanged across that read. It is what a signal goes through and the only thing that can: a pid alone can be another process's by the time a slow scan ends. There is no absent case to fall back from, so a process that cannot be named is never named here at all.
    #[cfg(target_os = "macos")]
    pub identity: darwin::AuditToken,
}

impl Orphans {
    pub fn pids(&self) -> Vec<i32> {
        self.named.iter().map(|orphan| orphan.pid).collect()
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the processes still holding a machine's directory. Every VMM smolvm spawns names its machine's directory on its command line, so this finds a VMM a previous runner process left behind as well as one of ours. The trailing slash keeps a machine from matching another whose directory name it prefixes. A scan that could not look answers with an error rather than with an empty list, since an empty list says no VMM holds the machine: only a process that exited mid-scan, leaving no command line at all, is that clean answer. A scan the kernel answered only in part says so in `unknown`, since it may still have named the VMMs it did answer for.
#[cfg_attr(target_os = "macos", allow(unused_variables))]
pub fn orphan_pids(proc_root: &Path, vm_dir: &Path) -> anyhow::Result<Orphans> {
    let dir = vm_dir.to_string_lossy();
    if dir.is_empty() {
        return Ok(Orphans::default());
    }
    let needle = format!("{dir}/");
    // UNIT_BOUNDARY_DESCRIPTION: a Mac reads its own process table, and reads it whether or not a `/proc` happens to be mounted there: the number alone is not the name a signal goes through.
    #[cfg(target_os = "macos")]
    return darwin::pids_with_arg(&needle);
    #[cfg(not(target_os = "macos"))]
    {
        let mut pids: Vec<i32> = Vec::new();
        let entries = fs::read_dir(proc_root)
            .with_context(|| format!("scanning {} for a VMM", proc_root.display()))?;
        for entry in entries {
            let entry =
                entry.with_context(|| format!("scanning {} for a VMM", proc_root.display()))?;
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.parse::<i32>().ok())
            else {
                continue;
            };
            let cmdline = match fs::read(entry.path().join("cmdline")) {
                Ok(cmdline) => cmdline,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => {
                    return Err(e)
                        .with_context(|| format!("reading the command line of process {pid}"))
                }
            };
            if String::from_utf8_lossy(&cmdline).contains(&needle) {
                pids.push(pid);
            }
        }
        pids.sort_unstable();
        Ok(Orphans {
            named: pids.into_iter().map(|pid| Orphan { pid }).collect(),
            unknown: 0,
        })
    }
}

// UNIT_BOUNDARY_DESCRIPTION: waits up to `limit` for the VMMs holding the machine's directory to exit, and returns the ones still there: those its command line names, and those in `seen`, found before a stop. A VMM's command line goes blank the moment it starts exiting, while its threads still hold its disks and published ports until the last of them exits — so a VMM the runner killed itself, or whose stop it went past, is only found through `seen`. smolvm's own stop waits for every thread since 1.18. A start issued before then is refused in a way that looks like a machine that can never start, or cannot bind the machine's port. A machine that is really stopped answers at once, and only a look that saw every process says so: a look that failed, or one that left a process the kernel would not describe, is waited out like one that found a VMM, since it has not shown the machine is free. A wait spent without one such look is an error and never an empty answer, because `clear_for_start` reads an empty answer as permission to clear the machine's lock and sockets and boot a second VMM on the disk the first may still be writing.
pub fn vmms_left(
    proc_root: &Path,
    vm_dir: &Path,
    mut seen: Vec<i32>,
    limit: Duration,
) -> anyhow::Result<Vec<i32>> {
    let deadline = Instant::now() + limit;
    let mut looked = false;
    let mut why = String::from("no scan was made");
    loop {
        match orphan_pids(proc_root, vm_dir) {
            Ok(found) => {
                seen.extend(found.pids());
                looked |= found.unknown == 0;
                if found.unknown > 0 {
                    why = format!(
                        "{} process(es) the kernel would not describe",
                        found.unknown
                    );
                }
            }
            Err(e) => why = format!("{e:#}"),
        }
        seen.sort_unstable();
        seen.dedup();
        seen.retain(|&pid| !exited(proc_root, pid));
        if looked && seen.is_empty() {
            return Ok(seen);
        }
        if Instant::now() >= deadline {
            return match looked {
                true => Ok(seen),
                false => Err(anyhow::anyhow!(
                    "scanning the host for a VMM holding {} for {limit:?} answered nothing: {why}",
                    vm_dir.display()
                )),
            };
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a process has let go of everything once it is gone, or is a zombie with no thread left beside it. A zombie main thread alone is not enough: the threads it leaves share its open files and close them only when the last one exits. A Mac asks the kernel, which is where the scan found the process: a `/proc` mounted on a Mac is a filesystem view the kernel's own table need not agree with, and a pid missing from it would read as a process that exited while the kernel still holds it, which authorizes removing the lock and sockets that keep a second VMM off a disk the first is still writing.
#[cfg_attr(target_os = "macos", allow(unused_variables))]
fn exited(proc_root: &Path, pid: i32) -> bool {
    #[cfg(target_os = "macos")]
    return darwin::exited(pid);
    #[cfg(not(target_os = "macos"))]
    let dir = proc_root.join(pid.to_string());
    #[cfg(not(target_os = "macos"))]
    let zombie = fs::read_to_string(dir.join("stat")).is_ok_and(|stat| {
        matches!(
            stat.rsplit_once(") ")
                .and_then(|(_, fields)| fields.split_ascii_whitespace().next()),
            Some("Z" | "X")
        )
    });
    #[cfg(not(target_os = "macos"))]
    {
        !dir.exists()
            || (zombie && fs::read_dir(dir.join("task")).is_ok_and(|tasks| tasks.count() <= 1))
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the host runner's process table. A Mac has no /proc, so the VMMs holding a machine's directory are found through the kernel's process list and each process's arguments, as `/proc/<pid>/cmdline` finds them on Linux.
#[cfg(target_os = "macos")]
pub(crate) mod darwin {
    use std::ffi::c_void;
    use std::mem;
    use std::time::Duration;

    use super::Orphans;

    // UNIT_BOUNDARY_DESCRIPTION: how long a process that answered no arguments is waited out, and how often it is read again. A process installing a new image answers nothing, or a partial answer, for the moment the kernel takes to swap its arguments, and answers its own again right after; every VMM is in that moment at its start. A process that answers nothing four times, a millisecond apart, is not named, which is the safe way to be wrong: `kill_orphans` signals every pid a scan names. Only a process that answered nothing pays the pause.
    const ARG_READS: usize = 4;
    const ARG_READ_PAUSE: Duration = Duration::from_millis(1);

    // UNIT_BOUNDARY_DESCRIPTION: how many pids the process table may hold before a scan gives up on listing it. No host comes near it: a Mac runs a few thousand processes at most, and a table that big is not one a scan can trust either way.
    pub(super) const PID_CAP: usize = 1 << 20;

    // UNIT_BOUNDARY_DESCRIPTION: this user's processes whose arguments hold `needle`, each with the identity that process had when it was read. A table the kernel did not answer is an error, never an empty list: an empty list says no process holds the machine, and `kill_orphans` and `vmms_left` read that as nobody to kill and nothing left. A process the kernel would not describe is counted, not named: an argument that cannot be read cannot be matched against.
    pub fn pids_with_arg(needle: &str) -> anyhow::Result<Orphans> {
        scan(needle, table, read_args)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the scan itself, over a process table and a reader its caller names, so the answers to a table, or to a process, the kernel would not answer for are tests of this crate and not of the kernel.
    pub(super) fn scan(
        needle: &str,
        table: impl FnOnce() -> anyhow::Result<Vec<i32>>,
        mut read: impl FnMut(i32) -> Answer,
    ) -> anyhow::Result<Orphans> {
        scan_named(needle, table, &mut read, identity)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the scan over a reader and a name-taking function its caller supplies, so a name that changes under a read, and a read whose process cannot be named at all, are tests of this crate and not of the kernel. A name is taken before the read and once more after it, and a process is named only when both are the same name: the arguments and the signal must belong to one process, and a pid given to another process mid-read, or an image installed mid-read, gives two names.
    pub(super) fn scan_named(
        needle: &str,
        table: impl FnOnce() -> anyhow::Result<Vec<i32>>,
        mut read: impl FnMut(i32) -> Answer,
        mut name: impl FnMut(i32) -> Identity,
    ) -> anyhow::Result<Orphans> {
        let mut found = Orphans::default();
        for pid in table()? {
            match look(pid, &mut read, &mut name) {
                // UNIT_BOUNDARY_DESCRIPTION: the arguments and the name were read of one process that did not change under them, so this name is the one that process held while its arguments were read, and it is the only thing a signal may go through. A process that matches and cannot be named is counted: `kill_orphans` signals every process a scan names, and a number alone can be another process's by the time the sweep runs.
                Look::Read { argv, identity } if argv.iter().any(|arg| arg.contains(needle)) => {
                    match identity {
                        Some(identity) => found.named.push(super::Orphan { pid, identity }),
                        None => found.unknown += 1,
                    }
                }
                Look::Read { .. } => {}
                // UNIT_BOUNDARY_DESCRIPTION: a process that is gone while the scan looks at it leaves nothing to look into, which is the clean answer. A process still there that never answered is one the scan did not see through: it is counted, so a caller can tell a look that saw every process from one that did not, and it is named by nothing.
                Look::Unknown if busy(pid) => found.unknown += 1,
                Look::Unknown | Look::Gone => {}
            }
        }
        found.named.sort_by_key(|orphan| orphan.pid);
        Ok(found)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the name the kernel holds for a process, for a caller that offers a function of its own in a test.
    fn identity_of(pid: i32) -> Identity {
        identity(pid)
    }

    // UNIT_BOUNDARY_DESCRIPTION: one process's arguments and the name that belonged to them. An attempt is retried as a whole while the process installs an image: the kernel answers nothing, then answers the new arguments, and bumps the pid version inside the name at that same moment, so a name taken before the read differs from the one taken after it, and retrying only the read would pair new arguments with an old name — a signal through that name ends nothing while the VMM holds the machine. The retry is what makes the arguments and the name one process's.
    pub(super) fn look(
        pid: i32,
        read: &mut impl FnMut(i32) -> Answer,
        name: &mut impl FnMut(i32) -> Identity,
    ) -> Look {
        for attempt in 0..ARG_READS {
            if attempt > 0 {
                std::thread::sleep(ARG_READ_PAUSE);
            }
            let before = name(pid);
            match read(pid) {
                Answer::Gone => return Look::Gone,
                Answer::MidExec => {}
                Answer::Args(argv) => {
                    let identity = match (before, name(pid)) {
                        (Some(before), Some(after)) if before == after => Some(after),
                        _ => None,
                    };
                    // UNIT_BOUNDARY_DESCRIPTION: a name that changed across the read belongs to another process, or to this one before the image it installed, and the arguments read belong to the other side of that change: read again, and only a read whose name holds still is an answer.
                    if identity.is_some() || before.is_none() {
                        return Look::Read { argv, identity };
                    }
                }
            }
        }
        Look::Unknown
    }

    // UNIT_BOUNDARY_DESCRIPTION: the kernel's name for a process, which is the only thing a signal may be sent through: a pid is a number the kernel hands to whatever process comes next, so the one a scan named can be another process's by the time a slow scan ends. Nothing when the kernel does not name the process — it is gone, a policy denies the lookup, or it is not this user's — and a process with no name is never signalled.
    pub type Identity = Option<AuditToken>;

    #[repr(C)]
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct AuditToken {
        val: [u32; 8],
    }

    impl AuditToken {
        // UNIT_BOUNDARY_DESCRIPTION: a name that is not the one the kernel gave, for a test to show that two names are told apart. The kernel bumps the pid version inside the token when it hands a number on, which is the first word a token carries.
        #[cfg(test)]
        pub fn bump(mut self) -> Self {
            self.val[0] = self.val[0].wrapping_add(1);
            self
        }
    }

    const TASK_AUDIT_TOKEN: libc::task_flavor_t = 15;
    // UNIT_BOUNDARY_DESCRIPTION: the kernel's own filter for a listing of one user's processes, from `sys/proc_info.h`.
    const PROC_UID_ONLY: u32 = 4;
    const TASK_AUDIT_TOKEN_COUNT: libc::mach_msg_type_number_t = 8;

    unsafe extern "C" {
        fn task_name_for_pid(
            target: libc::mach_port_t,
            pid: libc::c_int,
            task: *mut libc::mach_port_t,
        ) -> libc::kern_return_t;
        fn proc_signal_with_audittoken(token: *const AuditToken, sig: libc::c_int) -> libc::c_int;
        fn mach_port_deallocate(
            task: libc::mach_port_t,
            name: libc::mach_port_t,
        ) -> libc::kern_return_t;
    }

    // UNIT_BOUNDARY_DESCRIPTION: names a process once and for good: the token the kernel keeps for the task behind that pid, which no later process can inherit or take over. Nothing when the kernel does not name it — the process is gone, or it is not this user's and this runner may not look at its task.
    #[allow(deprecated)]
    pub fn identity(pid: i32) -> Identity {
        let mut task = 0;
        // SAFETY: `task` receives the send right the call takes on success, released below.
        let named = unsafe { task_name_for_pid(libc::mach_task_self(), pid, &raw mut task) };
        if named != 0 {
            return None;
        }
        let mut token = AuditToken::default();
        let mut count = TASK_AUDIT_TOKEN_COUNT;
        // SAFETY: `token` is an AuditToken, which the kernel writes as eight integers.
        let read = unsafe {
            libc::task_info(
                task,
                TASK_AUDIT_TOKEN,
                (&raw mut token).cast::<libc::integer_t>(),
                &raw mut count,
            )
        };
        // SAFETY: `task` is the right taken above, released once and not used again.
        unsafe { mach_port_deallocate(libc::mach_task_self(), task) };
        (read == 0 && count == TASK_AUDIT_TOKEN_COUNT).then_some(token)
    }

    // UNIT_BOUNDARY_DESCRIPTION: sends a signal through a name the kernel gave for a process, and through nothing else. The kernel refuses a name whose process has exited or installed a new image, so a sweep cannot kill the process that took its number. `false` means the kernel refused it.
    pub fn signal(token: &AuditToken, sig: i32) -> bool {
        // SAFETY: `token` is an AuditToken the kernel filled in for a live process of this user.
        unsafe { proc_signal_with_audittoken(token, sig) == 0 }
    }

    // UNIT_BOUNDARY_DESCRIPTION: ends one process a scan matched, and only that process. A refused name has left the process it was taken for — the process exited, or it installed a new image, which the kernel counts as a new name for the same process — so the process is looked at again and the signal repeated while its arguments still match the machine's directory. A process that is gone, that no longer matches, or that cannot be named afresh, is left alone: the number alone never carries a signal, because the kernel may have given it to another process.
    pub fn end(orphan: &super::Orphan, needle: &str) {
        let mut identity = Some(orphan.identity);
        for attempt in 0..ARG_READS {
            if attempt > 0 {
                std::thread::sleep(ARG_READ_PAUSE);
            }
            let Some(token) = identity else {
                match look(orphan.pid, &mut read_args, &mut identity_of) {
                    Look::Read {
                        argv,
                        identity: Some(fresh),
                    } if argv.iter().any(|arg| arg.contains(needle)) => {
                        identity = Some(fresh);
                        continue;
                    }
                    _ => return,
                }
            };
            if signal(&token, libc::SIGKILL) {
                return;
            }
            identity = None;
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: this user's processes in the kernel's table, which the kernel itself keeps apart by uid: a process of another user is no VMM of this machine, and asking the kernel for this user's alone means no scan ever needs to read the owner of a pid one at a time. A listing that failed is an error, and so is one that holds no pid at all, since this user always has at least the runner itself and an empty listing would say nothing of this user runs.
    fn table() -> anyhow::Result<Vec<i32>> {
        // SAFETY: geteuid takes no pointers and cannot fail.
        let uid = unsafe { libc::geteuid() };
        // SAFETY: a null buffer asks only for the number of bytes a listing takes.
        let hint =
            count(unsafe { libc::proc_listpids(PROC_UID_ONLY, uid, std::ptr::null_mut(), 0) })?;
        let pids = fill(hint, |pids| {
            let bytes = i32::try_from(mem::size_of_val(pids)).unwrap_or(i32::MAX);
            // SAFETY: the buffer holds `bytes` bytes, and the kernel writes at most that many.
            count(unsafe {
                libc::proc_listpids(
                    PROC_UID_ONLY,
                    uid,
                    pids.as_mut_ptr().cast::<c_void>(),
                    bytes,
                )
            })
        })?;
        Ok(pids.into_iter().filter(|&pid| pid > 0).collect())
    }

    // UNIT_BOUNDARY_DESCRIPTION: how many pids a listing call answered for, from the bytes it reports: `proc_listpids` counts in bytes both when it is asked how much room a listing needs and when it says how much it wrote. A call that wrote nothing is a failure, since this user always has at least the runner itself.
    fn count(bytes: i32) -> anyhow::Result<usize> {
        match usize::try_from(bytes) {
            Ok(bytes) if bytes > 0 => Ok(bytes / mem::size_of::<i32>()),
            _ => Err(anyhow::anyhow!(
                "listing the host's processes: {}",
                std::io::Error::last_os_error()
            )),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: a whole listing of this user's processes, as far as repeated readings can show one. The kernel writes at most what the buffer holds and answers how many it wrote, with no error when the table holds more, and it also caps its own snapshot of the table at what it counted a moment earlier plus twenty, so a listing can come back short of the room it was given and still be a prefix. A listing is therefore taken for the whole table only when it does not fill the room it was given and the same room answers the same pids again; otherwise it is read again with twice the room. Two readings that agree are evidence of a whole table and not proof: processes born and gone between them can leave two different prefixes with one count, and the kernel's own cap applies to both. A table too big for the cap is an error and never a prefix, since a scan that took one for the whole table would miss a VMM beyond it and answer that the machine is free.
    pub(super) fn fill(
        hint: usize,
        mut list: impl FnMut(&mut [i32]) -> anyhow::Result<usize>,
    ) -> anyhow::Result<Vec<i32>> {
        if hint > PID_CAP {
            anyhow::bail!("listing the host's processes: {hint} of them");
        }
        let mut capacity = (hint + 64).min(PID_CAP);
        loop {
            let mut pids = vec![0i32; capacity];
            let first = list(&mut pids)?;
            if first < capacity {
                let mut again = vec![0i32; capacity];
                if list(&mut again)? == first {
                    pids.truncate(first);
                    again.truncate(first);
                    let (mut seen, mut now) = (pids.clone(), again);
                    seen.sort_unstable();
                    now.sort_unstable();
                    if seen == now {
                        return Ok(pids);
                    }
                }
            }
            if capacity >= PID_CAP {
                anyhow::bail!("listing the host's processes: more than {capacity} of them");
            }
            capacity = (capacity * 2).min(PID_CAP);
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: a process's arguments, without its environment, or nothing when the kernel answered nothing for it every time it was read. A process the kernel will not answer for — gone, a zombie, root's or a kernel task's — has no arguments and a name to nobody, while one that answered nothing is a process the scan could not look into.
    pub(super) enum Answer {
        Args(Vec<String>),
        Gone,
        MidExec,
    }

    // UNIT_BOUNDARY_DESCRIPTION: what a look at one process found: its arguments and the name that belonged to them, that it was gone while the scan looked, or that it never answered. A look that never answered is not an empty command line, which would say the process was looked into.
    #[derive(Debug, PartialEq, Eq)]
    pub(super) enum Look {
        Read {
            argv: Vec<String>,
            identity: Identity,
        },
        Gone,
        Unknown,
    }

    // UNIT_BOUNDARY_DESCRIPTION: one read of a process's arguments through KERN_PROCARGS2, which answers the size the buffer must hold when given none, and a temporary failure for a process the kernel is in the middle of an exec on. A process that is not this user's is no VMM of this machine, so a failure to read it is an answer and is not waited out: the kernel refuses most of those, and paying the pause for a host's daemons would make every scan slow.
    pub(super) fn read_args(pid: i32) -> Answer {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
        let mut size: libc::size_t = 0;
        // SAFETY: a null buffer asks only for the size; `mib` names three levels.
        let sized = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                3,
                std::ptr::null_mut(),
                &raw mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if sized != 0 {
            return answer_of(&std::io::Error::last_os_error(), pid);
        }
        let mut buf = vec![0u8; size];
        // SAFETY: the buffer holds `size` bytes, and the kernel writes at most that many.
        let read = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                3,
                buf.as_mut_ptr().cast::<c_void>(),
                &raw mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if read != 0 {
            return answer_of(&std::io::Error::last_os_error(), pid);
        }
        buf.truncate(size);
        args_in(&buf).map_or(Answer::MidExec, Answer::Args)
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the kernel failed to answer, or answered that it cannot. A process changing its image, and one starting or exiting that the kernel has not made its task reachable for yet, fail with EIO, EAGAIN, EINTR, ENOMEM or EINVAL and answer again a moment later; ESRCH is the process being gone. Every other failure — a policy that denies the read, a permission this runner does not have — is no answer either, and says nothing about the process: a process that is still there is a process the scan did not look into, and a start may not read that as a machine nothing holds.
    pub(super) fn answer_of(error: &std::io::Error, pid: i32) -> Answer {
        match error.raw_os_error() {
            Some(libc::ESRCH) => Answer::Gone,
            _ => match busy(pid) {
                true => Answer::MidExec,
                false => Answer::Gone,
            },
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether a process is still one a scan has to look into, asked in a way no sandbox denies: a signal of zero is answered for every process, where the kernel's process information is not. A process that has exited but not been reaped — a zombie — is not one: it has released its threads and with them every file and port, and the kernel describes it no more. A pid the kernel refuses to describe for any other reason is still a process that is there, since nothing has shown it is not. Nothing here reaps, since a scan of the host sees children of its own process that belong to somebody else.
    fn busy(pid: i32) -> bool {
        // SAFETY: kill(2) with signal 0 takes no pointers and only checks for the process.
        if unsafe { libc::kill(pid, 0) } != 0 {
            return std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH);
        }
        // SAFETY: proc_bsdinfo is plain data, and the call writes at most its size.
        let mut info: libc::proc_bsdinfo = unsafe { mem::zeroed() };
        let size = i32::try_from(mem::size_of::<libc::proc_bsdinfo>()).unwrap_or(i32::MAX);
        // SAFETY: `info` is a valid proc_bsdinfo of `size` bytes.
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&raw mut info).cast::<c_void>(),
                size,
            )
        };
        match read == size {
            true => info.pbi_status != libc::SZOMB,
            // UNIT_BOUNDARY_DESCRIPTION: the kernel answers nothing for a zombie and sets ESRCH; any other failure leaves the process one to look into.
            false => std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the arguments in one answer from KERN_PROCARGS2: argc, the executable's path, the padding that aligns the arguments behind it, then argc arguments and the environment, all NUL-separated. Around argc the kernel counts the arguments, so a string from the environment is never read as an argument and an argument that is empty is still an argument. An answer is read only when all of that holds: a process mid-exec answers its old count over an empty buffer, and an argument the answer ends in the middle of is no argument, so neither is a command line that may name a process `kill_orphans` then signals. The kernel pads the path to the word size of the process, which is eight bytes for every process a Mac runs, Rosetta's included: that many bytes are skipped, and the arguments are read from there, so an empty first argument is read as empty and the environment behind the arguments is never read at all. A kernel of four-byte words would lay its padding out differently and is not one any Mac this runner supports runs.
    pub(super) fn args_in(answer: &[u8]) -> Option<Vec<String>> {
        let (argc, rest) = answer.split_first_chunk::<4>()?;
        let argc = usize::try_from(i32::from_ne_bytes(*argc))
            .ok()
            .filter(|&argc| argc > 0 && argc <= rest.len())?;
        // UNIT_BOUNDARY_DESCRIPTION: the executable's path comes first, and it is never empty: a read the kernel answered from a buffer too small for the arguments that came after it answers a region of NULs in place of both, which must not be read as a command line of empty arguments.
        let path = rest.iter().position(|&b| b == 0).filter(|&path| path > 0)?;
        let pad = padding(path + 1, mem::size_of::<usize>());
        if rest[path + 1..].iter().take(pad).any(|&b| b != 0) {
            return None;
        }
        let mut at = path + 1 + pad;
        let mut args = Vec::with_capacity(argc);
        for _ in 0..argc {
            let end = at + rest.get(at..)?.iter().position(|&b| b == 0)?;
            args.push(String::from_utf8_lossy(&rest[at..end]).into_owned());
            at = end + 1;
        }
        Some(args)
    }

    fn padding(len: usize, align: usize) -> usize {
        (align - len % align) % align
    }

    // UNIT_BOUNDARY_DESCRIPTION: a process's resident memory in bytes and its user plus system CPU time in microseconds, which Linux reads from /proc. The kernel counts CPU in Mach time units, nanoseconds on Intel and timebase ticks on Apple silicon, so it is scaled by the timebase.
    pub fn task_usage(pid: i32) -> Option<(u64, u64)> {
        // SAFETY: proc_taskinfo is plain data, and the call writes at most its size.
        let mut info: libc::proc_taskinfo = unsafe { mem::zeroed() };
        let size = i32::try_from(mem::size_of::<libc::proc_taskinfo>()).ok()?;
        // SAFETY: `info` is a valid proc_taskinfo of `size` bytes.
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTASKINFO,
                0,
                (&raw mut info).cast::<c_void>(),
                size,
            )
        };
        if read != size {
            return None;
        }
        #[allow(deprecated)]
        let (numer, denom) = {
            let mut base = libc::mach_timebase_info { numer: 0, denom: 0 };
            // SAFETY: `base` is a valid mach_timebase_info the call fills in.
            if unsafe { libc::mach_timebase_info(&raw mut base) } != 0 || base.denom == 0 {
                return None;
            }
            (u128::from(base.numer), u128::from(base.denom))
        };
        let nanos = u128::from(info.pti_total_user + info.pti_total_system) * numer / denom;
        Some((info.pti_resident_size, u64::try_from(nanos / 1000).ok()?))
    }

    // UNIT_BOUNDARY_DESCRIPTION: a process is gone, or a zombie, which on a Mac has already released its threads and with them every file and port. A process that is the runner's own child and has exited is reaped here first: smolvm on a Mac reads any pid that still answers a signal as a live VMM, so an unreaped one would fail the stop that follows its kill. The kernel answers no process info for a zombie, so a reap is also how a child zombie is told apart from a live child.
    pub fn exited(pid: i32) -> bool {
        // SAFETY: WNOHANG never blocks; a live child returns 0, and a pid that is not our child returns ECHILD.
        if unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) } == pid {
            return true;
        }
        // SAFETY: kill(2) with signal 0 only checks for the process.
        if unsafe { libc::kill(pid, 0) } != 0 {
            return std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
        }
        // SAFETY: proc_bsdinfo is plain data, and the call writes at most its size.
        let mut info: libc::proc_bsdinfo = unsafe { mem::zeroed() };
        let size = i32::try_from(mem::size_of::<libc::proc_bsdinfo>()).unwrap_or(i32::MAX);
        // SAFETY: `info` is a valid proc_bsdinfo of `size` bytes.
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&raw mut info).cast::<c_void>(),
                size,
            )
        };
        read == size && info.pbi_status == libc::SZOMB
    }
}

pub fn kill_orphans(proc_root: &Path, vm_dir: &Path) {
    let needle = format!("{}/", vm_dir.to_string_lossy());
    let found = orphan_pids(proc_root, vm_dir).unwrap_or_else(|e| {
        tracing::warn!(
            machine = %vm_dir.display(),
            "could not scan the host for a VMM holding the machine: {e:#}"
        );
        Orphans::default()
    });
    if found.unknown > 0 {
        tracing::warn!(
            machine = %vm_dir.display(),
            unanswered = found.unknown,
            "the kernel would not describe every process on the host, so a VMM among them is not killed"
        );
    }
    kill_named(&found.named, &needle);
}

// UNIT_BOUNDARY_DESCRIPTION: ends each process by the name the scan took for it, and never by its number: a number the kernel has given to another process would kill that one. A name the kernel refuses has left the process it was taken for — the process exited, or it installed a new image, which the kernel counts as a new name for the same process — so the name is taken again and the signal repeated while the process is still the one the scan matched. Only a process that is gone, or that is no longer the process the scan matched, is left alone.
fn kill_named(named: &[Orphan], needle: &str) {
    for orphan in named {
        #[cfg(target_os = "macos")]
        darwin::end(orphan, needle);
        // SAFETY: kill(2) takes no pointers; a pid that has already exited returns ESRCH, which is ignored.
        #[cfg(not(target_os = "macos"))]
        unsafe {
            libc::kill(orphan.pid, libc::SIGKILL);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = needle;
}

// UNIT_BOUNDARY_DESCRIPTION: a VMM a signal ended while its machine was booting or growing, which is what names the kill on the machine: the boot or grow call fails either way, and the failure alone would read as a machine that broke rather than one the kernel took for memory or its own filter killed. `pid` is the process, for the log and the counter.
#[derive(Debug)]
pub struct VmmKilled {
    pub pid: i32,
    pub signal: i32,
}

impl std::fmt::Display for VmmKilled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "the machine's VMM (pid {}) was killed by signal {}",
            self.pid, self.signal
        )
    }
}

impl std::error::Error for VmmKilled {}

// UNIT_BOUNDARY_DESCRIPTION: what one read of a child's exit status says. The read happens once and the caller keeps the answer: a second read gets ECHILD, and the status is gone with it, which is why the reaper collects before it decides anything. A VMM is a child of the process that spawned it, so a machine handed over to a new runner release reads as `Gone` here — the loader reaps those and records the signal for the runner that adopted them.
pub enum Ended {
    Running,
    Signalled(i32),
    Exited,
}

// UNIT_BOUNDARY_DESCRIPTION: what waitpid(2) says of a pid: `Running` covers both a live process and one this process never was the parent of, which the caller tells apart by the record the loader leaves.
pub fn ended(pid: i32) -> Ended {
    let mut status = 0;
    // SAFETY: WNOHANG never blocks, and the kernel writes at most the status word at `status`.
    if unsafe { libc::waitpid(pid, &raw mut status, libc::WNOHANG) } != pid {
        return Ended::Running;
    }
    // UNIT_BOUNDARY_DESCRIPTION: the status word goes to one reader, and a boot still waiting on this VMM is another: a reap here takes the word from smolvm's own wait for the same pid, which would then call the launch failed with nothing saying why it was. The signal is kept where that wait reads it, so whichever of the two reaps, the kill is still named.
    smolvm::process::note_exit_signal(pid, status);
    match libc::WIFSIGNALED(status) {
        true => Ended::Signalled(libc::WTERMSIG(status)),
        false => Ended::Exited,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: where ext4 keeps its magic number: the superblock starts 1024 bytes into the disk, and its magic, 0xEF53 little-endian, is 56 bytes into the superblock.
const EXT4_MAGIC_OFFSET: u64 = 1024 + 56;
// UNIT_BOUNDARY_DESCRIPTION: where btrfs keeps its magic: the primary superblock starts 64 KiB into the disk, and its magic, `_BHRfS_M`, is 64 bytes into the superblock.
const BTRFS_MAGIC_OFFSET: u64 = 0x10000 + 0x40;

// UNIT_BOUNDARY_DESCRIPTION: marks a storage disk that holds a filesystem as formatted when its marker is missing, so smolvm never copies its template over it. smolvm copies the template over any storage disk without the marker at every start, and it writes the marker only once that copy has also been resized to the size asked for. A resize that fails — on a host without resize2fs, every disk smaller than the template — leaves a disk without the marker, and every later start then replaced it, and the agent's home on it, with the template. A disk with an ext4 or btrfs superblock was formatted whatever its marker says, so it is marked here. A disk with no filesystem never reaches a start: a create whose disk cannot be made fails.
fn keep_formatted_storage(id: &str, vm_dir: &Path) -> anyhow::Result<()> {
    let disk = vm_dir.join(STORAGE_DISK_FILENAME);
    let marker = disk.with_extension("formatted");
    if marker.exists() || !holds_filesystem(&disk)? {
        return Ok(());
    }
    tracing::warn!(
        machine = id,
        "the storage disk holds a filesystem but no format marker; marking it so it is never copied over"
    );
    fs::write(&marker, "1").with_context(|| format!("marking {} formatted", disk.display()))
}

fn holds_filesystem(disk: &Path) -> anyhow::Result<bool> {
    use std::os::unix::fs::FileExt;
    let file = match fs::File::open(disk) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e).with_context(|| format!("reading {}", disk.display())),
    };
    let magic_at = |offset, magic: &[u8]| {
        let mut read = vec![0; magic.len()];
        match file.read_exact_at(&mut read, offset) {
            Ok(()) => Ok(read == magic),
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
            Err(e) => Err(e).with_context(|| format!("reading {}", disk.display())),
        }
    };
    Ok(magic_at(EXT4_MAGIC_OFFSET, &[0x53, 0xEF])? || magic_at(BTRFS_MAGIC_OFFSET, b"_BHRfS_M")?)
}

// UNIT_BOUNDARY_DESCRIPTION: how long a VMM killed with SIGKILL may take to be gone. A process leaves at once unless it is stuck in the kernel, and one stuck there keeps the disks open however long it is waited on.
pub const KILLED_EXIT_WAIT: Duration = Duration::from_secs(1);

// UNIT_BOUNDARY_DESCRIPTION: prepares a machine's directory for a fresh boot: any VMM still holding it is waited out for `wait` and then killed, the files a dead VMM leaves are removed, a storage disk that holds a filesystem is marked formatted, and the console an earlier boot wrote is emptied. A VMM that outlives even SIGKILL — stuck in uninterruptible sleep on its disk — fails the start instead: its lock and sockets are what keep a second VMM off the same storage disk, and a second VMM writing that disk under the first corrupts the agent's home. A wait in which no look at the host's processes saw them all fails the start too, and leaves the lock and sockets in place: a look that did not happen has not shown the machine is free, and no wait can prove it one.
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
    let left = vmms_left(proc_root, vm_dir, vmms, wait).with_context(|| {
        format!("machine '{id}': refusing to boot on a disk a VMM may still hold")
    })?;
    if !left.is_empty() {
        kill_orphans(proc_root, vm_dir);
        let left = vmms_left(proc_root, vm_dir, left, KILLED_EXIT_WAIT).with_context(|| {
            format!("machine '{id}': after SIGKILL, no look at the host's processes saw them all")
        })?;
        if !left.is_empty() {
            anyhow::bail!(
                "machine '{id}': its previous VMM (pid {left:?}) still holds the machine's disks after SIGKILL, likely stuck in the kernel; refusing to boot a second VMM on the same disk"
            );
        }
    }
    for file in STALE_RUNTIME_FILES {
        let _ = fs::remove_file(vm_dir.join(file));
    }
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
    #[cfg(not(target_os = "macos"))]
    use std::path::PathBuf;

    // TEST_SCENARIO: a VMM is found by the machine directory on its command line, and taken down, on the host's own process table: /proc on Linux, the kernel's process list on a Mac, which has no /proc. A machine whose directory only prefixes the VMM's is not matched.
    #[test]
    fn a_vmm_holding_the_machine_directory_is_found_and_ended_on_this_host() {
        let dir = TempDir::new("vmm-scan");
        let vm_dir = dir.path().join("m1");
        // UNIT_BOUNDARY_DESCRIPTION: the stand-in VMM blocks in a shell builtin so it forks nothing; a forked child carries sh's command line until it execs, and a scan in that moment finds two VMMs.
        let mut vmm = std::process::Command::new("sh")
            .args(["-c", "read _", "_boot-vm"])
            .arg(format!("{}/", vm_dir.display()))
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let pid = i32::try_from(vmm.id()).unwrap();
        let proc_root = Path::new("/proc");
        // UNIT_BOUNDARY_DESCRIPTION: spawn returns once the exec has begun, and Linux shows the new command line only a moment later, so a scan can miss a process that has just started. So a scan that finds no process is repeated until the deadline, while one that names a process must name the stand-in alone at once: `kill_orphans` signals every pid a scan names.
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut found = Vec::new();
        while Instant::now() < deadline {
            found = orphan_pids(proc_root, &vm_dir)
                .map(|found| found.pids())
                .unwrap_or_default();
            if !found.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(found, vec![pid], "the scan names the stand-in alone");
        assert!(orphan_pids(proc_root, &dir.path().join("m"))
            .unwrap()
            .pids()
            .is_empty());

        kill_orphans(proc_root, &vm_dir);
        vmm.wait().unwrap();
        assert!(
            vmms_left(proc_root, &vm_dir, vec![pid], Duration::from_secs(5))
                .unwrap()
                .is_empty()
        );
    }

    // TEST_SCENARIO: a boot and the reap tick both wait on the same VMM, and the kernel gives its status word to one of them. Whichever reaps, the kill is still named: the reap here leaves the signal where the boot's own wait reads it, so a machine killed as it started is not read as a launch that failed with nothing saying why.
    #[test]
    fn a_reap_here_keeps_the_signal_a_boot_is_still_waiting_for() {
        let mut vmm = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let pid = i32::try_from(vmm.id()).unwrap();
        assert!(matches!(ended(pid), Ended::Running));
        assert!(
            smolvm::process::peek_exit_signal(pid).is_none(),
            "a live child has no signal to keep"
        );
        // SAFETY: kill(2) takes plain integers and touches no memory here.
        assert_eq!(unsafe { libc::kill(pid, libc::SIGKILL) }, 0);
        // UNIT_BOUNDARY_DESCRIPTION: a signal is delivered a moment after the call, so the read below repeats until the child has ended.
        let deadline = Instant::now() + Duration::from_secs(5);
        while !matches!(ended(pid), Ended::Signalled(_)) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(matches!(ended(pid), Ended::Running | Ended::Signalled(_)));
        assert_eq!(
            smolvm::process::peek_exit_signal(pid),
            Some(libc::SIGKILL),
            "the boot's wait still finds the signal this reap took"
        );
        let _ = vmm.wait();
    }

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
        assert_eq!(w.command, vec!["/entry", "-x", "serve"]);
        assert_eq!(w.workdir.as_deref(), Some("/app"));

        let bare = workload(&spec_with_env(&[]), &launch(&[], &["run"], &[], "")).unwrap();
        assert_eq!(bare.command, vec!["run"]);
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

    // UNIT_BOUNDARY_DESCRIPTION: a stand-in `/proc` is a Linux process table; a Mac reads the kernel's own list, so these scans are proved where the walk they exercise exists and the Mac's are proved against the kernel in the `darwin` tests.
    #[cfg(not(target_os = "macos"))]
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

    // TEST_SCENARIO: a scan that cannot read a process's command line is not a scan that found no VMM. Read as one, a live machine whose launch record no longer decodes counts as zero at handoff and its storage share waits for no guest: an unknown scan must never answer "nothing holds this machine". A process that exited mid-scan leaves no command line at all, which is that clean answer, not a failure.
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn a_scan_that_cannot_read_a_command_line_is_not_a_clean_none_found() {
        let proc = TempDir::new("orphans-unreadable");
        let dir = PathBuf::from("/home/smolvm/.cache/smolvm/vms/abc123");
        fs::create_dir_all(proc.path().join("100").join("cmdline")).unwrap();
        let scanned = orphan_pids(proc.path(), &dir);
        assert!(
            scanned.is_err(),
            "an unreadable command line read as no VMM: {scanned:?}"
        );

        let proc = TempDir::new("orphans-exited");
        fs::create_dir_all(proc.path().join("100")).unwrap();
        assert_eq!(
            orphan_pids(proc.path(), &dir).unwrap().pids(),
            Vec::<i32>::new(),
            "a process that exited mid-scan read as a failed scan"
        );
    }

    // TEST_SCENARIO: a start clears a machine's lock and sockets once the wait shows nothing holds the machine, and a wait in which no look at the host's processes saw them all has shown nothing. Read as permission, it would boot a second VMM on the disk a live one may still be writing, and would remove the very lock and sockets that keep it off. The start must fail, and the lock must still be there afterwards.
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn a_wait_no_scan_answered_does_not_clear_the_machine() {
        let proc = TempDir::new("clear-unscanned");
        let machine = TempDir::new("clear-unscanned-machine");
        let dir = machine.path().to_path_buf();
        fs::write(dir.join("vm.lock"), "held by a VMM").unwrap();
        fs::create_dir_all(proc.path().join("100").join("cmdline")).unwrap();

        let cleared = clear_for_start(
            "m1",
            proc.path(),
            &dir,
            Vec::new(),
            Duration::from_millis(80),
        );
        assert!(
            cleared.is_err(),
            "a wait that looked nowhere cleared the machine: {cleared:?}"
        );
        assert!(
            dir.join("vm.lock").exists(),
            "the lock a live VMM may hold was cleared by a wait that saw nothing"
        );
    }

    // TEST_SCENARIO: a Mac finds a VMM in the kernel's process table, so it must ask the kernel whether that process has exited too. A `/proc` mounted on a Mac is a separate view the kernel's table need not agree with, and a pid missing from it would read as a process that exited while the kernel still lists it, which authorizes a start to remove the lock and sockets of a machine a live VMM is still holding. The holder here is a real process the kernel names, and the `/proc` view is a scratch directory holding no such pid: a start must fail and keep every file that keeps a second VMM off the disk.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_live_vmm_the_kernel_lists_is_not_read_as_gone_from_a_proc_view() {
        let dir = TempDir::new("proc-view-holder");
        let vm_dir = dir.path().join("m1");
        fs::create_dir_all(&vm_dir).unwrap();
        let mut vmm = std::process::Command::new("sh")
            .args(["-c", "read _", "_boot-vm"])
            .arg(format!("{}/", vm_dir.display()))
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let pid = i32::try_from(vmm.id()).unwrap();
        for file in STALE_RUNTIME_FILES {
            fs::write(vm_dir.join(file), "held by a VMM").unwrap();
        }
        let found = orphan_pids(Path::new("/proc"), &vm_dir).unwrap();
        assert!(
            found.pids().contains(&pid),
            "the kernel did not name the live holder this test needs: {found:?}"
        );

        // UNIT_BOUNDARY_DESCRIPTION: a `/proc` view that holds another process and not the holder, which is the disagreement between the two tables that the start must not read as an exit.
        let proc_view = TempDir::new("proc-view-absent");
        fs::create_dir_all(proc_view.path().join("1")).unwrap();

        let cleared = clear_for_start(
            "m1",
            proc_view.path(),
            &vm_dir,
            found.pids(),
            Duration::from_millis(80),
        );
        let alive = !exited(Path::new("/proc"), pid);
        let kept: Vec<bool> = STALE_RUNTIME_FILES
            .iter()
            .map(|file| vm_dir.join(file).exists())
            .collect();
        if alive {
            assert!(
                cleared.is_err(),
                "a start cleared a machine a live VMM the kernel lists still holds: {cleared:?}"
            );
            assert!(
                kept.iter().all(|kept| *kept),
                "a start removed the files that keep a second VMM off a disk a live one holds: {kept:?}"
            );
        }
        vmm.kill().ok();
        vmm.wait().ok();
    }

    // TEST_SCENARIO: a machine's VMM is found by its directory on the command line. Of three processes only the one naming this machine's directory is its VMM — not one for a machine whose directory name merely starts the same way, and not the runner itself.
    #[cfg(not(target_os = "macos"))]
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

        assert_eq!(orphan_pids(proc.path(), &dir).unwrap().pids(), vec![100]);
        assert!(orphan_pids(proc.path(), Path::new(""))
            .unwrap()
            .pids()
            .is_empty());
    }

    // TEST_SCENARIO: a start issued while the previous VMM still holds the disks is refused, which looks exactly like a machine that can never start. The wait is what breaks that, and a machine that is really stopped must not pay for it — both halves are asserted, since a wait that always returned true would pass the second alone.
    #[cfg(not(target_os = "macos"))]
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
            vmms_left(proc.path(), &dir, Vec::new(), Duration::from_millis(150)).unwrap(),
            vec![100]
        );
        assert!(started.elapsed() >= Duration::from_millis(150));

        fs::remove_dir_all(proc.path().join("100")).unwrap();
        let started = Instant::now();
        assert!(
            vmms_left(proc.path(), &dir, Vec::new(), Duration::from_secs(10))
                .unwrap()
                .is_empty()
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    // TEST_SCENARIO: a stopped VMM's command line goes blank while it is still exiting: first still running, then with its main thread a zombie while another thread still holds the machine's published port. A VMM seen before the stop is waited out through both, and counts as gone only once its last thread is.
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn a_stopped_vmm_is_waited_out_until_its_last_thread_exits() {
        let proc = TempDir::new("exiting");
        let dir = PathBuf::from("/home/smolvm/.cache/smolvm/vms/abc123");
        let vmm = proc.path().join("100");
        process(&proc, 100, "");
        fs::create_dir_all(vmm.join("task/100")).unwrap();
        let wait = Duration::from_millis(60);

        fs::write(vmm.join("stat"), "100 (VM:dam-platform) R 2 100").unwrap();
        assert_eq!(
            vmms_left(proc.path(), &dir, vec![100], wait).unwrap(),
            vec![100]
        );

        fs::write(vmm.join("stat"), "100 (VM:dam-platform) Z 2 100").unwrap();
        fs::create_dir_all(vmm.join("task/101")).unwrap();
        assert_eq!(
            vmms_left(proc.path(), &dir, vec![100], wait).unwrap(),
            vec![100]
        );
        assert!(
            vmms_left(proc.path(), &dir, Vec::new(), wait)
                .unwrap()
                .is_empty(),
            "a blank command line names no machine"
        );

        fs::remove_dir(vmm.join("task/101")).unwrap();
        assert!(vmms_left(proc.path(), &dir, vec![100], wait)
            .unwrap()
            .is_empty());
    }

    // TEST_SCENARIO: a machine's directory outlives the runner process that made it, and a VMM that died with its runner leaves its sockets, lock and pid file in it. What a start clears is pinned to the names smolvm writes, so a renamed entry here does not leave a stale socket in place and the next boot believing the machine is still up.
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
                LAUNCH_EXIT_FILE,
            ]
        );
    }

    // TEST_SCENARIO: the windows and sizes machines are run to. A shorter VMM wait kills a guest mid-checkpoint, and the guest agent's port is where every machine's guest listens; each is pinned so a change to it is deliberate.
    #[test]
    fn the_waits_and_caps_are_pinned() {
        assert_eq!(VMM_EXIT_WAIT, Duration::from_secs(10));
        assert_eq!(SLOW_OP, Duration::from_secs(2));
        assert_eq!(GUEST_AGENT_PORT, 8080);
    }

    // TEST_SCENARIO: a sweep ends every live process a scan named, through the name the kernel gave it, so a VMM left by a previous runner is really gone after it. A sweep that signalled nothing would leave that VMM holding the machine.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_sweep_ends_the_live_vmm_it_named() {
        use std::os::unix::process::ExitStatusExt;

        let dir = TempDir::new("sweep-kills");
        let vm_dir = dir.path().join("m1");
        let needle = format!("{}/", vm_dir.display());
        let mut vmm = std::process::Command::new("sh")
            .args(["-c", "read _", "_boot-vm"])
            .arg(&needle)
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let pid = i32::try_from(vmm.id()).unwrap();
        let named = darwin::pids_with_arg(&needle).unwrap();
        assert_eq!(named.pids(), vec![pid], "the scan named the stand-in");
        kill_named(&named.named, &needle);
        let ended = vmm.wait().unwrap();
        assert_eq!(
            ended.signal(),
            Some(libc::SIGKILL),
            "the sweep did not end the live VMM it named"
        );
    }

    // TEST_SCENARIO: a process that is gone keeps its number, and the kernel gives that number to another process. A sweep that signalled the number would kill whatever holds it now; a sweep that signals the name the scan took finds the name refused and ends nothing.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_sweep_never_kills_a_process_it_did_not_name() {
        let mut reused = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let pid = i32::try_from(reused.id()).unwrap();
        let mut gone = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let stale = darwin::identity(i32::try_from(gone.id()).unwrap())
            .expect("the kernel names a live process of this user");
        gone.kill().unwrap();
        gone.wait().unwrap();

        // UNIT_BOUNDARY_DESCRIPTION: the number the sweep holds is the live process's, while the name it holds is the one of a process that has gone: what a sweep sees when the kernel hands a number on under it.
        kill_named(
            &[Orphan {
                pid,
                identity: stale,
            }],
            "/m/1/",
        );
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            !exited(Path::new("/proc"), pid),
            "the sweep killed the process holding a reused number instead of the one its name holds"
        );
        reused.kill().unwrap();
        reused.wait().unwrap();
    }

    // TEST_SCENARIO: this runner cannot always name a process — a policy may deny the task lookup — and a process it cannot name is one it cannot tell apart from whatever process comes next. Such a process is counted as one the scan could not look into, so a start does not read the scan as a machine nothing holds, and it is never ended by number.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_process_the_runner_cannot_name_is_never_killed_by_number() {
        let mut child = std::process::Command::new("sh")
            .args(["-c", "read _", "_boot-vm"])
            .arg("/m/1/")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let pid = i32::try_from(child.id()).unwrap();
        let unnamed =
            darwin::scan_named("/m/1/", || Ok(vec![pid]), darwin::read_args, |_| None).unwrap();
        assert_eq!(
            unnamed.pids(),
            Vec::<i32>::new(),
            "a process the runner could not name was named by the scan"
        );
        assert_eq!(
            unnamed.unknown, 1,
            "a process the runner could not name was read as one it had looked into"
        );
        kill_named(&unnamed.named, "/m/1/");
        assert!(
            !exited(Path::new("/proc"), pid),
            "a sweep ended a process it could not name, by its number"
        );
        child.kill().unwrap();
        child.wait().unwrap();
    }

    // TEST_SCENARIO: the arguments a scan reads must be the arguments of the process whose name it keeps. A name taken before the read and again after it tells the two apart: an image installed mid-read, or a number the kernel handed on, gives two names, and the read belongs to neither process the sweep may signal.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_name_that_changes_across_the_read_names_no_process() {
        let mut child = std::process::Command::new("sh")
            .args(["-c", "read _", "_boot-vm"])
            .arg("/m/1/")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let pid = i32::try_from(child.id()).unwrap();
        let mut names = 0;
        let changed = darwin::scan_named(
            "/m/1/",
            || Ok(vec![pid]),
            darwin::read_args,
            |_| {
                names += 1;
                darwin::identity(pid).map(|token| match names % 2 {
                    1 => token,
                    _ => token.bump(),
                })
            },
        )
        .unwrap();
        assert_eq!(
            changed.pids(),
            Vec::<i32>::new(),
            "a process whose name changed across the read was named anyway"
        );
        assert!(
            changed.unknown >= 1,
            "a process whose name changed across the read was not counted as one the scan could not look into"
        );
        child.kill().unwrap();
        child.wait().unwrap();
    }

    // TEST_SCENARIO: a live process answers the kernel's read of its arguments with nothing, or with a partial answer, for the moment the kernel takes to install a new image, which is longer the longer its arguments are, and a VMM answers it that way at every start. A scan in that moment found no VMM, which `kill_orphans` read as nothing to kill and `vmms_left` as a machine nothing holds. The stand-in re-execs itself with an argument near the host's limit, so it is in that moment over and over, and every scan of it must name it.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_vmm_the_kernel_is_mid_exec_on_is_named_by_every_scan() {
        const SCAN_ATTEMPTS: usize = 200;
        let dir = TempDir::new("vmm-midexec");
        let vm_dir = dir.path().join("m1");
        let needle = format!("{}/", vm_dir.display());
        let script = dir.path().join("reexec");
        crate::testdir::exec_script(&script, "#!/bin/sh\nexec \"$0\" \"$1\" \"$2\"\n");
        let padding = "a".repeat(900_000);
        let mut vmm = std::process::Command::new(&script)
            .arg(&padding)
            .arg(&needle)
            .spawn()
            .unwrap();
        let pid = i32::try_from(vmm.id()).unwrap();
        let mut misses = Vec::new();
        let mut failed = None;
        for scan in 0..SCAN_ATTEMPTS {
            match darwin::pids_with_arg(&needle) {
                Ok(found) if found.pids().contains(&pid) => {}
                Ok(_) => misses.push(scan),
                Err(e) => {
                    misses.push(scan);
                    failed = Some(e);
                }
            }
        }
        vmm.kill().unwrap();
        vmm.wait().unwrap();
        assert!(
            misses.is_empty(),
            "the scan missed the live VMM on scans {misses:?}"
        );
        if let Some(e) = failed {
            panic!("the scan of the host failed while the VMM was live: {e:#}");
        }
    }

    // TEST_SCENARIO: a process of this user that the kernel answered nothing about, every time it was read, is a process the scan did not look into. It is named by nothing, since `kill_orphans` signals every pid a scan names, and it is counted, so a start's wait that met one does not read a look that missed a process as a machine nothing holds.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_process_that_never_answered_is_not_a_clean_scan() {
        let ours = i32::try_from(std::process::id()).unwrap();
        let scan =
            darwin::scan("no machine", || Ok(vec![ours]), |_| darwin::Answer::MidExec).unwrap();
        assert_eq!(scan.pids(), Vec::<i32>::new());
        assert_eq!(
            scan.unknown, 1,
            "a process the kernel would not describe counted as one it did"
        );
    }

    // TEST_SCENARIO: a read of a live process fails with EINVAL while Apple's exec has switched the process but not yet made its new task reachable, and the same read answers its own arguments a millisecond later. Read as gone, that answer dropped a live VMM from a scan that then reported success, and a start booted beside it while a kill swept nothing. A failure that says nothing about whether the process is there — a denied process information read included — is no answer either, and is counted rather than read as a machine nothing holds; only a process that is really gone is that clean answer.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_failed_read_of_a_live_process_is_not_a_process_that_is_gone() {
        let ours = i32::try_from(std::process::id()).unwrap();
        let mut gone = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let exited = i32::try_from(gone.id()).unwrap();
        gone.kill().unwrap();
        gone.wait().unwrap();
        // UNIT_BOUNDARY_DESCRIPTION: a pid that has been reaped names no process, which is what the kernel answers ESRCH for.
        assert!(
            matches!(
                darwin::answer_of(&std::io::Error::from_raw_os_error(libc::ESRCH), exited),
                darwin::Answer::Gone
            ),
            "a process that is gone is not read again"
        );
        for code in [libc::EINVAL, libc::EIO, libc::EPERM] {
            assert!(
                matches!(
                    darwin::answer_of(&std::io::Error::from_raw_os_error(code), ours),
                    darwin::Answer::MidExec
                ),
                "a live process this read failed for is one the scan could not look into, not one that is gone (errno {code})"
            );
            assert!(
                matches!(
                    darwin::answer_of(&std::io::Error::from_raw_os_error(code), exited),
                    darwin::Answer::Gone
                ),
                "a pid that names no process is gone whatever the read failed with (errno {code})"
            );
        }
    }

    // TEST_SCENARIO: the kernel stops listing pids when the room it keeps for its own snapshot of the table runs out, and answers how many it wrote with no error, so a listing can come back short of the buffer it was given and still be a prefix. Taken for the whole table, a scan would miss a VMM beyond the prefix and answer that the machine is free. A prefix is read again with more room, and a table too big for the cap is an error, never a prefix.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_process_table_listed_in_parts_is_read_again() {
        let mut calls = 0;
        let grown = darwin::fill(100, |pids| {
            calls += 1;
            match calls {
                1 => {
                    pids.fill(7);
                    Ok(pids.len())
                }
                2 => {
                    pids[..3].copy_from_slice(&[11, 12, 13]);
                    Ok(3)
                }
                _ => {
                    pids[..3].copy_from_slice(&[11, 12, 13]);
                    Ok(3)
                }
            }
        })
        .unwrap();
        assert_eq!(
            calls, 3,
            "a listing that filled its room was not read again, and the same table read twice is what says it is the whole one"
        );
        assert_eq!(grown, vec![11, 12, 13]);

        // UNIT_BOUNDARY_DESCRIPTION: the kernel's own snapshot cap: a reply short of the buffer that the next read disagrees with is a prefix too.
        let mut reads = 0;
        let kernel_capped = darwin::fill(100, |pids| {
            reads += 1;
            match reads {
                1 => {
                    pids[..120].fill(7);
                    Ok(120)
                }
                _ => {
                    pids[..130].fill(9);
                    Ok(130)
                }
            }
        })
        .unwrap();
        assert_eq!(
            kernel_capped.len(),
            130,
            "a reply short of the buffer that the next read contradicted was taken for the whole table"
        );

        // UNIT_BOUNDARY_DESCRIPTION: two listings of one count are not one listing: a process born and another gone between them leaves the same count with a different process in it, and the first is a prefix that may be missing the very VMM the scan looks for.
        let mut same_count = 0;
        let churned = darwin::fill(100, |pids| {
            same_count += 1;
            let listed: &[i32] = match same_count {
                1 => &[11, 12, 13],
                2 => &[11, 12, 99],
                _ => &[11, 12, 13, 99],
            };
            pids[..listed.len()].copy_from_slice(listed);
            Ok(listed.len())
        })
        .unwrap();
        assert_eq!(
            churned.len(),
            4,
            "two listings of the same count were taken for one table with a different process in them: {churned:?}"
        );

        let capped = darwin::fill(1, |pids| {
            pids.fill(7);
            Ok(pids.len())
        });
        assert!(
            capped.is_err(),
            "a table that never fitted its room answered a partial list"
        );
        let huge = darwin::fill(darwin::PID_CAP + 1, |_| {
            panic!("a count hint above the cap was listed instead of refused")
        });
        assert!(
            huge.is_err(),
            "a count hint above the cap was allocated and read instead of refused"
        );
    }

    // TEST_SCENARIO: a process whose environment names the machine and whose arguments do not is no VMM of it, and `kill_orphans` signals every pid a scan names. An empty first argument is the shape that reads a process's environment as its arguments, since its NULs cannot be told from the padding the kernel aligns the executable's path with.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_process_whose_environment_names_the_machine_is_not_named() {
        use std::os::unix::process::CommandExt;

        let dir = TempDir::new("vmm-env");
        let needle = format!("{}/", dir.path().join("m1").display());
        let mut child = std::process::Command::new("/bin/sleep")
            .arg0("")
            .arg("30")
            .env_clear()
            .env("REVIEW_ENV", &needle)
            .spawn()
            .unwrap();
        let pid = i32::try_from(child.id()).unwrap();
        let mut named = Vec::new();
        let mut failed = None;
        for scan in 0..10 {
            match darwin::pids_with_arg(&needle) {
                Ok(found) if found.pids().contains(&pid) => named.push(scan),
                Ok(_) => {}
                Err(e) => failed = Some(e),
            }
        }
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(
            named.is_empty(),
            "the scan named a process whose environment alone names the machine, on scans {named:?}"
        );
        if let Some(e) = failed {
            panic!("the scan of the host failed: {e:#}");
        }
    }

    // TEST_SCENARIO: the kernel answers nothing for a process that is installing a new image, which is every VMM at its start, and that answer is not a command line: the read is repeated until the process answers, and a process that never answers is not a command line at all.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_process_that_answered_nothing_is_read_again() {
        let mut answers = [
            darwin::Answer::MidExec,
            darwin::Answer::MidExec,
            darwin::Answer::Args(vec!["_boot-vm".to_string(), "/m/1/".to_string()]),
        ]
        .into_iter();
        let me = i32::try_from(std::process::id()).unwrap();
        let mut name = |_| darwin::identity(me);
        let installed = darwin::look(me, &mut |_| answers.next().expect("read again"), &mut name);
        assert!(
            matches!(&installed, darwin::Look::Read { argv, identity: Some(_) } if argv == &["_boot-vm".to_string(), "/m/1/".to_string()]),
            "the command line a process installs is read, not the nothing it answered first: {installed:?}"
        );
        assert_eq!(
            darwin::look(me, &mut |_| darwin::Answer::MidExec, &mut name),
            darwin::Look::Unknown,
            "a process that never answered is no command line"
        );
    }

    // TEST_SCENARIO: a process table the kernel did not answer is an error and never an empty list. An empty list is how a scan says no process holds the machine, and a runner that reads a failed look that way kills nothing and boots a second VMM on a disk a live one is writing.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_table_the_kernel_did_not_answer_is_an_error() {
        let unlisted = darwin::scan(
            "anything",
            || anyhow::bail!("the kernel listed no processes"),
            darwin::read_args,
        );
        assert!(
            unlisted.is_err(),
            "a table that was not read is not an empty one"
        );
    }

    // TEST_SCENARIO: a pid the kernel will not describe is either a process that is gone, which is the clean answer, or one this runner may not read, which is a process it could not look into and never a machine nothing holds. Either way it is named by nothing, since `kill_orphans` signals every process a scan names. Another user's processes never reach this at all: the kernel lists this user's alone.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_process_the_kernel_will_not_describe_is_named_by_nothing() {
        let nothing = "a needle no command line holds";
        let gone = darwin::scan(nothing, || Ok(vec![i32::MAX]), darwin::read_args).unwrap();
        assert_eq!(gone.pids(), Vec::<i32>::new());
        assert_eq!(
            gone.unknown, 0,
            "a pid that names no process counted as one the scan could not look into"
        );

        // UNIT_BOUNDARY_DESCRIPTION: pid 1 is root's, and this runner may not read its arguments: a process that is there and could not be looked into.
        let unreadable = darwin::scan(nothing, || Ok(vec![1]), darwin::read_args).unwrap();
        assert_eq!(unreadable.pids(), Vec::<i32>::new());
        assert_eq!(
            unreadable.unknown, 1,
            "a live process the kernel would not describe counted as one it described"
        );
    }

    // TEST_SCENARIO: an answer from the kernel holds argc, the executable's path, the padding that aligns the arguments behind it, then argc arguments and the environment, all NUL-separated. An answer holding fewer arguments than argc is a process mid-exec and not a command line; an empty first argument leaves NULs that its padding cannot be told from, so its environment would be read as its arguments; and an argument the buffer ends in the middle of is not one. The environment is never read as an argument, because `kill_orphans` signals every pid a scan names.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_arguments_end_where_the_kernel_says_they_do() {
        let mut short = answer("/bin/sh", &["sh", "-c"], &[]);
        short[0..4].copy_from_slice(&3i32.to_ne_bytes());
        assert_eq!(
            darwin::args_in(&short),
            None,
            "two arguments of three is no command line"
        );
        assert_eq!(
            darwin::args_in(&answer("/bin/sh", &["sh", "-c", "/m/1/"], &["PATH=/m/1/"])),
            Some(vec![
                "sh".to_string(),
                "-c".to_string(),
                "/m/1/".to_string()
            ]),
            "the environment is not an argument"
        );
        assert_eq!(
            darwin::args_in(&answer(
                "/bin/sh",
                &["sh", "", "-c", "/m/1/"],
                &["PATH=/m/1/"]
            )),
            Some(vec![
                "sh".to_string(),
                String::new(),
                "-c".to_string(),
                "/m/1/".to_string()
            ]),
            "an empty argument is an argument, and it does not shift the environment into the arguments"
        );
        assert_eq!(
            darwin::args_in(&answer("/bin/sh", &["", "60"], &["PATH=/m/1/"])),
            Some(vec![String::new(), "60".to_string()]),
            "an empty first argument is an argument, and skipping the padding the path asks for reads it and no environment"
        );
        assert_eq!(
            darwin::args_in(&answer("/bin/sh", &[], &["PATH=/m/1/"])),
            None,
            "no argument at all is no command line"
        );
        let mut unterminated = answer("/bin/sh", &["sh", "-c"], &[]);
        unterminated.pop();
        assert_eq!(
            darwin::args_in(&unterminated),
            None,
            "an argument the buffer ends in the middle of is no command line"
        );
    }

    // UNIT_BOUNDARY_DESCRIPTION: one answer from KERN_PROCARGS2 as the kernel writes it: argc, the executable's path, the padding this host's word size asks for, then the arguments and the environment, all NUL-separated.
    #[cfg(target_os = "macos")]
    fn answer(exec: &str, args: &[&str], env: &[&str]) -> Vec<u8> {
        let mut answer = i32::try_from(args.len()).unwrap().to_ne_bytes().to_vec();
        answer.extend(exec.as_bytes());
        answer.push(0);
        answer.extend(std::iter::repeat_n(0u8, (8 - (exec.len() + 1) % 8) % 8));
        for field in args.iter().chain(env) {
            answer.extend(field.as_bytes());
            answer.push(0);
        }
        answer
    }

    // TEST_SCENARIO: a read the kernel answers from a buffer too small for the arguments that came after it answers a region of NULs where the executable's path and the arguments were, and the read still reports success. Read as a command line it is one of empty arguments, which names no machine and says the process was looked into — a machine nothing holds. It is no command line, and the process is one the scan could not look into.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_truncated_answer_is_no_command_line() {
        let mut zeros = 6i32.to_ne_bytes().to_vec();
        zeros.extend(std::iter::repeat_n(0u8, 64));
        assert_eq!(
            darwin::args_in(&zeros),
            None,
            "a region of NULs where the executable's path belongs was read as a command line of empty arguments"
        );

        // UNIT_BOUNDARY_DESCRIPTION: an empty first argument still follows a real executable path, which is what keeps this from refusing a legitimate one.
        assert_eq!(
            darwin::args_in(&answer("/bin/sh", &["", "60"], &[])),
            Some(vec![String::new(), "60".to_string()]),
            "an empty first argument behind a real path was refused"
        );
    }

    // TEST_SCENARIO: a process whose arguments name no machine must never be named, and `kill_orphans` signals every process a scan names. The environment follows the arguments in the same buffer, so a parse that skips one byte too many or too few reads a machine's directory out of the environment. Empty leading arguments are what a parser shifting fields gets wrong: they leave NULs where a padding looks like it continues, and there can be any number of them.
    #[cfg(target_os = "macos")]
    #[test]
    fn empty_arguments_never_hand_the_environment_over_as_arguments() {
        let machine = "/m/1/";
        let env = ["REVIEW_ENV=/m/1/", "B=1", "C=2", "D=3"];
        for path in ["p", "pp", "ppp", "pppp", "ppppp", "pppppp", "ppppppp"] {
            for empties in 0..6 {
                let mut argv: Vec<&str> = vec![""; empties];
                argv.push("60");
                let Some(parsed) = darwin::args_in(&answer(path, &argv, &env)) else {
                    continue;
                };
                assert!(
                    !parsed.iter().any(|arg| arg.contains(machine)),
                    "a command line of {path:?} and {empties} empty leading arguments named the machine from its environment: {parsed:?}"
                );
                if !parsed.is_empty() {
                    assert_eq!(
                        parsed[parsed.len() - 1], "60",
                        "a command line of {path:?} and {empties} empty leading arguments did not end where its count says: {parsed:?}"
                    );
                }
            }
        }
        assert_eq!(
            darwin::args_in(&answer("/bin/sleep", &["", "", "", "", "60"], &env)),
            Some(vec![
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                "60".to_string()
            ]),
            "four empty leading arguments are four empty arguments, and the environment behind them is not read"
        );
    }

    // UNIT_BOUNDARY_DESCRIPTION: a stand-in `/proc` entry, which is a Linux process table alone: a Mac reads the kernel's own list, so nothing there consults this.
    #[cfg(not(target_os = "macos"))]
    fn process(proc: &TempDir, pid: i32, cmdline: &str) {
        let dir = proc.path().join(pid.to_string());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("cmdline"), cmdline).unwrap();
    }

    // TEST_SCENARIO: a VMM killed by a signal is told apart from one that exited on its own, and from one this process cannot read at all — a machine another runner release booted, whose VMM is nobody's child here. Only the kill carries a signal, which is what the machine's status reports.
    #[test]
    fn a_vmm_the_kernel_killed_reports_its_signal() {
        let mut child = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let pid = i32::try_from(child.id()).unwrap();
        assert!(matches!(ended(pid), Ended::Running), "a running VMM exited");
        // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
        unsafe { libc::kill(pid, libc::SIGSYS) };
        let deadline = Instant::now() + Duration::from_secs(5);
        let signal = loop {
            if let Ended::Signalled(signal) = ended(pid) {
                break signal;
            }
            assert!(Instant::now() < deadline, "the VMM never exited");
            std::thread::sleep(Duration::from_millis(5));
        };
        assert_eq!(signal, libc::SIGSYS);
        assert!(
            matches!(ended(pid), Ended::Running),
            "a VMM whose status was already read is not read again"
        );
        let _ = child.wait();
    }

    // TEST_SCENARIO: a VMM that exits on its own is told apart from one a signal ended, so a machine that stopped itself is not reported as a kill.
    #[test]
    fn a_vmm_that_exits_on_its_own_is_not_a_kill() {
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let pid = i32::try_from(child.id()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match ended(pid) {
                Ended::Exited => break,
                _ => {
                    assert!(Instant::now() < deadline, "the VMM never exited");
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        }
        let _ = child.wait();
    }
}
