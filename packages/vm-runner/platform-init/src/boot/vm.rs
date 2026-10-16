use std::io::Read;
use std::os::unix::process::CommandExt;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use smolvm_protocol::{error_codes, AgentRequest, AgentResponse, Envelope};

use super::*;

// UNIT_BOUNDARY_DESCRIPTION: the first stage, which is /sbin/platform-init in the agent rootfs and so part of the runtime rather than the runner release. It mounts the share, which holds the release's platform-init, at guest::STAGE0_SHARE and executes that, keeping init.krun's environment, so the guest always boots the platform-init of the release that wrote its share. The share is the boot mount the runner names at guest::SHARE_PATH.
pub fn stage0() -> ! {
    let Some(share) = boot_mounts()
        .into_iter()
        .find(|mount| mount.target == Path::new(guest::SHARE_PATH))
    else {
        fatal!("the VMM names no share at {}", guest::SHARE_PATH);
    };
    let at = Path::new(guest::STAGE0_SHARE);
    if let Err(e) = mount_virtiofs(&share.tag, at, true) {
        fatal!("mounting the share {} at {}: {e}", share.tag, at.display());
    }
    let init = at.join("init");
    let e = std::process::Command::new(&init).exec();
    fatal!("executing {}: {e}", init.display())
}

// UNIT_BOUNDARY_DESCRIPTION: one virtiofs share the VMM attached, as smolvm's launcher names it in the guest's environment: SMOLVM_MOUNT_COUNT, and SMOLVM_MOUNT_<i> as `tag:target:ro|rw|staged`. A tag never holds a colon; a target may, so the mode is split off the end.
#[derive(Debug, PartialEq)]
pub struct BootMount {
    pub tag: String,
    pub target: PathBuf,
    pub read_only: bool,
}

fn parse_boot_mount(value: &str) -> Option<BootMount> {
    let (tag, rest) = value.split_once(':')?;
    let (target, mode) = rest.rsplit_once(':')?;
    (!tag.is_empty() && target.starts_with('/')).then(|| BootMount {
        tag: tag.to_string(),
        target: PathBuf::from(target),
        read_only: mode != "rw",
    })
}

