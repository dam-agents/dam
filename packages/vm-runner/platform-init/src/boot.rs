// UNIT_BOUNDARY_DESCRIPTION: the entrypoint of every vm-backend machine. It claims the machine's storage disk, moves the image onto a root of its own that lasts as long as the image does, mounts the agent's home from the disk, puts the temporary and cache folders in memory, and starts the image's own entrypoint, which it then supervises. It exists so persistence is the platform's to guarantee rather than the image's to implement: the runner supplies this binary, so an image that has never heard of this platform still keeps its agent's home across a stop, and a machine that cannot mount its disk does not boot at all rather than losing its work at the first stop.
use std::ffi::{CString, OsStr, OsString};
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, IntoRawFd};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::guest::{self, SeedDigest};

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

// UNIT_BOUNDARY_DESCRIPTION: every caller is a condition under which the guest would come up without its persisted paths. An agent that runs and quietly discards its work looks healthy until the machine stops, so a machine that cannot persist does not boot at all.
macro_rules! fatal {
    ($($arg:tt)*) => {{
        announce(&format!("FATAL: {}", format_args!($($arg)*)));
        exit(1)
    }};
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

// UNIT_BOUNDARY_DESCRIPTION: ends platform-init, and with it the machine's workload. A thread of this process writes the boot log, so the log is flushed and the thread waited for first. Without that, the line that explains the exit is the one that never reaches the disk.
fn exit(code: i32) -> ! {
    close_boot_log();
    std::process::exit(code)
}

pub fn run(command: Vec<OsString>) -> ! {
    block_signals();
    if command.is_empty() {
        fatal!("no image entrypoint to exec; the runner passes it after this binary");
    }

    let workdir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    stop_propagation();
    let root = claim_disk();
    open_boot_log(&root);

    logf!("storage disk claimed at {}", root.display());
    claim_layout(&root);
    fresh_root(&root);
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
    mount_scratch();
    let trust = offer_trust_cache(&root);
    leave_disk(&root);
    share_mounts();
    enter_workdir(&workdir);

    let binary = match look_path(&command[0], std::env::var_os("PATH")) {
        Ok(binary) => binary,
        Err(e) => fatal!(
            "the image's entrypoint {:?} is not executable in this guest: {e}",
            command[0]
        ),
    };
    std::thread::spawn(reclaim_cold_cache);
    supervise(&binary, &command, trust.as_deref())
}

// UNIT_BOUNDARY_DESCRIPTION: a guest keeps the files it read in its page cache until something needs the memory, and the host counts that cache as memory the machine holds, so an agent that once read a large tree holds it long after. Every RECLAIM_INTERVAL the cache on the kernel's inactive list — what nothing has touched lately — is handed to the root cgroup's proactive reclaim, and the pages it frees go back to the host through free-page reporting within seconds. The guest has no swap, so reclaim drops only file pages: what the agent's processes hold stays. A guest kernel without cgroup v2 reclaim gives nothing to read or write, and the loop does nothing.
const RECLAIM_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
const RECLAIM_FLOOR: u64 = 64 << 20;

fn reclaim_cold_cache() {
    loop {
        std::thread::sleep(RECLAIM_INTERVAL);
        let Some(cold) = fs::read_to_string("/sys/fs/cgroup/memory.stat")
            .ok()
            .and_then(|stat| inactive_file(&stat))
        else {
            continue;
        };
        if cold >= RECLAIM_FLOOR {
            let _ = fs::write("/sys/fs/cgroup/memory.reclaim", cold.to_string());
        }
    }
}

fn inactive_file(stat: &str) -> Option<u64> {
    stat.lines()
        .find_map(|line| line.strip_prefix("inactive_file "))?
        .trim()
        .parse()
        .ok()
}

// UNIT_BOUNDARY_DESCRIPTION: the kernel refuses to move a mount out of a shared parent, and refuses pivot_root when either root's parent is shared. So the tree is made a slave before the disk is moved: mounts made elsewhere in the guest still arrive, and nothing this boot does leaves it. A private tree is left as it is.
fn stop_propagation() {
    if let Err(e) = mount(Path::new(""), Path::new("/"), libc::MS_REC | libc::MS_SLAVE) {
        logf!(
            "WARNING: making the mount tree a slave ({e}); moving the disk and the root may fail"
        );
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a disk that failed to attach leaves an ordinary directory of the root overlay in its place, which would take every write the agent's home makes and discard it at the next stop — so the device is checked before anything is mounted onto it. The move that follows takes the disk off a name that means something else here: left where the VMM put it, its root is writable as "workspace", and anything written straight to it persists outside the agent's home. A kernel that refuses the move still has a working disk, which is worth a line in the log and not a failed boot.
fn claim_disk() -> PathBuf {
    let device_path = Path::new(guest::DISK_DEVICE_PATH);
    let disk_path = Path::new(guest::DISK_PATH);
    let device = match fs::metadata(device_path) {
        Ok(device) => device,
        Err(e) => fatal!("no storage disk at {}: {e}", device_path.display()),
    };
    let root = match fs::metadata("/") {
        Ok(root) => root,
        Err(e) => fatal!("stat /: {e}"),
    };
    if device.dev() == root.dev() {
        fatal!(
            "{} is on the root filesystem, so this machine has no storage disk; refusing to boot without persistence",
            device_path.display()
        );
    }
    if let Err(e) = mkdir_all(disk_path) {
        logf!(
            "WARNING: creating {} ({e}); keeping the disk at {}",
            disk_path.display(),
            device_path.display()
        );
        return device_path.to_path_buf();
    }
    if let Err(e) = mount(device_path, disk_path, libc::MS_MOVE) {
        logf!(
            "WARNING: moving the disk to {} ({e}); keeping it at {}, where it stays writable under that name too",
            disk_path.display(),
            device_path.display()
        );
        return device_path.to_path_buf();
    }
    let _ = fs::remove_dir(device_path).or_else(|_| fs::remove_file(device_path));
    disk_path.to_path_buf()
}

// UNIT_BOUNDARY_DESCRIPTION: holds the boot to a disk whose layout this platform-init knows, before anything else is read from the disk or written to it. A disk marked with a newer layout was written by a newer platform-init — a runner rolled back past it — and this one would misread it, so the boot stops rather than seed or mount by the wrong names. A disk with no mark is in the one layout there has been, and gets the mark now.
fn claim_layout(root: &Path) {
    match mark_layout(root) {
        Ok(Some(version)) => logf!("marked the disk as layout {version}"),
        Ok(None) => {}
        Err(e) => fatal!("reading the disk's layout: {e}"),
    }
}

fn mark_layout(root: &Path) -> io::Result<Option<u32>> {
    let path = guest::system_store(root, guest::LAYOUT_FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            write_record(&path, format!("{}\n", guest::LAYOUT_VERSION).as_bytes())?;
            return Ok(Some(guest::LAYOUT_VERSION));
        }
        Err(e) => return Err(e),
    };
    match text.trim().parse::<u32>() {
        Ok(version) if version == guest::LAYOUT_VERSION => Ok(None),
        Ok(version) if version > guest::LAYOUT_VERSION => Err(io::Error::other(format!(
            "the disk is in layout {version}, and this platform-init knows layouts up to {}. Refusing to boot a disk a newer platform-init wrote",
            guest::LAYOUT_VERSION
        ))),
        _ => Err(io::Error::other(format!(
            "{} holds {:?}, which is not a layout this platform-init knows",
            path.display(),
            text.trim()
        ))),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm roots the image on an overlay whose upper layer sits on the storage disk, is named after the machine, and is kept across every stop and every change of image. Left on it, an old image's changes lie over a new one. This mounts the platform's own overlay over that root, with its upper and work layers on the disk, and pivots into it. The upper layer is kept while the machine boots the image that wrote it, as the runner names it in the share, and emptied when the image changed or either side names none, so what the image writes outside HOME lasts exactly as long as that image. The mounts smolvm made move along, except its other binds of the disk and its /tmp, which stay behind with the old root. A failure is fatal: a machine left on smolvm's root would look healthy while it keeps another image's changes.
fn fresh_root(disk: &Path) {
    let layers = FreshRoot::on(disk);
    let table = match fs::read_to_string("/proc/self/mountinfo") {
        Ok(table) => table,
        Err(e) => fatal!("reading the mount table: {e}"),
    };
    let plan = match plan_mounts(&parse_mountinfo(&table), disk) {
        Ok(plan) => plan,
        Err(e) => fatal!("{e}"),
    };
    let booting = image_record(Path::new(guest::IMAGE_PATH));
    let recorded = image_record(&layers.image);
    let fresh = fresh_reason(booting.as_deref(), recorded.as_deref());
    let mut cleared = vec![&layers.legacy_upper, &layers.work];
    if fresh.is_some() {
        cleared.extend([&layers.image, &layers.upper]);
    }
    for dir in cleared {
        if let Err(e) = remove_all(dir) {
            fatal!("clearing {}: {e}", dir.display());
        }
    }
    for dir in [&layers.upper, &layers.work, &layers.merged] {
        if let Err(e) = mkdir_all(dir) {
            fatal!("creating {}: {e}", dir.display());
        }
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
    if let Err(e) = layers.mount() {
        if e.raw_os_error() == Some(libc::EINVAL) {
            fatal!(
                "the kernel refused the platform's root over this image ({e}). It does that when the image's root is already two overlays deep, which smolvm builds when it cannot stack the image's layers in one mount. Refusing to boot on smolvm's root, which keeps every image's changes"
            );
        }
        fatal!(
            "mounting the platform's root at {}: {e}; refusing to boot on smolvm's root, which keeps every image's changes",
            layers.merged.display()
        );
    }
    let put_old = layers.merged.join(OLD_ROOT);
    if let Err(e) = DirBuilder::new().mode(0o700).create(&put_old) {
        if e.kind() != io::ErrorKind::AlreadyExists {
            fatal!("creating {}: {e}", put_old.display());
        }
    }
    if let Err(e) = pivot_root(&layers.merged, &put_old) {
        fatal!("pivoting into the platform's root: {e}");
    }
    if let Err(e) = std::env::set_current_dir("/") {
        fatal!("entering the platform's root: {e}");
    }
    let old = Path::new("/").join(OLD_ROOT);
    for point in &plan.carried {
        if let Err(e) = carry(&old, point) {
            if point == disk {
                fatal!("moving the storage disk into the platform's root: {e}");
            }
            logf!(
                "WARNING: {} is missing from the platform's root ({e})",
                point.display()
            );
        }
    }
    if let Err(e) = unmount_detached(&old) {
        fatal!("detaching the old root, which still reaches the disk under other names: {e}");
    }
    let _ = fs::remove_dir(&old);
    for point in &plan.left_behind {
        let _ = fs::remove_dir(point);
    }
    logf!(
        "what the image writes outside {} stays until the machine boots another image",
        guest::AGENT_HOME
    );
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

// UNIT_BOUNDARY_DESCRIPTION: smolvm starts this process in the image's WORKDIR, and the image's command counts on that: `node dist/server.js` under WORKDIR /app names a file that exists only relative to /app. pivot_root leaves the process in a directory of the old root, so fresh_root has to enter the new root's "/", and nothing else would ever leave it — so the directory saved before the pivot is entered again here. The path is absolute, and the platform root's merged view carries the whole image tree, so it resolves to the same directory of the same image. It is entered only once every mount is in place: a WORKDIR under HOME entered before the home is mounted is the image's copy, which the mount then hides, and the entrypoint would work in a directory nothing keeps. One the platform's root somehow lacks is a warning and a start at "/", not a failed boot: the entrypoint may not need it at all.
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

// UNIT_BOUNDARY_DESCRIPTION: the platform root's layers. The lower layer is "/", the image as smolvm mounted it: overlayfs reads a lower directory without the mounts on top of it, so /proc, /storage and the rest are not part of it. The upper and work layers are on the disk and not in memory, so an agent that writes a lot outside HOME fills its disk and not its RAM. The kept upper layer and the record of the image that wrote it share a directory of their own, `kept`. A platform-init from before roots were kept empties `upper` and `work` on every boot and never looks in `kept`, so a runner rolled back and forward again finds the kept upper still beside the record of the image that wrote it. The old `upper` is cleared on every boot, so a disk from that layout gets its space back.
struct FreshRoot {
    upper: PathBuf,
    image: PathBuf,
    legacy_upper: PathBuf,
    work: PathBuf,
    merged: PathBuf,
}

impl FreshRoot {
    fn on(disk: &Path) -> Self {
        let store = guest::system_store(disk, guest::ROOTFS_DIR);
        FreshRoot {
            upper: store.join("kept").join("upper"),
            image: store.join("kept").join("image"),
            legacy_upper: store.join("upper"),
            work: store.join("work"),
            merged: store.join("merged"),
        }
    }

    fn options(&self) -> io::Result<CString> {
        for dir in [&self.upper, &self.work] {
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
        let mut options = OsString::from("lowerdir=/,upperdir=");
        options.push(&self.upper);
        options.push(",workdir=");
        options.push(&self.work);
        options.push(LOWER_MAY_CHANGE);
        cstring(&options)
    }

    fn mount(&self) -> io::Result<()> {
        let options = self.options()?;
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

#[derive(Debug, PartialEq)]
struct MountEntry {
    id: u64,
    parent: u64,
    device: String,
    point: PathBuf,
}

// UNIT_BOUNDARY_DESCRIPTION: reads /proc/self/mountinfo. A line this cannot read is skipped and does not fail the boot: only the root and the mounts directly on it matter, and a mount missing from the plan is logged when the platform's root lacks it.
fn parse_mountinfo(table: &str) -> Vec<MountEntry> {
    table
        .lines()
        .filter_map(|line| {
            let mut fields = line.split(' ');
            let id = fields.next()?.parse().ok()?;
            let parent = fields.next()?.parse().ok()?;
            let device = fields.next()?.to_string();
            let _root = fields.next()?;
            let point = unescape_mount_path(fields.next()?);
            Some(MountEntry {
                id,
                parent,
                device,
                point,
            })
        })
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: the kernel writes a space, tab, newline or backslash in a mount path as a backslash and three octal digits, so a path is decoded before it is used.
fn unescape_mount_path(field: &str) -> PathBuf {
    let bytes = field.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let digits = bytes
            .get(i + 1..i + 4)
            .filter(|digits| bytes[i] == b'\\' && digits.iter().all(|d| (b'0'..=b'7').contains(d)));
        match digits {
            Some(digits) => {
                let value = digits
                    .iter()
                    .fold(0u32, |value, d| value * 8 + u32::from(d - b'0'));
                out.push(value as u8);
                i += 4;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    PathBuf::from(OsString::from_vec(out))
}

// UNIT_BOUNDARY_DESCRIPTION: which mounts follow the image onto the platform's root: every mount made directly on the old root, in the order the kernel lists them, except the other binds of the storage disk and the mounts platform-init makes again itself. The binds are smolvm's. /storage holds the whole disk, including the upper layer smolvm keeps, and carrying it would give the image a second, persistent name for the root of every image this machine ran. A mount on top of another moves with it, so only the ones on the root are named. The empty directory a left-behind mount stood on is removed too, so no script mistakes it for the disk. The directory of a mount platform-init makes again stays, since it mounts there.
#[derive(Debug, PartialEq)]
struct MountPlan {
    carried: Vec<PathBuf>,
    left_behind: Vec<PathBuf>,
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm's /tmp is a tmpfs. mount_scratch mounts the platform's own there, beside the other temporary folders, so smolvm's is left with the old root.
const DISCARDED_MOUNTS: [&str; 1] = ["/tmp"];

fn plan_mounts(table: &[MountEntry], disk: &Path) -> Result<MountPlan, String> {
    let root = table
        .iter()
        .rev()
        .find(|entry| entry.point == Path::new("/"))
        .ok_or("the mount table lists no root")?;
    let on_root: Vec<_> = table
        .iter()
        .filter(|entry| entry.parent == root.id && entry.id != root.id)
        .collect();
    let disk_device = on_root
        .iter()
        .rev()
        .find(|entry| entry.point == disk)
        .map(|entry| &entry.device)
        .ok_or_else(|| {
            format!(
                "the storage disk at {} is not mounted on the root",
                disk.display()
            )
        })?;
    let (carried, left_behind): (Vec<&&MountEntry>, Vec<_>) = on_root
        .iter()
        .partition(|entry| entry.point == disk || &entry.device != disk_device);
    let carried = carried.into_iter().filter(|entry| {
        entry.point == disk
            || !DISCARDED_MOUNTS
                .iter()
                .any(|path| entry.point == Path::new(path))
    });
    let points = |entries: Vec<&&MountEntry>| entries.iter().map(|e| e.point.clone()).collect();
    Ok(MountPlan {
        carried: points(carried.collect()),
        left_behind: points(left_behind),
    })
}

fn carry(old_root: &Path, point: &Path) -> io::Result<()> {
    let relative = point.strip_prefix("/").unwrap_or(point);
    let from = old_root.join(relative);
    let to = Path::new("/").join(relative);
    if fs::symlink_metadata(&to).is_err() {
        if fs::metadata(&from)?.is_dir() {
            mkdir_all(&to)?;
        } else {
            if let Some(parent) = to.parent() {
                mkdir_all(parent)?;
            }
            File::create(&to)?;
        }
    }
    mount(&from, &to, libc::MS_MOVE)
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

// UNIT_BOUNDARY_DESCRIPTION: the folders that only ever hold temporary files or caches, each a tmpfs of its own, so they are empty on every boot and never fill the disk or a root that is kept. The system ones get the mode the image expects of them and root as owner. In the agent's home, npm's whole cache directory and the XDG cache directory get the home's owner. A tmpfs mounted without a size is capped by the kernel at half the guest's memory, and what it holds counts as the machine's memory.
const SCRATCH_DIRS: [(&str, u32); 3] = [
    ("/tmp", 0o1777),
    ("/var/tmp", 0o1777),
    ("/var/cache", 0o755),
];
const HOME_CACHES: [&str; 2] = [".cache", ".npm"];
const HOME_CACHE_MODE: u32 = 0o755;

// UNIT_BOUNDARY_DESCRIPTION: puts every scratch folder on a tmpfs. It runs once the root is in place and the home is mounted, so a home cache sits on top of the persisted home, and before the trust cache, which is bound under /var/cache. A home cache that is a symlink — a home moved here from a container has ~/.cache pointing at /tmp/agent-cache — or that already holds files on the disk is moved aside and deleted in the background, so the disk gets its space back without holding up the boot. A tmpfs that cannot be mounted is a warning: the folder then stays on the disk, as it was before, and the agent still runs.
fn mount_scratch() {
    for (dir, mode) in SCRATCH_DIRS {
        scratch(Path::new(dir), mode, (0, 0));
    }
    let home = Path::new(guest::AGENT_HOME);
    let owner = match fs::metadata(home) {
        Ok(info) => (info.uid(), info.gid()),
        Err(e) => {
            logf!(
                "WARNING: reading the owner of {} ({e}); its caches stay on the disk",
                home.display()
            );
            return;
        }
    };
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    for name in HOME_CACHES {
        let path = home.join(name);
        match discard_cache(&path, stamp) {
            Ok(Some(aside)) => logf!("discarding the old {} from the disk", aside.display()),
            Ok(None) => {}
            Err(e) => {
                logf!(
                    "WARNING: moving the old {} aside ({e}); it stays on the disk",
                    path.display()
                );
                continue;
            }
        }
        scratch(&path, HOME_CACHE_MODE, owner);
    }
    let home = home.to_path_buf();
    std::thread::spawn(move || purge_discarded(&home));
}

fn scratch(path: &Path, mode: u32, (uid, gid): (u32, u32)) {
    let mounted = mkdir_all(path)
        .and_then(|()| std::os::unix::fs::chown(path, Some(uid), Some(gid)))
        .and_then(|()| fs::set_permissions(path, fs::Permissions::from_mode(mode)))
        .and_then(|()| mount_tmpfs(path, &format!("mode={mode:o},uid={uid},gid={gid}")));
    if let Err(e) = mounted {
        logf!(
            "WARNING: no tmpfs at {} ({e}); it stays on the disk",
            path.display()
        );
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the name a discarded home cache is moved to, beside itself, so the move is a rename on the same disk however many files the cache holds. The background delete finds discarded caches by this name, so one a stop cut short is deleted on the next boot. It is the agent image entrypoint's own pattern for its discarded caches.
const DISCARDED_INFIX: &str = ".discarded.";

// UNIT_BOUNDARY_DESCRIPTION: makes a home cache path ready to mount over: nothing there, or an empty directory, is left as it is. Anything else — a symlink, a file, a directory with files — is renamed aside and its new name returned. The rename never follows a symlink, so a link to /tmp moves and its target is not touched.
fn discard_cache(path: &Path, stamp: u64) -> io::Result<Option<PathBuf>> {
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

// UNIT_BOUNDARY_DESCRIPTION: deletes the home caches moved aside by this boot or an earlier one. Only the names discard_cache gives are touched, so nothing else in the home is. A delete that fails is left for the next boot.
fn purge_discarded(home: &Path) {
    let Ok(entries) = fs::read_dir(home) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if HOME_CACHES
            .iter()
            .any(|cache| name.starts_with(&format!("{cache}{DISCARDED_INFIX}")))
        {
            let _ = remove_all(&entry.path());
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the image's own boot may keep its extracted CA trust store here rather than rebuilding it every time. The variable is set only on this backend, so an image that honors it caches on a machine and silently does without in a container, where there is no disk to cache on. The store is bound to a path of its own because the disk itself is detached before the image runs.
fn offer_trust_cache(root: &Path) -> Option<PathBuf> {
    let trust = guest::system_store(root, "trust");
    let guest_dir = Path::new(TRUST_CACHE_PATH);
    let bound = mkdir_all(&trust)
        .and_then(|()| mkdir_all(guest_dir))
        .and_then(|()| mount(&trust, guest_dir, libc::MS_BIND));
    if let Err(e) = bound {
        logf!("WARNING: no trust cache directory ({e}); the image re-extracts its CA store every boot");
        return None;
    }
    Some(guest_dir.to_path_buf())
}

// UNIT_BOUNDARY_DESCRIPTION: the disk's root stays mounted only as long as the boot needs it. Everything the image may keep is on it under other mounts by now — its home, the trust cache, the root's layers — and an open file such as the boot log keeps working once the mount is gone. Left mounted, the disk's root lets anything in the guest write outside HOME and past its root, straight into the record of which image wrote that root or the platform's own state.
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
    if let Err(e) = mkdir_all(path) {
        fatal!("creating the guest mountpoint {}: {e}", path.display());
    }
    if let Err(e) = mount(&store, path, libc::MS_BIND) {
        fatal!("mounting {} from the disk: {e}", path.display());
    }
    logf!("persisting {}", path.display());
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
    if !must_seed(store, seeded_before)? {
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

// UNIT_BOUNDARY_DESCRIPTION: the copy lands beside its destination and is renamed into place, so a boot interrupted halfway leaves no half-seeded store to be mistaken for a complete one: the next boot finds nothing and seeds again.
fn seed(from: &Path, store: &Path) -> io::Result<()> {
    stage(store, |staged| match fs::symlink_metadata(from) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => mkdir_all(staged),
        Err(e) => Err(e),
        Ok(source) => copy_tree(from, staged, &source),
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

// UNIT_BOUNDARY_DESCRIPTION: a small file replaced whole: written beside itself, flushed and renamed over, so a boot cut short leaves the old record or the new one.
fn write_record(path: &Path, body: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        mkdir_all(parent)?;
    }
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
    fs::rename(&staged, path)
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

// UNIT_BOUNDARY_DESCRIPTION: the staged tree is flushed to the disk before the rename, and the directory that holds the store after it, so the store is whole on the disk once it has its name. A store that exists is never seeded again, so a stop before the data reached the disk — on a disk with no journal most of all — would otherwise leave the name over files that were lost, and the next boot would take it as the agent's home.
fn stage(store: &Path, fill: impl FnOnce(&Path) -> io::Result<()>) -> io::Result<()> {
    let parent = store
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    mkdir_all(parent)?;
    let staged = with_suffix(store, ".seeding");
    remove_all(&staged)?;
    if let Err(e) = fill(&staged).and_then(|()| flush_filesystem(&staged)) {
        let _ = remove_all(&staged);
        return Err(e);
    }
    fs::rename(&staged, store)?;
    File::open(parent)?.sync_all()
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

// UNIT_BOUNDARY_DESCRIPTION: every signal platform-init handles is blocked in every thread and read with sigtimedwait instead, so none arrives while the boot is half done and none is lost to the thread that writes the boot log. It runs before that thread exists, because a thread takes its signal mask from the one that starts it. A handler that does nothing is installed as well, because a signal the first process of a PID namespace leaves at its default is dropped by the kernel. std's spawn resets the mask in the entrypoint.
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
fn entrypoint(binary: &Path, command: &[OsString], trust: Option<&Path>) -> std::process::Command {
    use std::os::unix::process::CommandExt;
    let mut entrypoint = std::process::Command::new(binary);
    entrypoint.arg0(&command[0]).args(&command[1..]);
    if let Some(trust) = trust {
        entrypoint.env(TRUST_CACHE_ENV, trust);
    }
    entrypoint
}

// UNIT_BOUNDARY_DESCRIPTION: platform-init stays the parent of the image's entrypoint instead of becoming it. smolvm launches the workload once per boot and nothing in the guest starts it again, so an entrypoint that exited used to leave a machine that runs and answers nothing until the runner's unhealthy restart, ten minutes later. It cannot power the guest off instead: it is the first process of the workload's own PID namespace, where reboot(2) only ends that namespace. So when the entrypoint exits, every process it left is ended, as a container restart would, and it is started again on the same root and the same home, after a delay that doubles while it keeps failing. Each exit is announced, so the machine's console says why the agent went away. Being the first process of the namespace, platform-init also reaps every orphan, which is the job an image's own init did as that process.
fn supervise(binary: &Path, command: &[OsString], trust: Option<&Path>) -> ! {
    let words: Vec<_> = command.iter().map(|word| word.to_string_lossy()).collect();
    let mut delay = None;
    let mut stopping = false;
    loop {
        announce(&format!(
            "handing off to the image entrypoint [{}]",
            words.join(" ")
        ));
        let started = std::time::Instant::now();
        let status = match entrypoint(binary, command, trust).spawn() {
            Ok(child) => wait_for(child.id(), &mut stopping),
            Err(e) if delay.is_none() => fatal!("starting {}: {e}", binary.display()),
            Err(e) => {
                announce(&format!("starting {}: {e}", binary.display()));
                NOT_STARTED
            }
        };
        announce(&format!(
            "the image entrypoint {} after {}s",
            exit_description(status),
            started.elapsed().as_secs()
        ));
        end_the_rest(&mut stopping);
        if stopping {
            flush_home_on_stop();
            exit(exit_code(status));
        }
        let wait = restart_delay(delay, started.elapsed());
        delay = Some(wait);
        announce(&format!(
            "starting the image entrypoint again in {}s",
            wait.as_secs()
        ));
        if pause(wait, &mut stopping) {
            flush_home_on_stop();
            exit(exit_code(status));
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: writes the agent's home out to the disk once the workload has stopped, before the guest is quiesced and powered off. A stop asks smolvm to quiesce the disk, and a runner may be stopping a machine an older smolvm started, whose guest agent may not confirm it; the runner then powers the guest off. Flushing here makes that power-off cost at most a journal replay, never what the agent last wrote, whatever version the host runs.
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
            pid if pid > 0 => exited.push((pid, status)),
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

// UNIT_BOUNDARY_DESCRIPTION: the exit code a shell would report for the entrypoint: its own, or 128 plus the signal that killed it.
fn exit_code(status: libc::c_int) -> i32 {
    if libc::WIFSIGNALED(status) {
        128 + libc::WTERMSIG(status)
    } else {
        libc::WEXITSTATUS(status)
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

fn mount_tmpfs(target: &Path, options: &str) -> io::Result<()> {
    let target = cstring(target.as_os_str())?;
    let options = CString::new(options).map_err(io::Error::from)?;
    // SAFETY: the source, target, type and options are NUL-terminated strings that outlive the call, and tmpfs reads its options as a string.
    let rc = unsafe {
        libc::mount(
            c"tmpfs".as_ptr(),
            target.as_ptr(),
            c"tmpfs".as_ptr(),
            libc::MS_NOSUID | libc::MS_NODEV,
            options.as_ptr().cast(),
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

fn remove_all(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
        Ok(info) if info.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
    }
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

    // TEST_SCENARIO: a sparse file comes in the seed as its data and a map of its holes, and the tar reader hands the holes over as zeros. The restore seeks past them rather than writing them, so a 64 MiB file with one block of data is 64 MiB long, reads back exactly, and takes a few blocks of the disk rather than 64 MiB, and a hole at its end is kept by its length. The digest the runner expects is of the whole tar as uploaded, so it matches only if the unpack hashes the sparse entry's map and data as they are read.
    #[test]
    fn a_sparse_file_in_the_seed_is_restored_with_its_holes() {
        let size: u64 = 64 << 20;
        let at: u64 = 32 << 20;
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

    // TEST_SCENARIO: smolvm starts platform-init in the image's WORKDIR, and pivoting into the platform's root leaves the process at "/", where `node dist/server.js` under WORKDIR /app finds nothing. The directory saved before the pivot is entered again once the platform's root is in place; one the platform's root lacks leaves the process where the pivot left it rather than failing the boot.
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

    // TEST_SCENARIO: the scenarios below plan from the mount table smolvm leaves a container with when platform-init starts, after the disk has been moved to /mnt/platform. The disk's device is 254:16, and /storage is smolvm's bind of the whole of it.
    const SMOLVM_TABLE: &str = "\
50 1 0:40 / / rw,relatime - overlay overlay rw,lowerdir=/storage/layers/a,upperdir=/storage/overlays/persistent-m1/upper,workdir=/storage/overlays/persistent-m1/work
51 50 0:45 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw
52 50 0:46 / /dev rw,nosuid - tmpfs tmpfs rw,size=65536k,mode=755
53 52 0:47 / /dev/pts rw,nosuid,noexec - devpts devpts rw,mode=620,ptmxmode=666
54 50 0:23 / /sys ro,nosuid,nodev,noexec - sysfs sysfs ro
55 54 0:30 / /sys/fs/cgroup rw,nosuid,nodev,noexec - cgroup2 cgroup rw
56 50 0:49 / /run rw,nosuid,nodev - tmpfs tmpfs rw,mode=755
57 50 0:51 / /tmp rw,nosuid,nodev - tmpfs tmpfs rw
58 50 0:38 / /platform ro,relatime - virtiofs smolvm1 rw
59 50 254:16 / /storage rw,relatime - ext4 /dev/vdb rw
61 50 254:16 /workspace /mnt/platform rw,relatime - ext4 /dev/vdb rw
62 50 0:52 / /etc/host\\040name rw - tmpfs tmpfs rw
";

    fn carried(table: &str, disk: &str) -> Result<Vec<String>, String> {
        plan_mounts(&parse_mountinfo(table), Path::new(disk)).map(|plan| {
            plan.carried
                .iter()
                .map(|point| point.display().to_string())
                .collect()
        })
    }

    // TEST_SCENARIO: the image keeps every mount smolvm made for it — /proc, /dev, /sys, /run, the share, a bind over a file — and the disk. It loses /storage, which is the whole disk and holds the upper layer smolvm keeps. Carried, it would be a persistent name for the root of every image this machine ran. A mount on top of another is not named, because it moves with the one under it.
    #[test]
    fn the_fresh_root_keeps_every_mount_but_the_other_names_of_the_disk() {
        assert_eq!(
            carried(SMOLVM_TABLE, "/mnt/platform").unwrap(),
            [
                "/proc",
                "/dev",
                "/sys",
                "/run",
                "/platform",
                "/mnt/platform",
                "/etc/host name"
            ]
        );
        let plan = plan_mounts(&parse_mountinfo(SMOLVM_TABLE), Path::new("/mnt/platform")).unwrap();
        assert_eq!(plan.left_behind, [Path::new("/storage")]);
    }

    // TEST_SCENARIO: smolvm's /tmp is a tmpfs, and platform-init mounts its own there with the other scratch folders. smolvm's is neither carried onto the platform's root nor left behind, since a left-behind mount's directory is removed and /tmp is where the platform's tmpfs goes.
    #[test]
    fn smolvms_tmp_gives_way_to_the_platforms_own() {
        let plan = plan_mounts(&parse_mountinfo(SMOLVM_TABLE), Path::new("/mnt/platform")).unwrap();
        assert!(!plan.carried.contains(&PathBuf::from("/tmp")));
        assert!(!plan.left_behind.contains(&PathBuf::from("/tmp")));
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

    // TEST_SCENARIO: a home moved here from a container has ~/.cache as a link to /tmp/agent-cache, and a home from an earlier machine boot may hold a full ~/.npm on the disk. Both are moved aside so an empty tmpfs can go over the path, and the background delete reclaims them by name, without following the link and without touching anything else in the home. An empty cache directory, or none, is mounted over as it is.
    #[test]
    fn an_old_home_cache_is_moved_aside_and_deleted() {
        let home = TempDir::new("home");
        let target = TempDir::new("agent-cache");
        fs::write(target.path().join("kept"), b"x").unwrap();
        std::os::unix::fs::symlink(target.path(), home.path().join(".cache")).unwrap();
        fs::create_dir_all(home.path().join(".npm/_cacache")).unwrap();
        fs::write(home.path().join(".npm/_cacache/blob"), b"x").unwrap();
        fs::create_dir(home.path().join("work")).unwrap();
        fs::write(home.path().join(".cache.notes"), b"x").unwrap();

        let link = discard_cache(&home.path().join(".cache"), 7)
            .unwrap()
            .unwrap();
        assert_eq!(link, home.path().join(".cache.discarded.7"));
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        let npm = discard_cache(&home.path().join(".npm"), 7)
            .unwrap()
            .unwrap();
        assert!(npm.join("_cacache/blob").is_file());
        assert!(fs::symlink_metadata(home.path().join(".cache")).is_err());

        fs::create_dir(home.path().join(".cache")).unwrap();
        assert_eq!(discard_cache(&home.path().join(".cache"), 8).unwrap(), None);
        assert_eq!(
            discard_cache(&home.path().join(".absent"), 8).unwrap(),
            None
        );

        purge_discarded(home.path());
        assert!(fs::symlink_metadata(&link).is_err());
        assert!(!npm.exists());
        assert!(
            target.path().join("kept").is_file(),
            "the link was not followed"
        );
        assert!(home.path().join("work").is_dir());
        assert!(home.path().join(".cache.notes").is_file());
        assert!(home.path().join(".cache").is_dir());
    }

    // TEST_SCENARIO: when the kernel refused to move the disk, it stays at the path the VMM gave it. That path is then the one name the platform's root keeps, and /storage still goes.
    #[test]
    fn a_disk_left_where_the_vmm_put_it_is_still_the_one_carried() {
        let table = SMOLVM_TABLE.replace(" /mnt/platform ", " /workspace ");
        let points = carried(&table, "/workspace").unwrap();
        assert!(points.contains(&"/workspace".to_string()));
        assert!(!points.contains(&"/storage".to_string()));
    }

    // TEST_SCENARIO: a disk that is not a mount directly on the root means the table is not what this code expects. Booting anyway would lose the disk with the old root, so the plan fails and the boot with it.
    #[test]
    fn a_disk_that_is_not_on_the_root_fails_the_plan() {
        assert!(carried(SMOLVM_TABLE, "/home/agent").is_err());
        assert!(carried("", "/mnt/platform").is_err());
    }

    // TEST_SCENARIO: something mounted over the root hides the root below it. The mounts that count are the ones on the topmost root, which the kernel lists last.
    #[test]
    fn the_topmost_root_is_the_one_planned_from() {
        let table = format!(
            "{SMOLVM_TABLE}70 50 0:60 / / rw - overlay overlay rw\n71 70 0:61 / /proc rw - proc proc rw\n72 70 254:16 /workspace /mnt/platform rw - ext4 /dev/vdb rw\n"
        );
        assert_eq!(
            carried(&table, "/mnt/platform").unwrap(),
            ["/proc", "/mnt/platform"]
        );
    }

    #[test]
    fn mount_paths_are_decoded() {
        assert_eq!(
            unescape_mount_path(r"/a\040b\011c\134d\012"),
            Path::new("/a b\tc\\d\n")
        );
        assert_eq!(
            unescape_mount_path(r"/not\08escape\"),
            Path::new(r"/not\08escape\")
        );
    }

    // TEST_SCENARIO: the platform root's layers are on the disk, in the platform's own namespace, so the image's home cannot collide with them. Its lower layer is "/" — the image as smolvm mounted it — and nothing else. The kept upper layer is not at `rootfs/upper`, which a platform-init from before kept roots empties on every boot, so a rollback never leaves an upper that the image record beside it does not describe.
    #[test]
    fn the_platforms_root_stacks_a_disk_upper_over_the_image() {
        let layers = FreshRoot::on(Path::new(guest::DISK_PATH));
        assert_eq!(
            layers.merged,
            Path::new("/mnt/platform/system/rootfs/merged")
        );
        assert_eq!(layers.image, layers.upper.with_file_name("image"));
        assert_ne!(layers.upper, layers.legacy_upper);
        assert_eq!(
            layers.options().unwrap().to_str().unwrap(),
            "lowerdir=/,upperdir=/mnt/platform/system/rootfs/kept/upper,workdir=/mnt/platform/system/rootfs/work,index=off,redirect_dir=off,metacopy=off,xino=off,uuid=off"
        );
    }

    // TEST_SCENARIO: overlayfs splits its options on commas and its lower layers on colons, so a disk path holding either would name other layers than the ones meant. That is refused, not mounted.
    #[test]
    fn a_layer_path_overlayfs_would_misread_is_refused() {
        assert!(FreshRoot::on(Path::new("/mnt/a,b")).options().is_err());
        assert!(FreshRoot::on(Path::new("/mnt/a:b")).options().is_err());
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

    // TEST_SCENARIO: every disk leaves its first boot marked with the layout it is in, and a disk from before the mark existed is marked on its next boot, since it can only be in the one layout there has been. A disk already marked with this layout boots without being written.
    #[test]
    fn a_disk_is_marked_with_its_layout_once() {
        let disk = TempDir::new("disk");
        let mark = guest::system_store(disk.path(), guest::LAYOUT_FILE);

        assert_eq!(
            mark_layout(disk.path()).unwrap(),
            Some(guest::LAYOUT_VERSION)
        );
        assert_eq!(
            fs::read_to_string(&mark).unwrap(),
            format!("{}\n", guest::LAYOUT_VERSION)
        );
        assert_eq!(mark_layout(disk.path()).unwrap(), None);
    }

    // TEST_SCENARIO: a runner rolled back past a layout change boots disks that a newer platform-init already moved on, and this one would seed or mount them by names they no longer use. A newer layout fails the boot and says why; so does a mark this platform-init cannot read, rather than being taken for any layout and overwritten.
    #[test]
    fn a_layout_this_platform_init_does_not_know_fails_the_boot() {
        let disk = TempDir::new("disk");
        let mark = guest::system_store(disk.path(), guest::LAYOUT_FILE);
        fs::create_dir_all(mark.parent().unwrap()).unwrap();

        fs::write(&mark, format!("{}\n", guest::LAYOUT_VERSION + 1)).unwrap();
        let newer = mark_layout(disk.path()).unwrap_err().to_string();
        assert!(newer.contains("a newer platform-init wrote"), "{newer}");

        for unreadable in ["", "0", "one", "-1"] {
            fs::write(&mark, unreadable).unwrap();
            assert!(
                mark_layout(disk.path()).is_err(),
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

    // TEST_SCENARIO: the entrypoint is started with argv exactly as the image names it, argv[0] included although the binary was found on PATH, and with the trust cache named in its environment. platform-init blocks the signals it forwards, and Rust ignores SIGPIPE; the entrypoint must inherit neither, or a shell pipeline in the image is never ended by a closed pipe and the entrypoint never sees SIGTERM.
    #[test]
    fn the_entrypoint_starts_with_the_images_argv_and_a_clean_signal_state() {
        let binary = look_path(OsStr::new("sh"), None).unwrap();
        let command = [
            OsString::from("image-sh"),
            OsString::from("-c"),
            OsString::from(
                r#"echo "$0 $PLATFORM_TRUST_CACHE"; grep -E '^Sig(Blk|Ign):' /proc/self/status"#,
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
                Some(Path::new("/var/cache/platform/trust")),
            )
            .output()
            .unwrap()
        });
        let output = String::from_utf8(thread.join().unwrap().stdout).unwrap();
        let mut lines = output.lines();
        assert_eq!(lines.next(), Some("image-sh /var/cache/platform/trust"));
        for line in lines {
            let mask = u64::from_str_radix(line.split_whitespace().nth(1).unwrap(), 16).unwrap();
            assert_eq!(mask, 0, "the entrypoint inherited {line}");
        }
    }

    #[test]
    fn exit_statuses_read_like_a_shells() {
        assert_eq!(exit_code(3 << 8), 3);
        assert_eq!(exit_description(3 << 8), "exited with status 3");
        assert_eq!(exit_code(libc::SIGKILL), 137);
        assert_eq!(exit_description(libc::SIGKILL), "was killed by signal 9");
        assert_eq!(exit_code(NOT_STARTED), 127);
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

    // TEST_SCENARIO: the cold cache is read from the root cgroup's memory.stat, where `inactive_file` sits beside `file`, `active_file` and `inactive_anon`, all byte counts. Picking a neighbour would reclaim the wrong amount every minute — anonymous memory the guest cannot drop, or the active cache the agent is using.
    #[test]
    fn the_cold_cache_is_the_inactive_file_count() {
        let stat = "anon 4096\nfile 1289818112\ninactive_anon 0\nactive_anon 4096\ninactive_file 1283219456\nactive_file 2838528\n";
        assert_eq!(inactive_file(stat), Some(1283219456));
        assert_eq!(inactive_file("file 1\nactive_file 1\n"), None);
    }
}
