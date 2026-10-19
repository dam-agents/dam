// UNIT_BOUNDARY_DESCRIPTION: the init of every vm-backend machine, its PID 1. It sets the VM up as smolvm's guest agent and crun did (vm.rs), mounts the machine's storage disk, boots the image on a root of its own that lasts as long as the image does, mounts the agent's home from the disk, gives it empty temporary folders, and starts the image's own entrypoint, which it then supervises. It exists so persistence is the platform's to guarantee rather than the image's to implement: the runner supplies this binary, so an image that has never heard of this platform still keeps its agent's home across a stop, and a machine that cannot mount its disk does not boot at all rather than losing its work at the first stop.
use std::collections::HashSet;
use std::ffi::{CString, OsStr, OsString};
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::guest::{self, SeedDigest};
use crate::pool_guard::{guard_look, read_grant, PoolGuard, POOL_GUARD_FLOOR};

const BOOT_LOG_CAP: u64 = 32 << 20;
const TRUST_CACHE_ENV: &str = "PLATFORM_TRUST_CACHE";
const TRUST_CACHE_PATH: &str = "/var/cache/platform/trust";
const BOOT_LOG_NAME: &str = "agent-runtime.log";

// UNIT_BOUNDARY_DESCRIPTION: what a container runtime searches when an image names a bare command and its config sets no PATH. Without this an image that boots as a container would fail as a machine, on nothing but the absence of a variable it never had to set.
const DEFAULT_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

// UNIT_BOUNDARY_DESCRIPTION: one line to stderr, written in a single call. Stderr is the boot log once it is open, and the log is on the disk, so a write can fail with the disk full; that must not stop the boot, so the error is dropped.
fn log(message: std::fmt::Arguments) {
    let line = format!("platform-init: {message}\n");
    let _ = io::stderr().write_all(line.as_bytes());
}

macro_rules! logf {
    ($($arg:tt)*) => { log(format_args!($($arg)*)) };
}

// UNIT_BOUNDARY_DESCRIPTION: every caller is a condition under which the guest would come up without its persisted paths. An agent that runs and quietly discards its work looks healthy until the machine stops, so a machine that cannot persist does not boot at all. A step that failed because the disk has no space or no inode left says the home is full (guest::HOME_FULL), so the runner reports a full home and its fix, more storage, rather than a boot that failed for no reason it names.
macro_rules! fatal {
    ($($arg:tt)*) => {{
        announce(&fatal_line(&format!("{}", format_args!($($arg)*))));
        exit(1)
    }};
}

