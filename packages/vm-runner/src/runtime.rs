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
    // UNIT_BOUNDARY_DESCRIPTION: the process of the machine's running VMM, or nothing when no VMM runs or the runtime keeps none. The runner reaps that process itself, so it learns the signal that ended it — a seccomp filter's kill or the kernel's — where smolvm's own sweep over its children discards the status.
    fn vmm_pid(&self, _id: &str) -> Option<i32> {
        None
    }

    // UNIT_BOUNDARY_DESCRIPTION: the pid the machine's own record names, whether or not that process is still the one the record meant: a VMM the loader reaped is gone, so its start time cannot be checked any more, and the pid is the only link to the exit the loader recorded. Read only to match such a record, never to reap.
    fn vmm_record_pid(&self, _id: &str) -> Option<i32> {
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

// UNIT_BOUNDARY_DESCRIPTION: the processes still holding a machine's directory. Every VMM smolvm spawns names its machine's directory on its command line, so this finds a VMM a previous runner process left behind as well as one of ours. The trailing slash keeps a machine from matching another whose directory name it prefixes. A scan that could not look answers with an error rather than with an empty list, since an empty list says no VMM holds the machine: only a process that exited mid-scan, leaving no command line at all, is that clean answer.
pub fn orphan_pids(proc_root: &Path, vm_dir: &Path) -> anyhow::Result<Vec<i32>> {
    let dir = vm_dir.to_string_lossy();
    if dir.is_empty() {
        return Ok(Vec::new());
    }
    let needle = format!("{dir}/");
    let entries = fs::read_dir(proc_root);
    #[cfg(target_os = "macos")]
    let Ok(entries) = entries
    else {
        return darwin::pids_with_arg(&needle);
    };
    #[cfg(not(target_os = "macos"))]
    let entries = entries.with_context(|| format!("scanning {} for a VMM", proc_root.display()))?;
    let mut pids: Vec<i32> = Vec::new();
    for entry in entries {
        let entry = entry.with_context(|| format!("scanning {} for a VMM", proc_root.display()))?;
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
                return Err(e).with_context(|| format!("reading the command line of process {pid}"))
            }
        };
        if String::from_utf8_lossy(&cmdline).contains(&needle) {
            pids.push(pid);
        }
    }
    pids.sort_unstable();
    Ok(pids)
}