pub fn boot_mounts() -> Vec<BootMount> {
    let count = std::env::var("SMOLVM_MOUNT_COUNT")
        .ok()
        .and_then(|count| count.parse::<usize>().ok())
        .unwrap_or(0);
    (0..count)
        .filter_map(|i| std::env::var(format!("SMOLVM_MOUNT_{i}")).ok())
        .filter_map(|value| parse_boot_mount(&value))
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: mounts a virtiofs share, with DAX where the VMM gave the share a window, so a large binary run from it is mapped from the host's page cache rather than copied into the guest. A share without a window refuses the option, and is mounted without it. Each mount is a console line, `virtiofs mount active: <tag> at <target>, dax=<bool>`, which is how a host tells whether its machines' mounts are DAX-mapped.
fn mount_virtiofs(tag: &str, target: &Path, read_only: bool) -> io::Result<()> {
    mkdir_all(target)?;
    let flags = if read_only { libc::MS_RDONLY } else { 0 };
    let dax = mount_typed(tag, target, "virtiofs", flags, "dax").is_ok();
    if !dax {
        mount_typed(tag, target, "virtiofs", flags, "")?;
    }
    announce(&format!(
        "virtiofs mount active: {tag} at {}, dax={dax}",
        target.display()
    ));
    Ok(())
}

pub fn mount_typed(
    source: &str,
    target: &Path,
    fstype: &str,
    flags: libc::c_ulong,
    data: &str,
) -> io::Result<()> {
    let source = cstring(OsStr::new(source))?;
    let target = cstring(target.as_os_str())?;
    let fstype = cstring(OsStr::new(fstype))?;
    let data = cstring(OsStr::new(data))?;
    // SAFETY: every argument is a NUL-terminated string that outlives the call, and each filesystem here reads its data as a string.
    let rc = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            fstype.as_ptr(),
            flags,
            data.as_ptr().cast(),
        )
    };
    succeeded(rc == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: where the VM's own mounts are made before the image's root exists. The agent rootfs is read-only; init.krun leaves /run an empty directory in it, and a tmpfs there takes the mount points. All of it stays with the old root.
const STAGE: &str = "/run/platform-boot";

// UNIT_BOUNDARY_DESCRIPTION: what the VM gives the image's root: the platform's part of the storage disk, the image tree as smolvm shares it, every other share with the path it belongs at in the root, and the launch record from the share.
pub struct Machine {
    pub disk: PathBuf,
    pub image: PathBuf,
    pub shares: Vec<(PathBuf, PathBuf)>,
    pub launch: guest::Launch,
    pub hostname: Option<String>,
    pub dns: Option<String>,
}

// UNIT_BOUNDARY_DESCRIPTION: everything smolvm's guest agent and crun did for a machine before its image ran, which nothing else in the guest does now: the process limits and the clock, cgroup controllers for the containers an agent runs, the network the host's stack expects, the storage disk, the shares and the image tree, and the launch record. init.krun has mounted /dev, /proc, /sys and cgroup2 before this runs. A step without which the machine cannot run its image as an agent is fatal.
pub fn prepare() -> Machine {
    if let Err(e) = mount_typed("tmpfs", Path::new("/run"), "tmpfs", 0, "mode=0755") {
        fatal!("mounting a tmpfs at /run: {e}");
    }
    raise_open_files();
    set_clock();
    delegate_cgroups();
    let hostname = std::env::var(smolvm_protocol::guest_env::MACHINE_NAME).ok();
    if let Some(name) = &hostname {
        // SAFETY: the pointer and length name the bytes of a live string.
        if unsafe { libc::sethostname(name.as_ptr().cast(), name.len()) } != 0 {
            logf!(
                "WARNING: naming the guest {name}: {}",
                io::Error::last_os_error()
            );
        }
    }
    let dns = match configure_network() {
        Ok(dns) => dns,
        Err(e) => fatal!("configuring the guest's network: {e}"),
    };
    let disk = mount_storage(&Path::new(STAGE).join("disk"));
    let Some(tag) = std::env::var("SMOLVM_PACKED_LAYERS")
        .ok()
        .and_then(|value| value.split_once(':').map(|(tag, _)| tag.to_string()))
    else {
        fatal!("the VMM shares no image tree (SMOLVM_PACKED_LAYERS)");
    };
    let image = Path::new(STAGE).join("image");
    if let Err(e) = mount_virtiofs(&tag, &image, true) {
        fatal!("mounting the image tree {tag}: {e}");
    }
    let mut shares = vec![(
        PathBuf::from(guest::STAGE0_SHARE),
        PathBuf::from(guest::SHARE_PATH),
    )];
    for share in boot_mounts() {
        if share.target == Path::new(guest::SHARE_PATH) {
            continue;
        }
        let staged = Path::new(STAGE).join("shares").join(&share.tag);
        if let Err(e) = mount_virtiofs(&share.tag, &staged, share.read_only) {
            fatal!(
                "mounting the share {} for {}: {e}",
                share.tag,
                share.target.display()
            );
        }
        shares.push((staged, share.target));
    }
    let path = Path::new(guest::STAGE0_SHARE).join(guest::LAUNCH_FILE);
    let launch = match fs::read(&path)
        .map_err(|e| e.to_string())
        .and_then(|bytes| {
            serde_json::from_slice::<guest::Launch>(&bytes).map_err(|e| e.to_string())
        }) {
        Ok(launch) if !launch.command.is_empty() => launch,
        Ok(_) => fatal!("{} names no command", path.display()),
        Err(e) => fatal!("reading {}: {e}", path.display()),
    };
    Machine {
        disk,
        image,
        shares,
        launch,
        hostname,
        dns,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the open-file limit every process of the guest inherits, the one smolvm's guest agent set: language servers and builds of large trees keep many files open, and the kernel's default of 1024 fails them.
const OPEN_FILES: libc::rlim_t = 1 << 20;

fn raise_open_files() {
    let limit = libc::rlimit {
        rlim_cur: OPEN_FILES,
        rlim_max: OPEN_FILES,
    };
    // SAFETY: setrlimit reads the struct it is given and nothing else.
    if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) } != 0 {
        logf!(
            "WARNING: raising the open-file limit: {}",
            io::Error::last_os_error()
        );
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a guest whose clock reads before 2020 has none to speak of (no RTC the kernel trusts), and certificates and caches judged against it fail. smolvm hands the host's time at boot in nanoseconds, which is set then.
const SANE_EPOCH_SECS: i64 = 1_577_836_800;

fn set_clock() {
    let mut now = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: clock_gettime writes the struct it is given.
    unsafe { libc::clock_gettime(libc::CLOCK_REALTIME, &mut now) };
    if now.tv_sec >= SANE_EPOCH_SECS {
        return;
    }
    let Some(host) = std::env::var(smolvm_protocol::guest_env::HOST_TIME_NS)
        .ok()
        .and_then(|ns| ns.parse::<i64>().ok())
    else {
        return;
    };
    let time = libc::timespec {
        tv_sec: host / 1_000_000_000,
        tv_nsec: host % 1_000_000_000,
    };
    // SAFETY: clock_settime reads the struct it is given.
    if unsafe { libc::clock_settime(libc::CLOCK_REALTIME, &time) } != 0 {
        logf!("WARNING: setting the clock: {}", io::Error::last_os_error());
    }
}

// UNIT_BOUNDARY_DESCRIPTION: hands every controller the root cgroup has to its children, so a container runtime the agent starts (docker, k3s) can limit what it runs. The root cgroup is exempt from the rule that a cgroup with processes cannot delegate, so this works while the guest's processes stay in it.
fn delegate_cgroups() {
    let root = Path::new("/sys/fs/cgroup");
    let Ok(controllers) = fs::read_to_string(root.join("cgroup.controllers")) else {
        return;
    };
    let enable: Vec<_> = controllers
        .split_whitespace()
        .map(|controller| format!("+{controller}"))
        .collect();
    if let Err(e) = fs::write(root.join("cgroup.subtree_control"), enable.join(" ")) {
        logf!("WARNING: delegating the cgroup controllers ({e}); containers in the guest run without limits");
    }
}

// UNIT_BOUNDARY_DESCRIPTION: programs eth0 from SMOLVM_NETWORK_*, which is how smolvm's host stack and its guest agent agree on the guest's address: a static address and default route, IPv6 too when all three of its variables are set, and the resolver the host names, which is written into the image's root later. The agent rootfs's busybox `ip` does the work, before the root moves to the image, which may have no `ip` at all. A boot without the backend variable has no network to configure.
fn configure_network() -> io::Result<Option<String>> {
    let var = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    if var("SMOLVM_NETWORK_BACKEND").is_none() {
        return Ok(None);
    }
    let need = |name: &str| var(name).ok_or_else(|| io::Error::other(format!("{name} is not set")));
    let (ip, gateway, prefix, mac) = (
        need("SMOLVM_NETWORK_GUEST_IP")?,
        need("SMOLVM_NETWORK_GATEWAY")?,
        need("SMOLVM_NETWORK_PREFIX_LEN")?,
        need("SMOLVM_NETWORK_GUEST_MAC")?,
    );
    let ip_cmd = |args: &[&str]| -> io::Result<()> {
        let out = std::process::Command::new("/sbin/ip").args(args).output()?;
        if out.status.success() {
            Ok(())
        } else {
            Err(io::Error::other(format!(
                "ip {}: {}",
                args.join(" "),
                String::from_utf8_lossy(&out.stderr).trim()
            )))
        }
    };
    ip_cmd(&["link", "set", "lo", "up"])?;
    ip_cmd(&["link", "set", "eth0", "address", &mac, "mtu", "1500", "up"])?;
    ip_cmd(&["addr", "add", &format!("{ip}/{prefix}"), "dev", "eth0"])?;
    ip_cmd(&["route", "add", "default", "via", &gateway])?;
    if let (Some(ip6), Some(gateway6), Some(prefix6)) = (
        var("SMOLVM_NETWORK_GUEST_IP6"),
        var("SMOLVM_NETWORK_GATEWAY6"),
        var("SMOLVM_NETWORK_PREFIX_LEN6"),
    ) {
        ip_cmd(&[
            "-6",
            "addr",
            "add",
            &format!("{ip6}/{prefix6}"),
            "dev",
            "eth0",
        ])?;
        ip_cmd(&["-6", "route", "add", "default", "via", &gateway6])?;
    }
    Ok(var("SMOLVM_NETWORK_DNS"))
}

// UNIT_BOUNDARY_DESCRIPTION: writes the image root's resolver and, when the image has none, its hosts file. The resolver is the host stack's, which is the only one a machine may reach, so it replaces whatever the image shipped, a link into a /run the guest does not have included.
pub fn name_resolution(root: &Path, machine: &Machine) {
    if let Some(dns) = &machine.dns {
        let resolv = root.join("etc/resolv.conf");
        let _ = fs::remove_file(&resolv);
        if let Err(e) = fs::write(&resolv, format!("nameserver {dns}\n")) {
            logf!(
                "WARNING: writing {} ({e}); the guest resolves no names",
                resolv.display()
            );
        }
    }
    let hosts = root.join("etc/hosts");
    if fs::symlink_metadata(&hosts).is_err() {
        let name = machine.hostname.as_deref().unwrap_or("localhost");
        let _ = fs::write(
            &hosts,
            format!("127.0.0.1\tlocalhost\n::1\tlocalhost\n127.0.1.1\t{name}\n"),
        );
    }
}

const STORAGE_DEVICE: &str = "/dev/vda";

// UNIT_BOUNDARY_DESCRIPTION: where btrfs and ext4 keep their magic numbers: btrfs's primary superblock is 64 KiB into the disk with `_BHRfS_M` 64 bytes into it, ext4's superblock 1024 bytes in with 0xEF53 56 bytes into it.
fn magic_at(device: &str, offset: u64, magic: &[u8]) -> bool {
    use std::os::unix::fs::FileExt;
    let mut read = vec![0; magic.len()];
    File::open(device)
        .and_then(|disk| disk.read_exact_at(&mut read, offset))
        .is_ok_and(|()| read == magic)
}

// UNIT_BOUNDARY_DESCRIPTION: mounts the storage disk, which the runner formats before the first boot: btrfs compressed with zstd level 1 and grown online to its disk, or the ext4 of an older machine, checked and grown before the mount. A disk with neither filesystem is never formatted here, since the only disk that has none is one whose filesystem was lost, and formatting it would erase what is left; the boot stops with the reason on the console. The platform's part of the disk is its DISK_ROOT_DIR, made on a disk's first boot.
fn mount_storage(target: &Path) -> PathBuf {
    if let Err(e) = mkdir_all(target) {
        fatal!("creating {}: {e}", target.display());
    }
    if magic_at(STORAGE_DEVICE, 0x1_0040, b"_BHRfS_M") {
        if let Err(e) = mount_typed(
            STORAGE_DEVICE,
            target,
            "btrfs",
            libc::MS_NOATIME,
            "compress=zstd:1",
        ) {
            fatal!("mounting the storage disk's btrfs: {e}; the disk is kept as it is");
        }
        if let Err(e) = grow_btrfs(target) {
            logf!("WARNING: growing btrfs to the disk ({e}); it keeps the size it had");
        }
    } else if magic_at(STORAGE_DEVICE, 1024 + 56, &[0x53, 0xEF]) {
        check_ext4();
        match std::process::Command::new("/usr/sbin/resize2fs")
            .arg(STORAGE_DEVICE)
            .output()
        {
            Ok(out) if !out.status.success() => logf!(
                "WARNING: growing ext4 to the disk: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ),
            Err(e) => logf!("WARNING: growing ext4 to the disk: {e}"),
            Ok(_) => {}
        }
        if let Err(e) = mount_typed(STORAGE_DEVICE, target, "ext4", libc::MS_NOATIME, "") {
            fatal!("mounting the storage disk's ext4: {e}; the disk is kept as it is");
        }
    } else {
        fatal!("the storage disk holds neither btrfs nor ext4, or could not be read; refusing to boot rather than format it, so what it holds is kept");
    }
    let root = target.join(guest::DISK_ROOT_DIR);
    if let Err(e) = mkdir_all(&root) {
        fatal!("creating {}: {e}", root.display());
    }
    root
}

fn grow_btrfs(mount: &Path) -> io::Result<()> {
    // UNIT_BOUNDARY_DESCRIPTION: struct btrfs_ioctl_vol_args; "max" grows device 1, the disk's only one, to the end of the disk, and is a no-op when it already fills it.
    #[repr(C)]
    struct VolArgs {
        fd: i64,
        name: [u8; 4088],
    }
    let mut args = VolArgs {
        fd: 0,
        name: [0; 4088],
    };
    args.name[..3].copy_from_slice(b"max");
    let dir = File::open(mount)?;
    // SAFETY: BTRFS_IOC_RESIZE, _IOW(0x94, 3, struct btrfs_ioctl_vol_args), on an open directory of the mount, with `args` alive for the call.
    succeeded(unsafe { libc::ioctl(dir.as_raw_fd(), libc::_IOW::<VolArgs>(0x94, 3), &args) } == 0)
}

// UNIT_BOUNDARY_DESCRIPTION: e2fsck's passes, from least to most invasive: a preen returns at once on a clean filesystem and fixes what is safe to fix unattended; what it leaves gets a full repair, then one that also rebuilds directories. Exit codes 0 to 3 mean clean or repaired; 4 means errors are left, which escalates; anything else, or a pass killed by a signal, stops the boot with the disk as it is.
const FSCK_PASSES: [&[&str]; 3] = [&["-p"], &["-f", "-y"], &["-f", "-y", "-D"]];

fn check_ext4() {
    for (i, args) in FSCK_PASSES.iter().enumerate() {
        let out = match std::process::Command::new("/sbin/e2fsck")
            .args(*args)
            .arg(STORAGE_DEVICE)
            .output()
        {
            Ok(out) => out,
            Err(e) => fatal!("running e2fsck: {e}; refusing to mount a disk that may be damaged"),
        };
        let said = String::from_utf8_lossy(&out.stdout).trim().to_string();
        match out.status.code() {
            Some(0) => return,
            Some(1..=3) => {
                announce(&format!("storage: e2fsck {} repaired the filesystem: {said}", args.join(" ")));
                return;
            }
            Some(code) if code & !3 == 4 && i + 1 < FSCK_PASSES.len() => {
                announce(&format!("storage: e2fsck {} left errors; trying a fuller repair", args.join(" ")));
            }
            code => fatal!(
                "storage: e2fsck {} (exit {code:?}): {said}; refusing to mount, and the disk is kept as it is",
                args.join(" ")
            ),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the guest agent protocol of smolvm's host side, as much of it as the runner's machines use: a liveness ping that names what this init can do, the quiesced stop, and onlining RAM the VMM plugged in. Each request is a big-endian u32 length and a JSON body on vsock port 6000, answered the same way, and a connection may carry several. Once it listens, the init rings the host's readiness doorbell, which is what a start waits for; it starts only once the image's root is in place, since the host grows the machine's RAM the moment it is ready, and onlining reads /sys, which moves into that root. A request this init does not serve is answered with an error, never with silence, so the host does not wait out its timeout.
pub fn serve() {
    let listener = match vsock_listener(smolvm_protocol::ports::AGENT_CONTROL) {
        Ok(listener) => listener,
        Err(e) => fatal!("listening for the host on vsock: {e}"),
    };
    std::thread::spawn(move || loop {
        // SAFETY: accept4 writes no address, since none is asked for, and returns a new descriptor or -1.
        let fd = unsafe {
            libc::accept4(
                listener.as_raw_fd(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                libc::SOCK_CLOEXEC,
            )
        };
        if fd < 0 {
            continue;
        }
        // SAFETY: accept4 returned a descriptor nothing else owns.
        let conn = unsafe { File::from_raw_fd(fd) };
        std::thread::spawn(move || answer(conn));
    });
    ring_doorbell();
}

fn vsock_listener(port: u32) -> io::Result<File> {
    // SAFETY: socket(2) takes plain integers and returns a new descriptor or -1.
    let fd = unsafe { libc::socket(libc::AF_VSOCK, libc::SOCK_STREAM | libc::SOCK_CLOEXEC, 0) };
    succeeded(fd >= 0)?;
    // SAFETY: socket returned a descriptor nothing else owns.
    let socket = unsafe { File::from_raw_fd(fd) };
    // SAFETY: an all-zero sockaddr_vm is valid, and every field the kernel reads is set below.
    let mut addr: libc::sockaddr_vm = unsafe { std::mem::zeroed() };
    addr.svm_family = libc::AF_VSOCK as libc::sa_family_t;
    addr.svm_cid = libc::VMADDR_CID_ANY;
    addr.svm_port = port;
    // SAFETY: the address is a live sockaddr_vm of the length given.
    succeeded(
        unsafe {
            libc::bind(
                socket.as_raw_fd(),
                (&addr as *const libc::sockaddr_vm).cast(),
                std::mem::size_of::<libc::sockaddr_vm>() as libc::socklen_t,
            )
        } == 0,
    )?;
    // SAFETY: listen(2) takes the descriptor and a backlog.
    succeeded(unsafe { libc::listen(socket.as_raw_fd(), 16) } == 0)?;
    Ok(socket)
}

// UNIT_BOUNDARY_DESCRIPTION: connects to the host on its readiness port and closes again; the host's accept is the signal. A host that does not listen there finds the guest ready by its ping instead, so a failure here is not one.
fn ring_doorbell() {
    // SAFETY: socket(2) takes plain integers and returns a new descriptor or -1.
    let fd = unsafe { libc::socket(libc::AF_VSOCK, libc::SOCK_STREAM | libc::SOCK_CLOEXEC, 0) };
    if fd < 0 {
        return;
    }
    // SAFETY: socket returned a descriptor nothing else owns; dropping it closes it.
    let socket = unsafe { File::from_raw_fd(fd) };
    // SAFETY: an all-zero sockaddr_vm is valid, and every field the kernel reads is set below.
    let mut addr: libc::sockaddr_vm = unsafe { std::mem::zeroed() };
    addr.svm_family = libc::AF_VSOCK as libc::sa_family_t;
    addr.svm_cid = libc::VMADDR_CID_HOST;
    addr.svm_port = smolvm_protocol::ports::AGENT_READY;
    // SAFETY: the address is a live sockaddr_vm of the length given.
    unsafe {
        libc::connect(
            socket.as_raw_fd(),
            (&addr as *const libc::sockaddr_vm).cast(),
            std::mem::size_of::<libc::sockaddr_vm>() as libc::socklen_t,
        )
    };
}

fn read_frame(conn: &mut File) -> Option<Vec<u8>> {
    let mut len = [0; 4];
    conn.read_exact(&mut len).ok()?;
    let len = u32::from_be_bytes(len);
    if len > smolvm_protocol::MAX_FRAME_SIZE {
        return None;
    }
    let mut body = vec![0; len as usize];
    conn.read_exact(&mut body).ok()?;
    Some(body)
}

fn send(conn: &mut File, response: &AgentResponse) -> io::Result<()> {
    let frame = smolvm_protocol::encode_message(response).map_err(io::Error::other)?;
    conn.write_all(&frame)
}

fn answer(mut conn: File) {
    while let Some(body) = read_frame(&mut conn) {
        let response = match serde_json::from_slice::<Envelope<AgentRequest>>(&body) {
            Ok(request) => respond(request.body, &mut conn),
            Err(e) => AgentResponse::error(
                format!("unreadable request: {e}"),
                error_codes::INVALID_REQUEST,
            ),
        };
        if send(&mut conn, &response).is_err() {
            return;
        }
    }
}

fn respond(request: AgentRequest, conn: &mut File) -> AgentResponse {
    match request {
        AgentRequest::Ping => AgentResponse::Pong {
            version: smolvm_protocol::PROTOCOL_VERSION,
            capabilities: vec![
                smolvm_protocol::QUIESCED_SHUTDOWN_CAPABILITY.to_string(),
                smolvm_protocol::ONLINE_MEMORY_GROWTH_CAPABILITY.to_string(),
            ],
        },
        AgentRequest::OnlineMemory {
            start_address,
            length_bytes,
        } => match online_memory(start_address, length_bytes) {
            Ok(()) => AgentResponse::Ok {
                data: Some(
                    serde_json::json!({"start_address": start_address, "online_bytes": length_bytes}),
                ),
            },
            Err(e) => AgentResponse::error(
                format!("onlining guest RAM: {e}"),
                error_codes::INTERNAL_ERROR,
            ),
        },
        AgentRequest::VmExec {
            command,
            env,
            workdir,
            timeout_ms,
            interactive: false,
            tty: false,
            background: false,
            stdin_data,
        } => exec(
            &command,
            &env,
            workdir.as_deref(),
            timeout_ms.map_or(EXEC_TIMEOUT, Duration::from_millis),
            stdin_data,
        ),
        AgentRequest::Shutdown {
            stop_timeout_secs, ..
        } => quiesce(
            conn,
            stop_timeout_secs.map_or(DEFAULT_STOP_GRACE, Duration::from_secs),
        ),
        other => AgentResponse::error(
            format!("platform-init does not serve {other:?}"),
            error_codes::INVALID_REQUEST,
        ),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the exit statuses of the commands the host runs through the protocol, by pid. The supervisor reaps every child of the init, these too, so its reaper hands a registered pid's status here rather than dropping it (claim_exit), and the command's thread reaps it itself while the supervisor is not reaping. A pid is registered before the lock that registers it is released, so no status is reaped before anyone waits for it.
#[allow(clippy::type_complexity)]
static EXECS: (
    Mutex<std::collections::BTreeMap<libc::pid_t, Option<libc::c_int>>>,
    Condvar,
) = (
    Mutex::new(std::collections::BTreeMap::new()),
    Condvar::new(),
);

// UNIT_BOUNDARY_DESCRIPTION: records a reaped child's status when it is one of the protocol's commands, and says whether it was.
pub fn claim_exit(pid: libc::pid_t, status: libc::c_int) -> bool {
    let (lock, cvar) = &EXECS;
    let mut execs = lock.lock().unwrap_or_else(|e| e.into_inner());
    let Some(slot) = execs.get_mut(&pid) else {
        return false;
    };
    *slot = Some(status);
    cvar.notify_all();
    true
}

// UNIT_BOUNDARY_DESCRIPTION: how long a command the host runs may take when the host names no limit, and how much of its output is kept: the host reads a reply of at most smolvm_protocol::MAX_FRAME_SIZE, and both streams share it.
const EXEC_TIMEOUT: Duration = Duration::from_secs(300);
const EXEC_OUTPUT_MAX: usize = 8 << 20;

// UNIT_BOUNDARY_DESCRIPTION: runs one command for the host, as root in the image's root, with the env it names on top of a default PATH and nothing of the init's own, and answers with its exit code and output once it ends, or once `timeout` has passed and it was killed. Only a non-interactive command is run: operators reach a guest this way (`vm-runner exec`), and nothing in the platform needs a shell into it.
fn exec(
    command: &[String],
    env: &[(String, String)],
    workdir: Option<&str>,
    timeout: Duration,
    stdin: Option<String>,
) -> AgentResponse {
    use std::process::Stdio;
    let Some((program, args)) = command.split_first() else {
        return AgentResponse::error("no command to run", error_codes::INVALID_REQUEST);
    };
    let (lock, cvar) = &EXECS;
    let mut execs = lock.lock().unwrap_or_else(|e| e.into_inner());
    let spawned = std::process::Command::new(program)
        .args(args)
        .env_clear()
        .env("PATH", DEFAULT_PATH)
        .envs(env.iter().map(|(key, value)| (key, value)))
        .current_dir(workdir.unwrap_or("/"))
        .process_group(0)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => {
            return AgentResponse::error(
                format!("starting {program}: {e}"),
                error_codes::INVALID_REQUEST,
            )
        }
    };
    let pid = child.id() as libc::pid_t;
    execs.insert(pid, None);
    drop(execs);
    if let (Some(mut pipe), Some(data)) = (child.stdin.take(), stdin) {
        std::thread::spawn(move || pipe.write_all(data.as_bytes()));
    }
    let collect = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut out = Vec::new();
            if let Some(pipe) = pipe {
                let _ = pipe.take(EXEC_OUTPUT_MAX as u64).read_to_end(&mut out);
            }
            out
        })
    };
    let stdout = collect(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let stderr = collect(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let deadline = Instant::now() + timeout;
    let mut killed = false;
    let mut execs = lock.lock().unwrap_or_else(|e| e.into_inner());
    let status = loop {
        if let Some(Some(status)) = execs.get(&pid) {
            break *status;
        }
        let mut status = 0;
        // SAFETY: waitpid writes the wait status into the one integer it is given.
        if unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) } == pid {
            break status;
        }
        if !killed && Instant::now() >= deadline {
            // SAFETY: kill(2) reads no memory; the pid is not reaped yet, so its group still names the command and what it started, which would otherwise hold the output pipes open.
            unsafe { libc::kill(-pid, libc::SIGKILL) };
            killed = true;
        }
        execs = cvar
            .wait_timeout(execs, Duration::from_millis(20))
            .unwrap_or_else(|e| e.into_inner())
            .0;
    };
    execs.remove(&pid);
    drop(execs);
    let exit_code = if libc::WIFSIGNALED(status) {
        128 + libc::WTERMSIG(status)
    } else {
        libc::WEXITSTATUS(status)
    };
    AgentResponse::Completed {
        exit_code,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the memory blocks a range of guest physical memory covers, which must be whole blocks; more than MAX_MEMORY_BLOCKS at once is refused, as smolvm's guest agent refused it, so a malformed request cannot keep the init busy.
const MAX_MEMORY_BLOCKS: u64 = 8192;

fn memory_blocks(start: u64, length: u64, block: u64) -> io::Result<std::ops::Range<u64>> {
    let whole = block.is_power_of_two()
        && length > 0
        && start.is_multiple_of(block)
        && length.is_multiple_of(block);
    if !whole || length / block > MAX_MEMORY_BLOCKS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("RAM range must cover 1 to {MAX_MEMORY_BLOCKS} whole memory blocks"),
        ));
    }
    let end = start
        .checked_add(length)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "RAM range overflows"))?;
    Ok(start / block..end / block)
}

// UNIT_BOUNDARY_DESCRIPTION: how long onlining waits for the kernel to publish the next memory block before it gives up. virtio-mem adds memory a part at a time, about a GiB, and adds the next part only once the last is online, so the blocks are onlined as they appear rather than all at the end.
const MEMORY_STALL: Duration = Duration::from_secs(30);

fn online_memory(start: u64, length: u64) -> io::Result<()> {
    let sys = Path::new("/sys/devices/system/memory");
    let size = fs::read_to_string(sys.join("block_size_bytes"))?;
    let block = u64::from_str_radix(size.trim().trim_start_matches("0x"), 16)
        .map_err(|_| io::Error::other("unreadable memory block size"))?;
    let blocks = memory_blocks(start, length, block)?;
    let mut deadline = Instant::now() + MEMORY_STALL;
    loop {
        let mut unpublished = false;
        let mut onlined = false;
        for n in blocks.clone() {
            let state = sys.join(format!("memory{n}/state"));
            match fs::read_to_string(&state) {
                Ok(text) if text.trim() == "online" => {}
                Ok(text) if text.trim() == "offline" => {
                    fs::write(&state, "online")?;
                    onlined = true;
                }
                Ok(text) => {
                    return Err(io::Error::other(format!("memory{n} is {}", text.trim())));
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => unpublished = true,
                Err(e) => return Err(e),
            }
        }
        if onlined {
            deadline = Instant::now() + MEMORY_STALL;
            continue;
        }
        if !unpublished {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "the kernel did not publish the requested memory blocks",
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the stop handshake between the protocol thread and the supervisor, which runs on the init's main thread. The protocol thread asks for a stop with SIGTERM to the init, which the supervisor waits for, and waits on this for the supervisor to say the workload is gone and the home is written out.
static STOPPED: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

// UNIT_BOUNDARY_DESCRIPTION: the supervisor's end once the workload has stopped. The init is the guest's PID 1 and may not exit, since the kernel then panics; the host takes the VMM down once the stop is confirmed.
pub fn stopped() -> ! {
    let (lock, cvar) = &STOPPED;
    *lock.lock().unwrap_or_else(|e| e.into_inner()) = true;
    cvar.notify_all();
    loop {
        std::thread::park();
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the grace a stop gives the workload when the host names none, the same as smolvm's guest agent gave it.
const DEFAULT_STOP_GRACE: Duration = Duration::from_secs(10);
// UNIT_BOUNDARY_DESCRIPTION: how often a stop tells the host it is still at work. The host resets its idle deadline on every progress frame, so a workload that takes its whole grace does not read as a guest that hung.
const PROGRESS_EVERY: Duration = Duration::from_secs(1);
// UNIT_BOUNDARY_DESCRIPTION: what the supervisor gets, after every process was killed, to write the home out and say so.
const AFTER_KILL: Duration = Duration::from_secs(5);
// UNIT_BOUNDARY_DESCRIPTION: FIFREEZE, _IOWR('X', 119, int), the same on every architecture a guest runs; the libc crate does not export it.
const FIFREEZE: libc::c_ulong = 0xC004_5877;

// UNIT_BOUNDARY_DESCRIPTION: the quiesced stop. The workload gets SIGTERM and `grace`, then every process but the init gets SIGKILL; once the supervisor has written the home out, the storage disk is synced and frozen, so nothing the agent wrote can be lost when the host kills the VMM, and only then is the stop confirmed. A disk that will not freeze is not confirmed: the host then powers the guest off, after the sync.
fn quiesce(conn: &mut File, grace: Duration) -> AgentResponse {
    // SAFETY: kill(2) on the init's own pid sends it a signal and reads no memory.
    unsafe { libc::kill(libc::getpid(), libc::SIGTERM) };
    let started = Instant::now();
    let mut killed = false;
    let (lock, cvar) = &STOPPED;
    let mut stopped = lock.lock().unwrap_or_else(|e| e.into_inner());
    while !*stopped {
        if !killed && started.elapsed() >= grace {
            // SAFETY: kill(-1, SIGKILL) from PID 1 ends every other process and reads no memory.
            unsafe { libc::kill(-1, libc::SIGKILL) };
            killed = true;
        }
        if killed && started.elapsed() >= grace + AFTER_KILL {
            announce("the supervisor did not finish the stop; freezing the disk anyway");
            break;
        }
        stopped = cvar
            .wait_timeout(stopped, PROGRESS_EVERY)
            .unwrap_or_else(|e| e.into_inner())
            .0;
        let progress = AgentResponse::Progress {
            message: "stopping the workload".into(),
            percent: None,
            layer: None,
        };
        if send(conn, &progress).is_err() {
            break;
        }
    }
    drop(stopped);
    // SAFETY: sync(2) takes no arguments.
    unsafe { libc::sync() };
    let frozen = File::open(guest::AGENT_HOME).and_then(|home| {
        // SAFETY: FIFREEZE takes no pointed-to payload, and `home` keeps its descriptor open for the call.
        succeeded(unsafe { libc::ioctl(home.as_raw_fd(), FIFREEZE as _, 0) } == 0)
    });
    match frozen {
        Ok(()) => AgentResponse::Ok {
            data: Some(serde_json::json!({"filesystems_quiesced": true})),
        },
        Err(e) => AgentResponse::error(
            format!("freezing the storage disk: {e}"),
            error_codes::INTERNAL_ERROR,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: the shares reach the guest as smolvm's launcher names them, `tag:target:mode`. A target is any absolute path, a colon included, and anything but `rw` is read-only, so a share is never writable by a misread.
    #[test]
    fn boot_mounts_are_read_as_the_launcher_writes_them() {
        assert_eq!(
            parse_boot_mount("smolvm0:/platform:ro"),
            Some(BootMount {
                tag: "smolvm0".into(),
                target: "/platform".into(),
                read_only: true
            })
        );
        assert_eq!(
            parse_boot_mount("smolvm1:/opt/a:b:rw"),
            Some(BootMount {
                tag: "smolvm1".into(),
                target: "/opt/a:b".into(),
                read_only: false
            })
        );
        assert!(parse_boot_mount("smolvm2:/x:staged").unwrap().read_only);
        assert_eq!(parse_boot_mount("smolvm3:relative:ro"), None);
        assert_eq!(parse_boot_mount("nonsense"), None);
    }

    // TEST_SCENARIO: the host grows RAM in whole memory blocks; a range that is not, or that would keep the init onlining for a long time, is refused rather than half done.
    #[test]
    fn memory_ranges_cover_whole_blocks_only() {
        assert_eq!(memory_blocks(1024, 512, 128).unwrap(), 8..12);
        for (start, length, block) in [
            (0, 0, 128),
            (1, 128, 128),
            (0, 129, 128),
            (0, 128, 3),
            (u64::MAX - 127, 128, 128),
            (0, 8193 * 128, 128),
        ] {
            assert!(
                memory_blocks(start, length, block).is_err(),
                "{start} {length} {block}"
            );
        }
    }

    // TEST_SCENARIO: an operator's command runs to its end and answers with its exit code and both streams, with the env it was given and none of the init's; one that outlives its limit is killed and says so, rather than holding the protocol thread.
    #[test]
    fn an_exec_answers_with_what_the_command_did() {
        let run = |script: &str, timeout_ms: u64| {
            let mut conn = File::open("/dev/null").unwrap();
            respond(
                AgentRequest::VmExec {
                    command: vec!["/bin/sh".into(), "-c".into(), script.into()],
                    env: vec![("GIVEN".into(), "yes".into())],
                    workdir: Some("/".into()),
                    timeout_ms: Some(timeout_ms),
                    interactive: false,
                    tty: false,
                    background: false,
                    stdin_data: None,
                },
                &mut conn,
            )
        };
        let AgentResponse::Completed {
            exit_code,
            stdout,
            stderr,
        } = run(
            "echo \"$GIVEN ${CARGO:-clean} $(pwd)\"; echo err >&2; exit 3",
            10_000,
        )
        else {
            panic!("no completion");
        };
        assert_eq!(
            (exit_code, stdout, stderr),
            (3, b"yes clean /\n".to_vec(), b"err\n".to_vec())
        );
        let AgentResponse::Completed { exit_code, .. } = run("sleep 10", 100) else {
            panic!("no completion");
        };
        assert_eq!(exit_code, 128 + libc::SIGKILL);
    }

    // TEST_SCENARIO: the host checks a ping's capabilities before it asks for a quiesced stop or for RAM to be onlined; without them it refuses the stop and leaves the VMM running, or never grows the machine.
    #[test]
    fn a_ping_names_what_the_host_needs() {
        let mut conn = File::open("/dev/null").unwrap();
        let response = respond(AgentRequest::Ping, &mut conn);
        let AgentResponse::Pong { capabilities, .. } = response else {
            panic!("{response:?}");
        };
        assert!(capabilities
            .iter()
            .any(|c| c == smolvm_protocol::QUIESCED_SHUTDOWN_CAPABILITY));
        assert!(capabilities
            .iter()
            .any(|c| c == smolvm_protocol::ONLINE_MEMORY_GROWTH_CAPABILITY));
    }
}