fn fatal_line(message: &str) -> String {
    let full = [libc::ENOSPC, libc::EDQUOT]
        .iter()
        .any(|code| message.contains(&io::Error::from_raw_os_error(*code).to_string()));
    if full {
        format!("FATAL: {message}; {}", guest::HOME_FULL)
    } else {
        format!("FATAL: {message}")
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a line the runner must be able to read as well as the boot log. The boot log is on the guest's disk, which the host never reads, and before it is open stderr is /dev/null. The kernel log reaches the machine's console, whose end the runner puts in the Agent's status when a boot fails or goes quiet, so these lines go there too.
fn announce(message: &str) {
    log(format_args!("{message}"));
    let _ = OpenOptions::new()
        .write(true)
        .open(KMSG)
        .and_then(|mut kmsg| kmsg.write_all(console_line(message).as_bytes()));
}

const KMSG: &str = "/dev/kmsg";

// UNIT_BOUNDARY_DESCRIPTION: one kernel log record. The kernel takes a record of about a kilobyte, and prints it to the console only when its level is below the console's, which smolvm's quiet kernel sets to errors, so an error-level record stays in the ring buffer and never leaves the guest. So the line is cut to fit and sent at critical level, which reaches the console while its level is above that. A console quieter still would need emergency level, the one level every console prints.
const CONSOLE_LINE_MAX: usize = 900;

fn console_line(message: &str) -> String {
    let mut line = format!("<2>platform-init: {message}");
    if line.len() > CONSOLE_LINE_MAX {
        let mut cut = CONSOLE_LINE_MAX;
        while !line.is_char_boundary(cut) {
            cut -= 1;
        }
        line.truncate(cut);
    }
    line.push('\n');
    line
}

// UNIT_BOUNDARY_DESCRIPTION: ends platform-init, and with it the machine's workload. A thread of this process writes the boot log, so the log is flushed and the thread waited for first. Without that, the line that explains the exit is the one that never reaches the disk. As the guest's PID 1, its exit panics the kernel, which resets the VM before the console has passed on its last lines, the one that explains the exit among them, so it gives the console a second first.
fn exit(code: i32) -> ! {
    close_boot_log();
    if std::process::id() == 1 {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    std::process::exit(code)
}

mod vm;

pub use vm::stage0;

pub fn run() -> ! {
    // UNIT_BOUNDARY_DESCRIPTION: a panic of the guest's init ends the guest, and its message would go only to the boot log, which a thread may not have written out yet; it goes to the console too, where the runner reads why a boot ended, with the second the console needs before the reset (see exit).
    std::panic::set_hook(Box::new(|info| {
        announce(&format!("FATAL: {info}"));
        std::thread::sleep(std::time::Duration::from_secs(1));
    }));
    block_signals();
    stop_propagation();
    let machine = vm::prepare();
    let disk = machine.disk.clone();
    open_boot_log(&disk);

    logf!("storage disk mounted at {}", disk.display());
    claim_layout(&disk);
    fresh_root(&disk, &machine);
    vm::serve();
    let root = PathBuf::from(guest::DISK_PATH);
    bind_ca();
    let expected = match expected_seed(Path::new(guest::SEED_EXPECTED_PATH)) {
        Ok(expected) => expected,
        Err(e) => fatal!("reading the seed the runner expects: {e}"),
    };
    persist_home(
        &root,
        fs::metadata(guest::SEEDED_PATH).is_ok(),
        expected.as_ref(),
    );
    let trust = offer_trust_cache();
    show_boot_log(&root);
    let guard = pool_guard(&root);
    leave_disk(&root);
    share_mounts();
    enter_workdir(Path::new(machine.launch.workdir.as_deref().unwrap_or("/")));

    let command: Vec<OsString> = machine.launch.command.iter().map(OsString::from).collect();
    let env = &machine.launch.env;
    let search = env
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| OsString::from(value));
    let binary = match look_path(&command[0], search) {
        Ok(binary) => binary,
        Err(e) => fatal!(
            "the image's entrypoint {:?} is not executable in this guest: {e}",
            command[0]
        ),
    };
    let swapping = compressed_swap();
    std::thread::spawn(move || reclaim_cold_cache(swapping));
    let scratch = scratch_folders();
    std::thread::spawn(move || evict_scratch(&scratch));
    std::thread::spawn(trim_disk);
    if let Some(guard) = guard {
        *POOL_GUARD.lock().unwrap_or_else(|e| e.into_inner()) = Some(guard);
        std::thread::spawn(guard_pool);
    }
    let openrc = Path::new(OPENRC).exists();
    if openrc {
        let mut stopping = false;
        for runlevel in ["sysinit", "boot", "default"] {
            run_openrc(runlevel, env, &mut stopping);
            if stopping {
                break;
            }
        }
        if stopping {
            stop(openrc);
        }
    }
    supervise(&binary, &command, env, trust.as_deref(), openrc)
}

// UNIT_BOUNDARY_DESCRIPTION: an image that ships openrc opts in to its services: platform-init stays PID 1 and runs openrc's runlevels before the entrypoint, as an init that boots openrc would, and openrc's shutdown when the machine stops. An image without it boots its entrypoint alone.
const OPENRC: &str = "/sbin/openrc";

// UNIT_BOUNDARY_DESCRIPTION: a runlevel that fails is a line on the console and not a failed boot: the entrypoint, which is the agent, may not need the service that failed. It is waited for as the entrypoint is, reaping every orphan meanwhile: a service's daemon is an orphan of PID 1, and openrc stopping one waits until its process is gone, which a zombie never is. A stop that arrives meanwhile is passed on to openrc and noted in `stopping`. openrc runs in the entrypoint's environment, of which its rc_env_allow passes on only what the image names, such as the gateway a service pulls through.
fn run_openrc(runlevel: &str, env: &[(String, String)], stopping: &mut bool) {
    let mut openrc = std::process::Command::new(OPENRC);
    openrc.arg(runlevel).env_clear().env("PATH", DEFAULT_PATH);
    let spawned = unblocked(openrc.envs(env.iter().map(|(key, value)| (key, value)))).spawn();
    match spawned.map(|child| wait_for(child.id(), stopping)) {
        Ok(0) => logf!("openrc {runlevel} done"),
        Ok(status) => announce(&format!(
            "WARNING: openrc {runlevel} {}",
            exit_description(status)
        )),
        Err(e) => announce(&format!("WARNING: running openrc {runlevel}: {e}")),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a guest keeps the files it read in its page cache until something needs the memory, and the host counts that cache as memory the machine holds, so an agent that once read a large tree holds it long after. Every RECLAIM_INTERVAL the cache on the kernel's inactive list — what nothing has touched lately — is handed to the root cgroup's proactive reclaim, and the pages it frees go back to the host through free-page reporting within seconds. With compressed swap (`swapping`) the inactive anonymous memory is handed over too, so what the agent's processes hold but have not touched lately is compressed into zram and the rest of its pages go back to the host; without it reclaim drops only file pages. A guest kernel without cgroup v2 reclaim gives nothing to read or write, and the loop does nothing.
const RECLAIM_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
const RECLAIM_FLOOR: u64 = 64 << 20;

fn reclaim_cold_cache(swapping: bool) {
    let order = fs::read_to_string("/sys/module/page_reporting/parameters/page_reporting_order")
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(DEFAULT_REPORTING_ORDER);
    let mut settled = scattered_free(order).unwrap_or(0);
    loop {
        std::thread::sleep(RECLAIM_INTERVAL);
        if let Some(cold) = fs::read_to_string("/sys/fs/cgroup/memory.stat")
            .ok()
            .and_then(|stat| {
                let anon = if swapping {
                    stat_bytes(&stat, "inactive_anon")?
                } else {
                    0
                };
                Some(stat_bytes(&stat, "inactive_file")? + anon)
            })
        {
            if cold >= RECLAIM_FLOOR {
                let _ = fs::write("/sys/fs/cgroup/memory.reclaim", cold.to_string());
            }
        }
        let Some(scattered) = scattered_free(order) else {
            continue;
        };
        if scattered >= settled + SCATTERED_RISE {
            let _ = fs::write(
                "/sys/fs/cgroup/memory.reclaim",
                (scattered - settled).to_string(),
            );
            let _ = fs::write("/proc/sys/vm/compact_memory", "1");
            settled = scattered_free(order).unwrap_or(scattered);
        } else {
            settled = settled.min(scattered);
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: free-page reporting hands the host only free blocks of at least the reporting order, 2 MiB on the guests' kernel, so memory a program frees between pages the guest still uses stays counted on the host: on dev about 600 MiB after a burst of processes ended, for as long as the pages pinning it lived. When the free memory in smaller blocks has risen by SCATTERED_RISE since the last look, that much cold cache and slab is reclaimed and the guest's memory compacted, which merges the free pages into blocks the host takes back, in about a quarter of a second of guest time. A guest whose memory stays scattered is not compacted again until more is freed.
const SCATTERED_RISE: u64 = 128 << 20;
const DEFAULT_REPORTING_ORDER: usize = 9;

fn scattered_free(order: usize) -> Option<u64> {
    let buddy = fs::read_to_string("/proc/buddyinfo").ok()?;
    // SAFETY: sysconf has no preconditions.
    let page = u64::try_from(unsafe { libc::sysconf(libc::_SC_PAGESIZE) }).ok()?;
    Some(free_below_order(&buddy, order) * page)
}

// UNIT_BOUNDARY_DESCRIPTION: free pages in blocks smaller than `order`, over every zone of /proc/buddyinfo, whose lines are "Node N, zone NAME" and then the count of free blocks of each order from 0.
fn free_below_order(buddyinfo: &str, order: usize) -> u64 {
    buddyinfo
        .lines()
        .flat_map(|line| {
            line.split_whitespace()
                .skip(4)
                .take(order)
                .enumerate()
                .filter_map(|(o, count)| count.parse::<u64>().ok().map(|count| count << o))
        })
        .sum()
}

fn stat_bytes(stat: &str, key: &str) -> Option<u64> {
    stat.lines()
        .find_map(|line| line.strip_prefix(key)?.strip_prefix(' '))?
        .trim()
        .parse()
        .ok()
}

// UNIT_BOUNDARY_DESCRIPTION: makes zram swap: memory the guest's processes hold but no longer touch is kept compressed in RAM rather than whole, so a machine of the same size holds about half to a quarter as much of it on the host. The guest boots below its size and grows once it is up, so the device takes ZRAM_BOOT_RAM_MULTIPLE times the RAM it boots with in uncompressed pages, a quarter to the whole of the machine's size; an unused device costs only its table. Pages are compressed with zstd: on an idle V8 heap it stored 1.5 GB in 163 MB where lz4 needed about 420 MB, and reading the heap back took 1.0 s against 0.86 s, and compression runs in the reclaim pass, off any request; swappiness 100 weighs a page in zram like a page of file cache, since reading one back costs about as little, and page-cluster 0 reads back one page at a time, as zram has no seek to amortise. The container's /sys is read-only and its /dev has no zram node, so the device is set up through a sysfs of platform-init's own, mounted at ZRAM_SYSFS and detached again, and its node is made from the numbers sysfs gives. A kernel without zram, or a device that will not set up, leaves the guest without swap, as before. True when swap is on.
const ZRAM_BOOT_RAM_MULTIPLE: u64 = 2;
const ZRAM_SYSFS: &str = "/run/platform-zram-sysfs";

fn compressed_swap() -> bool {
    let Ok(numbers) = fs::read_to_string("/sys/block/zram0/dev") else {
        return false;
    };
    // SAFETY: sysconf has no preconditions.
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as usize;
    let sysfs = Path::new(ZRAM_SYSFS);
    let result = (|| -> io::Result<()> {
        let (major, minor) = numbers
            .trim()
            .split_once(':')
            .and_then(|(major, minor)| Some((major.parse().ok()?, minor.parse().ok()?)))
            .ok_or_else(|| io::Error::other(format!("zram0 is device {numbers:?}")))?;
        let node = CString::new("/dev/zram0").expect("static path");
        // SAFETY: a NUL-terminated path; an existing node is left as it is.
        if unsafe {
            libc::mknod(
                node.as_ptr(),
                libc::S_IFBLK | 0o600,
                libc::makedev(major, minor),
            )
        } != 0
            && io::Error::last_os_error().kind() != io::ErrorKind::AlreadyExists
        {
            return Err(io::Error::last_os_error());
        }
        fs::create_dir_all(sysfs)?;
        let (source, fstype, target) = (
            CString::new("sysfs").expect("static"),
            CString::new("sysfs").expect("static"),
            CString::new(ZRAM_SYSFS).expect("static path"),
        );
        // SAFETY: NUL-terminated source, target and type, and no data.
        if unsafe {
            libc::mount(
                source.as_ptr(),
                target.as_ptr(),
                fstype.as_ptr(),
                0,
                std::ptr::null(),
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        let zram = sysfs.join("block/zram0");
        let configured = (|| -> io::Result<()> {
            let ram = fs::read_to_string("/proc/meminfo")?
                .lines()
                .find_map(|line| {
                    line.strip_prefix("MemTotal:")?
                        .trim()
                        .strip_suffix(" kB")?
                        .parse::<u64>()
                        .ok()
                })
                .ok_or_else(|| io::Error::other("no MemTotal in /proc/meminfo"))?;
            fs::write(zram.join("comp_algorithm"), "zstd")?;
            fs::write(
                zram.join("disksize"),
                (ram * 1024 * ZRAM_BOOT_RAM_MULTIPLE).to_string(),
            )
        })();
        // SAFETY: the NUL-terminated target mounted above.
        unsafe { libc::umount2(target.as_ptr(), libc::MNT_DETACH) };
        configured?;
        let size = fs::read_to_string("/sys/block/zram0/size")?
            .trim()
            .parse::<u64>()
            .map_err(io::Error::other)?
            * 512;
        OpenOptions::new()
            .write(true)
            .open("/dev/zram0")?
            .write_all(&swap_header(page, size))?;
        let device = CString::new("/dev/zram0").expect("static path");
        // SAFETY: a NUL-terminated path to the device the header was just written to.
        if unsafe { libc::swapon(device.as_ptr(), 0) } != 0 {
            return Err(io::Error::last_os_error());
        }
        fs::write("/proc/sys/vm/swappiness", "100")?;
        fs::write("/proc/sys/vm/page-cluster", "0")
    })();
    match result {
        Ok(()) => true,
        Err(e) => {
            logf!("WARNING: setting up zram swap ({e}); the guest runs without swap");
            false
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the first page of a swap area, as mkswap writes it (struct swap_header, version 1): the last usable page at 1028, no bad pages, and the magic `SWAPSPACE2` in the page's last ten bytes.
fn swap_header(page: usize, size: u64) -> Vec<u8> {
    let mut header = vec![0; page];
    header[1024..1028].copy_from_slice(&1u32.to_ne_bytes());
    header[1028..1032].copy_from_slice(&((size / page as u64 - 1) as u32).to_ne_bytes());
    header[page - 10..].copy_from_slice(b"SWAPSPACE2");
    header
}

// UNIT_BOUNDARY_DESCRIPTION: the kernel refuses to move a mount out of a shared parent, and refuses pivot_root when either root's parent is shared. So the tree is made a slave before the disk is moved: mounts made elsewhere in the guest still arrive, and nothing this boot does leaves it. A private tree is left as it is.
fn stop_propagation() {
    if let Err(e) = mount(Path::new(""), Path::new("/"), libc::MS_REC | libc::MS_SLAVE) {
        logf!(
            "WARNING: making the mount tree a slave ({e}); moving the disk and the root may fail"
        );
    }
}

// UNIT_BOUNDARY_DESCRIPTION: holds the boot to a disk whose layout this platform-init knows, before anything else is read from the disk or written to it. A disk marked with a newer layout was written by a newer platform-init — a runner rolled back past it — and this one would misread it, so the boot stops rather than seed or mount by the wrong names. A disk with no mark is in the one layout the storage mount boots (vm::mount_storage), and gets the mark now; a mark that names an older layout means the disk is not what its mark says, and the boot stops rather than guess. A mark that is empty or only zeros counts as no mark: a disk with no journal can lose a file's data to an unclean stop and keep its name, and the home under it is still intact.
fn claim_layout(root: &Path) {
    match mark_layout(root, guest::LAYOUT_VERSION) {
        Ok(Some(version)) => logf!("marked the disk as layout {version}"),
        Ok(None) => {}
        Err(e) => fatal!("reading the disk's layout: {e}"),
    }
}

fn mark_layout(root: &Path, layout: u32) -> io::Result<Option<u32>> {
    let path = guest::system_store(root, guest::LAYOUT_FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    let text = text.trim_matches(|c: char| c == '\0' || c.is_whitespace());
    if text.is_empty() {
        write_record(&path, format!("{layout}\n").as_bytes())?;
        return Ok(Some(layout));
    }
    match text.parse::<u32>() {
        Ok(version) if version == layout => Ok(None),
        Ok(version) if version > guest::LAYOUT_VERSION => Err(io::Error::other(format!(
            "the disk is in layout {version}, and this platform-init knows layouts up to {}. Refusing to boot a disk a newer platform-init wrote",
            guest::LAYOUT_VERSION
        ))),
        Ok(version) if version <= guest::LAYOUT_VERSION => Err(io::Error::other(format!(
            "the disk is marked as layout {version}, but holds layout {layout}"
        ))),
        _ => Err(io::Error::other(format!(
            "{} holds {:?}, which is not a layout this platform-init knows",
            path.display(),
            text
        ))),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: boots the image on the platform's root: an overlay whose lower layer is the image tree the VMM shares, and whose upper and work layers are on the disk. The upper layer is kept while the machine boots the image that wrote it, as the runner names it in the share, and emptied when the image changed or either side names none, so what the image writes outside HOME lasts exactly as long as that image. The VM's own mounts go in before the pivot: /dev, /proc and /sys move over from init.krun, /run is a fresh tmpfs, every share goes to the path it belongs at, and the platform's part of the disk to guest::DISK_PATH. Everything else of the agent rootfs, the whole disk among it, stays with the old root, which is detached. A failure is fatal: the image cannot run as an agent without its root.
fn fresh_root(disk: &Path, machine: &vm::Machine) {
    let layers = FreshRoot::on(disk);
    let booting = image_record(
        &Path::new(guest::STAGE0_SHARE).join(
            Path::new(guest::IMAGE_PATH)
                .strip_prefix(guest::SHARE_PATH)
                .expect("the image record is in the share"),
        ),
    );
    let recorded = image_record(&layers.image);
    let fresh = fresh_reason(booting.as_deref(), recorded.as_deref());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    if let Err(e) = layers.clear(fresh.is_some(), stamp) {
        fatal!("{e}");
    }
    let make = || {
        [&layers.upper, &layers.work, &layers.merged]
            .into_iter()
            .try_for_each(|dir| {
                mkdir_all(dir).map_err(|e| {
                    io::Error::new(e.kind(), format!("creating {}: {e}", dir.display()))
                })
            })
    };
    if let Err(e) = make().or_else(|e| {
        if !out_of_room(&e) {
            return Err(e);
        }
        logf!("{e}; deleting what earlier boots left to delete, and trying again");
        free_room_for_boot(disk);
        make()
    }) {
        fatal!("{e}");
    }
    match (fresh, booting.as_deref()) {
        (None, _) => logf!(
            "keeping the root of the last boot, which ran this image too ({})",
            booting.as_deref().unwrap_or_default()
        ),
        (Some(reason), Some(booting)) => {
            if let Err(e) = write_record(&layers.image, format!("{booting}\n").as_bytes()) {
                fatal!(
                    "recording the image of the root at {}: {e}",
                    layers.image.display()
                );
            }
            logf!("booting on a fresh root: {reason}");
        }
        (Some(reason), None) => logf!("booting on a fresh root: {reason}"),
    }
    if let Err(e) = layers.fresh_scratch(&machine.image, stamp) {
        fatal!("{e}");
    }
    let accounts = machine.image.with_file_name("accounts");
    let mut lowers = vec![machine.image.as_path()];
    match accounts_layer(&machine.image, &accounts) {
        Ok(true) => lowers.insert(0, &accounts),
        Ok(false) => {}
        Err(e) => logf!(
            "WARNING: building the boot's /etc/passwd ({e}); SSH logins as agent do not land as root"
        ),
    }
    if let Err(e) = layers.mount(&lowers) {
        fatal!(
            "mounting the platform's root at {}: {e}",
            layers.merged.display()
        );
    }
    let merged = &layers.merged;
    if let Err(e) = vm_mounts(merged, disk, machine) {
        fatal!("{e}");
    }
    vm::name_resolution(merged, machine);
    layers.purge_discarded();
    let put_old = merged.join(OLD_ROOT);
    if let Err(e) = DirBuilder::new().mode(0o700).create(&put_old) {
        if e.kind() != io::ErrorKind::AlreadyExists {
            fatal!("creating {}: {e}", put_old.display());
        }
    }
    if let Err(e) = pivot_root(merged, &put_old) {
        fatal!("pivoting into the platform's root: {e}");
    }
    if let Err(e) = std::env::set_current_dir("/") {
        fatal!("entering the platform's root: {e}");
    }
    let old = Path::new("/").join(OLD_ROOT);
    if let Err(e) = unmount_detached(&old) {
        fatal!("detaching the old root, which still reaches the whole disk: {e}");
    }
    let _ = fs::remove_dir(&old);
    logf!(
        "what the image writes outside {} stays until the machine boots another image",
        guest::AGENT_HOME
    );
}

// UNIT_BOUNDARY_DESCRIPTION: the mounts the image's root gets from the VM before the pivot. Each mount point is made in the new root, which is the overlay's upper layer, so an image that lacks one still gets it.
fn vm_mounts(root: &Path, disk: &Path, machine: &vm::Machine) -> io::Result<()> {
    let at = |path: &str| root.join(path.trim_start_matches('/'));
    let point = |target: &Path| -> io::Result<()> {
        mkdir_all(target)
            .map_err(|e| io::Error::new(e.kind(), format!("creating {}: {e}", target.display())))
    };
    for kernel in ["/dev", "/proc", "/sys"] {
        point(&at(kernel))?;
        mount(Path::new(kernel), &at(kernel), libc::MS_MOVE).map_err(|e| {
            io::Error::new(
                e.kind(),
                format!("moving {kernel} into the platform's root: {e}"),
            )
        })?;
    }
    point(&at("/run"))?;
    vm::mount_typed(
        "tmpfs",
        &at("/run"),
        "tmpfs",
        libc::MS_NOSUID | libc::MS_NODEV,
        "mode=0755",
    )
    .map_err(|e| io::Error::new(e.kind(), format!("mounting /run: {e}")))?;
    point(&at("/run/lock"))?;
    point(&at("/dev/mqueue"))?;
    if let Err(e) = vm::mount_typed("mqueue", &at("/dev/mqueue"), "mqueue", 0, "") {
        logf!("WARNING: mounting /dev/mqueue ({e}); POSIX message queues are unavailable");
    }
    for (staged, target) in &machine.shares {
        let to = root.join(target.strip_prefix("/").unwrap_or(target));
        point(&to)?;
        mount(staged, &to, libc::MS_MOVE).map_err(|e| {
            io::Error::new(
                e.kind(),
                format!(
                    "moving the share for {} into the platform's root: {e}",
                    target.display()
                ),
            )
        })?;
    }
    let disk_path = at(guest::DISK_PATH);
    point(&disk_path)?;
    mount(disk, &disk_path, libc::MS_BIND).map_err(|e| {
        io::Error::new(
            e.kind(),
            format!("binding the storage disk into the platform's root: {e}"),
        )
    })
}

// UNIT_BOUNDARY_DESCRIPTION: one image record, the runner's in the share or the disk's beside the root, as its one line. A record that is missing, unreadable or empty names no image.
fn image_record(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let line = text.trim();
    (!line.is_empty()).then(|| line.to_string())
}

// UNIT_BOUNDARY_DESCRIPTION: why this boot starts from an empty upper layer, or nothing when it keeps the last one. A root is kept only when the runner names the image of this boot and the disk records that same image for the root. A share that names none is from a runner that does not write the record; a disk that records none is new, from the layout that emptied the root on every boot, or was cut short while its root was cleared. Either way nothing says the root came from this image, so it is not kept.
fn fresh_reason(booting: Option<&str>, recorded: Option<&str>) -> Option<&'static str> {
    match (booting, recorded) {
        (None, _) => Some("the runner names no image for this boot"),
        (Some(_), None) => Some("the disk records no image for its last root"),
        (Some(booting), Some(recorded)) if booting != recorded => Some(
            "the image changed since the last boot, which is normal after the agent's image was updated",
        ),
        _ => None,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm starts this process in the image's WORKDIR, and the image's command counts on that: `node dist/main.js` under WORKDIR /app names a file that exists only relative to /app. pivot_root leaves the process in a directory of the old root, so fresh_root has to enter the new root's "/", and nothing else would ever leave it — so the directory saved before the pivot is entered again here. The path is absolute, and the platform root's merged view carries the whole image tree, so it resolves to the same directory of the same image. It is entered only once every mount is in place: a WORKDIR under HOME entered before the home is mounted is the image's copy, which the mount then hides, and the entrypoint would work in a directory nothing keeps. One the platform's root somehow lacks is a warning and a start at "/", not a failed boot: the entrypoint may not need it at all.
fn enter_workdir(saved: &Path) {
    if let Err(e) = std::env::set_current_dir(saved) {
        logf!(
            "WARNING: the image's working directory {} is not in the platform's root ({e}); its entrypoint starts at /",
            saved.display()
        );
    }
}

// UNIT_BOUNDARY_DESCRIPTION: where pivot_root puts the root the image came up on, inside the platform's. It is detached and removed before the image runs; a kept root may still hold it from a boot cut short, and it is used again.
const OLD_ROOT: &str = ".platform-old-root";

// UNIT_BOUNDARY_DESCRIPTION: the overlay features off, so a kept upper layer may sit over a lower that changed while it was not mounted, which is every new image of the root's generation. With them on, overlayfs records each copied-up directory's origin in the lower and verifies it at the next mount: the smolvm guest's kernel then refuses a fresh mount with a stale file handle, or, over platform-init's root, hides a new image's files under every directory the agent ever wrote into — a later image's baked tools vanished under a `mise use` this way. The kernel documents changing the lower between mounts as safe only with these off.
const LOWER_MAY_CHANGE: &str = ",index=off,redirect_dir=off,metacopy=off,xino=off,uuid=off";

const KEPT: &str = "kept";
const WORK: &str = "work";
const DISCARDED_LAYERS: [&str; 2] = [KEPT, WORK];

// UNIT_BOUNDARY_DESCRIPTION: the platform root's layers. The lower layer is the image tree the VMM shares, read-only. The upper and work layers are on the disk and not in memory, so an agent that writes a lot outside HOME fills its disk and not its RAM. The kept upper layer and the record of the image that wrote it share a directory of their own, `kept`.
struct FreshRoot {
    store: PathBuf,
    kept: PathBuf,
    upper: PathBuf,
    image: PathBuf,
    work: PathBuf,
    merged: PathBuf,
}

impl FreshRoot {
    fn on(disk: &Path) -> Self {
        let store = guest::system_store(disk, guest::ROOTFS_DIR);
        FreshRoot {
            kept: store.join(KEPT),
            upper: store.join(KEPT).join("upper"),
            image: store.join(KEPT).join("image"),
            work: store.join(WORK),
            merged: store.join("merged"),
            store,
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: empties the work layer, and with `fresh` the kept upper and its image record together, so a boot cut short leaves no record and the next boot is fresh too. Each is renamed aside, which is one step however many files it holds; only a rename that fails deletes in place.
    fn clear(&self, fresh: bool, stamp: u64) -> io::Result<()> {
        let mut cleared = vec![&self.work];
        if fresh {
            cleared.push(&self.kept);
        }
        for dir in cleared {
            discard(dir, stamp)
                .map(drop)
                .or_else(|_| remove_all(dir))
                .map_err(|e| io::Error::other(format!("clearing {}: {e}", dir.display())))?;
        }
        Ok(())
    }

    // UNIT_BOUNDARY_DESCRIPTION: gives the root an empty /tmp and /var/tmp for this boot, as plain directories of its upper layer: what the last boot left there is moved aside into the store, out of the root, and deleted in the background with the other discarded layers, and each comes back empty, root's, with its mode, and opaque, so it starts empty whatever the image ships there. A parent the upper layer lacks takes the image's owner and mode, which is what the root shows for it.
    fn fresh_scratch(&self, lower: &Path, stamp: u64) -> io::Result<()> {
        for (dir, mode) in SCRATCH_DIRS {
            let relative = dir.trim_start_matches('/');
            let path = self.upper.join(relative);
            if fs::symlink_metadata(&path).is_ok() {
                let aside = self
                    .store
                    .join(format!("{}{DISCARDED_INFIX}{stamp}", scratch_name(dir)));
                fs::rename(&path, &aside).map_err(|e| {
                    io::Error::new(e.kind(), format!("moving the last boot's {dir} aside: {e}"))
                })?;
            }
            if let Some(parent) = Path::new(relative)
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
            {
                let upper_parent = self.upper.join(parent);
                if fs::symlink_metadata(&upper_parent).is_err() {
                    mkdir_all(&upper_parent)?;
                    if let Ok(image) = fs::metadata(lower.join(parent)) {
                        std::os::unix::fs::chown(
                            &upper_parent,
                            Some(image.uid()),
                            Some(image.gid()),
                        )?;
                        fs::set_permissions(
                            &upper_parent,
                            fs::Permissions::from_mode(image.mode() & 0o7777),
                        )?;
                    }
                }
            }
            DirBuilder::new().mode(0o700).create(&path)?;
            std::os::unix::fs::chown(&path, Some(0), Some(0))?;
            fs::set_permissions(&path, fs::Permissions::from_mode(mode))?;
            let at = cstring(path.as_os_str())?;
            // SAFETY: `at` and the attribute's name are NUL-terminated, and the value is readable for its length; all outlive the call.
            let set = unsafe {
                libc::setxattr(
                    at.as_ptr(),
                    c"trusted.overlay.opaque".as_ptr(),
                    b"y".as_ptr().cast(),
                    1,
                    0,
                )
            };
            succeeded(set == 0)
                .map_err(|e| io::Error::new(e.kind(), format!("making {dir} start empty: {e}")))?;
        }
        Ok(())
    }

    // UNIT_BOUNDARY_DESCRIPTION: deletes the layers fresh_root moved aside, in the background. A kept upper can hold millions of files, which would hold up the boot for minutes. leave_disk detaches the disk's root before the delete is done, so the store is reached through a descriptor opened now.
    fn purge_discarded(&self) {
        match File::open(&self.store) {
            Err(e) => logf!("WARNING: opening the root's store ({e}); the old root's layers stay on the disk until a later boot"),
            Ok(store) => {
                std::thread::spawn(move || {
                    let store = PathBuf::from(format!("/proc/self/fd/{}", store.as_raw_fd()));
                    purge_discarded(&store, &DISCARDED_LAYERS);
                    purge_discarded(&store, &scratch_layers());
                });
            }
        }
    }

    fn options(&self, lowers: &[&Path]) -> io::Result<CString> {
        for dir in lowers
            .iter()
            .copied()
            .chain([self.upper.as_path(), self.work.as_path()])
        {
            if dir
                .as_os_str()
                .as_bytes()
                .iter()
                .any(|b| b",:\\".contains(b))
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("{} cannot be named in overlay options", dir.display()),
                ));
            }
        }
        let mut options = OsString::from("lowerdir=");
        options.push(
            lowers
                .iter()
                .map(|dir| dir.as_os_str())
                .collect::<Vec<_>>()
                .join(OsStr::new(":")),
        );
        options.push(",upperdir=");
        options.push(&self.upper);
        options.push(",workdir=");
        options.push(&self.work);
        options.push(LOWER_MAY_CHANGE);
        cstring(&options)
    }

    fn mount(&self, lowers: &[&Path]) -> io::Result<()> {
        let options = self.options(lowers)?;
        let target = cstring(self.merged.as_os_str())?;
        // SAFETY: the source, target, type and options are NUL-terminated strings that outlive the call, and overlayfs reads its options as a string.
        let rc = unsafe {
            libc::mount(
                c"overlay".as_ptr(),
                target.as_ptr(),
                c"overlay".as_ptr(),
                0,
                options.as_ptr().cast(),
            )
        };
        succeeded(rc == 0)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a layer of this boot alone, over the image, holding the image's /etc/passwd with `agent` as uid 0: SSH logins come as `agent`, and on a machine the harness runs as root. A layer rather than a write keeps the entry out of the kept upper, so the next image's /etc/passwd shows through, and the file is an ordinary one of the root, which useradd copies up as it replaces it. The layer's /etc and passwd take the image's owners and modes, which the root shows for them. An image without /etc/passwd, or whose /etc/passwd names `agent` already, gets no layer.
fn accounts_layer(image: &Path, layer: &Path) -> io::Result<bool> {
    let image_passwd = image.join("etc/passwd");
    let Some(passwd) = fs::read_to_string(&image_passwd)
        .ok()
        .and_then(|text| accounts_passwd(&text))
    else {
        return Ok(false);
    };
    let etc = layer.join("etc");
    mkdir_all(&etc)?;
    fs::write(etc.join("passwd"), passwd)?;
    for (from, to) in [(image_passwd, etc.join("passwd")), (image.join("etc"), etc)] {
        let meta = fs::metadata(&from)?;
        std::os::unix::fs::chown(&to, Some(meta.uid()), Some(meta.gid()))?;
        fs::set_permissions(&to, fs::Permissions::from_mode(meta.mode() & 0o7777))?;
    }
    Ok(true)
}

// UNIT_BOUNDARY_DESCRIPTION: the image's /etc/passwd with `agent` at its end as uid 0, with HOME as its home and root's shell, or nothing when the image names `agent` already.
fn accounts_passwd(image: &str) -> Option<String> {
    if image.lines().any(|line| line.starts_with("agent:")) {
        return None;
    }
    let shell = image
        .lines()
        .find(|line| line.starts_with("root:"))
        .and_then(|line| line.rsplit(':').next())
        .filter(|shell| !shell.is_empty())
        .unwrap_or("/bin/sh");
    let mut passwd = image.to_string();
    if !passwd.is_empty() && !passwd.ends_with('\n') {
        passwd.push('\n');
    }
    passwd.push_str(&format!(
        "agent:x:0:0:Agent User:{}:{shell}\n",
        guest::AGENT_HOME
    ));
    Some(passwd)
}

fn pivot_root(new_root: &Path, put_old: &Path) -> io::Result<()> {
    let new_root = cstring(new_root.as_os_str())?;
    let put_old = cstring(put_old.as_os_str())?;
    // SAFETY: both paths are NUL-terminated strings that outlive the call, and pivot_root(2) takes exactly these two.
    succeeded(
        unsafe { libc::syscall(libc::SYS_pivot_root, new_root.as_ptr(), put_old.as_ptr()) } == 0,
    )
}

fn unmount_detached(target: &Path) -> io::Result<()> {
    let target = cstring(target.as_os_str())?;
    // SAFETY: the target is a NUL-terminated string that outlives the call.
    succeeded(unsafe { libc::umount2(target.as_ptr(), libc::MNT_DETACH) } == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: a machine's console goes nowhere — stdout and stderr in the guest are both /dev/null — so without this a guest that dies explains itself to nobody. Pointing both at the disk this early puts the whole boot in the record, not only the part after the harness starts. Each boot starts a fresh file and moves the one before it aside, so the history is one boot deep: enough that a machine which died still explains itself on the boot after. Both are pointed at a pipe and not at the file, so a thread of this process can bound the boot being written: an agent that logs without pause would otherwise fill its disk.
fn open_boot_log(root: &Path) {
    let dir = guest::system_store(root, "log");
    if let Err(e) = mkdir_all(&dir) {
        logf!("WARNING: no boot log directory ({e}); this machine's output stays discarded");
        return;
    }
    let path = dir.join(BOOT_LOG_NAME);
    let previous = with_suffix(&path, ".prev");
    if let Err(e) = fs::rename(&path, &previous) {
        if e.kind() != io::ErrorKind::NotFound {
            logf!("WARNING: rotating the boot log ({e})");
        }
    }
    let _ = fs::remove_file(with_suffix(&path, ROTATED_SUFFIX));
    keep_tail(&previous, BOOT_LOG_CAP);

    let log = match CappedLog::open(&path, BOOT_LOG_CAP) {
        Ok(log) => log,
        Err(e) => {
            logf!("WARNING: opening the boot log ({e}); this machine's output stays discarded");
            return;
        }
    };
    let mut ends = [0; 2];
    // SAFETY: pipe2 writes two descriptors into the array it is given, which holds exactly two.
    if unsafe { libc::pipe2(ends.as_mut_ptr(), libc::O_CLOEXEC) } < 0 {
        let e = io::Error::last_os_error();
        logf!("WARNING: no pipe for the boot log ({e}); this machine's output stays discarded");
        return;
    }
    let [read, write] = ends;
    for fd in [libc::STDOUT_FILENO, libc::STDERR_FILENO] {
        // SAFETY: dup3 reads no memory, and the pipe end it duplicates is open until it is closed below.
        if unsafe { libc::dup3(write, fd, 0) } < 0 {
            let e = io::Error::last_os_error();
            logf!("WARNING: redirecting fd {fd} to the boot log ({e})");
        }
    }
    // SAFETY: `write` is this function's own descriptor, and stdout and stderr hold duplicates of it.
    unsafe { libc::close(write) };
    // SAFETY: `read` was just returned by pipe2 and nothing else owns it.
    let source = unsafe { <File as std::os::fd::FromRawFd>::from_raw_fd(read) };
    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        log.drain(source);
        let _ = done.send(());
    });
    if let Ok(mut logger) = LOGGER.lock() {
        *logger = Some(finished);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: how the exit path learns that the thread writing the boot log has written everything. The thread ends when the pipe has no writer left, and it says so on this channel.
static LOGGER: std::sync::Mutex<Option<std::sync::mpsc::Receiver<()>>> =
    std::sync::Mutex::new(None);

// UNIT_BOUNDARY_DESCRIPTION: how long the exit path waits for the boot log to be written. A process this one did not end may still hold the pipe, and the log is not worth a machine that never exits.
const LOG_FLUSH_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

// UNIT_BOUNDARY_DESCRIPTION: stdout and stderr are pointed away from the pipe, so its last writer is gone and the thread writing the log drains it and ends.
fn close_boot_log() {
    let Some(finished) = LOGGER.lock().ok().and_then(|mut logger| logger.take()) else {
        return;
    };
    if let Ok(null) = OpenOptions::new().write(true).open("/dev/null") {
        for fd in [libc::STDOUT_FILENO, libc::STDERR_FILENO] {
            // SAFETY: dup3 reads no memory, and /dev/null stays open until the end of this function.
            unsafe { libc::dup3(null.as_raw_fd(), fd, 0) };
        }
    }
    let _ = finished.recv_timeout(LOG_FLUSH_WAIT);
}

// UNIT_BOUNDARY_DESCRIPTION: the boot log of the running boot, bounded. When the next write would take the file past the cap, the file is moved aside to the rotated name, over the one moved there before, and a new file is started. So the boot keeps at most twice the cap on the disk, and always its most recent output. A write the disk refuses is dropped: the pipe must keep draining, or every process writing to it would block.
const ROTATED_SUFFIX: &str = ".1";

struct CappedLog {
    path: PathBuf,
    cap: u64,
    file: Option<File>,
    written: u64,
}

impl CappedLog {
    fn open(path: &Path, cap: u64) -> io::Result<Self> {
        let file = Self::create(path)?;
        let written = file.metadata()?.len();
        Ok(CappedLog {
            path: path.to_path_buf(),
            cap,
            file: Some(file),
            written,
        })
    }

    fn create(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o644)
            .open(path)
    }

    fn write(&mut self, chunk: &[u8]) {
        let length = u64::try_from(chunk.len()).unwrap_or(u64::MAX);
        if self.written > 0 && self.written.saturating_add(length) > self.cap {
            self.file = None;
            let _ = fs::rename(&self.path, with_suffix(&self.path, ROTATED_SUFFIX));
            self.file = Self::create(&self.path).ok();
            self.written = 0;
        }
        if self.file.is_none() {
            self.file = Self::create(&self.path).ok();
        }
        if let Some(file) = self.file.as_mut() {
            if file.write_all(chunk).is_ok() {
                self.written = self.written.saturating_add(length);
            }
        }
    }

    fn drain(mut self, mut source: impl io::Read) {
        let mut buffer = vec![0; 64 << 10];
        loop {
            match source.read(&mut buffer) {
                Ok(0) => return,
                Ok(n) => self.write(&buffer[..n]),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return,
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a failure shows at the end of a log, so a cap has to trim the start and never the whole file.
fn keep_tail(path: &Path, limit: u64) {
    let Ok(info) = fs::metadata(path) else {
        return;
    };
    if info.len() <= limit {
        return;
    }
    let Ok(mut source) = File::open(path) else {
        return;
    };
    if source.seek(SeekFrom::Start(info.len() - limit)).is_err() {
        return;
    }
    let trimmed = with_suffix(path, ".trim");
    let Ok(mut destination) = File::create(&trimmed) else {
        return;
    };
    let copied = io::copy(&mut source, &mut destination);
    let closed = close(destination);
    if copied.is_err() || closed.is_err() || fs::rename(&trimmed, path).is_err() {
        let _ = fs::remove_file(&trimmed);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: where the guest reads its boot log: this boot's and the one before, read-only. The log lives in the platform's part of the disk, which is detached once the boot is through with it (leave_disk), and the host never reads the disk, so without this bind the log, which holds the harness's output, is readable by no one. Read-only, so nothing in the guest can rewrite what the platform recorded.
const BOOT_LOG_VIEW: &str = "/var/log/platform";

fn show_boot_log(root: &Path) {
    let target = Path::new(BOOT_LOG_VIEW);
    if let Err(e) =
        mkdir_all(target).and_then(|()| bind_read_only(&guest::system_store(root, "log"), target))
    {
        logf!("WARNING: showing the boot log at {BOOT_LOG_VIEW} ({e}); it is still written to the disk");
    }
}

// UNIT_BOUNDARY_DESCRIPTION: an install whose gateway intercepts nothing mounts no CA, and every host then serves a certificate the public roots already cover — so a missing share is silence rather than a warning.
fn bind_ca() {
    let share = Path::new(guest::SHARE_CA_DIR);
    let guest_dir = Path::new(guest::GUEST_CA_DIR);
    if fs::metadata(share).is_err() {
        return;
    }
    if let Err(e) = mkdir_all(guest_dir) {
        logf!(
            "WARNING: creating {} ({e}); intercepted hosts may fail TLS",
            guest_dir.display()
        );
        return;
    }
    if let Err(e) = bind_read_only(share, guest_dir) {
        logf!(
            "WARNING: binding the CA to {} ({e}); intercepted hosts may fail TLS",
            guest_dir.display()
        );
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the folders that only ever hold temporary files or caches. The system ones are plain directories of the root's upper layer on the disk, empty on every boot, owned by root with the mode the image expects of them (FreshRoot::fresh_scratch), so they are bounded by the disk and not by the guest's memory, and nothing under them is the image's own. /var/cache is not one of them: an image ships its font, package and linker caches there, and emptying it had every boot rebuild them, so it is part of the kept root, which lasts as long as the image's root generation. In the agent's home, npm's cache directory and the XDG cache directory are ordinary directories of the home and last as it does. evict_scratch deletes from all of them when the disk runs short.
const SCRATCH_DIRS: [(&str, u32); 2] = [("/tmp", 0o1777), ("/var/tmp", 0o1777)];
const HOME_CACHES: [&str; 2] = [".cache", ".npm"];

fn out_of_room(e: &io::Error) -> bool {
    matches!(e.raw_os_error(), Some(libc::ENOSPC | libc::EDQUOT))
        || e.kind() == io::ErrorKind::StorageFull
}

// UNIT_BOUNDARY_DESCRIPTION: what a boot that found the disk full deletes at once, before the step that failed is tried again: the root layers and scratch folders earlier boots moved aside, which are otherwise deleted in the background only after a boot that succeeded, and the last boot's /tmp and /var/tmp, which this boot would empty anyway. A disk with no inode left cannot even create the empty work layer the boot needs, so without this the agent never boots again although its home is intact. Nothing of the home or the kept root is touched.
fn free_room_for_boot(disk: &Path) {
    let layers = FreshRoot::on(disk);
    purge_discarded(&layers.store, &DISCARDED_LAYERS);
    purge_discarded(&layers.store, &scratch_layers());
    for (dir, _) in SCRATCH_DIRS {
        let _ = remove_all(&layers.upper.join(dir.trim_start_matches('/')));
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the names /tmp and /var/tmp are moved aside under in the root's store (FreshRoot::fresh_scratch).
fn scratch_layers() -> Vec<String> {
    SCRATCH_DIRS.map(|(dir, _)| scratch_name(dir)).to_vec()
}

fn scratch_name(dir: &str) -> String {
    dir.trim_start_matches('/').replace('/', "-")
}

// UNIT_BOUNDARY_DESCRIPTION: the name a discarded folder is moved to, beside itself, so the move is a rename on the same disk however many files it holds. The background delete finds discarded folders by this name, so one a stop cut short is deleted on the next boot. It is the agent image entrypoint's own pattern for its discarded caches.
const DISCARDED_INFIX: &str = ".discarded.";

// UNIT_BOUNDARY_DESCRIPTION: makes a path ready to start empty: nothing there, or an empty directory, is left as it is. Anything else is renamed aside and its new name returned. The rename never follows a symlink.
fn discard(path: &Path, stamp: u64) -> io::Result<Option<PathBuf>> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
        Ok(info) if info.is_dir() && fs::read_dir(path)?.next().is_none() => Ok(None),
        Ok(_) => {
            let aside = with_suffix(path, &format!("{DISCARDED_INFIX}{stamp}"));
            fs::rename(path, &aside)?;
            Ok(Some(aside))
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: deletes the entries of `dir` that discard moved aside from one of `names`, by this boot or an earlier one. Only those names are touched, so nothing else in the directory is. A delete that fails is left for the next boot.
fn purge_discarded(dir: &Path, names: &[impl AsRef<str>]) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if names
            .iter()
            .any(|kept| name.starts_with(&format!("{}{DISCARDED_INFIX}", kept.as_ref())))
        {
            let _ = remove_all(&entry.path());
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: scratch on the disk shares it with the agent's home, so a tool that fills /tmp or its home cache could leave the agent no room for its work. Every EVICT_INTERVAL, while the disk has less than EVICT_BELOW_PERCENT of it free, the scratch folders lose whole entries, until EVICT_UNTIL_PERCENT is free or only entries used within the last EVICT_AGES pass are left. A request from the runner that the owner's claim is short (ClaimRequest) is served once, with one pass that stops at the bytes the runner asked this machine for and evicts nothing used within CLAIM_EVICT_AGE: the claim is mostly the agents' homes, which no eviction touches, so a claim that stays short would otherwise give every agent's /tmp a ten-minute life with nothing gained. The runner sends a new request only when the claim fills further. An entry is one name directly in a scratch folder, such as ~/.cache/go-build or /tmp/pr-body.md, and it goes whole or not at all: a tool that loses some of its cache's files and keeps the rest sees a half cache that looks complete, and fails on it with an error that says nothing about the disk. An entry counts as used at the newest modification or change time anywhere in it. Access times are not counted: the disk is mounted relatime, so a read often does not move them. The disk is a sparse file on that claim, and the guest agent's trim hands what this frees back to it. Each eviction goes to the console, so the host sees why a cache vanished. A deleted file that is still open frees its space only when it is closed.
const EVICT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
const EVICT_BELOW_PERCENT: u64 = 10;
const EVICT_UNTIL_PERCENT: u64 = 20;
const EVICT_AGES: [u64; 4] = [7 * 86_400, 86_400, 3_600, 600];
const CLAIM_EVICT_AGE: u64 = 3_600;

// UNIT_BOUNDARY_DESCRIPTION: the Cache Directory Tagging Specification's mark (bford.info/cachedir) that a directory holds only a cache its tool can rebuild. Go, cargo and ccache write it. In each pass a tagged entry goes before an untagged one, which may be an agent's work in progress.
const CACHEDIR_TAG: &str = "CACHEDIR.TAG";
const CACHEDIR_TAG_SIGNATURE: &[u8] = b"Signature: 8a477f597d28d172789f06886806bc55";

// UNIT_BOUNDARY_DESCRIPTION: the name an entry is renamed to before it is deleted, so a tool never sees it half deleted. An entry with this name was left by a delete that failed, and goes first. A file of the agent's own that happens to have this name is lost the same way, and only while the disk is short.
const EVICTED_INFIX: &str = ".evicted.";

struct ScratchEntry {
    path: PathBuf,
    shown: PathBuf,
    used: u64,
    bytes: u64,
    rebuildable: bool,
}

// UNIT_BOUNDARY_DESCRIPTION: a scratch folder opened for one pass. The pass names everything in it through `dir`'s descriptor and never by `shown`, so a folder swapped for a symlink after it was opened is not followed either. `mount` is the id of the mount it is on: nothing on another mount is scratch.
struct ScratchRoot {
    dir: File,
    shown: PathBuf,
    mount: u64,
    dev: Option<u64>,
}

// UNIT_BOUNDARY_DESCRIPTION: the scratch folders eviction serves, each with the mount it is on at boot, before the agent runs: /tmp's own bind, and a home cache's home, or the cache itself when it already exists. A folder whose mount cannot be read is not served.
fn scratch_folders() -> Vec<(PathBuf, u64)> {
    let home = Path::new(guest::AGENT_HOME);
    SCRATCH_DIRS
        .iter()
        .map(|(dir, ..)| PathBuf::from(dir))
        .chain(HOME_CACHES.iter().map(|name| home.join(name)))
        .filter_map(|dir| {
            match statx(libc::AT_FDCWD, &dir)
                .or_else(|_| statx(libc::AT_FDCWD, dir.parent().unwrap_or(&dir)))
            {
                Ok(info) => Some((dir, info.stx_mnt_id)),
                Err(e) => {
                    logf!("WARNING: reading the mount of {} ({e}); it is not evicted when the disk runs short", dir.display());
                    None
                }
            }
        })
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: whether `dir` is on overlayfs, as /tmp and /var/tmp are on the platform's root. overlayfs gives its directories a device of its own but shows each file with its upper layer's, so a device check would reject every file there; the mount id is the boundary instead.
fn on_overlay(dir: &File) -> bool {
    const OVERLAYFS_SUPER_MAGIC: i64 = 0x794C_7630;
    // SAFETY: a zeroed statfs is a valid value for the kernel to fill, and `dir` keeps its descriptor open for the call.
    let mut info: libc::statfs = unsafe { std::mem::zeroed() };
    unsafe {
        libc::fstatfs(dir.as_raw_fd(), &mut info) == 0
            && info.f_type as i64 == OVERLAYFS_SUPER_MAGIC
    }
}

// UNIT_BOUNDARY_DESCRIPTION: opens the scratch folders for a pass, without following a symlink. A folder that is one, such as a ~/.cache an agent pointed at its work, is skipped, since what it points at is not scratch, and so is one that is no longer on the mount it had at boot, such as a work directory bound onto it. A missing folder is skipped quietly.
fn open_scratch_roots(dirs: &[(PathBuf, u64)]) -> Vec<ScratchRoot> {
    dirs.iter()
        .filter_map(|(shown, boot_mount)| {
            match OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
                .open(shown)
                .and_then(|dir| Ok((statx(dir.as_raw_fd(), Path::new(""))?, dir)))
            {
                Ok((info, _)) if info.stx_mnt_id != *boot_mount => {
                    logf!("WARNING: not evicting from {}, which is a mount it was not at boot: what is mounted there is not scratch", shown.display());
                    None
                }
                Ok((info, dir)) => Some(ScratchRoot {
                    dev: (!on_overlay(&dir))
                        .then(|| libc::makedev(info.stx_dev_major, info.stx_dev_minor)),
                    dir,
                    shown: shown.clone(),
                    mount: info.stx_mnt_id,
                }),
                Err(e) if e.kind() == io::ErrorKind::NotFound => None,
                Err(_) if fs::symlink_metadata(shown).is_ok_and(|info| info.is_symlink()) => {
                    logf!("WARNING: not evicting from {}, which is a symlink: what it points at is not scratch", shown.display());
                    None
                }
                Err(e) => {
                    logf!("WARNING: not evicting from {} ({e})", shown.display());
                    None
                }
            }
        })
        .collect()
}

fn evict_scratch(dirs: &[(PathBuf, u64)]) {
    let home = Path::new(guest::AGENT_HOME);
    let (mut stuck, mut served) = (false, None::<String>);
    loop {
        std::thread::sleep(EVICT_INTERVAL);
        let request = claim_request();
        if request.is_none() {
            served = None;
        }
        let Some(pass) = eviction_pass(free_percent(home), request.as_ref(), served.as_deref())
        else {
            stuck = false;
            continue;
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_secs());
        let (mut freed, mut deleted) = (0, Vec::new());
        let locked = match fs::read_to_string("/proc/locks") {
            Ok(table) => locked_files(&table),
            Err(e) => {
                logf!("WARNING: reading /proc/locks ({e}); no scratch is evicted, since a file a tool has locked could not be told apart");
                continue;
            }
        };
        let roots = open_scratch_roots(dirs);
        for entry in scratch_entries(&roots, &locked, now, pass.youngest) {
            if !pass.continues(free_percent(home), freed) {
                break;
            }
            match evict(&entry.path, now) {
                Ok(true) => {
                    freed += entry.bytes;
                    deleted.push(entry.shown.display().to_string());
                }
                Ok(false) => {}
                Err(e) => logf!("WARNING: evicting {} ({e})", entry.shown.display()),
            }
        }
        if let Some(request) = request.filter(|_| pass.claim_only) {
            served = Some(request.id);
        }
        if !deleted.is_empty() {
            announce(&format!(
                "the {} is short of room: deleted {freed} bytes of unused scratch: {}",
                if pass.claim_only {
                    "owner's storage"
                } else {
                    "disk"
                },
                deleted.join(" ")
            ));
        }
        let short = disk_short(free_percent(home), EVICT_BELOW_PERCENT);
        if short && !stuck {
            announce(&format!(
                "the disk is still short of room: no scratch is left that was unused for {} s, so writes to the agent's home may fail",
                EVICT_AGES[EVICT_AGES.len() - 1]
            ));
        }
        stuck = short;
    }
}

// UNIT_BOUNDARY_DESCRIPTION: every entry of the scratch folders that may be evicted at `now`, in the order to evict them: by the first EVICT_AGES pass it is old enough for, then rebuildable before not, then oldest first. An entry is left out when it was used within `youngest` seconds, when it holds a socket or fifo a process may still listen on, a mount, or a file in `locked`, or when it cannot be read.
fn scratch_entries(
    roots: &[ScratchRoot],
    locked: &HashSet<(u32, u32, u64)>,
    now: u64,
    youngest: u64,
) -> Vec<ScratchEntry> {
    let mut entries: Vec<(usize, ScratchEntry)> = roots
        .iter()
        .filter_map(|root| {
            let at = PathBuf::from(format!("/proc/self/fd/{}", root.dir.as_raw_fd()));
            Some((root, fs::read_dir(&at).ok()?))
        })
        .flat_map(|(root, names)| {
            names.flatten().map(|name| {
                (
                    name.path(),
                    root.shown.join(name.file_name()),
                    root.mount,
                    root.dev,
                )
            })
        })
        .filter_map(|(path, shown, mount, dev)| {
            let (used, bytes) = tree_use(&path, dev, mount, locked)?;
            let leftover = path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().contains(EVICTED_INFIX));
            let used = if leftover { 0 } else { used };
            let pass = EVICT_AGES
                .iter()
                .take_while(|age| **age >= youngest)
                .position(|age| used < now.saturating_sub(*age))?;
            let rebuildable = leftover || cache_tagged(&path);
            Some((
                pass,
                ScratchEntry {
                    path,
                    shown,
                    used,
                    bytes,
                    rebuildable,
                },
            ))
        })
        .collect();
    entries.sort_by_key(|(pass, entry)| (*pass, !entry.rebuildable, entry.used));
    entries.into_iter().map(|(_, entry)| entry).collect()
}

// UNIT_BOUNDARY_DESCRIPTION: the newest modification or change time anywhere under `path`, and the bytes it holds, without following a symlink. None when the tree cannot be evicted whole: it leaves the disk's device or the scratch folder's `mount` — a bind mount on the same disk has the device but not the mount, and what it shows is someone's work — holds a socket or fifo or a file in `locked`, or a directory in it cannot be read.
fn tree_use(
    path: &Path,
    disk: Option<u64>,
    mount: u64,
    locked: &HashSet<(u32, u32, u64)>,
) -> Option<(u64, u64)> {
    let info = statx(libc::AT_FDCWD, path).ok()?;
    let kind = u32::from(info.stx_mode) & libc::S_IFMT;
    if disk.is_some_and(|disk| libc::makedev(info.stx_dev_major, info.stx_dev_minor) != disk)
        || info.stx_mnt_id != mount
        || ![libc::S_IFDIR, libc::S_IFREG, libc::S_IFLNK].contains(&kind)
        || locked.contains(&(info.stx_dev_major, info.stx_dev_minor, info.stx_ino))
    {
        return None;
    }
    let mut used = u64::try_from(info.stx_mtime.tv_sec.max(info.stx_ctime.tv_sec)).unwrap_or(0);
    let mut bytes = info.stx_blocks * 512;
    if kind == libc::S_IFDIR {
        for child in fs::read_dir(path).ok()? {
            let (child_used, child_bytes) = tree_use(&child.ok()?.path(), disk, mount, locked)?;
            used = used.max(child_used);
            bytes += child_bytes;
        }
    }
    Some((used, bytes))
}

// UNIT_BOUNDARY_DESCRIPTION: every file a process holds a lock on — BSD flock, POSIX or open file description — as its device's major and minor and its inode, from the kernel's lock table (/proc/locks), which platform-init, as the guest's first process, sees whole. A lock is how a tool says it still needs a file, wherever the file sits in an entry, so eviction keeps the entry whole. Reading the table takes no lock, so no tool is held up, and a lock taken after it is read is seen only by the next pass. A file open for writing without a lock is not looked for: its time moves as it is written, which keeps its entry.
fn locked_files(table: &str) -> HashSet<(u32, u32, u64)> {
    table
        .lines()
        .filter_map(|line| {
            line.split_whitespace().find_map(|field| {
                let mut parts = field.split(':');
                let (major, minor, inode) = (parts.next()?, parts.next()?, parts.next()?);
                if parts.next().is_some() {
                    return None;
                }
                Some((
                    u32::from_str_radix(major, 16).ok()?,
                    u32::from_str_radix(minor, 16).ok()?,
                    inode.parse().ok()?,
                ))
            })
        })
        .collect()
}

fn cache_tagged(dir: &Path) -> bool {
    let tag = dir.join(CACHEDIR_TAG);
    let mut head = [0; CACHEDIR_TAG_SIGNATURE.len()];
    fs::symlink_metadata(&tag).is_ok_and(|info| info.is_file())
        && File::open(&tag)
            .and_then(|mut file| io::Read::read_exact(&mut file, &mut head))
            .is_ok()
        && head == CACHEDIR_TAG_SIGNATURE
}

// UNIT_BOUNDARY_DESCRIPTION: deletes one scratch entry whole: it is renamed aside first, so no tool sees it half deleted, then deleted. An entry a process holds a BSD lock on is left, and false returned: that is how systemd-tmpfiles lets a tool keep its files from aging, and a tool written for it is kept here too. The lock is held through the delete, so the tool cannot take it in between.
fn evict(path: &Path, stamp: u64) -> io::Result<bool> {
    let _lock = if fs::symlink_metadata(path)?.file_type().is_symlink() {
        None
    } else {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)?;
        // SAFETY: the descriptor is open for the call and flock takes no pointer.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let e = io::Error::last_os_error();
            return if e.kind() == io::ErrorKind::WouldBlock {
                Ok(false)
            } else {
                Err(e)
            };
        }
        Some(file)
    };
    let name = path
        .file_name()
        .map(OsStr::to_string_lossy)
        .unwrap_or_default();
    let aside = if name.contains(EVICTED_INFIX) {
        path.to_path_buf()
    } else {
        let aside = with_suffix(path, &format!("{EVICTED_INFIX}{stamp}"));
        fs::rename(path, &aside)?;
        aside
    };
    remove_all(&aside)?;
    Ok(true)
}

fn disk_short(free: Option<u64>, percent: u64) -> bool {
    free.is_some_and(|free| free < percent)
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's request that this machine give back scratch because the owner's claim is short, read from guest::STORAGE_SHORT_PATH: an id that changes with every new request, and the bytes asked of this machine. A mark from an older runner is empty, and is one request with no byte bound.
#[derive(Debug, PartialEq)]
struct ClaimRequest {
    id: String,
    bytes: Option<u64>,
}

fn claim_request() -> Option<ClaimRequest> {
    fs::read_to_string(guest::STORAGE_SHORT_PATH)
        .ok()
        .map(|text| parse_claim_request(&text))
}

fn parse_claim_request(text: &str) -> ClaimRequest {
    let text = text.trim();
    ClaimRequest {
        id: text.to_string(),
        bytes: text
            .split_whitespace()
            .nth(1)
            .and_then(|bytes| bytes.parse().ok()),
    }
}

#[derive(Debug, PartialEq)]
struct EvictionPass {
    youngest: u64,
    claim_only: bool,
    bytes: Option<u64>,
}

impl EvictionPass {
    // UNIT_BOUNDARY_DESCRIPTION: whether the pass goes on to the next entry: while the disk is short, until EVICT_UNTIL_PERCENT is free; for a claim request alone, until the bytes asked for are freed.
    fn continues(&self, free: Option<u64>, freed: u64) -> bool {
        if self.claim_only {
            self.bytes.is_none_or(|bytes| freed < bytes)
        } else {
            disk_short(free, EVICT_UNTIL_PERCENT)
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether this look evicts, and how: a disk with less than EVICT_BELOW_PERCENT free gets the whole EVICT_AGES ladder, and a claim request not yet served gets one pass of entries unused for CLAIM_EVICT_AGE. A disk whose room cannot be read is left alone unless a request is pending.
fn eviction_pass(
    free: Option<u64>,
    request: Option<&ClaimRequest>,
    served: Option<&str>,
) -> Option<EvictionPass> {
    if disk_short(free, EVICT_BELOW_PERCENT) {
        return Some(EvictionPass {
            youngest: EVICT_AGES[EVICT_AGES.len() - 1],
            claim_only: false,
            bytes: None,
        });
    }
    let request = request.filter(|request| served != Some(request.id.as_str()))?;
    Some(EvictionPass {
        youngest: CLAIM_EVICT_AGE,
        claim_only: true,
        bytes: request.bytes,
    })
}

// UNIT_BOUNDARY_DESCRIPTION: the disk is a sparse file on the owner's claim, so a block the agent frees stays allocated there, and counted against the owner's storage, until the guest's filesystem discards it. btrfs discards on its own (`discard=async`), and in these machines that does not reach the claim: a guest that deleted 300 MiB saw the claim's use stay where it was for minutes, while a trim of the same disk returned it at once. So platform-init trims the disk itself: every TRIM_INTERVAL, and before the guard sizes itself, because the guard's preallocation takes the extents the guest just freed and no trim can reach an extent that is allocated (trim_freed).
const TRIM_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
// UNIT_BOUNDARY_DESCRIPTION: _IOWR('X', 121, struct fstrim_range), the same on every architecture a guest runs; the libc crate does not export it.
const FITRIM: libc::c_ulong = 0xC018_5879;
// UNIT_BOUNDARY_DESCRIPTION: free extents smaller than this are skipped, so a minute's trim sends no stream of tiny discards to the claim's storage.
const TRIM_MIN_BYTES: u64 = 1 << 20;

#[repr(C)]
struct FstrimRange {
    start: u64,
    len: u64,
    minlen: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: returns every free extent of the filesystem holding `path` to the storage under it, and the bytes it returned. It is called every TRIM_INTERVAL, and by the storage guard before the guard sizes itself: a preallocated extent is allocated, so a trim skips it, and the room the guest freed would stay on the claim until the machine stopped if the guard took it first.
fn trim_freed(path: &Path) -> io::Result<u64> {
    let dir = File::open(path)?;
    let mut range = FstrimRange {
        start: 0,
        len: u64::MAX,
        minlen: TRIM_MIN_BYTES,
    };
    // SAFETY: `dir` holds an open descriptor for the call, and `range` is a live fstrim_range the kernel reads and writes back.
    succeeded(unsafe { libc::ioctl(dir.as_raw_fd(), FITRIM as _, &mut range) } == 0)?;
    Ok(range.len)
}

// UNIT_BOUNDARY_DESCRIPTION: trims the disk every TRIM_INTERVAL, so a delete the storage guard never moves for, one smaller than its step, still goes back to the claim within a minute. A trim that cannot run costs only the room it would have returned, so the warning is written once and the trim retried.
fn trim_disk() {
    let home = Path::new(guest::AGENT_HOME);
    let mut failing = false;
    loop {
        std::thread::sleep(TRIM_INTERVAL);
        match trim_freed(home) {
            Ok(_) => failing = false,
            Err(e) => {
                if !std::mem::replace(&mut failing, true) {
                    logf!("WARNING: trimming {} ({e}); the room the agent frees stays on the owner's storage", home.display());
                }
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a guest's disk is a sparse file sized at the owner's whole claim, which every other disk of the owner shares, so the guest sees room the claim no longer has, and a write past the claim's last block fails as a broken disk would, for every agent of the owner at once. So platform-init holds the guest to the room the runner grants it (guest::STORAGE_ROOM_PATH): every POOL_GUARD_INTERVAL it sizes a file it preallocates on the disk so that what the guest can still write is the grant, less what the guest wrote since the grant came, or, once that is below POOL_GUARD_FLOOR, the floor once per shortage (pool_guard::PoolGuard). A write past it then fails inside the guest with "no space left on device", which the agent and its tools handle and the runner reports as a full home, and the claim stays writable for the other agents. Preallocated blocks are only marked in the guest's filesystem and never written, so the file takes nothing from the claim. A growth extends the file, and a shrink gives up the room in the one way a filesystem returns all of it: it takes the new size in a file of its own, whole, and then drops the old one, or, when the disk cannot hold both, empties this file whole and takes the new size in it (size_guard). A filesystem frees the blocks of a file it loses, and of a file cut to nothing, but btrfs kept the blocks of a preallocated extent a length alone partly truncated allocated while the file's own stat reported the smaller size, and a guard shortened that way gave a steadily writing guest nothing back, which filled that guest's disk with room the guard said it had freed. It is an unnamed temporary file: no older platform-init, no image and no agent can find it, and the guest's filesystem frees it whenever the guest stops, however it stops; a clean stop empties it before the disk is synced and frozen (release_pool_guard), so the next boot does not find its blocks still taken. btrfs counts an allocation in the free space statvfs reports only at its next transaction commit, about every 30 s, so the guard reads its own size from its blocks, syncs the filesystem before and after it moves, so the free space it reads counts what is pending and its own move, and moves at most once per POOL_GUARD_BACKOFF and only by more than POOL_GUARD_STEP (guard_look). btrfs's free space is an estimate that can pass the disk's own size, so the guard counts on no more than the disk holds beyond the guest's use, and when a preallocation is refused it finds what the disk takes and holds to that until the guest frees room, warning once (PoolGuard::grow). The floor keeps room for SSH keys, a shell and the agent's own state while every agent of an owner is held near zero, so with N agents running the claim can pass the runner's level by N times the floor.
const POOL_GUARD_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
const POOL_GUARD_BACKOFF: std::time::Duration = std::time::Duration::from_secs(30);

static POOL_GUARD: std::sync::Mutex<Option<File>> = std::sync::Mutex::new(None);
static POOL_GUARD_HELD: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn pool_guard(root: &Path) -> Option<File> {
    let dir = root.join(guest::SYSTEM_DIR);
    match OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_TMPFILE)
        .mode(0o600)
        .open(&dir)
    {
        Ok(file) => Some(file),
        Err(e) => {
            logf!("WARNING: making the guard file in {} ({e}); this agent's writes are not held to the owner's storage", dir.display());
            None
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: sizes the guard file to `size` bytes of preallocated blocks, or leaves it at the size it had when the disk refuses them, and reports the refusal. It reads that size from the file's own length rather than from the caller's count, because it is called more than once per look, each time with the size the disk last took, and a comparison with a stale count either skips a shrink or asks for less than the file already holds. Growth extends the file, and the allocation adds only the blocks it gains. A shrink never frees part of an extent: a filesystem frees a file it loses, and a file cut to nothing, but a preallocated extent it is only partly asked to release can stay allocated, and a guard parked on that room reports it free while the guest cannot write it. So a shrink first takes the new size in a file of its own, whole, and drops the old one only once that file holds the room, and when the disk cannot hold both it empties this file whole and takes the new size in it. The first path leaves the guest guarded throughout; the second leaves it unguarded for the two calls in which the file is empty, and puts the old size back if the new one is refused.
fn size_guard(guard: &mut File, root: &Path, size: u64) -> io::Result<()> {
    let held = guard.metadata()?.len();
    if size == held {
        return Ok(());
    }
    // UNIT_BOUNDARY_DESCRIPTION: an empty file takes no allocation, so a guard held to nothing is a cut and not a preallocation the disk can refuse.
    if size == 0 {
        return guard.set_len(0);
    }
    if size > held {
        return preallocate(guard, size);
    }
    if let Some(fresh) = pool_guard(root) {
        if preallocate(&fresh, size).is_ok() {
            let _ = guard.set_len(0);
            *guard = fresh;
            return Ok(());
        }
    }
    guard.set_len(0)?;
    match preallocate(guard, size) {
        Ok(()) => Ok(()),
        Err(refused) => match preallocate(guard, held) {
            Ok(()) => Err(refused),
            Err(restore) => Err(restore),
        },
    }
}

// UNIT_BOUNDARY_DESCRIPTION: takes `size` bytes of blocks for `file`, all of them or none, and reports a refusal. Every call is a whole allocation from the file's start, so the file's blocks are a set of whole extents and no release below it has to free part of one.
fn preallocate(file: &File, size: u64) -> io::Result<()> {
    let length =
        libc::off_t::try_from(size).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    // SAFETY: `file` holds an open descriptor for the call, and fallocate takes no pointer.
    match unsafe { libc::fallocate(file.as_raw_fd(), 0, 0, length) } {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

fn guard_pool() {
    let home = Path::new(guest::AGENT_HOME);
    let mut state = PoolGuard::default();
    let mut moved: Option<std::time::Instant> = None;
    let mut trim_failing = false;
    loop {
        std::thread::sleep(POOL_GUARD_INTERVAL);
        // UNIT_BOUNDARY_DESCRIPTION: the guard is read and the disk is looked at outside POOL_GUARD, and the mutex is taken only to size the file: a stop's release takes it to empty the file, and a stop must never wait on a trim or a sync, which is unbounded work, because the host gives a stop 5 s of silence before it cuts the machine down.
        let held = {
            let slot = POOL_GUARD.lock().unwrap_or_else(|e| e.into_inner());
            let Some(guard) = slot.as_ref() else {
                return;
            };
            guard.metadata().map_or_else(
                |_| POOL_GUARD_HELD.load(std::sync::atomic::Ordering::Relaxed),
                |info| info.blocks() * 512,
            )
        };
        POOL_GUARD_HELD.store(held, std::sync::atomic::Ordering::Relaxed);
        let grant = fs::read_to_string(guest::STORAGE_ROOM_PATH)
            .ok()
            .as_deref()
            .and_then(read_grant);
        let backed_off = moved.is_none_or(|at| at.elapsed() >= POOL_GUARD_BACKOFF);
        let look = |state: &mut PoolGuard| {
            let stat = statvfs(home)?;
            #[allow(clippy::unnecessary_cast)]
            let (size, blocks, free, avail) = (
                stat.f_frsize as u64,
                stat.f_blocks as u64,
                stat.f_bfree as u64,
                stat.f_bavail as u64,
            );
            let used = blocks.saturating_sub(free).saturating_mul(size);
            guard_look(
                state,
                grant.clone(),
                used,
                avail.saturating_mul(size),
                held,
                blocks.saturating_mul(size),
                backed_off,
            )
            .map(|want| (want, used.saturating_sub(held)))
        };
        if look(&mut state).is_none() {
            continue;
        }
        if let Err(e) = flush_filesystem(home) {
            logf!("WARNING: syncing the disk before sizing the storage guard: {e}");
            continue;
        }
        match trim_freed(home) {
            Ok(_) => trim_failing = false,
            Err(e) => {
                if !std::mem::replace(&mut trim_failing, true) {
                    logf!("WARNING: trimming the disk before sizing the storage guard: {e}");
                }
            }
        }
        let Some((want, mine)) = look(&mut state) else {
            continue;
        };
        let mut slot = POOL_GUARD.lock().unwrap_or_else(|e| e.into_inner());
        let Some(guard) = slot.as_mut() else {
            return;
        };
        moved = Some(std::time::Instant::now());
        let mut error = None;
        let mut size_to = |size: u64| match size_guard(guard, home, size) {
            Ok(()) => true,
            Err(e) => {
                error = Some(e);
                false
            }
        };
        let (sized, warn) = if want > held {
            state.grow(held, want, mine, size_to)
        } else {
            (if size_to(want) { want } else { held }, error.is_some())
        };
        let sized_held = guard.metadata().map_or(sized, |info| info.blocks() * 512);
        drop(slot);
        if let Err(e) = flush_filesystem(home) {
            logf!("WARNING: syncing the disk after sizing the storage guard: {e}");
        }
        let was = held;
        let held = sized_held;
        POOL_GUARD_HELD.store(held, std::sync::atomic::Ordering::Relaxed);
        if let (true, Some(e)) = (warn, error) {
            logf!("WARNING: sizing the storage guard to {want} bytes, it holds {held}: {e}");
        }
        if (was < POOL_GUARD_FLOOR) != (held < POOL_GUARD_FLOOR) {
            announce(&if held < POOL_GUARD_FLOOR {
                "the owner's storage has room again: this agent's writes are no longer held back"
                    .to_string()
            } else {
                format!("the owner's storage is nearly full: this agent may write {} more bytes before its writes fail with no space left", state.keep)
            });
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: empties and closes the guard file on a clean stop, before the disk is synced and frozen. An unnamed file is freed only once the filesystem gets to it, which on btrfs once lasted 35 s into the next boot, holding that boot's guest to room it did not have. The guard thread finds no file after this and ends, so it cannot grow the file again.
fn release_pool_guard() {
    if let Some(guard) = POOL_GUARD.lock().unwrap_or_else(|e| e.into_inner()).take() {
        if let Err(e) = guard.set_len(0) {
            logf!("WARNING: emptying the storage guard before the stop: {e}");
        }
    }
    POOL_GUARD_HELD.store(0, std::sync::atomic::Ordering::Relaxed);
}

fn statvfs(path: &Path) -> Option<libc::statvfs> {
    let path = cstring(path.as_os_str()).ok()?;
    // SAFETY: statvfs is plain old data, and all-zero bytes are a valid value of it.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `path` is NUL-terminated and lives for the call, and `stat` is a live, writable statvfs.
    let rc = unsafe { libc::statvfs(path.as_ptr(), &mut stat) };
    (rc == 0).then_some(stat)
}

// UNIT_BOUNDARY_DESCRIPTION: the smaller of the disk's free share of blocks and of inodes. A filesystem with a fixed inode count can run out of inodes with most of its space free under a home of many small files (dependency trees, checkouts), and a write then fails with "no space left on device" all the same; btrfs reports no inode count, and is judged by its blocks.
// UNIT_BOUNDARY_DESCRIPTION: the storage guard's blocks count as free here: they hold the guest to the owner's storage, which the runner's claim requests already shed for, so they must not have the disk read as its own disk short and evict every few minutes.
fn free_percent(path: &Path) -> Option<u64> {
    let mut stat = statvfs(path)?;
    let held = POOL_GUARD_HELD.load(std::sync::atomic::Ordering::Relaxed);
    #[allow(clippy::unnecessary_cast)]
    let held_blocks = (held / (stat.f_frsize as u64).max(1)) as libc::fsblkcnt_t;
    stat.f_bavail = stat.f_bavail.saturating_add(held_blocks);
    free_share(&stat)
}

#[allow(clippy::unnecessary_cast)]
fn free_share(stat: &libc::statvfs) -> Option<u64> {
    let share = |free: u64, total: u64| (total > 0).then(|| free * 100 / total);
    let blocks = share(stat.f_bavail as u64, stat.f_blocks as u64)?;
    Some(
        share(stat.f_favail as u64, stat.f_files as u64)
            .map_or(blocks, |inodes| blocks.min(inodes)),
    )
}

// UNIT_BOUNDARY_DESCRIPTION: whether the home has less than guest::HOME_FULL_BYTES or guest::HOME_FULL_INODES left, so an agent that crashed for want of inodes is reported full as one that ran out of space is. A filesystem that reports no inode count at all is judged by its space alone.
fn home_full(path: &Path) -> bool {
    statvfs(path).is_some_and(|stat| {
        #[allow(clippy::unnecessary_cast)]
        let (bytes, inodes, files) = (
            (stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64),
            stat.f_favail as u64,
            stat.f_files as u64,
        );
        bytes < guest::HOME_FULL_BYTES || (files > 0 && inodes < guest::HOME_FULL_INODES)
    })
}

// UNIT_BOUNDARY_DESCRIPTION: a directory an image's boot may keep its extracted trust store in rather than rebuilding it, named to the entrypoint in TRUST_CACHE_ENV. It is a plain directory of the root, so it lasts as long as the root does: an extracted trust store belongs to the image that extracted it, and a new image starts with none.
fn offer_trust_cache() -> Option<PathBuf> {
    let dir = Path::new(TRUST_CACHE_PATH);
    if let Err(e) = mkdir_all(dir) {
        logf!("WARNING: no trust cache directory ({e}); the image re-extracts its CA store every boot");
        return None;
    }
    Some(dir.to_path_buf())
}

// UNIT_BOUNDARY_DESCRIPTION: the disk's root stays mounted only as long as the boot needs it. Everything the image may keep is on it under other mounts by now — its home and the root's layers — and an open file such as the boot log keeps working once the mount is gone. Left mounted, the disk's root lets anything in the guest write outside HOME and past its root, straight into the record of which image wrote that root or the platform's own state.
fn leave_disk(root: &Path) {
    if let Err(e) = unmount_detached(root) {
        logf!(
            "WARNING: detaching the disk from {} ({e}); the image can still write to it outside {}",
            root.display(),
            guest::AGENT_HOME
        );
        return;
    }
    let _ = fs::remove_dir(root);
}

// UNIT_BOUNDARY_DESCRIPTION: stop_propagation left every mount a slave or private, and a container runtime or a cluster inside the guest needs its root shared: the kubelet refuses to start on a root that is not, and a bind mount made for one container would not reach another. Mounts made in this guest's namespace still do not reach smolvm's, because a slave never propagates back to its master.
fn share_mounts() {
    if let Err(e) = mount(
        Path::new(""),
        Path::new("/"),
        libc::MS_REC | libc::MS_SHARED,
    ) {
        logf!("WARNING: sharing the mount tree ({e}); a container runtime in the guest may refuse to start");
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the first boot seeds the home from whatever the image ships there, so a home an image baked is the home the agent starts from — or, for an agent moved here from the container backend, from the seed of its old volume the runner put in the share. Every later boot finds the store and mounts it as it is. `seeded_before` is the runner's record that this machine's disk has held a home; a disk that has lost it is refused rather than seeded again.
fn persist_home(root: &Path, seeded_before: bool, expected: Option<&SeedDigest>) {
    let path = Path::new(guest::AGENT_HOME);
    let store = guest::agent_store(root);
    if let Err(e) = prepare_home(
        path,
        Path::new(guest::SHARE_SEED_FILE),
        &store,
        seeded_before,
        expected,
    ) {
        fatal!("seeding {} onto the disk: {e}", path.display());
    }
    if let Err(e) = mountpoint(path) {
        fatal!("creating the guest mountpoint {}: {e}", path.display());
    }
    if let Err(e) = mount(&store, path, libc::MS_BIND) {
        fatal!("mounting {} from the disk: {e}", path.display());
    }
    logf!("persisting {}", path.display());
}

// UNIT_BOUNDARY_DESCRIPTION: the home's mountpoint as a directory of the root. An image may ship the home as a link, to /root for example, and a bind onto a link lands wherever the link points. The link is replaced, so the disk is mounted at the home and nowhere else.
fn mountpoint(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path).is_ok_and(|info| info.is_symlink()) {
        logf!(
            "{} is a link in the image; replacing it with a directory so the home is on the disk",
            path.display()
        );
        fs::remove_file(path)?;
    }
    mkdir_all(path)
}

// UNIT_BOUNDARY_DESCRIPTION: seeds the store once, on the boot that finds none. A seed in the share wins over the image's home, because it is the agent's own home from before the move; a store that exists is never touched, even with a seed still in the share, since it already holds everything the agent did since. When the runner expects a seed, the image's home is never the fallback: a store is restored from exactly that seed or the boot fails, and a store that exists boots only if it was restored from that seed. A migration whose seed went missing then fails where it is seen, instead of booting the image's home and being taken for done.
fn prepare_home(
    home: &Path,
    archive: &Path,
    store: &Path,
    seeded_before: bool,
    expected: Option<&SeedDigest>,
) -> io::Result<()> {
    let record = seeded_from_path(store);
    let linked = fs::symlink_metadata(store).is_ok_and(|info| info.is_symlink());
    if linked {
        logf!(
            "WARNING: the home store on the disk is a link, made by an older platform-init from an image whose {} is a link, so the home was never on the disk. Seeding it again from what {} holds now",
            home.display(),
            home.display()
        );
    }
    if !linked && !must_seed(store, seeded_before)? {
        return match expected {
            Some(expected) => restored_from(&record, expected),
            None => Ok(()),
        };
    }
    match fs::metadata(archive) {
        Ok(info) => {
            if let Some(expected) = expected.filter(|e| e.bytes != info.len()) {
                return Err(io::Error::other(format!(
                    "the seed in the share is {} bytes, but the runner expects seed {} of {} bytes. Refusing to restore the home from it",
                    info.len(),
                    expected.sha256,
                    expected.bytes
                )));
            }
            logf!("seeding {} from {}", home.display(), archive.display());
            let used = seed_from_archive(archive, home, store, expected, &record)?;
            logf!("seeded {} from seed {used}", home.display());
            Ok(())
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => match expected {
            Some(expected) => Err(io::Error::other(format!(
                "the runner expects this home to be restored from seed {}, and the share holds no seed. Refusing to seed it from the image instead",
                expected.sha256
            ))),
            None => seed(home, store),
        },
        Err(e) => Err(e),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the seed the runner put in the share as the one the home must come from, or none when the share names none. A record that is there but cannot be read is an error, because guessing would either boot the image's home or refuse a good one.
fn expected_seed(path: &Path) -> io::Result<Option<SeedDigest>> {
    match fs::read_to_string(path) {
        Ok(text) => SeedDigest::parse(&text).map(Some).ok_or_else(|| {
            io::Error::other(format!(
                "{} holds {:?}, which is not a SHA-256 and a byte count",
                path.display(),
                text.trim()
            ))
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: where the disk records the seed its store was restored from: the system store beside the agent store, so the agent's own home cannot hold a file of that name.
fn seeded_from_path(store: &Path) -> PathBuf {
    guest::system_store(
        store.parent().unwrap_or_else(|| Path::new("/")),
        guest::SEEDED_FROM_FILE,
    )
}

// UNIT_BOUNDARY_DESCRIPTION: a store that exists while a seed is expected is a boot after the one that restored it — the controller keeps expecting the seed until it has seen the guest answer. It boots only if the disk records that very seed; any other home, the image's included, is not the one the migration brought.
fn restored_from(record: &Path, expected: &SeedDigest) -> io::Result<()> {
    let recorded = match fs::read_to_string(record) {
        Ok(text) => text.trim().to_string(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    if recorded == expected.sha256 {
        return Ok(());
    }
    let from = if recorded.is_empty() {
        "no seed".to_string()
    } else {
        format!("seed {recorded}")
    };
    Err(io::Error::other(format!(
        "the home on the disk was restored from {from}, but the runner expects seed {}. Refusing to boot a home the migration did not bring",
        expected.sha256
    )))
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm formats a storage disk it cannot mount, and a disk it formatted has no store, exactly like a disk that was never seeded. Seeding that disk would boot the agent on an empty home and report it healthy. When the runner says this disk has held a home before, a missing store is therefore the loss of that home, and the boot stops so the loss is seen.
fn must_seed(store: &Path, seeded_before: bool) -> io::Result<bool> {
    let seed = needs_seed(store)
        .map_err(|e| io::Error::new(e.kind(), format!("reading it on the disk: {e}")))?;
    if seed && seeded_before {
        return Err(io::Error::other(
            "the agent's home is missing from a disk that held it before, so the disk was reformatted or lost it. Refusing to boot on a fresh home that would look like the old one",
        ));
    }
    Ok(seed)
}

fn needs_seed(store: &Path) -> io::Result<bool> {
    match fs::metadata(store) {
        Ok(_) => Ok(false),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(e),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the copy lands beside its destination and is renamed into place, so a boot interrupted halfway leaves no half-seeded store to be mistaken for a complete one: the next boot finds nothing and seeds again. A home the image ships as a link is followed, and only there: the store is always a directory of the disk, holding what the link points at, because a store that is itself a link would put the bind, and so the agent's work, back on the root an image update discards.
fn seed(from: &Path, store: &Path) -> io::Result<()> {
    stage(store, |staged| match fs::metadata(from) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => mkdir_all(staged),
        Err(e) => Err(e),
        Ok(source) if source.is_dir() => copy_tree(from, staged, &source),
        Ok(_) => Err(io::Error::other(format!(
            "{} is not a directory in the image",
            from.display()
        ))),
    })
}

// UNIT_BOUNDARY_DESCRIPTION: restores the store from the seed and answers with the seed's SHA-256, hashed as it was read, so the check costs no second pass over a home of many GiB. A seed that is not the one expected fails before its store is renamed into place. The disk's record of the seed is written before that rename too, so no store restored from a seed is ever without it.
fn seed_from_archive(
    archive: &Path,
    home: &Path,
    store: &Path,
    expected: Option<&SeedDigest>,
    record: &Path,
) -> io::Result<String> {
    let mut used = String::new();
    stage(store, |staged| {
        let read = extract(archive, home, staged)?;
        if let Some(expected) = expected.filter(|e| **e != read) {
            return Err(io::Error::other(format!(
                "the seed in the share has SHA-256 {} and {} bytes, but the runner expects seed {} of {} bytes. Refusing to restore the home from it",
                read.sha256, read.bytes, expected.sha256, expected.bytes
            )));
        }
        write_record(record, read.sha256.as_bytes())?;
        used = read.sha256;
        Ok(())
    })?;
    Ok(used)
}

// UNIT_BOUNDARY_DESCRIPTION: a small file replaced whole: written beside itself, flushed and renamed over, and the directory flushed after the rename, so a boot cut short leaves the old record or the new one, also on a disk with no journal.
fn write_record(path: &Path, body: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    mkdir_all(parent)?;
    let staged = with_suffix(path, ".new");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o644)
        .open(&staged)?;
    file.write_all(body)?;
    file.sync_all()?;
    close(file)?;
    fs::rename(&staged, path)?;
    File::open(parent)?.sync_all()
}

// UNIT_BOUNDARY_DESCRIPTION: the seed's reader, counting and hashing every byte the tar reader takes from it.
struct Hashing<R> {
    inner: R,
    hasher: Sha256,
    bytes: u64,
}

impl<R: io::Read> io::Read for Hashing<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.hasher.update(&buf[..n]);
        self.bytes += n as u64;
        Ok(n)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the staged tree is flushed to the disk before the rename, and the directory that holds the store after it, so the store is whole on the disk once it has its name. A store that exists is never seeded again, so a stop before the data reached the disk — on a disk with no journal most of all — would otherwise leave the name over files that were lost, and the next boot would take it as the agent's home. A store an older boot made a link is swapped with the staged tree in one rename and removed after: a boot cut short before the swap finds the link and seeds again, where one that found no store would refuse the disk as a lost home.
fn stage(store: &Path, fill: impl FnOnce(&Path) -> io::Result<()>) -> io::Result<()> {
    let parent = store
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    mkdir_all(parent)?;
    let staged = with_suffix(store, ".seeding");
    remove_all(&staged)?;
    if subvolume_root(parent) {
        if let Some(name) = staged.file_name() {
            vm::ensure_subvolume(parent, &name.to_string_lossy())?;
        }
    }
    if let Err(e) = fill(&staged).and_then(|()| flush_filesystem(&staged)) {
        let _ = remove_all(&staged);
        return Err(e);
    }
    if fs::symlink_metadata(store).is_ok_and(|info| info.is_symlink()) {
        exchange(&staged, store)?;
        fs::remove_file(&staged)?;
    } else {
        fs::rename(&staged, store)?;
    }
    File::open(parent)?.sync_all()
}

// UNIT_BOUNDARY_DESCRIPTION: whether `dir` is the root of a btrfs subvolume, as the disk's top is in the subvolume layout. A store staged there is staged as a subvolume of its own, so the home it becomes is one too; a store that existed before its seed would be taken for a seeded home (needs_seed). The root of every btrfs subvolume is inode 256.
fn subvolume_root(dir: &Path) -> bool {
    const BTRFS_SUPER_MAGIC: i64 = 0x9123_683E;
    let Ok(path) = cstring(dir.as_os_str()) else {
        return false;
    };
    // SAFETY: a zeroed statfs is a valid value for the kernel to fill, and `path` is NUL-terminated; both outlive the call.
    let mut fs_info: libc::statfs = unsafe { std::mem::zeroed() };
    let btrfs = unsafe { libc::statfs(path.as_ptr(), &mut fs_info) } == 0
        && fs_info.f_type as i64 == BTRFS_SUPER_MAGIC;
    btrfs && fs::metadata(dir).is_ok_and(|info| info.ino() == 256)
}

fn exchange(a: &Path, b: &Path) -> io::Result<()> {
    let a = cstring(a.as_os_str())?;
    let b = cstring(b.as_os_str())?;
    // SAFETY: both paths are NUL-terminated strings that outlive the call, and AT_FDCWD resolves them as relative to the working directory, as rename(2) would.
    let rc = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            a.as_ptr(),
            libc::AT_FDCWD,
            b.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    succeeded(rc == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: flushes everything written to the filesystem that holds `path`. One syncfs covers a whole seeded tree, where an fsync per file would cost a call for each of them.
fn flush_filesystem(path: &Path) -> io::Result<()> {
    let dir = File::open(path)?;
    // SAFETY: syncfs(2) reads no memory, and `dir` keeps its descriptor open for the call.
    succeeded(unsafe { libc::syncfs(dir.as_raw_fd()) } == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: restores a seed into `to` as copy_tree reproduces an image's home: owner and mode from each entry, the mode set after the entry exists so the umask cannot drop a bit, and symlinks recreated as symlinks and never followed. Times are restored too, since they are part of what an agent's tools read, such as a build that compares them. Directories get their mode and time last, deepest first: a directory's time moves as entries are written into it, and a read-only one would refuse them. A sparse entry gets its holes back (see write_sparse). The seed comes from a volume the agent could write to, so every name is checked before it is used — an absolute name or a `..`, in an entry's name or in a hard link's target, or a path through a symlink the seed itself put there could each write outside the store, and any of them fails the whole seed. A symlink's own target is restored as it was, absolute or not: a home holds absolute links to places inside itself, and nothing here writes through a link, so a target cannot take a write outside the store. Devices and fifos are skipped, as copy_tree skips them. A seed with no entry for the home itself gives the store the owner and mode of the image's home, as seeding from the image would.
fn extract(archive: &Path, home: &Path, to: &Path) -> io::Result<SeedDigest> {
    mkdir_all(to)?;
    let mut dirs: Vec<(PathBuf, u32, u64)> = Vec::new();
    let mut rooted = false;
    let mut reader = tar::Archive::new(Hashing {
        inner: File::open(archive)?,
        hasher: Sha256::new(),
        bytes: 0,
    });
    for entry in reader.entries()? {
        let mut entry = entry?;
        let name = entry.path()?.into_owned();
        let relative = inside(&name)?;
        let target = to.join(&relative);
        let kind = entry.header().entry_type();
        let header = entry.header();
        let mode = header.mode()? & 0o7777;
        let uid = id_of(header.uid()?)?;
        let gid = id_of(header.gid()?)?;
        let mtime = header.mtime()?;
        if relative.as_os_str().is_empty() && !kind.is_dir() {
            return Err(refused(
                &name,
                "names the home itself as something other than a directory",
            ));
        }
        no_symlink_between(to, &relative, &name)?;
        if let Some(parent) = target.parent() {
            mkdir_all(parent)?;
        }
        match kind {
            tar::EntryType::Directory => {
                if relative.as_os_str().is_empty() {
                    rooted = true;
                } else {
                    make_dir(&target)?;
                }
                std::os::unix::fs::lchown(&target, Some(uid), Some(gid))?;
                dirs.push((target, mode, mtime));
                continue;
            }
            tar::EntryType::Regular | tar::EntryType::Continuous | tar::EntryType::GNUSparse => {
                clear(&target)?;
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&target)?;
                let written = if kind == tar::EntryType::GNUSparse {
                    write_sparse(&mut entry, &mut file)
                } else {
                    io::copy(&mut entry, &mut file).map(drop)
                };
                if let Err(e) = written {
                    let _ = close(file);
                    return Err(e);
                }
                close(file)?;
            }
            tar::EntryType::Symlink => {
                let link = entry
                    .link_name()?
                    .ok_or_else(|| refused(&name, "is a symlink with no target"))?;
                clear(&target)?;
                std::os::unix::fs::symlink(link, &target)?;
            }
            tar::EntryType::Link => {
                let link = entry
                    .link_name()?
                    .ok_or_else(|| refused(&name, "is a hard link with no target"))?
                    .into_owned();
                let linked = inside(&link)?;
                no_symlink_between(to, &linked, &link)?;
                clear(&target)?;
                fs::hard_link(to.join(linked), &target)?;
                continue;
            }
            _ => {
                logf!(
                    "WARNING: not seeding {}, which is neither a file, a directory nor a symlink",
                    name.display()
                );
                continue;
            }
        }
        std::os::unix::fs::lchown(&target, Some(uid), Some(gid))?;
        if kind != tar::EntryType::Symlink {
            fs::set_permissions(&target, fs::Permissions::from_mode(mode))?;
        }
        set_mtime(&target, mtime)?;
    }
    if !rooted {
        if let Ok(info) = fs::metadata(home) {
            std::os::unix::fs::lchown(to, Some(info.uid()), Some(info.gid()))?;
            dirs.push((to.to_path_buf(), info.mode() & 0o7777, info.mtime() as u64));
        }
    }
    for (dir, mode, mtime) in dirs.iter().rev() {
        fs::set_permissions(dir, fs::Permissions::from_mode(*mode))?;
        set_mtime(dir, *mtime)?;
    }
    let mut read = reader.into_inner();
    io::copy(&mut read, &mut io::sink())?;
    Ok(SeedDigest {
        sha256: hex::encode(read.hasher.finalize()),
        bytes: read.bytes,
    })
}

// UNIT_BOUNDARY_DESCRIPTION: the block a sparse entry is restored in. The tar reader hands over a hole as the zeros it reads as, so each block of zeros is skipped by a seek instead of written, and the length is set at the end so a hole at the end of the file is kept too. A file of 64 MiB with a few bytes of data takes a few blocks of the disk, as it did on its old volume, instead of 64 MiB.
const SPARSE_BLOCK: usize = 64 << 10;

fn write_sparse(entry: &mut impl io::Read, file: &mut File) -> io::Result<()> {
    let mut block = vec![0u8; SPARSE_BLOCK];
    let mut at: u64 = 0;
    loop {
        let mut filled = 0;
        while filled < block.len() {
            match entry.read(&mut block[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
        if filled == 0 {
            break;
        }
        let chunk = &block[..filled];
        if chunk.iter().any(|b| *b != 0) {
            file.seek(SeekFrom::Start(at))?;
            file.write_all(chunk)?;
        }
        at += filled as u64;
    }
    file.set_len(at)
}

// UNIT_BOUNDARY_DESCRIPTION: a seed's name as a path below the store, or a refusal when it could leave it. `.` components are dropped, so `./.bashrc` and `.bashrc` are one name and `.` is the home itself.
fn inside(name: &Path) -> io::Result<PathBuf> {
    let mut relative = PathBuf::new();
    for part in name.components() {
        match part {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            Component::RootDir | Component::ParentDir | Component::Prefix(_) => {
                return Err(refused(name, "leaves the home"));
            }
        }
    }
    Ok(relative)
}

// UNIT_BOUNDARY_DESCRIPTION: a symlink the seed itself created is a way out of the store for every later entry named through it, so no directory an entry is written through may be one. Components that do not exist yet are created as directories.
fn no_symlink_between(to: &Path, relative: &Path, name: &Path) -> io::Result<()> {
    let mut at = to.to_path_buf();
    for part in relative.parent().into_iter().flat_map(Path::components) {
        at.push(part);
        match fs::symlink_metadata(&at) {
            Ok(info) if info.file_type().is_symlink() => {
                return Err(refused(name, "is written through a symlink"));
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: a later entry of one name replaces an earlier one, as tar itself unpacks, but never a directory: replacing one would drop everything the seed already put in it.
fn clear(target: &Path) -> io::Result<()> {
    match fs::symlink_metadata(target) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
        Ok(info) if info.is_dir() => Err(refused(target, "is already a directory")),
        Ok(_) => fs::remove_file(target),
    }
}

fn make_dir(target: &Path) -> io::Result<()> {
    match fs::symlink_metadata(target) {
        Ok(info) if info.is_dir() => Ok(()),
        Ok(_) => {
            fs::remove_file(target)?;
            mkdir_all(target)
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => mkdir_all(target),
        Err(e) => Err(e),
    }
}

fn id_of(id: u64) -> io::Result<u32> {
    u32::try_from(id).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("owner {id} does not fit a uid"),
        )
    })
}

fn refused(name: &Path, why: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("the seed's entry {} {why}", name.display()),
    )
}

// UNIT_BOUNDARY_DESCRIPTION: sets an entry's modification time without following it, so a symlink gets its own time and its target keeps its own. The access time is left as it is.
fn set_mtime(path: &Path, mtime: u64) -> io::Result<()> {
    let path = cstring(path.as_os_str())?;
    let times = [
        libc::timespec {
            tv_sec: 0,
            tv_nsec: libc::UTIME_OMIT,
        },
        libc::timespec {
            tv_sec: libc::time_t::try_from(mtime).unwrap_or(libc::time_t::MAX),
            tv_nsec: 0,
        },
    ];
    // SAFETY: the path is a NUL-terminated string that outlives the call, and `times` is the two-element array utimensat(2) reads.
    let rc = unsafe {
        libc::utimensat(
            libc::AT_FDCWD,
            path.as_ptr(),
            times.as_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    succeeded(rc == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: ownership and mode are copied, not just content. An image's home belongs to the user its harness runs as, and a tree reproduced as root's would leave that user unable to write its own home. Mode is set after the entry exists rather than at creation, because creation masks it through the umask this process inherited — which would quietly drop the group-write, setgid and sticky bits an image relies on, once, on the only boot that seeds. Sockets, devices and fifos are skipped: they are not state an agent carries across a boot, and reproducing them needs privileges this copy should not assume.
fn copy_tree(from: &Path, to: &Path, info: &fs::Metadata) -> io::Result<()> {
    let kind = info.file_type();
    if kind.is_symlink() {
        std::os::unix::fs::symlink(fs::read_link(from)?, to)?;
    } else if kind.is_dir() {
        if let Err(e) = DirBuilder::new().mode(info.mode() & 0o777).create(to) {
            if e.kind() != io::ErrorKind::AlreadyExists {
                return Err(e);
            }
        }
        let mut entries = fs::read_dir(from)?.collect::<io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let child = entry.metadata()?;
            copy_tree(&entry.path(), &to.join(entry.file_name()), &child)?;
        }
    } else if kind.is_file() {
        copy_file(from, to, info.mode() & 0o777)?;
    } else {
        logf!(
            "WARNING: not seeding {}, which is neither a file, a directory nor a symlink",
            from.display()
        );
        return Ok(());
    }
    std::os::unix::fs::lchown(to, Some(info.uid()), Some(info.gid()))?;
    if kind.is_symlink() {
        return Ok(());
    }
    fs::set_permissions(to, fs::Permissions::from_mode(info.mode() & 0o7777))
}

fn copy_file(from: &Path, to: &Path, mode: u32) -> io::Result<()> {
    let mut source = File::open(from)?;
    let mut destination = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(to)?;
    if let Err(e) = io::copy(&mut source, &mut destination) {
        let _ = close(destination);
        return Err(e);
    }
    close(destination)
}

// UNIT_BOUNDARY_DESCRIPTION: read-only is a property of the mount and not of the bind, so it takes a second call. A bind that cannot be made read-only is still a working bind, and what it exposes is a share the guest cannot write to anyway.
fn bind_read_only(from: &Path, to: &Path) -> io::Result<()> {
    mount(from, to, libc::MS_BIND)?;
    if let Err(e) = mount(
        Path::new(""),
        to,
        libc::MS_BIND | libc::MS_REMOUNT | libc::MS_RDONLY,
    ) {
        logf!(
            "WARNING: {} stays writable in this guest ({e})",
            to.display()
        );
    }
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: an image's launch record may name a bare command, which a container runtime would resolve against PATH — so this resolves it the same way rather than failing on an entrypoint that works everywhere else. The search path is passed in rather than read here, so the caller decides which environment it is.
fn look_path(command: &OsStr, search: Option<OsString>) -> io::Result<PathBuf> {
    let given = Path::new(command);
    if command.as_bytes().contains(&b'/') {
        executable(given)?;
        return Ok(given.to_path_buf());
    }
    let search = match search {
        Some(search) if !search.is_empty() => search,
        _ => OsString::from(DEFAULT_PATH),
    };
    std::env::split_paths(&search)
        .map(|dir| dir.join(command))
        .find(|candidate| executable(candidate).is_ok())
        .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
}

fn executable(path: &Path) -> io::Result<()> {
    let info = fs::metadata(path)?;
    if info.is_dir() || info.permissions().mode() & 0o111 == 0 {
        return Err(io::Error::from(io::ErrorKind::PermissionDenied));
    }
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the signals platform-init passes on to the image's entrypoint. It is the first process of the workload's PID namespace, and the kernel drops a signal sent to that process unless it takes the signal itself, so each of these is taken and sent on. SIGTERM, SIGINT and SIGQUIT also mean the workload is being stopped, so an entrypoint that exits after one is not started again.
const FORWARDED: [libc::c_int; 7] = [
    libc::SIGTERM,
    libc::SIGINT,
    libc::SIGQUIT,
    libc::SIGHUP,
    libc::SIGUSR1,
    libc::SIGUSR2,
    libc::SIGWINCH,
];
const STOPPING: [libc::c_int; 3] = [libc::SIGTERM, libc::SIGINT, libc::SIGQUIT];

// UNIT_BOUNDARY_DESCRIPTION: every signal platform-init handles is blocked in every thread and read with sigtimedwait instead, so none arrives while the boot is half done and none is lost to the thread that writes the boot log. It runs before that thread exists, because a thread takes its signal mask from the one that starts it. A handler that does nothing is installed as well, because a signal the first process of a PID namespace leaves at its default is dropped by the kernel. A child inherits the mask, so every child that outlives a moment is started unblocked.
fn block_signals() {
    // SAFETY: the sigset is initialised by sigemptyset before any other use, sigaction is given a zeroed struct naming a handler with the signature the kernel calls, and both calls read only the memory passed to them.
    unsafe {
        let set = handled_signals();
        libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = ignore_signal as extern "C" fn(libc::c_int) as usize;
        for signal in FORWARDED.iter().chain(&[libc::SIGCHLD]) {
            libc::sigaction(*signal, &action, std::ptr::null_mut());
        }
    }
}

extern "C" fn ignore_signal(_: libc::c_int) {}

// UNIT_BOUNDARY_DESCRIPTION: starts `command`'s child with no signal blocked. std clears the mask it inherited only when it forks, not when it uses posix_spawn, and a child that waits for SIGCHLD, as openrc-run does, then waits forever.
fn unblocked(command: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::unix::process::CommandExt;
    // SAFETY: sigemptyset and sigprocmask are async-signal-safe and touch only the set on the child's stack.
    unsafe {
        command.pre_exec(|| {
            let mut set: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut set);
            succeeded(libc::sigprocmask(libc::SIG_SETMASK, &set, std::ptr::null_mut()) == 0)
        })
    }
}

fn handled_signals() -> libc::sigset_t {
    // SAFETY: sigemptyset initialises the set before sigaddset reads it, and a zeroed sigset_t is valid memory for both.
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        for signal in FORWARDED.iter().chain(&[libc::SIGCHLD]) {
            libc::sigaddset(&mut set, *signal);
        }
        set
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the next signal, or nothing once `limit` passes.
fn next_signal(limit: std::time::Duration) -> Option<libc::c_int> {
    let set = handled_signals();
    let timeout = libc::timespec {
        tv_sec: libc::time_t::try_from(limit.as_secs()).unwrap_or(libc::time_t::MAX),
        tv_nsec: libc::c_long::from(limit.subsec_nanos()),
    };
    // SAFETY: sigtimedwait reads the set and the timeout it is given and writes no siginfo when passed null.
    let signal = unsafe { libc::sigtimedwait(&set, std::ptr::null_mut(), &timeout) };
    (signal > 0).then_some(signal)
}

// UNIT_BOUNDARY_DESCRIPTION: the image's entrypoint, with argv exactly as the image names it — argv[0] included, although the binary was resolved from PATH — in the working directory and environment this boot has built.
// UNIT_BOUNDARY_DESCRIPTION: the entrypoint's process, with the env of the launch record and nothing of platform-init's own: init.krun hands the init the VMM's settings, which are not the image's. A record without PATH gets the one a container runtime would search.
fn entrypoint(
    binary: &Path,
    command: &[OsString],
    env: &[(String, String)],
    trust: Option<&Path>,
) -> std::process::Command {
    use std::os::unix::process::CommandExt;
    let mut entrypoint = std::process::Command::new(binary);
    entrypoint.arg0(&command[0]).args(&command[1..]).env_clear();
    if !env.iter().any(|(key, _)| key == "PATH") {
        entrypoint.env("PATH", DEFAULT_PATH);
    }
    entrypoint.envs(env.iter().map(|(key, value)| (key, value)));
    if let Some(trust) = trust {
        entrypoint.env(TRUST_CACHE_ENV, trust);
    }
    unblocked(&mut entrypoint);
    entrypoint
}

// UNIT_BOUNDARY_DESCRIPTION: platform-init stays the parent of the image's entrypoint instead of becoming it. Nothing else in the guest starts the entrypoint again, so an entrypoint that exited would leave a machine that runs and answers nothing until the runner's unhealthy restart, ten minutes later; powering the guest off instead would lose the stop handshake with the host. So when the entrypoint exits, every process it left is ended, as a container restart would, and it is started again on the same root and the same home, after a delay that doubles while it keeps failing. Each exit is announced, so the machine's console says why the agent went away. Being PID 1, platform-init also reaps every orphan. A stop ends in vm::stopped, never in an exit: the guest's PID 1 may not exit.
fn supervise(
    binary: &Path,
    command: &[OsString],
    env: &[(String, String)],
    trust: Option<&Path>,
    openrc: bool,
) -> ! {
    let words: Vec<_> = command.iter().map(|word| word.to_string_lossy()).collect();
    let cgroup = if openrc { entrypoint_cgroup() } else { None };
    let mut delay = None;
    let mut stopping = false;
    loop {
        announce(&format!(
            "handing off to the image entrypoint [{}]",
            words.join(" ")
        ));
        let started = std::time::Instant::now();
        let mut start = entrypoint(binary, command, env, trust);
        if let Some(procs) = &cgroup {
            use std::os::unix::process::CommandExt;
            let procs = procs.as_raw_fd();
            // SAFETY: the child only calls write(2), which is async-signal-safe, on a descriptor the parent keeps open across the fork; "0" moves the writer itself.
            unsafe {
                start.pre_exec(move || succeeded(libc::write(procs, b"0".as_ptr().cast(), 1) == 1))
            };
        }
        let status = match start.spawn() {
            Ok(child) => wait_for(child.id(), &mut stopping),
            Err(e) if delay.is_none() => fatal!("starting {}: {e}", binary.display()),
            Err(e) => {
                announce(&format!("starting {}: {e}", binary.display()));
                NOT_STARTED
            }
        };
        let full = status != 0 && home_full(Path::new(guest::AGENT_HOME));
        announce(&format!(
            "the image entrypoint {} after {}s{}",
            exit_description(status),
            started.elapsed().as_secs(),
            if full {
                format!("; {}", guest::HOME_FULL)
            } else {
                String::new()
            }
        ));
        // UNIT_BOUNDARY_DESCRIPTION: with openrc the other processes are its services, which a restart of the entrypoint keeps, so only the entrypoint's cgroup is ended. A guest whose cgroup could not be made keeps what the old entrypoint left too, holding its ports.
        if !openrc {
            end_the_rest(&mut stopping);
        } else if cgroup.is_some() {
            end_cgroup(&mut stopping);
        }
        if stopping {
            stop(openrc);
        }
        let wait = restart_delay(delay, started.elapsed());
        delay = Some(wait);
        announce(&format!(
            "starting the image entrypoint again in {}s",
            wait.as_secs()
        ));
        if pause(wait, &mut stopping) {
            stop(openrc);
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the cgroup an openrc guest's entrypoint runs in, apart from openrc's services, so that whatever the entrypoint started can be ended without them, however it detached itself. Returns its cgroup.procs, open for the child to move itself into.
const ENTRYPOINT_CGROUP: &str = "/sys/fs/cgroup/entrypoint";

fn entrypoint_cgroup() -> Option<File> {
    let cgroup = Path::new(ENTRYPOINT_CGROUP);
    match mkdir_all(cgroup).and_then(|()| {
        OpenOptions::new()
            .write(true)
            .open(cgroup.join("cgroup.procs"))
    }) {
        Ok(procs) => Some(procs),
        Err(e) => {
            announce(&format!("WARNING: making the entrypoint's cgroup {ENTRYPOINT_CGROUP} ({e}); a restart of the entrypoint ends none of what it started"));
            None
        }
    }
}

fn end_cgroup(stopping: &mut bool) {
    let cgroup = Path::new(ENTRYPOINT_CGROUP);
    if let Err(e) = fs::write(cgroup.join("cgroup.kill"), "1") {
        announce(&format!("WARNING: ending the entrypoint's cgroup: {e}"));
        return;
    }
    let deadline = std::time::Instant::now() + END_GRACE;
    while fs::read_to_string(cgroup.join("cgroup.procs"))
        .is_ok_and(|procs| !procs.trim().is_empty())
        && std::time::Instant::now() < deadline
    {
        reap();
        if let Some(signal) = next_signal(REAP_INTERVAL / 10) {
            on_signal(signal, stopping);
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the end of the workload once its entrypoint has exited on a stop: openrc's services are stopped by openrc first, so each gets its own stop, and whatever is left is ended after.
fn stop(openrc: bool) -> ! {
    if openrc {
        run_openrc("shutdown", &[], &mut true);
        end_the_rest(&mut true);
    }
    flush_home_on_stop();
    vm::stopped()
}

// UNIT_BOUNDARY_DESCRIPTION: writes the agent's home out to the disk once the workload has stopped, before the guest is quiesced and powered off. A stop asks smolvm to quiesce the disk, and a runner may be stopping a machine an older smolvm started, whose guest agent may not confirm it; the runner then powers the guest off. Flushing here means that power-off never costs what the agent last wrote, whatever version the host runs.
fn flush_home_on_stop() {
    if let Err(e) = flush_filesystem(Path::new(guest::AGENT_HOME)) {
        announce(&format!(
            "flushing {} before the stop: {e}",
            guest::AGENT_HOME
        ));
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the wait status of an entrypoint that could not be started at all: exit status 127, which is what a shell reports for a command it cannot run.
const NOT_STARTED: libc::c_int = 127 << 8;

// UNIT_BOUNDARY_DESCRIPTION: how often the wait loops look for exited processes without being woken. A SIGCHLD for every exit is not guaranteed, because the kernel merges signals that arrive while one is pending.
const REAP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

// UNIT_BOUNDARY_DESCRIPTION: how long the processes the entrypoint left get to exit after SIGTERM, and then after SIGKILL, before the entrypoint is started again anyway.
const END_GRACE: std::time::Duration = std::time::Duration::from_secs(5);

// UNIT_BOUNDARY_DESCRIPTION: the delay before the entrypoint is started again. It starts at a second and doubles up to a minute while the entrypoint keeps exiting soon after it starts, so an image that cannot start does not spin the guest. One that ran for a minute or more had a working start, so its next start waits the least again.
const FIRST_RESTART_DELAY: std::time::Duration = std::time::Duration::from_secs(1);
const MAX_RESTART_DELAY: std::time::Duration = std::time::Duration::from_secs(60);
const STABLE_RUN: std::time::Duration = std::time::Duration::from_secs(60);

fn restart_delay(
    previous: Option<std::time::Duration>,
    ran: std::time::Duration,
) -> std::time::Duration {
    match previous {
        Some(previous) if ran < STABLE_RUN => (previous * 2).min(MAX_RESTART_DELAY),
        _ => FIRST_RESTART_DELAY,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: waits for the entrypoint to exit, reaping every orphan meanwhile, and passes each forwarded signal on to it. The result is the entrypoint's wait status.
fn wait_for(pid: u32, stopping: &mut bool) -> libc::c_int {
    let pid = libc::pid_t::try_from(pid).unwrap_or(libc::pid_t::MAX);
    loop {
        let (exited, _) = reap();
        if let Some(&(_, status)) = exited.iter().find(|(exited, _)| *exited == pid) {
            return status;
        }
        if let Some(signal) = next_signal(REAP_INTERVAL) {
            if on_signal(signal, stopping) {
                // SAFETY: kill(2) reads no memory. The entrypoint is not reaped until the loop above sees it exit, so its pid still names it.
                unsafe { libc::kill(pid, signal) };
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: notes a signal that stops the workload, and says whether the signal is one to pass on to the entrypoint.
fn on_signal(signal: libc::c_int, stopping: &mut bool) -> bool {
    if STOPPING.contains(&signal) {
        *stopping = true;
    }
    FORWARDED.contains(&signal)
}

// UNIT_BOUNDARY_DESCRIPTION: every child that has exited, reaped, and whether any child is left.
fn reap() -> (Vec<(libc::pid_t, libc::c_int)>, bool) {
    let mut exited = Vec::new();
    loop {
        let mut status = 0;
        // SAFETY: waitpid writes the wait status into the one integer it is given.
        let pid = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
        match pid {
            0 => return (exited, true),
            pid if pid > 0 => {
                if !vm::claim_exit(pid, status) {
                    exited.push((pid, status));
                }
            }
            _ => return (exited, false),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: ends every process the entrypoint left in the workload's PID namespace, as a container runtime ends a container's processes before it restarts it. A daemon the old entrypoint started would otherwise still hold its ports and files when the new one starts. kill(2) with -1 reaches every process of the namespace but its first, and is refused by the guard to anything that is not that first process, so a test cannot signal every process of its user.
fn end_the_rest(stopping: &mut bool) {
    if std::process::id() != 1 {
        return;
    }
    for signal in [libc::SIGTERM, libc::SIGKILL] {
        // SAFETY: kill(2) reads no memory.
        unsafe { libc::kill(-1, signal) };
        if reaped_all_within(END_GRACE, stopping) {
            return;
        }
    }
}

fn reaped_all_within(limit: std::time::Duration, stopping: &mut bool) -> bool {
    let deadline = std::time::Instant::now() + limit;
    loop {
        if !reap().1 {
            return true;
        }
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            return false;
        }
        if let Some(signal) = next_signal(left.min(REAP_INTERVAL)) {
            on_signal(signal, stopping);
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: waits out the delay before a restart, reaping orphans meanwhile. The result says whether the workload was stopped during it.
fn pause(delay: std::time::Duration, stopping: &mut bool) -> bool {
    let deadline = std::time::Instant::now() + delay;
    loop {
        reap();
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if *stopping || left.is_zero() {
            return *stopping;
        }
        if let Some(signal) = next_signal(left) {
            on_signal(signal, stopping);
        }
    }
}

fn exit_description(status: libc::c_int) -> String {
    if libc::WIFEXITED(status) {
        format!("exited with status {}", libc::WEXITSTATUS(status))
    } else if libc::WIFSIGNALED(status) {
        format!("was killed by signal {}", libc::WTERMSIG(status))
    } else {
        format!("ended with wait status {status}")
    }
}

fn mount(source: &Path, target: &Path, flags: libc::c_ulong) -> io::Result<()> {
    let source = cstring(source.as_os_str())?;
    let target = cstring(target.as_os_str())?;
    // SAFETY: source, target and the empty filesystem type are NUL-terminated strings that outlive the call, and a null data pointer is how mount(2) is told there are no options.
    let rc = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            c"".as_ptr(),
            flags,
            std::ptr::null(),
        )
    };
    succeeded(rc == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: a close that fails is a write that did not land, so a copy reports it rather than letting the drop discard it.
fn close(file: File) -> io::Result<()> {
    // SAFETY: into_raw_fd hands over the only owner of the descriptor, so nothing closes it twice.
    succeeded(unsafe { libc::close(file.into_raw_fd()) } == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: the result of a libc call that reports failure in errno, read right after the call and before anything else can overwrite it.
fn succeeded(ok: bool) -> io::Result<()> {
    if ok {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn mkdir_all(path: &Path) -> io::Result<()> {
    DirBuilder::new().recursive(true).mode(0o755).create(path)
}

// UNIT_BOUNDARY_DESCRIPTION: deletes `path` and everything under it, never through a symlink and never into a mount. A work directory bound into a cache is the work itself, on the same disk, so the delete stops with an error at the first mount it meets, and what is mounted there stays. Every name is reached through its parent's descriptor, so a directory swapped for a link or a mount meanwhile is not followed either.
fn remove_all(path: &Path) -> io::Result<()> {
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} names no entry", path.display()),
        ));
    };
    let parent = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY)
        .open(parent)?;
    let mount = statx(parent.as_raw_fd(), Path::new(""))?.stx_mnt_id;
    match remove_at(&parent, name, mount) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        removed => removed,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a name that is not a directory is unlinked at once, which a file or link bound in place refuses with EBUSY. Only a directory costs a look at its mount, so a purge of millions of files makes one call for each.
fn remove_at(dir: &File, name: &OsStr, mount: u64) -> io::Result<()> {
    let c_name = cstring(name)?;
    // SAFETY: c_name is NUL-terminated and outlives the call.
    if unsafe { libc::unlinkat(dir.as_raw_fd(), c_name.as_ptr(), 0) } == 0 {
        return Ok(());
    }
    let e = io::Error::last_os_error();
    if e.raw_os_error() != Some(libc::EISDIR) {
        return Err(e);
    }
    // SAFETY: c_name is NUL-terminated and outlives the call.
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            c_name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    succeeded(fd >= 0)?;
    // SAFETY: openat returned a descriptor nothing else owns.
    let child = unsafe { File::from_raw_fd(fd) };
    if statx(fd, Path::new(""))?.stx_mnt_id != mount {
        return Err(io::Error::other(format!(
            "{} is a mount, kept with what it holds",
            Path::new(name).display()
        )));
    }
    for entry in fs::read_dir(format!("/proc/self/fd/{fd}"))? {
        remove_at(&child, &entry?.file_name(), mount)?;
    }
    // SAFETY: c_name is NUL-terminated and outlives the call.
    succeeded(unsafe { libc::unlinkat(dir.as_raw_fd(), c_name.as_ptr(), libc::AT_REMOVEDIR) } == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: statx(2) of `path` relative to the descriptor `dir`, or of `dir` itself for an empty path, without following a final symlink, with the id of the mount the entry is on. A kernel that reports no mount id is an error, since eviction cannot then tell a bind mount from scratch.
fn statx(dir: libc::c_int, path: &Path) -> io::Result<libc::statx> {
    let path = cstring(path.as_os_str())?;
    let mut info = std::mem::MaybeUninit::<libc::statx>::zeroed();
    // SAFETY: path is NUL-terminated and outlives the call, and info is a statx buffer the call may write.
    let rc = unsafe {
        libc::statx(
            dir,
            path.as_ptr(),
            libc::AT_SYMLINK_NOFOLLOW | libc::AT_EMPTY_PATH,
            libc::STATX_BASIC_STATS | libc::STATX_MNT_ID,
            info.as_mut_ptr(),
        )
    };
    succeeded(rc == 0)?;
    // SAFETY: the buffer was zeroed, and statx is plain data, so every bit pattern is a valid value.
    let info = unsafe { info.assume_init() };
    if info.stx_mask & libc::STATX_MNT_ID == 0 {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "the kernel reports no mount id",
        ));
    }
    Ok(info)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn cstring(value: &OsStr) -> io::Result<CString> {
    CString::new(value.as_bytes()).map_err(io::Error::from)
}

#[cfg(test)]
mod tests {
    // TEST_OVERVIEW: platform-init is what makes a machine's persistence the platform's promise rather than the image's behaviour. The mounting itself needs a guest, but everything that decides what ends up on the disk — seeding the home from the image exactly once, never leaving a half-copy behind, keeping the boot log readable, which mounts follow the image onto its root and when that root is kept, which cache folders are cleared from the home, resolving the entrypoint it hands off to — is ordinary file or table work and is covered here.
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // TEST_SCENARIO: a guard that held room when the guest stopped is emptied and closed first, so the stop's sync frees its blocks and the next boot does not find them still taken; the guard thread then finds no file and ends.
    #[test]
    fn a_clean_stop_empties_the_storage_guard() {
        let disk = TempDir::new("guard-stop");
        fs::create_dir_all(disk.path().join(guest::SYSTEM_DIR)).unwrap();
        let guard = pool_guard(disk.path()).expect("an unnamed file on the disk");
        guard.set_len(1 << 20).unwrap();
        let probe = guard.try_clone().unwrap();
        *POOL_GUARD.lock().unwrap() = Some(guard);
        release_pool_guard();
        assert!(POOL_GUARD.lock().unwrap().is_none());
        assert_eq!(probe.metadata().unwrap().len(), 0);
    }

    // TEST_SCENARIO: the guard file has no name, so no older platform-init, image or agent can find it, and the filesystem frees it once the guest stops; a disk where it cannot be made boots without it.
    #[test]
    fn the_storage_guard_is_an_unnamed_file_on_the_disk() {
        let disk = TempDir::new("guard");
        assert!(pool_guard(disk.path()).is_none());
        fs::create_dir_all(disk.path().join(guest::SYSTEM_DIR)).unwrap();
        let guard = pool_guard(disk.path()).expect("an unnamed file on the disk");
        assert_eq!(guard.metadata().unwrap().nlink(), 0);
        assert_eq!(
            fs::read_dir(disk.path().join(guest::SYSTEM_DIR))
                .unwrap()
                .count(),
            0
        );
    }

    // TEST_SCENARIO: the guard is sized again whenever the guest frees room or its runner grants it more, and the room it gives up has to be room the guest can write again: on btrfs a file shortened in place kept the blocks of the extent it had partly freed while its own stat reported the smaller size, so a smaller guard freed nothing and a steadily writing guest filled its disk with room it had been given back. The guard gives a shrink's room up whole, so preallocating 128 MiB takes 128 MiB, sizing back to 32 MiB gives 96 MiB back, and a run of sizes there and back loses nothing to the moves: the filesystem's free space ends where it started.
    #[test]
    fn a_smaller_guard_gives_its_room_back() {
        let disk = TempDir::new("guard-resize");
        fs::create_dir_all(disk.path().join(guest::SYSTEM_DIR)).unwrap();
        let mut guard = pool_guard(disk.path()).expect("an unnamed file on the disk");
        let free = || {
            flush_filesystem(disk.path()).unwrap();
            let stat = statvfs(disk.path()).expect("the disk's free space");
            #[allow(clippy::unnecessary_cast)]
            let (size, avail) = (stat.f_frsize as u64, stat.f_bavail as u64);
            size * avail
        };
        let base = free();
        size_guard(&mut guard, disk.path(), 128 << 20).unwrap();
        let held = free();
        assert!(
            base.saturating_sub(held) >= 120 << 20,
            "128 MiB of blocks took {} MiB",
            base.saturating_sub(held) >> 20
        );
        size_guard(&mut guard, disk.path(), 32 << 20).unwrap();
        let after = free();
        assert!(
            after.saturating_sub(held) >= 88 << 20,
            "a guard shrunk by 96 MiB gave back {} MiB",
            after.saturating_sub(held) >> 20
        );
        for round in 1..=4 {
            size_guard(&mut guard, disk.path(), 128 << 20).unwrap();
            size_guard(&mut guard, disk.path(), 32 << 20).unwrap();
            let blocks = guard.metadata().unwrap().blocks() * 512;
            assert!(
                blocks <= (32 << 20) + (1 << 20),
                "round {round} left the file holding {} MiB of blocks for a 32 MiB guard",
                blocks >> 20
            );
            assert!(
                free().saturating_sub(after) <= 8 << 20,
                "round {round} took {} MiB off the disk's free space",
                free().saturating_sub(after) >> 20
            );
        }
    }

    // TEST_SCENARIO: a disk of many small files runs out of inodes with most of its space free, and a write then fails as on a full disk, so the free share is the smaller of blocks and inodes; a filesystem that counts no inodes is judged by its blocks.
    #[test]
    fn a_disk_out_of_inodes_reads_as_full() {
        // SAFETY: statvfs is plain old data, and all-zero bytes are a valid value of it.
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        (stat.f_blocks, stat.f_bavail) = (100, 97);
        assert_eq!(free_share(&stat), Some(97));
        (stat.f_files, stat.f_favail) = (100, 0);
        assert_eq!(free_share(&stat), Some(0));
        stat.f_blocks = 0;
        assert_eq!(free_share(&stat), None);
    }

    // TEST_SCENARIO: a boot step that failed for want of space or inodes says the home is full, which the runner reads to report a full home and its fix; any other failure does not.
    #[test]
    fn a_boot_refused_for_a_full_disk_says_the_home_is_full() {
        let full = fatal_line(&format!(
            "creating /x: {}",
            io::Error::from_raw_os_error(libc::ENOSPC)
        ));
        assert!(
            full.starts_with("FATAL: creating /x") && full.ends_with(guest::HOME_FULL),
            "{full}"
        );
        let other = fatal_line(&format!(
            "creating /x: {}",
            io::Error::from_raw_os_error(libc::EACCES)
        ));
        assert!(!other.contains(guest::HOME_FULL), "{other}");
    }

    // TEST_SCENARIO: a full disk cannot create even the empty work layer a boot needs, so the boot first deletes what earlier boots set aside and the last boot's temporary folders, then tries again; the kept root and the home stay.
    #[test]
    fn a_full_disk_gives_back_only_what_a_boot_discards() {
        let disk = TempDir::new("free-room");
        let layers = FreshRoot::on(disk.path());
        let home = disk.path().join("home");
        for dir in [
            layers.upper.clone(),
            layers.store.join(format!("work{DISCARDED_INFIX}1")),
            layers.store.join(format!("var-tmp{DISCARDED_INFIX}1")),
            layers.upper.join("tmp/repo"),
            home.clone(),
        ] {
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("f"), b"x").unwrap();
        }
        free_room_for_boot(disk.path());
        assert!(layers.upper.join("f").exists());
        assert!(home.join("f").exists());
        assert!(!layers
            .store
            .join(format!("work{DISCARDED_INFIX}1"))
            .exists());
        assert!(!layers.upper.join("tmp").exists());
        assert!(!layers
            .store
            .join(format!("var-tmp{DISCARDED_INFIX}1"))
            .exists());
    }

    // TEST_SCENARIO: a guest's own disk that is short is evicted on every look down to the last EVICT_AGES step, until it has room; a disk whose room cannot be read is left alone.
    #[test]
    fn a_short_disk_is_evicted_until_it_has_room() {
        let pass = eviction_pass(Some(5), None, None).unwrap();
        assert_eq!(pass.youngest, 600);
        assert!(pass.continues(Some(15), 1 << 40) && !pass.continues(Some(20), 0));
        assert_eq!(eviction_pass(Some(50), None, None), None);
        assert_eq!(eviction_pass(None, None, None), None);
    }

    // TEST_SCENARIO: the owner's claim is mostly the agents' homes, which eviction never touches, so a claim that stays short must not give every agent's /tmp a ten-minute life. A request from the runner is served once, by a pass that keeps whatever was used in the last hour and stops at the bytes asked; only a new request, which the runner sends when the claim fills further, brings another pass. An older runner's empty mark is one unbounded request.
    #[test]
    fn a_short_claim_is_served_once_per_request_and_spares_recent_work() {
        let request = parse_claim_request("17 1000\n");
        assert_eq!(request.bytes, Some(1000));
        let pass = eviction_pass(Some(50), Some(&request), None).unwrap();
        assert_eq!((pass.youngest, pass.claim_only), (CLAIM_EVICT_AGE, true));
        assert!(pass.continues(Some(50), 999) && !pass.continues(Some(50), 1000));
        assert_eq!(
            eviction_pass(Some(50), Some(&request), Some("17 1000")),
            None
        );
        assert!(eviction_pass(
            Some(50),
            Some(&parse_claim_request("18 1000")),
            Some("17 1000")
        )
        .is_some());
        let legacy = parse_claim_request("");
        assert_eq!(legacy.bytes, None);
        assert!(eviction_pass(Some(50), Some(&legacy), None)
            .unwrap()
            .continues(Some(50), u64::MAX));
        assert_eq!(eviction_pass(Some(50), Some(&legacy), Some("")), None);
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "platform-init-{name}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
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

    fn mode(path: &Path) -> u32 {
        fs::symlink_metadata(path).unwrap().mode()
    }

    #[test]
    fn seeding_reproduces_the_image_tree() {
        let image = TempDir::new("image");
        let nested = image.path().join("work").join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("file"), b"baked").unwrap();
        fs::set_permissions(nested.join("file"), fs::Permissions::from_mode(0o640)).unwrap();
        std::os::unix::fs::symlink("nested/file", image.path().join("work").join("link")).unwrap();
        fs::create_dir(image.path().join("shared")).unwrap();
        fs::set_permissions(
            image.path().join("shared"),
            fs::Permissions::from_mode(0o3775),
        )
        .unwrap();

        let disk = TempDir::new("disk");
        let store = disk.path().join("agent").join("home").join("agent");
        seed(image.path(), &store).unwrap();

        let file = store.join("work").join("nested").join("file");
        assert_eq!(fs::read(&file).unwrap(), b"baked");
        assert_eq!(
            mode(&file) & 0o7777,
            0o640,
            "a mode the image set is a mode the agent keeps"
        );
        assert_eq!(
            mode(&store.join("shared")) & 0o7777,
            0o3775,
            "setgid, sticky and group-write survive the umask this process inherited; seeding happens once, so a bit dropped here never comes back"
        );
        assert_eq!(
            fs::read_link(store.join("work").join("link")).unwrap(),
            Path::new("nested/file"),
            "a symlink is reproduced, not followed and copied"
        );
    }

    // TEST_SCENARIO: an image may ship its home as a link, to the root user's home for example. The store must still be a directory on the disk holding what the link points at, because a store that is a link puts the agent's work on the root an image update discards. The mountpoint is then made a directory in place of the link, and what the link pointed at is left alone.
    #[test]
    fn a_home_the_image_links_elsewhere_is_seeded_and_mounted_as_a_directory() {
        let image = TempDir::new("image");
        let target = image.path().join("root");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("file"), b"baked").unwrap();
        std::os::unix::fs::symlink("inner", target.join("link")).unwrap();
        let home = image.path().join("home");
        std::os::unix::fs::symlink(&target, &home).unwrap();

        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");
        seed(&home, &store).unwrap();

        assert!(fs::symlink_metadata(&store).unwrap().is_dir());
        assert_eq!(fs::read(store.join("file")).unwrap(), b"baked");
        assert_eq!(
            fs::read_link(store.join("link")).unwrap(),
            Path::new("inner"),
            "only the home itself is followed"
        );

        mountpoint(&home).unwrap();
        assert!(fs::symlink_metadata(&home).unwrap().is_dir());
        assert_eq!(fs::read(target.join("file")).unwrap(), b"baked");
    }

    // TEST_SCENARIO: an older platform-init made the store a link on a disk whose image linked its home elsewhere, and the runner then recorded the disk as holding a home it never held. That disk is seeded again from what the image's home holds now, which while the root is kept is the agent's work since the last image update, instead of being refused as a lost home or mounted as the link.
    #[test]
    fn a_store_an_older_boot_made_a_link_is_seeded_again() {
        let image = TempDir::new("image");
        fs::write(image.path().join("file"), b"the agent's work").unwrap();
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");
        std::os::unix::fs::symlink(image.path(), &store).unwrap();

        prepare_home(
            image.path(),
            &disk.path().join("no-seed.tar"),
            &store,
            true,
            None,
        )
        .unwrap();

        assert!(fs::symlink_metadata(&store).unwrap().is_dir());
        assert_eq!(fs::read(store.join("file")).unwrap(), b"the agent's work");
        assert!(!with_suffix(&store, ".seeding").exists());
    }

    // TEST_SCENARIO: the reseed of a linked store can fail or be cut short. The link must then still be there, so the next boot seeds again instead of finding no store and refusing the disk as a lost home.
    #[test]
    fn a_failed_reseed_of_a_linked_store_keeps_the_link() {
        let image = TempDir::new("image");
        let home = image.path().join("home");
        fs::write(&home, b"not a directory").unwrap();
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");
        std::os::unix::fs::symlink(&home, &store).unwrap();

        prepare_home(&home, &disk.path().join("no-seed.tar"), &store, true, None).unwrap_err();

        assert!(fs::symlink_metadata(&store).unwrap().is_symlink());
    }

    // TEST_SCENARIO: an image may ship nothing at the agent's home. That is an empty directory on the disk, not a failed boot.
    #[test]
    fn seeding_a_path_the_image_does_not_ship_starts_empty() {
        let image = TempDir::new("absent");
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent").join("data");
        seed(&image.path().join("absent"), &store).unwrap();

        assert_eq!(fs::read_dir(&store).unwrap().count(), 0);
    }

    // TEST_SCENARIO: seeding happens once, on the boot that finds no store. A store that already holds the agent's work must never be overwritten by the image again — that would discard everything the agent has done since it was created.
    #[test]
    fn seeding_leaves_an_existing_store_alone() {
        let image = TempDir::new("image");
        fs::write(image.path().join("file"), b"from the image").unwrap();

        let disk = TempDir::new("disk");
        let store = disk.path().join("agent").join("home").join("agent");
        assert!(needs_seed(&store).unwrap(), "the first boot finds no store");
        seed(image.path(), &store).unwrap();
        fs::write(store.join("file"), b"the agent's work").unwrap();

        assert!(
            !needs_seed(&store).unwrap(),
            "the store exists, so a second boot never seeds at all"
        );
        assert_eq!(fs::read(store.join("file")).unwrap(), b"the agent's work");
    }

    // TEST_SCENARIO: a boot cut short halfway through the copy must leave nothing a later boot could mistake for a complete store. The copy is staged beside its destination and renamed into place, so an interrupted seed leaves only the staging directory and the next boot seeds again from the image.
    #[test]
    fn an_interrupted_seed_is_not_mistaken_for_a_store() {
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent").join("home").join("agent");
        let staged = with_suffix(&store, ".seeding");
        fs::create_dir_all(&staged).unwrap();
        fs::write(staged.join("half"), b"partial").unwrap();

        let image = TempDir::new("image");
        fs::write(image.path().join("whole"), b"complete").unwrap();
        assert!(
            needs_seed(&store).unwrap(),
            "a staging directory is not a store"
        );
        seed(image.path(), &store).unwrap();

        assert!(store.join("whole").is_file());
        assert!(
            !store.join("half").exists(),
            "the abandoned staging directory is discarded, not adopted"
        );
    }

    // UNIT_BOUNDARY_DESCRIPTION: one entry of a hand-built seed. The name is written into the header raw, as a hostile seed would write it, because the tar writer itself refuses the names these tests need.
    struct Entry<'a> {
        name: &'a str,
        kind: tar::EntryType,
        mode: u32,
        link: Option<&'a str>,
        body: &'a [u8],
    }

    fn entry<'a>(name: &'a str, kind: tar::EntryType, mode: u32) -> Entry<'a> {
        Entry {
            name,
            kind,
            mode,
            link: None,
            body: b"",
        }
    }

    fn owner() -> (u32, u32) {
        // SAFETY: geteuid(2) and getegid(2) read no memory of this process and cannot fail.
        let (uid, gid) = unsafe { (libc::geteuid(), libc::getegid()) };
        if uid == 0 {
            (1000, 1000)
        } else {
            (uid, gid)
        }
    }

    fn seed_tar(dir: &Path, entries: &[Entry<'_>]) -> PathBuf {
        let (uid, gid) = owner();
        let path = dir.join("seed.tar");
        let mut builder = tar::Builder::new(File::create(&path).unwrap());
        for e in entries {
            let mut header = tar::Header::new_gnu();
            let name = &mut header.as_old_mut().name;
            name[..e.name.len()].copy_from_slice(e.name.as_bytes());
            header.set_entry_type(e.kind);
            header.set_mode(e.mode);
            header.set_uid(u64::from(uid));
            header.set_gid(u64::from(gid));
            header.set_mtime(1_000_000_000);
            header.set_size(e.body.len() as u64);
            if let Some(link) = e.link {
                header.set_link_name(link).unwrap();
            }
            header.set_cksum();
            builder.append(&header, e.body).unwrap();
        }
        builder.finish().unwrap();
        path
    }

    // TEST_SCENARIO: an agent moved from the container backend brings its old home as a seed in the share. The first boot restores exactly that home and not the image's: the home's own mode, a private file with its mode, owner and time, an empty directory, a symlink out of the home as the link it is, and a file's second name as the same file. A fifo is not state an agent carries and is skipped, as seeding from the image skips it. Ownership other than this process's own is asserted only when the test runs as root, since only root may give a file away.
    #[test]
    fn a_seed_in_the_share_restores_the_old_home_instead_of_the_image() {
        let share = TempDir::new("share");
        let archive = seed_tar(
            share.path(),
            &[
                entry("./", tar::EntryType::Directory, 0o750),
                Entry {
                    body: b"export A=1\n",
                    ..entry("./.bashrc", tar::EntryType::Regular, 0o600)
                },
                entry("./empty/", tar::EntryType::Directory, 0o700),
                Entry {
                    link: Some("/etc/passwd"),
                    ..entry("./out", tar::EntryType::Symlink, 0o777)
                },
                Entry {
                    link: Some("./.bashrc"),
                    ..entry("./again", tar::EntryType::Link, 0o600)
                },
                entry("./pipe", tar::EntryType::Fifo, 0o644),
            ],
        );
        let image = TempDir::new("image");
        fs::write(image.path().join("from-the-image"), b"baked").unwrap();
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");

        prepare_home(image.path(), &archive, &store, false, None).unwrap();

        let bashrc = store.join(".bashrc");
        assert_eq!(fs::read(&bashrc).unwrap(), b"export A=1\n");
        assert_eq!(mode(&bashrc) & 0o7777, 0o600);
        assert_eq!(fs::metadata(&bashrc).unwrap().mtime(), 1_000_000_000);
        assert_eq!(
            mode(&store) & 0o7777,
            0o750,
            "the home's own mode was not restored"
        );
        assert_eq!(mode(&store.join("empty")) & 0o7777, 0o700);
        assert_eq!(
            fs::read_link(store.join("out")).unwrap(),
            Path::new("/etc/passwd")
        );
        assert_eq!(
            fs::metadata(store.join("again")).unwrap().ino(),
            fs::metadata(&bashrc).unwrap().ino(),
            "a hard link became a copy"
        );
        assert!(!store.join("pipe").exists());
        assert!(
            !store.join("from-the-image").exists(),
            "the image's home was seeded too"
        );
        let (uid, gid) = owner();
        let info = fs::metadata(&bashrc).unwrap();
        assert_eq!((info.uid(), info.gid()), (uid, gid));
    }

    // TEST_SCENARIO: the seed is made from a volume the agent could write to, so it is not trusted to stay inside the home. A name that is absolute, one that climbs out with `..`, a hard link to a file outside, and a file written through a symlink the seed planted a moment earlier could each write anywhere in the guest's root. Each fails the whole seed: nothing lands outside, and no store is left for a later boot to mount as though it were complete.
    #[test]
    fn a_seed_that_would_write_outside_the_home_is_refused() {
        let outside = TempDir::new("outside");
        let escape = outside.path().to_string_lossy().into_owned();
        let absolute = format!("{escape}/absolute");
        let cases: Vec<Vec<Entry<'_>>> = vec![
            vec![Entry {
                body: b"x",
                ..entry(&absolute, tar::EntryType::Regular, 0o644)
            }],
            vec![Entry {
                body: b"x",
                ..entry("./a/../../climbed", tar::EntryType::Regular, 0o644)
            }],
            vec![Entry {
                link: Some("../../etc/passwd"),
                ..entry("./linked", tar::EntryType::Link, 0o644)
            }],
            vec![
                Entry {
                    link: Some(&escape),
                    ..entry("./planted", tar::EntryType::Symlink, 0o777)
                },
                Entry {
                    body: b"x",
                    ..entry("./planted/through", tar::EntryType::Regular, 0o644)
                },
            ],
        ];
        for (i, case) in cases.iter().enumerate() {
            let share = TempDir::new("hostile");
            let archive = seed_tar(share.path(), case);
            let disk = TempDir::new("disk");
            let store = disk.path().join("agent");

            let refused = prepare_home(Path::new("/nonexistent"), &archive, &store, false, None);

            assert!(refused.is_err(), "case {i} was seeded");
            assert!(!store.exists(), "case {i} left a store behind");
            assert!(
                !with_suffix(&store, ".seeding").exists(),
                "case {i} left its staging"
            );
        }
        assert_eq!(
            fs::read_dir(outside.path()).unwrap().count(),
            0,
            "a seed wrote outside the home"
        );
    }

    // TEST_SCENARIO: a sparse file comes in the seed as its data and a map of its holes, and the tar reader hands the holes over as zeros. The restore seeks past them rather than writing them, so a 4 MiB file with one block of data is 4 MiB long, reads back exactly, and takes a few blocks of the disk rather than 4 MiB, and a hole at its end is kept by its length. The digest the runner expects is of the whole tar as uploaded, so it matches only if the unpack hashes the sparse entry's map and data as they are read.
    #[test]
    fn a_sparse_file_in_the_seed_is_restored_with_its_holes() {
        let size: u64 = 4 << 20;
        let at: u64 = 2 << 20;
        let data = vec![7u8; 4096];
        let share = TempDir::new("sparse-share");
        let archive = share.path().join("seed.tar");
        let mut builder = tar::Builder::new(File::create(&archive).unwrap());
        let mut header = tar::Header::new_gnu();
        header.set_path("sparse").unwrap();
        header.set_entry_type(tar::EntryType::GNUSparse);
        header.set_mode(0o644);
        header.set_mtime(1_000_000_000);
        let owner = fs::metadata(share.path()).unwrap();
        header.set_uid(owner.uid().into());
        header.set_gid(owner.gid().into());
        header.set_size(data.len() as u64);
        let gnu = header.as_gnu_mut().unwrap();
        gnu.set_real_size(size);
        gnu.sparse[0].set_offset(at);
        gnu.sparse[0].set_length(data.len() as u64);
        gnu.sparse[1].set_offset(size);
        gnu.sparse[1].set_length(0);
        header.set_cksum();
        builder.append(&header, data.as_slice()).unwrap();
        builder.finish().unwrap();
        drop(builder);
        let disk = TempDir::new("sparse-disk");
        let store = disk.path().join("agent");

        let expected = digest_of(&archive);
        prepare_home(
            Path::new("/nonexistent"),
            &archive,
            &store,
            false,
            Some(&expected),
        )
        .unwrap();

        let restored = store.join("sparse");
        let info = fs::metadata(&restored).unwrap();
        assert_eq!(info.len(), size);
        assert!(
            info.blocks() * 512 < 1 << 20,
            "the holes were written out: {} blocks",
            info.blocks()
        );
        let body = fs::read(&restored).unwrap();
        assert_eq!(
            &body[at as usize..at as usize + data.len()],
            data.as_slice()
        );
        assert_eq!(body.iter().filter(|b| **b != 0).count(), data.len());
    }

    // TEST_SCENARIO: a boot cut short while it restored a seed leaves only the staging directory. The next boot does not take it for a store, and restores the seed again from the start.
    #[test]
    fn an_interrupted_seed_from_the_share_is_restored_again() {
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");
        let staged = with_suffix(&store, ".seeding");
        fs::create_dir_all(&staged).unwrap();
        fs::write(staged.join("half"), b"partial").unwrap();
        let share = TempDir::new("share");
        let archive = seed_tar(
            share.path(),
            &[Entry {
                body: b"complete",
                ..entry("whole", tar::EntryType::Regular, 0o644)
            }],
        );

        prepare_home(Path::new("/nonexistent"), &archive, &store, false, None).unwrap();

        assert_eq!(fs::read(store.join("whole")).unwrap(), b"complete");
        assert!(!store.join("half").exists());
    }

    // TEST_SCENARIO: the seed is still in the share after the boot that restored it, until the controller removes it. A later boot must mount the store the agent has been writing to, not restore the old home over it.
    #[test]
    fn an_existing_store_is_left_alone_even_with_a_seed_in_the_share() {
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");
        fs::create_dir_all(&store).unwrap();
        fs::write(store.join("file"), b"the agent's work").unwrap();
        let share = TempDir::new("share");
        let archive = seed_tar(
            share.path(),
            &[Entry {
                body: b"the old home",
                ..entry("file", tar::EntryType::Regular, 0o644)
            }],
        );

        prepare_home(Path::new("/nonexistent"), &archive, &store, false, None).unwrap();

        assert_eq!(fs::read(store.join("file")).unwrap(), b"the agent's work");
    }

    // TEST_SCENARIO: with no seed in the share the first boot seeds from the image's home, as every machine not moved from a container does.
    #[test]
    fn without_a_seed_the_image_home_is_seeded() {
        let image = TempDir::new("image");
        fs::write(image.path().join("file"), b"baked").unwrap();
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");

        prepare_home(
            image.path(),
            &disk.path().join("no-seed.tar"),
            &store,
            false,
            None,
        )
        .unwrap();

        assert_eq!(fs::read(store.join("file")).unwrap(), b"baked");
    }

    fn digest_of(path: &Path) -> SeedDigest {
        let body = fs::read(path).unwrap();
        SeedDigest {
            sha256: hex::encode(Sha256::digest(&body)),
            bytes: body.len() as u64,
        }
    }

    fn one_file_seed(dir: &Path, body: &'static [u8]) -> PathBuf {
        seed_tar(
            dir,
            &[Entry {
                body,
                ..entry("file", tar::EntryType::Regular, 0o644)
            }],
        )
    }

    // TEST_SCENARIO: a migration's seed can go missing before the first boot — a runner claim lost or recreated, a node that crashed before the upload was durable, an operator. When the runner says a seed is expected, a first boot that finds none must not seed the image's home instead: that boot would answer, and the migration would be taken for done with the agent's work left behind. It fails, and leaves no store for a later boot to mount.
    #[test]
    fn an_expected_seed_that_is_missing_fails_the_boot_instead_of_seeding_the_image() {
        let image = TempDir::new("image");
        fs::write(image.path().join("file"), b"baked").unwrap();
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");
        let expected = SeedDigest {
            sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
            bytes: 4,
        };

        let refused = prepare_home(
            image.path(),
            &disk.path().join("no-seed.tar"),
            &store,
            false,
            Some(&expected),
        )
        .unwrap_err()
        .to_string();

        assert!(refused.contains(&expected.sha256), "{refused}");
        assert!(!store.exists(), "the image's home was seeded");
    }

    // TEST_SCENARIO: the seed the runner expects is restored, hashed as it is read, and the disk records which seed it was. A later boot that still expects that seed — the controller has not yet seen the guest answer — mounts the store as it is. One that expects another seed refuses the home, because it is not the one this migration brought.
    #[test]
    fn the_expected_seed_is_restored_and_recorded_on_the_disk() {
        let share = TempDir::new("share");
        let archive = one_file_seed(share.path(), b"the old home");
        let expected = digest_of(&archive);
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");

        prepare_home(
            Path::new("/nonexistent"),
            &archive,
            &store,
            false,
            Some(&expected),
        )
        .unwrap();

        assert_eq!(fs::read(store.join("file")).unwrap(), b"the old home");
        let record = disk.path().join("system").join(guest::SEEDED_FROM_FILE);
        assert_eq!(fs::read_to_string(&record).unwrap(), expected.sha256);

        fs::write(store.join("file"), b"work since").unwrap();
        prepare_home(
            Path::new("/nonexistent"),
            &archive,
            &store,
            false,
            Some(&expected),
        )
        .unwrap();
        assert_eq!(fs::read(store.join("file")).unwrap(), b"work since");

        let other = SeedDigest {
            sha256: "0".repeat(64),
            ..expected
        };
        assert!(prepare_home(
            Path::new("/nonexistent"),
            &archive,
            &store,
            false,
            Some(&other)
        )
        .is_err());
    }

    // TEST_SCENARIO: a seed that is there but not the one expected — changed after the upload, or cut short — is refused whole. The digest is only known once the whole tar is read, so the refusal comes after the unpack, and must still leave neither a store nor a record behind.
    #[test]
    fn a_seed_that_is_not_the_one_expected_is_refused() {
        let share = TempDir::new("share");
        let archive = one_file_seed(share.path(), b"the old home");
        let honest = digest_of(&archive);
        for expected in [
            SeedDigest {
                sha256: "0".repeat(64),
                ..honest.clone()
            },
            SeedDigest {
                bytes: honest.bytes + 1,
                ..honest.clone()
            },
        ] {
            let disk = TempDir::new("disk");
            let store = disk.path().join("agent");
            assert!(prepare_home(
                Path::new("/nonexistent"),
                &archive,
                &store,
                false,
                Some(&expected)
            )
            .is_err());
            assert!(!store.exists());
            assert!(!disk.path().join("system").exists());
        }
    }

    // TEST_SCENARIO: a disk whose home came from the image — booted before its seed arrived — must not pass for a migrated one when a seed is expected: it has no record of a seed, so the boot is refused.
    #[test]
    fn a_home_from_the_image_is_refused_when_a_seed_is_expected() {
        let disk = TempDir::new("disk");
        let store = disk.path().join("agent");
        fs::create_dir_all(&store).unwrap();
        let expected = SeedDigest {
            sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
            bytes: 4,
        };
        let refused = prepare_home(
            Path::new("/nonexistent"),
            &disk.path().join("seed.tar"),
            &store,
            true,
            Some(&expected),
        )
        .unwrap_err()
        .to_string();
        assert!(refused.contains("no seed"), "{refused}");
    }

    // TEST_SCENARIO: the share names no expected seed for a machine that was never migrated, and that reads as none; a record the runner wrote that does not parse is an error, so the boot does not guess.
    #[test]
    fn the_expected_seed_record_is_read_strictly() {
        let share = TempDir::new("share");
        let path = share.path().join("seed-expected");
        assert_eq!(expected_seed(&path).unwrap(), None);
        let seed = SeedDigest {
            sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
            bytes: 4,
        };
        fs::write(&path, seed.line()).unwrap();
        assert_eq!(expected_seed(&path).unwrap(), Some(seed));
        fs::write(&path, "garbage").unwrap();
        assert!(expected_seed(&path).is_err());
    }

    // TEST_SCENARIO: a failure shows at the end of a log, so the cap on the previous boot trims its start. Trimming the whole file, or keeping the head, would throw away the only record of why a machine died.
    #[test]
    fn the_boot_log_cap_keeps_the_end() {
        let dir = TempDir::new("log");
        let path = dir.path().join(BOOT_LOG_NAME);
        fs::write(
            &path,
            format!("older than the cap{}the failure", "x".repeat(100)),
        )
        .unwrap();

        keep_tail(&path, 11);

        assert_eq!(fs::read_to_string(&path).unwrap(), "the failure");
        assert!(
            !with_suffix(&path, ".trim").exists(),
            "the trimmed copy replaces the log"
        );
    }

    #[test]
    fn a_short_boot_log_is_left_alone() {
        let dir = TempDir::new("log");
        let path = dir.path().join(BOOT_LOG_NAME);
        fs::write(&path, b"short").unwrap();

        keep_tail(&path, 1 << 20);

        assert_eq!(fs::read_to_string(&path).unwrap(), "short");
    }

    // TEST_SCENARIO: an image's launch record may name a bare command, which a container runtime resolves against PATH. Refusing one would fail a machine on an entrypoint that works everywhere else.
    #[test]
    fn the_image_entrypoint_is_resolved_like_a_shell_would() {
        let dir = TempDir::new("path");
        fs::write(dir.path().join("harness"), b"#!/bin/sh\n").unwrap();
        fs::set_permissions(
            dir.path().join("harness"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        fs::write(dir.path().join("notes"), b"data").unwrap();
        fs::set_permissions(dir.path().join("notes"), fs::Permissions::from_mode(0o644)).unwrap();
        let search = Some(dir.path().as_os_str().to_owned());

        assert_eq!(
            look_path(OsStr::new("harness"), search.clone()).unwrap(),
            dir.path().join("harness")
        );
        assert!(
            look_path(OsStr::new("notes"), search.clone()).is_err(),
            "a file on PATH that nobody can run is not the entrypoint"
        );
        let absolute = dir.path().join("harness");
        assert_eq!(
            look_path(absolute.as_os_str(), search).unwrap(),
            absolute,
            "an absolute entrypoint is taken as given"
        );
    }

    // TEST_SCENARIO: smolvm starts platform-init in the image's WORKDIR, and pivoting into the platform's root leaves the process at "/", where `node dist/main.js` under WORKDIR /app finds nothing. The directory saved before the pivot is entered again once the platform's root is in place; one the platform's root lacks leaves the process where the pivot left it rather than failing the boot.
    #[test]
    fn the_image_working_directory_survives_the_pivot() {
        let before = std::env::current_dir().unwrap();
        let dir = TempDir::new("workdir");
        let app = dir.path().join("app");
        fs::create_dir(&app).unwrap();

        enter_workdir(&app);
        assert_eq!(
            std::env::current_dir().unwrap(),
            app.canonicalize().unwrap()
        );

        enter_workdir(&dir.path().join("missing"));
        assert_eq!(
            std::env::current_dir().unwrap(),
            app.canonicalize().unwrap(),
            "a directory the platform's root lacks is a warning, not a move"
        );
        std::env::set_current_dir(before).unwrap();
    }

    // TEST_SCENARIO: a root is kept only when the runner names this boot's image and the disk records the same one for the root. A runner from before the record, a disk from the layout that emptied its root every boot, and an image that changed each start from an empty upper layer, so an old image's writes never lie over a new one.
    #[test]
    fn a_root_is_kept_only_for_the_image_that_wrote_it() {
        let image = "local-dir:/images/sha256-a/rootfs 1234 1700000000.5";
        assert_eq!(fresh_reason(Some(image), Some(image)), None);
        assert!(fresh_reason(Some(image), Some("quay.io/x/vm:1"))
            .unwrap()
            .contains("image changed"));
        assert!(fresh_reason(Some(image), None)
            .unwrap()
            .contains("records no image"));
        assert!(fresh_reason(None, Some(image))
            .unwrap()
            .contains("names no image"));
        assert!(fresh_reason(None, None).is_some());
    }

    // TEST_SCENARIO: an image names its root generation as a key, and the root is kept only when the key line is exactly the one the root was written under. An image that extends the default one appends its own segment, so its key starts with the default's and still boots on an empty root; so do a bumped key and the integer generation of the images before keys.
    #[test]
    fn a_root_is_kept_only_under_an_equal_generation_key() {
        let default = "root-generation default-1";
        assert_eq!(fresh_reason(Some(default), Some(default)), None);
        for other in [
            "root-generation default-1/gepa-1",
            "root-generation default-2",
            "root-compat 1",
        ] {
            assert!(
                fresh_reason(Some(other), Some(default)).is_some(),
                "{other}"
            );
            assert!(
                fresh_reason(Some(default), Some(other)).is_some(),
                "{other}"
            );
        }
    }

    // TEST_SCENARIO: the records are read as one trimmed line. A missing or empty record names no image, so a share from an older runner reads as unknown rather than as an image called "".
    #[test]
    fn an_image_record_is_one_line_or_none() {
        let dir = TempDir::new("record");
        let path = dir.path().join("image");
        assert_eq!(image_record(&path), None);
        fs::write(&path, "\n").unwrap();
        assert_eq!(image_record(&path), None);
        fs::write(&path, "quay.io/x/vm:1\n").unwrap();
        assert_eq!(image_record(&path).as_deref(), Some("quay.io/x/vm:1"));
    }

    // TEST_SCENARIO: the last boot's /tmp is moved aside so the boot starts on an empty one, and the background delete reclaims it and a home cache an earlier boot moved aside by name, without following a link and without touching anything else. An empty folder, or none, is left as it is.
    #[test]
    fn a_discarded_folder_is_moved_aside_and_deleted() {
        let store = TempDir::new("scratch");
        let target = TempDir::new("target");
        fs::write(target.path().join("kept"), b"x").unwrap();
        fs::create_dir(store.path().join("tmp")).unwrap();
        std::os::unix::fs::symlink(target.path(), store.path().join("tmp/link")).unwrap();
        fs::write(store.path().join("tmp.notes"), b"x").unwrap();
        fs::write(store.path().join(".cache.discarded.3"), b"x").unwrap();

        let tmp = discard(&store.path().join("tmp"), 7).unwrap().unwrap();
        assert_eq!(tmp, store.path().join("tmp.discarded.7"));
        assert!(fs::symlink_metadata(store.path().join("tmp")).is_err());
        fs::create_dir(store.path().join("tmp")).unwrap();
        assert_eq!(discard(&store.path().join("tmp"), 8).unwrap(), None);
        assert_eq!(discard(&store.path().join("absent"), 8).unwrap(), None);

        purge_discarded(store.path(), &["tmp".to_string()]);
        assert!(!tmp.exists());
        assert!(
            store.path().join(".cache.discarded.3").exists(),
            "another name is not purged"
        );
        purge_discarded(store.path(), &HOME_CACHES);
        assert!(!store.path().join(".cache.discarded.3").exists());
        assert!(
            target.path().join("kept").is_file(),
            "the link was not followed"
        );
        assert!(store.path().join("tmp.notes").is_file());
        assert!(store.path().join("tmp").is_dir());
    }

    // TEST_SCENARIO: an image ships its font, package and linker caches in /var/cache, and emptying it every boot had each boot rebuild them. /var/cache is no scratch folder, so it stays the image's and the kept root's.
    #[test]
    fn the_images_var_cache_is_not_emptied() {
        assert!(SCRATCH_DIRS.iter().all(|(dir, _)| *dir != "/var/cache"));
    }

    // TEST_SCENARIO: a new image boots on an empty upper, and the old one can hold millions of files, which deleted in place hold up the boot for minutes. Clearing renames the kept upper aside with its image record, so nothing under the old names is left to mount, and a later delete takes it away. A root kept for the same image is left as it is, while the work layer is emptied on every boot.
    #[test]
    fn a_new_image_moves_the_old_root_aside_without_deleting_it() {
        let disk = TempDir::new("fresh-root");
        let layers = FreshRoot::on(disk.path());
        fs::create_dir_all(layers.upper.join("usr/local")).unwrap();
        fs::write(layers.upper.join("usr/local/tool"), b"x").unwrap();
        fs::write(&layers.image, b"image-a\n").unwrap();
        fs::create_dir_all(layers.work.join("work")).unwrap();

        layers.clear(false, 1).unwrap();
        assert!(
            layers.upper.join("usr/local/tool").is_file(),
            "a kept root was cleared"
        );
        assert!(!layers.work.exists());

        layers.clear(true, 2).unwrap();
        assert!(!layers.kept.exists());
        let aside = with_suffix(&layers.kept, ".discarded.2");
        assert!(
            aside.join("upper/usr/local/tool").is_file(),
            "the old root was deleted on the boot path"
        );
        assert!(image_record(&aside.join("image")).is_some());

        purge_discarded(&layers.store, &DISCARDED_LAYERS);
        assert!(!aside.exists());
    }

    // TEST_SCENARIO: under pressure a scratch folder is evicted by whole entries. A leftover of a failed eviction goes first, then a cache its tool tagged as rebuildable, then the rest, so an agent's own file in /tmp is the last to go. A forged tag does not count, and an entry holding a socket a process may still listen on, an entry used within the last pass, and an entry on another device are not offered at all, and a pass for the claim offers only what was unused for an hour. A change time cannot be set back, so a clock moved forward stands for entries long unused.
    #[test]
    fn scratch_is_offered_whole_and_rebuildable_caches_first() {
        let scratch = TempDir::new("evict");
        let target = TempDir::new("evict-target");
        fs::write(target.path().join("kept"), b"x").unwrap();
        let s = scratch.path();
        fs::write(s.join("pr-body.md"), b"x").unwrap();
        fs::create_dir_all(s.join("go-build/00")).unwrap();
        fs::write(s.join("go-build/00/blob"), vec![1u8; 8192]).unwrap();
        fs::write(
            s.join("go-build").join(CACHEDIR_TAG),
            [CACHEDIR_TAG_SIGNATURE, b"\n"].concat(),
        )
        .unwrap();
        fs::create_dir(s.join("forged")).unwrap();
        fs::write(s.join("forged").join(CACHEDIR_TAG), b"Signature: nope").unwrap();
        fs::create_dir(s.join("x.evicted.5")).unwrap();
        std::os::unix::fs::symlink(target.path(), s.join("link")).unwrap();
        fs::create_dir(s.join("live")).unwrap();
        let socket = std::os::unix::net::UnixListener::bind(s.join("live/sock")).unwrap();
        let disk = fs::metadata(s).unwrap().dev();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let dirs = open_scratch_roots(&[(s.to_path_buf(), mount_of(s))]);
        let names = |now, dev| -> Vec<String> {
            let mut roots = open_scratch_roots(&[(s.to_path_buf(), mount_of(s))]);
            roots.iter_mut().for_each(|root| root.dev = Some(dev));
            scratch_entries(&roots, &HashSet::new(), now, EVICT_AGES[3])
                .iter()
                .map(|entry| {
                    entry
                        .path
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect()
        };

        assert_eq!(
            names(now, disk),
            ["x.evicted.5"],
            "what was just used stays"
        );
        let order = names(now + 2 * EVICT_AGES[3], disk);
        assert_eq!(order[..2], ["x.evicted.5", "go-build"]);
        let mut rest = order[2..].to_vec();
        rest.sort();
        assert_eq!(rest, ["forged", "link", "pr-body.md"]);
        assert_eq!(
            scratch_entries(
                &dirs,
                &HashSet::new(),
                now + 2 * EVICT_AGES[3],
                CLAIM_EVICT_AGE
            )
            .len(),
            1,
            "a claim pass keeps what was used within the hour"
        );
        assert!(scratch_entries(
            &dirs,
            &HashSet::new(),
            now + 2 * EVICT_AGES[3],
            EVICT_AGES[3]
        )
        .iter()
        .any(|entry| entry.path.ends_with("go-build") && entry.bytes >= 8192));
        assert!(
            names(now + 2 * EVICT_AGES[3], disk + 1).is_empty(),
            "another device is not walked"
        );
        drop(socket);
    }

    // TEST_SCENARIO: a scratch folder that is itself a symlink to the agent's work, such as a ~/.cache pointed at a work directory, is not scratch: a pass offers nothing from it, and the work's long-unused file stays. A folder swapped for such a link after the pass opened it is still evicted from where it was opened, and the link's target keeps its file of the same name.
    #[test]
    fn a_scratch_folder_that_is_a_symlink_is_not_followed() {
        let home = TempDir::new("evict-linked-home");
        let h = home.path();
        fs::create_dir_all(h.join("work")).unwrap();
        fs::write(h.join("work/main.rs"), b"fn main() {}").unwrap();
        std::os::unix::fs::symlink("work", h.join(".cache")).unwrap();
        fs::create_dir_all(h.join(".npm/_cacache")).unwrap();
        fs::write(h.join(".npm/main.rs"), b"cache").unwrap();
        let later = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 2 * EVICT_AGES[0];

        let roots = open_scratch_roots(&[
            (h.join(".cache"), mount_of(h)),
            (h.join(".npm"), mount_of(h)),
        ]);
        let offered = scratch_entries(&roots, &HashSet::new(), later, EVICT_AGES[3]);
        let mut shown: Vec<_> = offered.iter().map(|entry| entry.shown.clone()).collect();
        shown.sort();
        assert_eq!(shown, [h.join(".npm/_cacache"), h.join(".npm/main.rs")]);

        fs::rename(h.join(".npm"), h.join("npm-moved")).unwrap();
        std::os::unix::fs::symlink("work", h.join(".npm")).unwrap();
        for entry in &offered {
            assert!(evict(&entry.path, 9).unwrap());
        }
        assert_eq!(fs::read(h.join("work/main.rs")).unwrap(), b"fn main() {}");
        assert_eq!(fs::read_dir(h.join("npm-moved")).unwrap().count(), 0);
    }

    fn mount_of(path: &Path) -> u64 {
        statx(libc::AT_FDCWD, path).unwrap().stx_mnt_id
    }

    // UNIT_BOUNDARY_DESCRIPTION: runs the test `name` again in a child of the test binary with a mount namespace of its own, and a user namespace unless it runs as root, so it may bind mount without root and without touching the host's mounts, and returns false when this process is that child. A host that allows no such namespace skips the test, with a line saying so.
    fn in_mount_namespace(name: &str) -> bool {
        const INSIDE: &str = "PLATFORM_INIT_TEST_IN_MOUNT_NAMESPACE";
        if std::env::var_os(INSIDE).is_some() {
            return false;
        }
        let unshare = || {
            let mut command = std::process::Command::new("unshare");
            // SAFETY: geteuid(2) reads no memory of this process and cannot fail.
            if unsafe { libc::geteuid() } != 0 {
                command.args(["--user", "--map-root-user"]);
            }
            command.arg("--mount");
            command
        };
        let probe = unshare().args(["mount", "--bind", "/tmp", "/tmp"]).output();
        if !probe.is_ok_and(|probe| probe.status.success()) {
            eprintln!(
                "skipping {name}: this host allows no user and mount namespace to bind mount in"
            );
            return true;
        }
        let status = unshare()
            .arg(std::env::current_exe().unwrap())
            .args(["--exact", name, "--test-threads=1", "--nocapture"])
            .env(INSIDE, "1")
            .status()
            .unwrap();
        assert!(status.success(), "{name} failed in its mount namespace");
        true
    }

    // TEST_SCENARIO: a work directory bound into a home cache on the same disk has the cache's device, so only its mount tells it apart from scratch. The entry holding it is kept whole and its own old files stay with it, a single file bound in place is kept, a cache folder the work is bound onto is skipped, and only the plain cache entry beside them goes. A delete that meets a mount anyway, such as one made after a pass looked, stops there with an error and the work it shows stays. Binding needs a mount namespace, so the test runs in one of its own (in_mount_namespace).
    #[test]
    fn eviction_never_deletes_through_a_mount() {
        if in_mount_namespace("boot::tests::eviction_never_deletes_through_a_mount") {
            return;
        }
        let home = TempDir::new("evict-mounts");
        let h = home.path();
        for dir in ["work", "notes", ".cache/tool/inner", ".cache/plain", ".npm"] {
            fs::create_dir_all(h.join(dir)).unwrap();
        }
        fs::write(h.join("work/main.rs"), b"fn main() {}").unwrap();
        fs::write(h.join("notes/todo.md"), b"ship it").unwrap();
        fs::write(h.join(".cache/tool/old"), b"x").unwrap();
        fs::write(h.join(".cache/plain/old"), b"x").unwrap();
        fs::write(h.join(".cache/single"), b"").unwrap();
        let boot = [
            (h.join(".cache"), mount_of(h)),
            (h.join(".npm"), mount_of(h)),
        ];
        mount(&h.join("work"), &h.join(".cache/tool/inner"), libc::MS_BIND).unwrap();
        mount(
            &h.join("notes/todo.md"),
            &h.join(".cache/single"),
            libc::MS_BIND,
        )
        .unwrap();
        mount(&h.join("notes"), &h.join(".npm"), libc::MS_BIND).unwrap();
        let later = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 2 * EVICT_AGES[0];

        let roots = open_scratch_roots(&boot);
        let offered = scratch_entries(&roots, &HashSet::new(), later, EVICT_AGES[3]);
        let shown: Vec<_> = offered.iter().map(|entry| entry.shown.clone()).collect();
        assert_eq!(shown, [h.join(".cache/plain")]);
        for entry in &offered {
            assert!(evict(&entry.path, 9).unwrap());
        }
        assert!(remove_all(&h.join(".cache/tool")).is_err());
        assert!(remove_all(&h.join(".npm")).is_err());

        assert_eq!(fs::read(h.join("work/main.rs")).unwrap(), b"fn main() {}");
        assert_eq!(fs::read(h.join("notes/todo.md")).unwrap(), b"ship it");
        assert!(!h.join(".cache/plain").exists());
        for point in [".cache/tool/inner", ".cache/single", ".npm"] {
            // SAFETY: the path is NUL-terminated and outlives the call.
            assert_eq!(
                unsafe { libc::umount2(cstring(h.join(point).as_os_str()).unwrap().as_ptr(), 0) },
                0
            );
        }
    }

    // TEST_SCENARIO: a tool that locks a file deep in its cache still needs it, so the whole entry holding it stays while the lock is held — a BSD lock or a POSIX one — however long the entry has gone unused, and an unlocked entry beside it goes. Once the lock is released, the entry is offered again. The lock table is the kernel's own, which this test process's locks are in.
    #[test]
    fn an_entry_holding_a_locked_file_is_kept_whole() {
        let home = TempDir::new("evict-locked");
        let h = home.path();
        for dir in [".cache/tool/sub", ".cache/posix", ".cache/plain"] {
            fs::create_dir_all(h.join(dir)).unwrap();
        }
        for file in [
            ".cache/tool/sub/db",
            ".cache/tool/other",
            ".cache/posix/db",
            ".cache/plain/old",
        ] {
            fs::write(h.join(file), b"x").unwrap();
        }
        let roots = open_scratch_roots(&[(h.join(".cache"), mount_of(h))]);
        let later = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 2 * EVICT_AGES[0];
        let offered = || {
            let locked = locked_files(&fs::read_to_string("/proc/locks").unwrap());
            let mut shown: Vec<_> = scratch_entries(&roots, &locked, later, EVICT_AGES[3])
                .into_iter()
                .map(|entry| entry.shown)
                .collect();
            shown.sort();
            shown
        };

        let bsd = File::open(h.join(".cache/tool/sub/db")).unwrap();
        // SAFETY: the descriptor is open for the call and flock takes no pointer.
        assert_eq!(unsafe { libc::flock(bsd.as_raw_fd(), libc::LOCK_EX) }, 0);
        let posix = OpenOptions::new()
            .write(true)
            .open(h.join(".cache/posix/db"))
            .unwrap();
        // SAFETY: a zeroed flock is a valid value, and every field the call reads is set below.
        let mut range: libc::flock = unsafe { std::mem::zeroed() };
        range.l_type = libc::F_WRLCK as _;
        range.l_whence = libc::SEEK_SET as _;
        // SAFETY: range is a flock that outlives the call.
        assert_eq!(
            unsafe { libc::fcntl(posix.as_raw_fd(), libc::F_SETLK, &range) },
            0
        );
        assert_eq!(offered(), [h.join(".cache/plain")]);

        drop(bsd);
        drop(posix);
        // UNIT_BOUNDARY_DESCRIPTION: a BSD lock belongs to the open file, and a parallel test's child shares that file between its fork and its exec, so the lock can outlive the drop for a moment.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut shown = offered();
        while shown.len() < 3 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
            shown = offered();
        }
        assert_eq!(
            shown,
            [
                h.join(".cache/plain"),
                h.join(".cache/posix"),
                h.join(".cache/tool")
            ]
        );
    }

    // TEST_SCENARIO: the kernel's lock table names each locked file by device and inode, the device's numbers in hex, also on the lines of a process waiting for a lock.
    #[test]
    fn the_lock_table_is_read_for_device_and_inode() {
        let table = "1: FLOCK  ADVISORY  WRITE 812 fd:01:1234 0 EOF\n1: -> FLOCK  ADVISORY  WRITE 813 fd:01:1234 0 EOF\n2: OFDLCK ADVISORY  READ  -1 00:1a:77 0 0\n";
        let mut locked: Vec<_> = locked_files(table).into_iter().collect();
        locked.sort();
        assert_eq!(locked, [(0, 0x1a, 77), (0xfd, 1, 1234)]);
    }

    // TEST_SCENARIO: an evicted entry goes whole, and a link goes without its target. An entry a process holds a BSD lock on stays, the way systemd-tmpfiles leaves it, and goes once the lock is released. A leftover of a failed eviction is deleted where it is.
    #[test]
    fn an_entry_is_evicted_whole_unless_it_is_locked() {
        let scratch = TempDir::new("evict-one");
        let target = TempDir::new("evict-one-target");
        fs::write(target.path().join("kept"), b"x").unwrap();
        let s = scratch.path();
        fs::create_dir_all(s.join("mise/installs/acp")).unwrap();
        fs::write(s.join("mise/installs/acp/package.json"), b"{}").unwrap();
        std::os::unix::fs::symlink(target.path(), s.join("link")).unwrap();
        fs::create_dir(s.join("held")).unwrap();
        fs::create_dir(s.join("x.evicted.5")).unwrap();

        assert!(evict(&s.join("mise"), 9).unwrap());
        assert!(evict(&s.join("link"), 9).unwrap());
        assert!(evict(&s.join("x.evicted.5"), 9).unwrap());
        let lock = File::open(s.join("held")).unwrap();
        // SAFETY: the descriptor is open for the call and flock takes no pointer.
        assert_eq!(unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) }, 0);
        assert!(!evict(&s.join("held"), 9).unwrap());
        assert!(s.join("held").is_dir());
        drop(lock);
        assert!(evict(&s.join("held"), 9).unwrap());

        assert_eq!(
            fs::read_dir(s).unwrap().count(),
            0,
            "nothing is left, renamed aside or not"
        );
        assert!(target.path().join("kept").is_file());
    }

    // TEST_SCENARIO: the platform root's layers are on the disk, in the platform's own namespace, so the image's home cannot collide with them. Its lower layer is the image tree the VMM shares, and nothing else. The kept upper layer sits beside the record of the image that wrote it.
    #[test]
    fn the_platforms_root_stacks_a_disk_upper_over_the_image() {
        let layers = FreshRoot::on(Path::new(guest::DISK_PATH));
        assert_eq!(
            layers.merged,
            Path::new("/mnt/platform/system/rootfs/merged")
        );
        assert_eq!(layers.image, layers.upper.with_file_name("image"));
        assert_eq!(
            layers.options(&[Path::new("/run/platform-boot/image")]).unwrap().to_str().unwrap(),
            "lowerdir=/run/platform-boot/image,upperdir=/mnt/platform/system/rootfs/kept/upper,workdir=/mnt/platform/system/rootfs/work,index=off,redirect_dir=off,metacopy=off,xino=off,uuid=off"
        );
    }

    // TEST_SCENARIO: overlayfs splits its options on commas and its lower layers on colons, so a disk path holding either would name other layers than the ones meant. That is refused, not mounted.
    #[test]
    fn a_layer_path_overlayfs_would_misread_is_refused() {
        let image = Path::new("/run/platform-boot/image");
        assert!(FreshRoot::on(Path::new("/mnt/a,b"))
            .options(&[image])
            .is_err());
        assert!(FreshRoot::on(Path::new("/mnt/a:b"))
            .options(&[image])
            .is_err());
        assert!(FreshRoot::on(Path::new(guest::DISK_PATH))
            .options(&[Path::new("/i:x"), image])
            .is_err());
    }

    // TEST_SCENARIO: the boot's accounts layer sits over the image, so its /etc/passwd is the one the root shows, and the kept upper over both.
    #[test]
    fn the_accounts_layer_sits_between_the_image_and_the_upper() {
        let layers = FreshRoot::on(Path::new(guest::DISK_PATH));
        let options = layers
            .options(&[
                Path::new("/run/platform-boot/accounts"),
                Path::new("/run/platform-boot/image"),
            ])
            .unwrap();
        assert!(options.to_str().unwrap().starts_with(
            "lowerdir=/run/platform-boot/accounts:/run/platform-boot/image,upperdir="
        ));
    }

    // TEST_SCENARIO: SSH logins come as `agent`, which on a machine is uid 0 with the agent's home and root's shell, appended to the image's own entries; an image that names `agent` itself is left as it is.
    #[test]
    fn the_boot_maps_agent_to_root_after_the_images_entries() {
        let image = "root:x:0:0:root:/home/agent:/bin/bash\ndaemon:x:1:1::/:/usr/sbin/nologin";
        assert_eq!(
            accounts_passwd(image).unwrap(),
            format!("{image}\nagent:x:0:0:Agent User:/home/agent:/bin/bash\n")
        );
        assert_eq!(
            accounts_passwd("root:x:0:0:root:/root:\n").unwrap(),
            "root:x:0:0:root:/root:\nagent:x:0:0:Agent User:/home/agent:/bin/sh\n"
        );
        assert_eq!(
            accounts_passwd("root:x:0:0::/root:/bin/sh\nagent:x:1000:1000::/home/agent:/bin/sh\n"),
            None
        );
    }

    // TEST_SCENARIO: the layer's /etc and passwd show the image's owners and modes, since the topmost layer that holds a directory sets what the root shows; an image without /etc/passwd gets no layer.
    #[test]
    fn the_accounts_layer_keeps_the_images_modes() {
        let image = TempDir::new("accounts-image");
        let layer = image.path().join("layer");
        let etc = image.path().join("etc");
        fs::create_dir(&etc).unwrap();
        assert!(!accounts_layer(image.path(), &layer).unwrap());
        assert!(!layer.exists());
        fs::write(etc.join("passwd"), "root:x:0:0:root:/root:/bin/bash\n").unwrap();
        fs::set_permissions(&etc, fs::Permissions::from_mode(0o751)).unwrap();
        fs::set_permissions(etc.join("passwd"), fs::Permissions::from_mode(0o640)).unwrap();
        assert!(accounts_layer(image.path(), &layer).unwrap());
        let mode = |p: &Path| fs::metadata(p).unwrap().mode() & 0o7777;
        assert_eq!(mode(&layer.join("etc")), 0o751);
        assert_eq!(mode(&layer.join("etc/passwd")), 0o640);
        assert!(fs::read_to_string(layer.join("etc/passwd"))
            .unwrap()
            .ends_with("agent:x:0:0:Agent User:/home/agent:/bin/bash\n"));
    }

    // TEST_SCENARIO: an image whose config sets no PATH still names bare commands, because a container runtime searches its own default for them. An empty or missing PATH is searched the same way here.
    #[test]
    fn an_image_that_sets_no_path_is_searched_like_a_container() {
        for search in [None, Some(OsString::new())] {
            let found = look_path(OsStr::new("sh"), search).expect("sh is on the default path");
            assert!(
                DEFAULT_PATH
                    .split(':')
                    .any(|dir| found.parent() == Some(Path::new(dir))),
                "{} is not on the default path",
                found.display()
            );
        }
    }

    // TEST_SCENARIO: smolvm formats a storage disk it cannot mount, which leaves no store, exactly as on a disk that was never seeded. Once the runner has recorded that this disk held a home, a missing store is refused instead of seeded, so the loss fails the boot rather than bringing the agent up on an empty home that looks healthy. A disk the runner has never seen a home on is still seeded, and a store that exists is mounted either way.
    #[test]
    fn a_home_lost_from_a_seeded_disk_is_refused_rather_than_seeded_again() {
        let disk = TempDir::new("disk");
        let store = guest::agent_store(disk.path());

        assert!(must_seed(&store, false).unwrap(), "a first boot seeds");
        let lost = must_seed(&store, true).unwrap_err().to_string();
        assert!(
            lost.contains("missing from a disk that held it before"),
            "the refusal does not say what happened: {lost}"
        );

        fs::create_dir_all(&store).unwrap();
        assert!(!must_seed(&store, true).unwrap());
        assert!(!must_seed(&store, false).unwrap());
    }

    // TEST_SCENARIO: every disk leaves its first boot marked with its layout, and a disk from before the mark existed is marked on its next boot. A disk already marked with its layout boots without being written; one whose mark names an older layout is refused, since its names are not what the mark says.
    #[test]
    fn a_disk_is_marked_with_its_layout_once() {
        let disk = TempDir::new("disk");
        let mark = guest::system_store(disk.path(), guest::LAYOUT_FILE);

        assert_eq!(
            mark_layout(disk.path(), guest::LAYOUT_VERSION).unwrap(),
            Some(guest::LAYOUT_VERSION)
        );
        assert_eq!(
            fs::read_to_string(&mark).unwrap(),
            format!("{}\n", guest::LAYOUT_VERSION)
        );
        assert_eq!(
            mark_layout(disk.path(), guest::LAYOUT_VERSION).unwrap(),
            None
        );
        fs::write(&mark, "1\n").unwrap();
        let marked = mark_layout(disk.path(), guest::LAYOUT_VERSION)
            .unwrap_err()
            .to_string();
        assert!(
            marked.contains("marked as layout 1, but holds layout 2"),
            "{marked}"
        );
    }

    // TEST_SCENARIO: on a disk with no journal an unclean stop can leave the mark with its name and none of its data, as an empty file or one of zeros. The home under it is intact, so the boot takes it for no mark and marks the disk again, instead of refusing every boot until the agent is deleted.
    #[test]
    fn a_mark_a_crash_emptied_is_taken_for_no_mark() {
        let disk = TempDir::new("disk");
        let mark = guest::system_store(disk.path(), guest::LAYOUT_FILE);
        fs::create_dir_all(mark.parent().unwrap()).unwrap();

        for emptied in ["", "\0\0"] {
            fs::write(&mark, emptied).unwrap();
            assert_eq!(
                mark_layout(disk.path(), guest::LAYOUT_VERSION).unwrap(),
                Some(guest::LAYOUT_VERSION),
                "{emptied:?}"
            );
            assert_eq!(
                fs::read_to_string(&mark).unwrap(),
                format!("{}\n", guest::LAYOUT_VERSION)
            );
        }
    }

    // TEST_SCENARIO: a runner rolled back past a layout change boots disks that a newer platform-init already moved on, and this one would seed or mount them by names they no longer use. A newer layout fails the boot and says why; so does a mark this platform-init cannot read, rather than being taken for any layout and overwritten.
    #[test]
    fn a_layout_this_platform_init_does_not_know_fails_the_boot() {
        let disk = TempDir::new("disk");
        let mark = guest::system_store(disk.path(), guest::LAYOUT_FILE);
        fs::create_dir_all(mark.parent().unwrap()).unwrap();

        fs::write(&mark, format!("{}\n", guest::LAYOUT_VERSION + 1)).unwrap();
        let newer = mark_layout(disk.path(), guest::LAYOUT_VERSION)
            .unwrap_err()
            .to_string();
        assert!(newer.contains("a newer platform-init wrote"), "{newer}");

        for unreadable in ["0", "one", "-1"] {
            fs::write(&mark, unreadable).unwrap();
            assert!(
                mark_layout(disk.path(), guest::LAYOUT_VERSION).is_err(),
                "{unreadable:?} was taken for a layout"
            );
            assert_eq!(fs::read_to_string(&mark).unwrap(), unreadable);
        }
    }

    // TEST_SCENARIO: the boot log of the running boot is bounded. A write that would take it past the cap moves it aside first, so the boot keeps at most two files of the cap each, the newest output is always in the log itself, and the output just before it is in the rotated file.
    #[test]
    fn the_running_boot_log_rotates_at_its_cap() {
        let dir = TempDir::new("capped");
        let path = dir.path().join(BOOT_LOG_NAME);
        let rotated = with_suffix(&path, ROTATED_SUFFIX);
        let mut log = CappedLog::open(&path, 10).unwrap();

        log.write(b"first\n");
        log.write(b"second\n");
        assert_eq!(fs::read_to_string(&path).unwrap(), "second\n");
        assert_eq!(fs::read_to_string(&rotated).unwrap(), "first\n");

        log.write(b"third\n");
        assert_eq!(fs::read_to_string(&path).unwrap(), "third\n");
        assert_eq!(fs::read_to_string(&rotated).unwrap(), "second\n");

        log.write(b"a line longer than the cap\n");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "a line longer than the cap\n",
            "a single write over the cap is kept whole rather than dropped"
        );

        CappedLog::open(&dir.path().join("drained"), 1 << 20)
            .unwrap()
            .drain(&b"from the pipe"[..]);
        assert_eq!(
            fs::read_to_string(dir.path().join("drained")).unwrap(),
            "from the pipe"
        );
    }

    // TEST_SCENARIO: the kernel log is how FATAL and the hand-off reach the machine's console, which is all the runner reads of a guest. smolvm's quiet kernel prints only records below error level, and the kernel takes a record of about a kilobyte, so the line is sent at critical level and cut to fit, on a character boundary.
    #[test]
    fn console_lines_are_critical_and_fit_one_kernel_record() {
        assert_eq!(console_line("FATAL: x"), "<2>platform-init: FATAL: x\n");
        let long = console_line(&"é".repeat(2000));
        assert!(long.len() <= CONSOLE_LINE_MAX + 1);
        assert!(long.starts_with("<2>platform-init: é"));
        assert!(long.ends_with('\n'));
    }

    // TEST_SCENARIO: an entrypoint that keeps exiting is started again after a delay that doubles up to a minute, so a broken image does not spin the guest. One that ran for a minute had a working start, and waits the least again.
    #[test]
    fn restarts_back_off_while_the_entrypoint_keeps_failing() {
        let quick = std::time::Duration::from_secs(2);
        let mut delay = restart_delay(None, quick);
        assert_eq!(delay, FIRST_RESTART_DELAY);
        let mut seen = vec![delay.as_secs()];
        for _ in 0..8 {
            delay = restart_delay(Some(delay), quick);
            seen.push(delay.as_secs());
        }
        assert_eq!(seen, [1, 2, 4, 8, 16, 32, 60, 60, 60]);
        assert_eq!(
            restart_delay(Some(MAX_RESTART_DELAY), STABLE_RUN),
            FIRST_RESTART_DELAY
        );
    }

    // TEST_SCENARIO: the entrypoint is started with argv exactly as the image names it, argv[0] included although the binary was found on PATH, and with the trust cache and the launch record's env in its environment, and nothing of platform-init's own (cargo's CARGO here, the VMM's settings in a guest). platform-init blocks the signals it forwards, and Rust ignores SIGPIPE; the entrypoint must inherit neither, or a shell pipeline in the image is never ended by a closed pipe and the entrypoint never sees SIGTERM. The signals glibc reserves below SIGRTMIN are left out: under Docker's default seccomp profile the spawned process starts with them ignored, and the C library keeps them for its own use, so no program in the image can catch or send them.
    #[test]
    fn the_entrypoint_starts_with_the_images_argv_and_a_clean_signal_state() {
        let binary = look_path(OsStr::new("sh"), None).unwrap();
        let command = [
            OsString::from("image-sh"),
            OsString::from("-c"),
            OsString::from(
                r#"echo "$0 $PLATFORM_TRUST_CACHE $FROM_LAUNCH ${CARGO:-clean}"; grep -E '^Sig(Blk|Ign):' /proc/self/status"#,
            ),
        ];
        let thread = std::thread::spawn(move || {
            // SAFETY: the set is initialised by sigemptyset before sigaddset and pthread_sigmask read it, and the mask changed is this test thread's own.
            unsafe {
                let mut set: libc::sigset_t = std::mem::zeroed();
                libc::sigemptyset(&mut set);
                libc::sigaddset(&mut set, libc::SIGTERM);
                libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
            }
            entrypoint(
                &binary,
                &command,
                &[("FROM_LAUNCH".into(), "yes".into())],
                Some(Path::new("/var/cache/platform/trust")),
            )
            .output()
            .unwrap()
        });
        let output = String::from_utf8(thread.join().unwrap().stdout).unwrap();
        let mut lines = output.lines();
        assert_eq!(
            lines.next(),
            Some("image-sh /var/cache/platform/trust yes clean")
        );
        let glibc_reserved: u64 = (32..libc::SIGRTMIN()).map(|s| 1 << (s - 1)).sum();
        for line in lines {
            let mask = u64::from_str_radix(line.split_whitespace().nth(1).unwrap(), 16).unwrap();
            assert_eq!(mask & !glibc_reserved, 0, "the entrypoint inherited {line}");
        }
    }

    #[test]
    fn exit_statuses_read_like_a_shells() {
        assert_eq!(exit_description(3 << 8), "exited with status 3");
        assert_eq!(exit_description(libc::SIGKILL), "was killed by signal 9");
        assert_eq!(exit_description(NOT_STARTED), "exited with status 127");
    }

    // TEST_SCENARIO: a signal the workload is stopped with ends the supervision, so an entrypoint that exits on it is not started again; every forwarded signal reaches the entrypoint, and SIGCHLD, which only wakes the reaper, does not.
    #[test]
    fn stopping_signals_end_the_supervision() {
        let mut stopping = false;
        assert!(on_signal(libc::SIGHUP, &mut stopping));
        assert!(!stopping, "a reload is not a stop");
        assert!(!on_signal(libc::SIGCHLD, &mut stopping));
        assert!(on_signal(libc::SIGTERM, &mut stopping));
        assert!(stopping);
    }

    // TEST_SCENARIO: only free blocks below the reporting order count as scattered, summed in pages over every zone. Counting the larger blocks would compact a guest whose free memory the host already took back, and dropping a zone would miss memory freed there.
    #[test]
    fn scattered_free_counts_blocks_below_the_reporting_order_in_every_zone() {
        let buddy = "Node 0, zone    DMA32      1      2      0      0      0      0      0      0      0      7    446 \n\
                     Node 0, zone   Normal      3      0      0      0      0      0      0      0      1      5      2 \n";
        assert_eq!(free_below_order(buddy, 9), 1 + 2 * 2 + 3 + 256);
        assert_eq!(free_below_order(buddy, 1), 4);
        assert_eq!(free_below_order("", 9), 0);
    }
    // TEST_SCENARIO: the cold memory is read from the root cgroup's memory.stat, where `inactive_file` and `inactive_anon` sit beside `file`, `active_file` and `inactive_anon`, all byte counts. Picking a neighbour would reclaim the wrong amount every minute — anonymous memory the guest cannot drop, or the active cache the agent is using.
    #[test]
    fn the_cold_memory_is_the_inactive_counts() {
        let stat = "anon 4096\nfile 1289818112\ninactive_anon 0\nactive_anon 4096\ninactive_file 1283219456\nactive_file 2838528\n";
        assert_eq!(stat_bytes(stat, "inactive_file"), Some(1283219456));
        assert_eq!(stat_bytes("file 1\nactive_file 1\n", "inactive_file"), None);
        assert_eq!(stat_bytes(stat, "inactive_anon"), Some(0));
    }

    // TEST_SCENARIO: the kernel refuses swapon on a zram device whose first page is not a version 1 swap header with the right last page, and the guest then runs without swap. So the header carries the magic in the page's last ten bytes and names the last page of the device.
    #[test]
    fn the_zram_swap_header_is_the_one_mkswap_writes() {
        let header = swap_header(4096, 8 << 20);
        assert_eq!(header.len(), 4096);
        assert_eq!(&header[4086..], b"SWAPSPACE2");
        assert_eq!(header[1024..1028], 1u32.to_ne_bytes());
        assert_eq!(header[1028..1032], 2047u32.to_ne_bytes());
        assert!(header[..1024].iter().all(|&b| b == 0));
    }

    // TEST_SCENARIO: /tmp is on the platform's overlay root, where overlayfs shows a directory on a device of its own and each file on its upper layer's. Eviction must still offer a file, a symlink and a directory holding a file there, or a full disk frees nothing of /tmp. Needs root, for the overlay mount: `sudo -E cargo test -p platform-init -- --ignored overlay`.
    #[test]
    #[ignore = "needs root"]
    fn eviction_offers_files_on_an_overlay_root() {
        let dir = TempDir::new("evict-overlay");
        let d = dir.path();
        for name in ["lower", "upper", "work", "merged"] {
            fs::create_dir_all(d.join(name)).unwrap();
        }
        let options = format!(
            "lowerdir={},upperdir={},workdir={}",
            d.join("lower").display(),
            d.join("upper").display(),
            d.join("work").display()
        );
        let merged = d.join("merged");
        let out = std::process::Command::new("mount")
            .args(["-t", "overlay", "overlay", "-o", &options])
            .arg(&merged)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let checks = || {
            fs::write(merged.join("file"), b"x").unwrap();
            std::os::unix::fs::symlink("file", merged.join("link")).unwrap();
            fs::create_dir(merged.join("cache")).unwrap();
            fs::write(merged.join("cache/blob"), b"y").unwrap();
            let roots = open_scratch_roots(&[(merged.clone(), mount_of(&merged))]);
            assert_eq!(
                roots[0].dev, None,
                "an overlay root is bounded by its mount alone"
            );
            let later = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 2 * EVICT_AGES[0];
            let mut names: Vec<_> = scratch_entries(&roots, &HashSet::new(), later, EVICT_AGES[3])
                .into_iter()
                .map(|entry| {
                    entry
                        .path
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect();
            names.sort();
            assert_eq!(names, ["cache", "file", "link"]);
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(checks));
        let _ = std::process::Command::new("umount").arg(&merged).status();
        result.unwrap();
    }
}
