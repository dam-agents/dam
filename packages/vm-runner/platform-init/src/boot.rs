// UNIT_BOUNDARY_DESCRIPTION: the entrypoint of every vm-backend machine. It claims the machine's storage disk, moves the image onto a fresh root, mounts the agent's home from the disk, and execs the image's own entrypoint. It exists so persistence is the platform's to guarantee rather than the image's to implement: the runner supplies this binary, so an image that has never heard of this platform still keeps its agent's home across a stop, and a machine that cannot mount its disk does not boot at all rather than losing its work at the first stop.
use std::ffi::{CString, OsStr, OsString};
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, IntoRawFd};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use crate::guest;

const BOOT_LOG_CAP: u64 = 32 << 20;
const TRUST_CACHE_ENV: &str = "PLATFORM_TRUST_CACHE";
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
        log(format_args!("FATAL: {}", format_args!($($arg)*)));
        std::process::exit(1)
    }};
}

pub fn run(command: Vec<OsString>) -> ! {
    if command.is_empty() {
        fatal!("no image entrypoint to exec; the runner passes it after this binary");
    }

    stop_propagation();
    let root = claim_disk();
    open_boot_log(&root);

    logf!("storage disk claimed at {}", root.display());
    fresh_root(&root);
    bind_ca();
    persist_home(&root);
    offer_trust_cache(&root);

    let binary = match look_path(&command[0], std::env::var_os("PATH")) {
        Ok(binary) => binary,
        Err(e) => fatal!(
            "the image's entrypoint {:?} is not executable in this guest: {e}",
            command[0]
        ),
    };
    let words: Vec<_> = command.iter().map(|word| word.to_string_lossy()).collect();
    logf!("handing off to the image entrypoint [{}]", words.join(" "));
    let e = exec(&binary, &command);
    fatal!("exec {}: {e}", binary.display());
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

// UNIT_BOUNDARY_DESCRIPTION: smolvm roots the image on an overlay whose upper layer sits on the storage disk, is named after the machine, and is kept across every stop and every change of image. Without this, anything the image writes outside HOME persists, and an old image's changes lie over a new one. This mounts a new overlay over that root, with empty upper and work layers on the disk, and pivots into it. The mounts smolvm made move along, except its other binds of the disk, which stay behind with the old root. A failure is fatal: a machine left on the old root would look healthy while it keeps what the platform promises to discard.
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
    for dir in [&layers.upper, &layers.work] {
        if let Err(e) = remove_all(dir) {
            fatal!("clearing the last boot's root at {}: {e}", dir.display());
        }
    }
    for dir in [&layers.upper, &layers.work, &layers.merged] {
        if let Err(e) = mkdir_all(dir) {
            fatal!("creating {}: {e}", dir.display());
        }
    }
    if let Err(e) = layers.mount() {
        if e.raw_os_error() == Some(libc::EINVAL) {
            fatal!(
                "the kernel refused a fresh root over this image ({e}). It does that when the image's root is already two overlays deep, which smolvm builds when it cannot stack the image's layers in one mount. Refusing to boot on a root whose writes would persist"
            );
        }
        fatal!(
            "mounting a fresh root at {}: {e}; refusing to boot on a root whose writes would persist",
            layers.merged.display()
        );
    }
    let put_old = layers.merged.join(OLD_ROOT);
    if let Err(e) = DirBuilder::new().mode(0o700).create(&put_old) {
        fatal!("creating {}: {e}", put_old.display());
    }
    if let Err(e) = pivot_root(&layers.merged, &put_old) {
        fatal!("pivoting into the fresh root: {e}");
    }
    if let Err(e) = std::env::set_current_dir("/") {
        fatal!("entering the fresh root: {e}");
    }
    let old = Path::new("/").join(OLD_ROOT);
    for point in &plan.carried {
        if let Err(e) = carry(&old, point) {
            if point == disk {
                fatal!("moving the storage disk into the fresh root: {e}");
            }
            logf!(
                "WARNING: {} is missing from the fresh root ({e})",
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
        "booting on a fresh root; what the image writes outside {} ends with this boot",
        guest::AGENT_HOME
    );
}

// UNIT_BOUNDARY_DESCRIPTION: where pivot_root puts the root the image came up on, inside the fresh one. It is detached and removed before the image runs.
const OLD_ROOT: &str = ".platform-old-root";

// UNIT_BOUNDARY_DESCRIPTION: the fresh root's layers. The lower layer is "/", the image as smolvm mounted it: overlayfs reads a lower directory without the mounts on top of it, so /proc, /storage and the rest are not part of it. The upper and work layers are on the disk and not in memory, so an agent that writes a lot outside HOME fills its disk and not its RAM.
struct FreshRoot {
    upper: PathBuf,
    work: PathBuf,
    merged: PathBuf,
}

impl FreshRoot {
    fn on(disk: &Path) -> Self {
        let store = guest::system_store(disk, guest::ROOTFS_DIR);
        FreshRoot {
            upper: store.join("upper"),
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
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

#[derive(Debug, PartialEq)]
struct MountEntry {
    id: u64,
    parent: u64,
    device: String,
    point: PathBuf,
}

// UNIT_BOUNDARY_DESCRIPTION: reads /proc/self/mountinfo. A line this cannot read is skipped and does not fail the boot: only the root and the mounts directly on it matter, and a mount missing from the plan is logged when the fresh root lacks it.
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

// UNIT_BOUNDARY_DESCRIPTION: which mounts follow the image onto its fresh root: every mount made directly on the old root, in the order the kernel lists them, except the other binds of the storage disk. Those are smolvm's. /storage holds the whole disk, including the upper layer smolvm keeps, and carrying it would give the image a second, persistent name for everything the fresh root discards. A mount on top of another moves with it, so only the ones on the root are named. The empty directory a left-behind mount stood on is removed too, so no script mistakes it for the disk.
#[derive(Debug, PartialEq)]
struct MountPlan {
    carried: Vec<PathBuf>,
    left_behind: Vec<PathBuf>,
}

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
    let (carried, left_behind): (Vec<_>, Vec<_>) = on_root
        .iter()
        .partition(|entry| entry.point == disk || &entry.device != disk_device);
    let points = |entries: Vec<&&MountEntry>| entries.iter().map(|e| e.point.clone()).collect();
    Ok(MountPlan {
        carried: points(carried),
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
    if unsafe { libc::syscall(libc::SYS_pivot_root, new_root.as_ptr(), put_old.as_ptr()) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn unmount_detached(target: &Path) -> io::Result<()> {
    let target = cstring(target.as_os_str())?;
    // SAFETY: the target is a NUL-terminated string that outlives the call.
    if unsafe { libc::umount2(target.as_ptr(), libc::MNT_DETACH) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a machine's console goes nowhere — stdout and stderr in the guest are both /dev/null — so without this a guest that dies explains itself to nobody. Pointing both at the disk this early puts the whole boot in the record, not only the part after the harness starts. Each boot starts a fresh file and moves the one before it aside, so the history is one boot deep: enough that a machine which died still explains itself on the boot after. Nothing bounds the boot being written, so an agent that logs without pause can still fill its disk and only the boot after it trims.
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
    keep_tail(&previous, BOOT_LOG_CAP);

    let file = match OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o644)
        .open(&path)
    {
        Ok(file) => file,
        Err(e) => {
            logf!("WARNING: opening the boot log ({e}); this machine's output stays discarded");
            return;
        }
    };
    for fd in [libc::STDOUT_FILENO, libc::STDERR_FILENO] {
        // SAFETY: dup3 reads no memory, and the file it duplicates stays open until the end of this function.
        if unsafe { libc::dup3(file.as_raw_fd(), fd, 0) } < 0 {
            let e = io::Error::last_os_error();
            logf!("WARNING: redirecting fd {fd} to the boot log ({e})");
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

// UNIT_BOUNDARY_DESCRIPTION: the image's own boot may keep its extracted CA trust store here rather than rebuilding it every time. The variable is set only on this backend, so an image that honors it caches on a machine and silently does without in a container, where there is no disk to cache on.
fn offer_trust_cache(root: &Path) {
    let trust = guest::system_store(root, "trust");
    if let Err(e) = mkdir_all(&trust) {
        logf!("WARNING: no trust cache directory ({e}); the image re-extracts its CA store every boot");
        return;
    }
    std::env::set_var(TRUST_CACHE_ENV, &trust);
}

// UNIT_BOUNDARY_DESCRIPTION: the first boot seeds the home from whatever the image ships there, so a home an image baked is the home the agent starts from. Every later boot finds the store and mounts it as it is.
fn persist_home(root: &Path) {
    let path = Path::new(guest::AGENT_HOME);
    let store = guest::agent_store(root);
    match needs_seed(&store) {
        Ok(true) => {
            if let Err(e) = seed(path, &store) {
                fatal!("seeding {} onto the disk: {e}", path.display());
            }
        }
        Ok(false) => {}
        Err(e) => fatal!("reading {} on the disk: {e}", store.display()),
    }
    if let Err(e) = mkdir_all(path) {
        fatal!("creating the guest mountpoint {}: {e}", path.display());
    }
    if let Err(e) = mount(&store, path, libc::MS_BIND) {
        fatal!("mounting {} from the disk: {e}", path.display());
    }
    logf!("persisting {}", path.display());
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
    if let Some(parent) = store.parent().filter(|p| !p.as_os_str().is_empty()) {
        mkdir_all(parent)?;
    }
    let staged = with_suffix(store, ".seeding");
    remove_all(&staged)?;
    match fs::symlink_metadata(from) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => mkdir_all(&staged)?,
        Err(e) => return Err(e),
        Ok(source) => {
            if let Err(e) = copy_tree(from, &staged, &source) {
                let _ = remove_all(&staged);
                return Err(e);
            }
        }
    }
    fs::rename(&staged, store)
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

// UNIT_BOUNDARY_DESCRIPTION: replaces this process with the image's entrypoint, with argv exactly as the image names it and the environment this boot has built. Rust starts every program with SIGPIPE ignored, and an ignored signal survives exec, so it is put back to its default first: an entrypoint started any other way than by a container runtime would otherwise never be killed by a closed pipe, which a shell pipeline in the image relies on.
fn exec(binary: &Path, command: &[OsString]) -> io::Error {
    let program = match cstring(binary.as_os_str()) {
        Ok(program) => program,
        Err(e) => return e,
    };
    let argv = match command
        .iter()
        .map(|word| cstring(word))
        .collect::<io::Result<Vec<_>>>()
    {
        Ok(argv) => argv,
        Err(e) => return e,
    };
    let mut pointers: Vec<*const libc::c_char> = argv.iter().map(|word| word.as_ptr()).collect();
    pointers.push(std::ptr::null());
    // SAFETY: signal(2) reads no memory of this process; SIG_DFL is a valid disposition for SIGPIPE.
    unsafe { libc::signal(libc::SIGPIPE, libc::SIG_DFL) };
    // SAFETY: the program and every argv entry are NUL-terminated strings that outlive the call, and the pointer list ends in the null execv(3) requires.
    unsafe { libc::execv(program.as_ptr(), pointers.as_ptr()) };
    io::Error::last_os_error()
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
    if rc == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a close that fails is a write that did not land, so a copy reports it rather than letting the drop discard it.
fn close(file: File) -> io::Result<()> {
    // SAFETY: into_raw_fd hands over the only owner of the descriptor, so nothing closes it twice.
    if unsafe { libc::close(file.into_raw_fd()) } == 0 {
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
    // TEST_OVERVIEW: platform-init is what makes a machine's persistence the platform's promise rather than the image's behaviour. The mounting itself needs a guest, but everything that decides what ends up on the disk — seeding the home from the image exactly once, never leaving a half-copy behind, keeping the boot log readable, which mounts follow the image onto its fresh root, resolving the entrypoint it hands off to — is ordinary file or table work and is covered here.
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

    // TEST_SCENARIO: the image keeps every mount smolvm made for it — /proc, /dev, /sys, the tmpfs mounts, the share, a bind over a file — and the disk. It loses /storage, which is the whole disk and holds the upper layer smolvm keeps. Carried, it would be a persistent name for everything the fresh root discards. A mount on top of another is not named, because it moves with the one under it.
    #[test]
    fn the_fresh_root_keeps_every_mount_but_the_other_names_of_the_disk() {
        assert_eq!(
            carried(SMOLVM_TABLE, "/mnt/platform").unwrap(),
            [
                "/proc",
                "/dev",
                "/sys",
                "/run",
                "/tmp",
                "/platform",
                "/mnt/platform",
                "/etc/host name"
            ]
        );
        let plan = plan_mounts(&parse_mountinfo(SMOLVM_TABLE), Path::new("/mnt/platform")).unwrap();
        assert_eq!(plan.left_behind, [Path::new("/storage")]);
    }

    // TEST_SCENARIO: when the kernel refused to move the disk, it stays at the path the VMM gave it. That path is then the one name the fresh root keeps, and /storage still goes.
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

    // TEST_SCENARIO: the fresh root's layers are on the disk, in the platform's own namespace, so the image's home cannot collide with them. Its lower layer is "/" — the image as smolvm mounted it — and nothing else.
    #[test]
    fn the_fresh_root_stacks_a_disk_upper_over_the_image() {
        let layers = FreshRoot::on(Path::new(guest::DISK_PATH));
        assert_eq!(
            layers.merged,
            Path::new("/mnt/platform/system/rootfs/merged")
        );
        assert_eq!(
            layers.options().unwrap().to_str().unwrap(),
            "lowerdir=/,upperdir=/mnt/platform/system/rootfs/upper,workdir=/mnt/platform/system/rootfs/work"
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
}