// UNIT_BOUNDARY_DESCRIPTION: waits up to `limit` for the VMMs holding the machine's directory to exit, and returns the ones still there: those its command line names, and those in `seen`, found before a stop. A VMM's command line goes blank the moment it starts exiting, while its threads still hold its disks and published ports until the last of them exits — so a VMM the runner killed itself, or whose stop it went past, is only found through `seen`. smolvm's own stop waits for every thread since 1.18. A start issued before then is refused in a way that looks like a machine that can never start, or cannot bind the machine's port. A machine that is really stopped answers at once, and only a scan that looked says so: a scan that failed is waited out like one that found a VMM, since it has not shown the machine is free.
pub fn vmms_left(proc_root: &Path, vm_dir: &Path, mut seen: Vec<i32>, limit: Duration) -> Vec<i32> {
    let deadline = Instant::now() + limit;
    let mut looked = false;
    loop {
        match orphan_pids(proc_root, vm_dir) {
            Ok(found) => {
                looked = true;
                seen.extend(found);
            }
            Err(e) => tracing::warn!(
                machine = %vm_dir.display(),
                "could not scan the host for a VMM holding the machine: {e:#}"
            ),
        }
        seen.sort_unstable();
        seen.dedup();
        seen.retain(|&pid| !exited(proc_root, pid));
        if (looked && seen.is_empty()) || Instant::now() >= deadline {
            return seen;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a process has let go of everything once it is gone, or is a zombie with no thread left beside it. A zombie main thread alone is not enough: the threads it leaves share its open files and close them only when the last one exits.
fn exited(proc_root: &Path, pid: i32) -> bool {
    #[cfg(target_os = "macos")]
    if !proc_root.is_dir() {
        return darwin::exited(pid);
    }
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

// UNIT_BOUNDARY_DESCRIPTION: the host runner's process table. A Mac has no /proc, so the VMMs holding a machine's directory are found through the kernel's process list and each process's arguments, as `/proc/<pid>/cmdline` finds them on Linux.
#[cfg(target_os = "macos")]
pub(crate) mod darwin {
    use std::ffi::c_void;
    use std::mem;
    use std::time::Duration;

    // UNIT_BOUNDARY_DESCRIPTION: how long a process that answered no arguments is waited out, and how often it is read again. A process installing a new image answers nothing, or a partial answer, for the moment the kernel takes to swap its arguments, and answers its own again right after; every VMM is in that moment at its start. A process that answers nothing four times, a millisecond apart, is taken to have no command line, which is the safe way to be wrong: `kill_orphans` signals every pid a scan names. Only a process that answered nothing pays the pause.
    const ARG_READS: usize = 4;
    const ARG_READ_PAUSE: Duration = Duration::from_millis(1);

    // UNIT_BOUNDARY_DESCRIPTION: the pids whose arguments hold `needle`. A table the kernel did not answer is an error, never an empty list: an empty list says no process holds the machine, and `kill_orphans` and `vmms_left` read that as nobody to kill and nothing left.
    pub fn pids_with_arg(needle: &str) -> anyhow::Result<Vec<i32>> {
        scan(needle, table)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the scan itself, over a process table its caller names, so the answer to a table the kernel would not list is a test of this crate and not of the kernel.
    pub(super) fn scan(
        needle: &str,
        table: impl FnOnce() -> anyhow::Result<Vec<i32>>,
    ) -> anyhow::Result<Vec<i32>> {
        let mut found: Vec<i32> = table()?
            .into_iter()
            .filter(|&pid| {
                args(|| read_args(pid))
                    .iter()
                    .any(|arg| arg.contains(needle))
            })
            .collect();
        found.sort_unstable();
        Ok(found)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the pids in the kernel's process table, with the room a scan needs for the processes born between asking its size and reading it. A listing that failed, or one that holds no pid at all, is an error: a process table always holds pid 1, and an empty one would say nothing runs on the host.
    fn table() -> anyhow::Result<Vec<i32>> {
        let check = |listed: i32| match usize::try_from(listed) {
            Ok(count) if count > 0 => Ok(count),
            _ => Err(anyhow::anyhow!(
                "listing the host's processes: {}",
                std::io::Error::last_os_error()
            )),
        };
        // SAFETY: a null buffer asks only for the number of pids.
        let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        let mut pids = vec![0i32; check(count)? + 64];
        let bytes = i32::try_from(pids.len() * mem::size_of::<i32>()).unwrap_or(i32::MAX);
        // SAFETY: the buffer holds `bytes` bytes of pids.
        let listed = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast::<c_void>(), bytes) };
        pids.truncate(check(listed)?);
        pids.retain(|&pid| pid > 0);
        Ok(pids)
    }

    // UNIT_BOUNDARY_DESCRIPTION: a process's arguments, without its environment. A process the kernel will not answer for — gone, a zombie, root's or a kernel task's — has none, and neither has one that answered nothing every time it was read: a VMM names its machine's directory on the command line of a process this user runs, and an argument that cannot be read cannot be matched against, so the scan names no process it could not check.
    pub(super) fn args(mut read: impl FnMut() -> Answer) -> Vec<String> {
        (0..ARG_READS)
            .find_map(|attempt| {
                if attempt > 0 {
                    std::thread::sleep(ARG_READ_PAUSE);
                }
                match read() {
                    Answer::Args(args) => Some(args),
                    Answer::Gone => Some(Vec::new()),
                    Answer::MidExec => None,
                }
            })
            .unwrap_or_default()
    }

    pub(super) enum Answer {
        Args(Vec<String>),
        Gone,
        MidExec,
    }

    // UNIT_BOUNDARY_DESCRIPTION: one read of a process's arguments through KERN_PROCARGS2, which answers the size the buffer must hold when given none, and a temporary failure — EIO, EAGAIN, EINTR, ENOMEM — for a process the kernel is in the middle of an exec on.
    fn read_args(pid: i32) -> Answer {
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
            return answer_of(std::io::Error::last_os_error());
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
            return answer_of(std::io::Error::last_os_error());
        }
        buf.truncate(size);
        args_in(&buf).map_or(Answer::MidExec, Answer::Args)
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the kernel failed to answer, or answered that it cannot: a process exiting or changing its image fails with EIO, EAGAIN, EINTR or ENOMEM and answers again a moment later, while EINVAL and ESRCH are answers — the process is gone, a zombie, or another user's.
    fn answer_of(error: std::io::Error) -> Answer {
        match error.raw_os_error() {
            Some(libc::EIO | libc::EAGAIN | libc::EINTR | libc::ENOMEM) => Answer::MidExec,
            _ => Answer::Gone,
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the arguments in one answer from KERN_PROCARGS2: argc, the executable's path, the padding that aligns them, then argc arguments and the environment, all NUL-separated. Around argc the kernel counts the arguments, so a string from the environment is never read as one and an argument that is empty is still an argument. An answer holding fewer arguments than argc is not one — a process mid-exec answers its old count over an empty buffer — so it is no answer at all rather than a partial list that names nothing.
    pub(super) fn args_in(answer: &[u8]) -> Option<Vec<String>> {
        let (argc, rest) = answer.split_first_chunk::<4>()?;
        let argc = usize::try_from(i32::from_ne_bytes(*argc)).unwrap_or(0);
        let args: Vec<String> = rest
            .split(|&b| b == 0)
            .skip(1)
            .skip_while(|field| field.is_empty())
            .take(argc)
            .map(|field| String::from_utf8_lossy(field).into_owned())
            .collect();
        (args.len() == argc).then_some(args)
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
    let pids = orphan_pids(proc_root, vm_dir).unwrap_or_else(|e| {
        tracing::warn!(
            machine = %vm_dir.display(),
            "could not scan the host for a VMM holding the machine: {e:#}"
        );
        Vec::new()
    });
    for pid in pids {
        // SAFETY: kill(2) takes no pointers; a pid that has already exited returns ESRCH, which is ignored.
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
}

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

// UNIT_BOUNDARY_DESCRIPTION: prepares a machine's directory for a fresh boot: any VMM still holding it is waited out for `wait` and then killed, the files a dead VMM leaves are removed, a storage disk that holds a filesystem is marked formatted, and the console an earlier boot wrote is emptied. A VMM that outlives even SIGKILL — stuck in uninterruptible sleep on its disk — fails the start instead: its lock and sockets are what keep a second VMM off the same storage disk, and a second VMM writing that disk under the first corrupts the agent's home.
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
            found = orphan_pids(proc_root, &vm_dir).unwrap_or_default();
            if !found.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(found, vec![pid], "the scan names the stand-in alone");
        assert!(orphan_pids(proc_root, &dir.path().join("m"))
            .unwrap()
            .is_empty());

        kill_orphans(proc_root, &vm_dir);
        vmm.wait().unwrap();
        assert!(vmms_left(proc_root, &vm_dir, vec![pid], Duration::from_secs(5)).is_empty());
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
            orphan_pids(proc.path(), &dir).unwrap(),
            Vec::<i32>::new(),
            "a process that exited mid-scan read as a failed scan"
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

        assert_eq!(orphan_pids(proc.path(), &dir).unwrap(), vec![100]);
        assert!(orphan_pids(proc.path(), Path::new("")).unwrap().is_empty());
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
        for scan in 0..SCAN_ATTEMPTS {
            if !darwin::pids_with_arg(&needle).unwrap().contains(&pid) {
                misses.push(scan);
            }
        }
        vmm.kill().unwrap();
        vmm.wait().unwrap();
        assert!(
            misses.is_empty(),
            "the scan missed the live VMM on scans {misses:?}"
        );
    }

    // TEST_SCENARIO: the kernel answers nothing for a process that is installing a new image, which is every VMM at its start, and that answer is not a command line: the read is repeated until the process answers, and a process that never answers is not named, since `kill_orphans` signals every pid a scan names.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_process_that_answered_nothing_is_read_again() {
        let mut answers = [
            darwin::Answer::MidExec,
            darwin::Answer::MidExec,
            darwin::Answer::Args(vec!["_boot-vm".to_string(), "/m/1/".to_string()]),
        ]
        .into_iter();
        assert_eq!(
            darwin::args(|| answers.next().expect("read again")),
            ["_boot-vm", "/m/1/"],
            "the command line a process installs is read, not the nothing it answered first"
        );
        assert_eq!(
            darwin::args(|| darwin::Answer::MidExec),
            Vec::<String>::new(),
            "a process that never answered is named by nothing"
        );
    }

    // TEST_SCENARIO: a process table the kernel did not answer is an error and never an empty list. An empty list is how a scan says no process holds the machine, and a runner that reads a failed look that way kills nothing and boots a second VMM on a disk a live one is writing.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_table_the_kernel_did_not_answer_is_an_error() {
        let unlisted = darwin::scan("anything", || {
            anyhow::bail!("the kernel listed no processes")
        });
        assert!(
            unlisted.is_err(),
            "a table that was not read is not an empty one"
        );
    }

    // TEST_SCENARIO: the kernel answers nothing for the processes it keeps to itself — pid 1, root's daemons, every kernel task — and a scan that read those as failures would fail on every machine. They are named by nothing, and they do not fail the scan.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_process_the_kernel_will_not_describe_is_named_by_nothing() {
        let unreadable = darwin::scan("a needle no command line holds", || Ok(vec![1, i32::MAX]));
        assert_eq!(unreadable.unwrap(), Vec::<i32>::new());
    }

    // TEST_SCENARIO: an answer from the kernel holds argc, the executable's path, the padding that aligns the arguments, then argc arguments and the environment. An answer holding fewer arguments than argc is a process mid-exec and not a command line, and the environment is never read as an argument: `kill_orphans` signals every pid a scan names, so a needle in another process's environment must not name it.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_arguments_end_where_the_kernel_says_they_do() {
        let answer = |argc: i32, rest: &[u8]| {
            let mut answer = argc.to_ne_bytes().to_vec();
            answer.extend(rest);
            answer
        };
        assert_eq!(
            darwin::args_in(&answer(3, b"/bin/sh\0\0\0sh\0-c")),
            None,
            "two arguments of three is no command line"
        );
        assert_eq!(
            darwin::args_in(&answer(3, b"/bin/sh\0\0\0sh\0-c\0/m/1/\0PATH=/m/1/\0")),
            Some(vec![
                "sh".to_string(),
                "-c".to_string(),
                "/m/1/".to_string()
            ]),
            "the environment is not an argument"
        );
        assert_eq!(
            darwin::args_in(&answer(4, b"/bin/sh\0\0\0sh\0\0-c\0/m/1/\0PATH=/m/1/\0")),
            Some(vec![
                "sh".to_string(),
                String::new(),
                "-c".to_string(),
                "/m/1/".to_string()
            ]),
            "an empty argument is an argument, and it does not shift the environment into the arguments"
        );
    }

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
