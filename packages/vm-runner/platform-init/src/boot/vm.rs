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

// UNIT_BOUNDARY_DESCRIPTION: where btrfs and ext4 keep their magic numbers: btrfs's primary superblock is 64 KiB into the disk with `_BHRfS_M` 64 bytes into it, ext4's superblock 1024 bytes in with 0xEF53 56 bytes into it. ext4 is read only to say why a disk is refused.
fn magic_at(device: &str, offset: u64, magic: &[u8]) -> bool {
    use std::os::unix::fs::FileExt;
    let mut read = vec![0; magic.len()];
    File::open(device)
        .and_then(|disk| disk.read_exact_at(&mut read, offset))
        .is_ok_and(|()| read == magic)
}

// UNIT_BOUNDARY_DESCRIPTION: what a disk that predates the subvolume layout is told: it is never booted, formatted or rewritten, so what it holds is kept for an operator to recover.
const PREDATES_SUBVOLUMES: &str = "predates the btrfs subvolume layout, which this platform-init alone boots; refusing to boot it, and the disk is kept as it is";

// UNIT_BOUNDARY_DESCRIPTION: the storage disk's mount options. Compressed with zstd level 1, and discarding synchronously: a freed extent is then discarded to the disk file the host claim pays for before the filesystem hands it out again, so a block the storage guard takes for its own can never be one whose backing is still unreturned. Asynchronous discard queues the same discards but lets the allocator reuse a freed extent before its discard runs, which leaves that backing on the claim until something else frees it; the guard's own growth is the caller that raced it.
const STORAGE_DISK_OPTIONS: &str = "compress=zstd:1,discard=sync";

// UNIT_BOUNDARY_DESCRIPTION: mounts the storage disk, which the runner formats as btrfs before the first boot, compressed with zstd level 1 and grown online to its disk, and returns the platform's root on it: the whole filesystem, with AGENT_DIR and SYSTEM_DIR as subvolumes. The system subvolume is made on the first boot; the agent's is the home's seed (see stage). A disk from before that layout — ext4, or btrfs that holds DISK_ROOT_DIR at its top — fails the boot. A disk with no filesystem is never formatted here either, since the only disk that has none is one whose filesystem was lost, and formatting it would erase what is left; the boot stops with the reason on the console.
fn mount_storage(target: &Path) -> PathBuf {
    if let Err(e) = mkdir_all(target) {
        fatal!("creating {}: {e}", target.display());
    }
    if magic_at(STORAGE_DEVICE, 1024 + 56, &[0x53, 0xEF]) {
        fatal!("the storage disk is ext4, which {PREDATES_SUBVOLUMES}");
    }
    if !magic_at(STORAGE_DEVICE, 0x1_0040, b"_BHRfS_M") {
        fatal!("the storage disk holds no btrfs, or could not be read; refusing to boot rather than format it, so what it holds is kept");
    }
    if let Err(e) = mount_typed(
        STORAGE_DEVICE,
        target,
        "btrfs",
        libc::MS_NOATIME,
        STORAGE_DISK_OPTIONS,
    ) {
        fatal!("mounting the storage disk's btrfs: {e}; the disk is kept as it is");
    }
    if target.join(guest::DISK_ROOT_DIR).exists() {
        fatal!(
            "the storage disk holds {} at its top, so it {PREDATES_SUBVOLUMES}",
            guest::DISK_ROOT_DIR
        );
    }
    if let Err(e) = grow_btrfs(target) {
        logf!("WARNING: growing btrfs to the disk ({e}); it keeps the size it had");
    }
    if let Err(e) = ensure_subvolume(target, guest::SYSTEM_DIR) {
        fatal!("creating the subvolume {}: {e}", guest::SYSTEM_DIR);
    }
    target.to_path_buf()
}

// UNIT_BOUNDARY_DESCRIPTION: struct btrfs_ioctl_vol_args, which the resize and the subvolume ioctls take: a NUL-terminated name in a fixed buffer.
#[repr(C)]
struct VolArgs {
    fd: i64,
    name: [u8; 4088],
}

fn btrfs_ioctl(dir: &Path, request: u8, name: &str) -> io::Result<()> {
    let mut args = VolArgs {
        fd: 0,
        name: [0; 4088],
    };
    args.name[..name.len()].copy_from_slice(name.as_bytes());
    let dir = File::open(dir)?;
    // SAFETY: _IOW(0x94, request, struct btrfs_ioctl_vol_args), on an open directory of the filesystem, with `args` alive for the call.
    succeeded(
        unsafe {
            libc::ioctl(
                dir.as_raw_fd(),
                libc::_IOW::<VolArgs>(0x94, request.into()),
                &args,
            )
        } == 0,
    )
}

// UNIT_BOUNDARY_DESCRIPTION: BTRFS_IOC_RESIZE with "max" grows device 1, the disk's only one, to the end of the disk, and is a no-op when it already fills it.
fn grow_btrfs(mount: &Path) -> io::Result<()> {
    btrfs_ioctl(mount, 3, "max")
}

// UNIT_BOUNDARY_DESCRIPTION: makes `parent/name` a subvolume (BTRFS_IOC_SUBVOL_CREATE) unless something is there already.
pub(super) fn ensure_subvolume(parent: &Path, name: &str) -> io::Result<()> {
    if fs::symlink_metadata(parent.join(name)).is_ok() {
        return Ok(());
    }
    btrfs_ioctl(parent, 14, name)
}

// UNIT_BOUNDARY_DESCRIPTION: the guest agent protocol of smolvm's host side, as much of it as the runner's machines use: a liveness ping that names what this init can do, the quiesced stop, onlining RAM the VMM plugged in, and an operator's command, which runs in `env`, the launch record's. Each request is a big-endian u32 length and a JSON body on vsock port 6000, answered the same way, and a connection may carry several. Once it listens, the init rings the host's readiness doorbell, which is what a start waits for; it starts only once the image's root is in place, since the host grows the machine's RAM the moment it is ready, and onlining reads /sys, which moves into that root. A request this init does not serve is answered with an error, never with silence, so the host does not wait out its timeout.
pub fn serve(env: Vec<(String, String)>) {
    let env: std::sync::Arc<[(String, String)]> = env.into();
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
        let env = env.clone();
        std::thread::spawn(move || answer(conn, &env));
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

fn answer(mut conn: File, env: &[(String, String)]) {
    while let Some(body) = read_frame(&mut conn) {
        let response = match serde_json::from_slice::<Envelope<AgentRequest>>(&body) {
            Ok(request) => respond(request.body, &mut conn, env),
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

fn respond(
    request: AgentRequest,
    conn: &mut File,
    launch_env: &[(String, String)],
) -> AgentResponse {
    match request {
        AgentRequest::Ping => AgentResponse::Pong {
            version: smolvm_protocol::PROTOCOL_VERSION,
            capabilities: [
                smolvm_protocol::QUIESCED_SHUTDOWN_CAPABILITY.to_string(),
                smolvm_protocol::ONLINE_MEMORY_GROWTH_CAPABILITY.to_string(),
            ]
            .into(),
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
            launch_env,
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

// UNIT_BOUNDARY_DESCRIPTION: runs one command for the host, as root in the image's root, with the env it names on top of the launch record's and nothing of the init's own, and answers with its exit code and output once it ends, or once `timeout` has passed and it was killed. Only a non-interactive command is run: operators reach a guest this way (`vm-runner exec`), and nothing in the platform needs a shell into it.
// UNIT_BOUNDARY_DESCRIPTION: the launch record's env is the one the image's entrypoint got, as a container's exec gets its container's: the image's PATH, which finds the tools it installs, and the variables that point them at the agent's own browser, display and trust store. A record without PATH gets the default one, as the entrypoint does.
fn exec(
    command: &[String],
    launch_env: &[(String, String)],
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
    let mut spawn = std::process::Command::new(program);
    spawn.args(args).env_clear();
    if !launch_env.iter().any(|(key, _)| key == "PATH") {
        spawn.env("PATH", DEFAULT_PATH);
    }
    let spawned = super::unblocked(&mut spawn)
        .envs(launch_env.iter().map(|(key, value)| (key, value)))
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

// UNIT_BOUNDARY_DESCRIPTION: the phases of the stop handshake between the protocol thread and the supervisor, which runs on the init's main thread. The protocol thread asks for a stop with SIGTERM to the init, which the supervisor waits for, and waits on this for the supervisor to say the workload is gone and the home is written out. The phase is one value under one lock because the moment openrc's shutdown starts and the moment the kill is decided are a single decision: a kill issued while the shutdown runs would end it mid-run, and a shutdown started after the kill would stop nothing, since everything it would stop is already gone. The transition is taken before the child is spawned and not after it, so starting a shutdown never makes the stop wait on the spawn itself: a spawn can stall for as long as the image's own loader does, and the stop must keep telling the host it is at work and keep its own deadlines meanwhile.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    // UNIT_BOUNDARY_DESCRIPTION: the workload has been signalled and has its grace, and no shutdown has been asked for, so the kill comes at the end of that grace.
    Stopping,
    // UNIT_BOUNDARY_DESCRIPTION: the supervisor is spawning openrc's shutdown, which counts as a shutdown in progress from the moment it was asked for: the kill keeps off until the shutdown's own window has passed, however long the spawn takes. It becomes `Shutdown` once the spawn returns, or stays `Killed` if the stop gave up while it ran.
    Starting,
    // UNIT_BOUNDARY_DESCRIPTION: openrc's shutdown is running, and must not be killed under it.
    Shutdown,
    // UNIT_BOUNDARY_DESCRIPTION: the kill was issued at this instant, so nothing new may start.
    Killed(Instant),
    // UNIT_BOUNDARY_DESCRIPTION: the supervisor finished the stop, so the home is written out.
    Done,
}

static STOP: (Mutex<Phase>, Condvar) = (Mutex::new(Phase::Stopping), Condvar::new());

// UNIT_BOUNDARY_DESCRIPTION: what asking the stop to start openrc's shutdown came to.
pub enum Begun<T> {
    // UNIT_BOUNDARY_DESCRIPTION: the stop took the shutdown and will not kill it under its window, so its services may run their stops.
    Started(T),
    // UNIT_BOUNDARY_DESCRIPTION: the kill was already decided, so `start` was never called: everything a shutdown stops is gone by then.
    Refused,
    // UNIT_BOUNDARY_DESCRIPTION: the kill was decided while the child was being made, so this one stops nothing. The caller drops it and does not wait on it, since the stop has already given up on the shutdown and the namespace cleanup after it ends the child and its tree under a bound.
    TooLate(T),
}

// UNIT_BOUNDARY_DESCRIPTION: the supervisor's end once the workload has stopped. The init is the guest's PID 1 and may not exit, since the kernel then panics; the host takes the VMM down once the stop is confirmed.
pub fn stopped() -> ! {
    let (lock, cvar) = &STOP;
    *lock.lock().unwrap_or_else(|e| e.into_inner()) = Phase::Done;
    cvar.notify_all();
    loop {
        std::thread::park();
    }
}

// UNIT_BOUNDARY_DESCRIPTION: starts openrc's shutdown unless the kill is already decided. The phase is taken under the lock and `start` runs outside it: the lock is what makes the start and the kill one decision, and the spawn is unbounded work that the stop must not be made to wait on. So the phase says `Starting` from the instant the shutdown is asked for, which the kill path reads as a shutdown in progress and keeps off for that shutdown's window; whatever the spawn returns is then reported against the phase it landed in, and a child that lost the race is handed back for the caller to drop.
pub fn begin_shutdown<T>(start: impl FnOnce() -> T) -> Begun<T> {
    let (lock, cvar) = &STOP;
    {
        let mut phase = lock.lock().unwrap_or_else(|e| e.into_inner());
        if !matches!(*phase, Phase::Stopping) {
            return Begun::Refused;
        }
        *phase = Phase::Starting;
        cvar.notify_all();
    }
    let started = start();
    let mut phase = lock.lock().unwrap_or_else(|e| e.into_inner());
    if matches!(*phase, Phase::Starting) {
        *phase = Phase::Shutdown;
        cvar.notify_all();
        return Begun::Started(started);
    }
    Begun::TooLate(started)
}

// UNIT_BOUNDARY_DESCRIPTION: the grace a stop gives the workload when the host names none, the same as smolvm's guest agent gave it.
const DEFAULT_STOP_GRACE: Duration = Duration::from_secs(10);
// UNIT_BOUNDARY_DESCRIPTION: the window openrc's shutdown gets on top of the workload's grace, once one has been asked for. The shutdown runs each service's stop in turn, so a kill inside it ends the services whose stops had not come round yet; a stop that kills at the end of the workload's grace alone therefore loses them. It is added to that grace rather than overlapped with it, because the shutdown starts only after the entrypoint has had its grace, which is why an early shutdown would otherwise get no window at all. This is one shared, best-effort window and not one per service: a slow service still spends what the services after it would have had, and a cleanup that must happen is not guaranteed by it — issue 5339 says why an init and not a stop hook is where a guarantee has to live. Five seconds is what the runner can spare: the default wait is the workload's grace, this and AFTER_KILL, 20 s, and the runner gives a stop 40 s (STOP_ON_CLOSE). What follows the wait — releasing the storage guard, sync, the disk's freeze, the ack and the VMM's own teardown, up to 5 s of it — is unbounded work on slow or fragmented storage and has no bound in this code: it fits the 40 s only if it takes the 15 s that are left, and nothing here shows that it does.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
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
    wait_out_stop(conn, grace, SHUTDOWN_GRACE, AFTER_KILL, || {
        // SAFETY: kill(-1, SIGKILL) from PID 1 ends every other process and reads no memory.
        unsafe { libc::kill(-1, libc::SIGKILL) };
    });
    let mut stopping = || {
        let progress = AgentResponse::Progress {
            message: "stopping the workload".into(),
            percent: None,
            layer: None,
        };
        let _ = send(conn, &progress);
    };
    let guard = take_pool_guard(&mut stopping);
    let frozen = std::sync::Mutex::new(None);
    keeping_progress(&mut stopping, || {
        if let Some(mut guard) = guard {
            guard.release();
        }
        // SAFETY: sync(2) takes no arguments.
        unsafe { libc::sync() };
        let result = File::open(guest::AGENT_HOME).and_then(|home| {
            // SAFETY: FIFREEZE takes no pointed-to payload, and `home` keeps its descriptor open for the call.
            succeeded(unsafe { libc::ioctl(home.as_raw_fd(), FIFREEZE as _, 0) } == 0)
        });
        *frozen.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
    });
    let frozen = frozen
        .into_inner()
        .unwrap_or_else(|e| e.into_inner())
        .unwrap_or_else(|| Err(io::Error::other("the storage disk was not frozen")));
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

// UNIT_BOUNDARY_DESCRIPTION: waits for the supervisor to finish the stop, telling the host it is still at work once a second, and issues `kill` once the phase allows it. The kill is decided under the phase's own lock, so it lands either before openrc's shutdown was asked for, which the supervisor then never starts, or after it, and then only once the shutdown's own window has passed. Both windows are counted from this wait's own start: `grace` from it, and `shutdown_grace` on top once a shutdown has been asked for. `after_kill` then stays for the supervisor to write the home out and say so. Every instant here bounds this wait alone: the guard release, the sync and the disk freeze that follow it are unbounded work, as they were before, and outlast any pending spawn because that work runs outside this lock.
fn wait_out_stop(
    conn: &mut File,
    grace: Duration,
    shutdown_grace: Duration,
    after_kill: Duration,
    kill: impl Fn(),
) {
    let waiting = Instant::now();
    let mut frame_at = waiting + PROGRESS_EVERY;
    let (lock, cvar) = &STOP;
    let mut phase = lock.lock().unwrap_or_else(|e| e.into_inner());
    loop {
        let now = Instant::now();
        let wake = match *phase {
            Phase::Done => break,
            Phase::Killed(at) => {
                if now >= at + after_kill {
                    announce("the supervisor did not finish the stop; freezing the disk anyway");
                    break;
                }
                (at + after_kill).min(frame_at)
            }
            running => {
                // UNIT_BOUNDARY_DESCRIPTION: the workload's grace, and the shutdown's own window on top of it once one has been asked for: the shutdown comes after the entrypoint has had its grace, so its window is added and does not overlap it. A shutdown that is still being spawned counts here too, since it is a shutdown the stop must not kill.
                let kill_at = waiting
                    + grace
                    + if matches!(running, Phase::Shutdown | Phase::Starting) {
                        shutdown_grace
                    } else {
                        Duration::ZERO
                    };
                if now >= kill_at {
                    kill();
                    *phase = Phase::Killed(now);
                    cvar.notify_all();
                    continue;
                }
                kill_at.min(frame_at)
            }
        };
        if now >= frame_at {
            frame_at = now + PROGRESS_EVERY;
            let progress = AgentResponse::Progress {
                message: "stopping the workload".into(),
                percent: None,
                layer: None,
            };
            if send(conn, &progress).is_err() {
                break;
            }
            continue;
        }
        phase = cvar
            .wait_timeout(phase, wake.saturating_duration_since(now))
            .unwrap_or_else(|e| e.into_inner())
            .0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: the storage disk is mounted with synchronous discards, so a freed extent reaches the disk file the owner's claim pays for before the filesystem can hand it to the storage guard, and compresses what it holds.
    #[test]
    fn the_storage_disk_discards_before_it_reuses() {
        assert!(STORAGE_DISK_OPTIONS.contains("discard=sync"));
        assert!(STORAGE_DISK_OPTIONS.contains("compress=zstd:1"));
    }

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
        let run = |command: Vec<String>, launch_env: &[(String, String)], timeout_ms: u64| {
            let mut conn = File::open("/dev/null").unwrap();
            respond(
                AgentRequest::VmExec {
                    command,
                    env: vec![("GIVEN".into(), "yes".into())],
                    workdir: Some("/".into()),
                    timeout_ms: Some(timeout_ms),
                    interactive: false,
                    tty: false,
                    background: false,
                    stdin_data: None,
                },
                &mut conn,
                launch_env,
            )
        };
        let sh = |script: &str| vec!["/bin/sh".into(), "-c".into(), script.into()];
        let AgentResponse::Completed {
            exit_code,
            stdout,
            stderr,
        } = run(
            sh("echo \"$GIVEN ${CARGO:-clean} $(pwd) $PATH\"; echo err >&2; exit 3"),
            &[],
            10_000,
        )
        else {
            panic!("no completion");
        };
        assert_eq!(
            (exit_code, stdout, stderr),
            (
                3,
                format!("yes clean / {DEFAULT_PATH}\n").into_bytes(),
                b"err\n".to_vec()
            )
        );
        let AgentResponse::Completed { exit_code, .. } = run(sh("sleep 10"), &[], 100) else {
            panic!("no completion");
        };
        assert_eq!(exit_code, 128 + libc::SIGKILL);
    }

    // TEST_SCENARIO: an operator's command runs in the env the image's entrypoint got, as a container's exec does: a tool the image installs off the default PATH is found by name, and its variables are set, with the request's own env over them. What failed without it was `vm-runner exec <machine> -- sh -c 'agent-browser ...'`, which found no agent-browser.
    #[test]
    fn an_exec_runs_in_the_launch_records_env() {
        let dir =
            std::env::temp_dir().join(format!("platform-init-exec-env-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let tool = dir.join("image-tool");
        fs::write(&tool, "#!/bin/sh\necho \"tool $IMAGE_SETTING $GIVEN $*\"\n").unwrap();
        fs::set_permissions(&tool, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let launch_env = [
            (
                "PATH".to_string(),
                format!("{}:/usr/bin:/bin", dir.display()),
            ),
            ("IMAGE_SETTING".to_string(), "image".to_string()),
            ("GIVEN".to_string(), "image".to_string()),
        ];
        for (command, said) in [
            (
                vec!["image-tool".to_string(), "direct".to_string()],
                "direct",
            ),
            (
                vec!["sh".into(), "-c".into(), "image-tool shell".into()],
                "shell",
            ),
        ] {
            let mut conn = File::open("/dev/null").unwrap();
            let response = respond(
                AgentRequest::VmExec {
                    command: command.clone(),
                    env: vec![("GIVEN".into(), "yes".into())],
                    workdir: None,
                    timeout_ms: Some(10_000),
                    interactive: false,
                    tty: false,
                    background: false,
                    stdin_data: None,
                },
                &mut conn,
                &launch_env,
            );
            let AgentResponse::Completed {
                exit_code,
                stdout,
                stderr,
            } = response
            else {
                panic!("{command:?}: {response:?}");
            };
            assert_eq!(
                (exit_code, String::from_utf8_lossy(&stdout).into_owned()),
                (0, format!("tool image yes {said}\n")),
                "{command:?}: {}",
                String::from_utf8_lossy(&stderr)
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    // TEST_SCENARIO: the host checks a ping's capabilities before it asks for a quiesced stop or for RAM to be onlined; without them it refuses the stop and leaves the VMM running, or never grows the machine.
    #[test]
    fn a_ping_names_what_the_host_needs() {
        let mut conn = File::open("/dev/null").unwrap();
        let response = respond(AgentRequest::Ping, &mut conn, &[]);
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

    // TEST_SCENARIO: openrc's shutdown is the supervisor's child and runs each service's stop in turn, and a stop that kills everything but the init at the end of the workload's grace ends it mid-run: a service whose stop had not come round writes nothing, which is what a hibernating agent saw of a slow docker stop ahead of its own service. The kill is therefore a decision of the stop's own state, taken under the lock that starts the shutdown: a shutdown may still start, so the stop gives it its own window, or the kill has gone, so a shutdown is never spawned at all. A shutdown that hangs is cut short, the progress frames settle back to one a second after the kill, and the wait returns on its own bound without the supervisor. The shutdown here is a real child in a group of its own that writes a marker once it reaches its service's stop, as a stop_post does, and the stop signals that group as it signals every other process.
    #[test]
    fn a_stop_lets_the_openrc_shutdown_finish_before_it_kills() {
        let dir = std::env::temp_dir().join(format!(
            "platform-init-shutdown-stop-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        use std::sync::atomic::{AtomicUsize, Ordering};
        static RUNS: AtomicUsize = AtomicUsize::new(0);
        // UNIT_BOUNDARY_DESCRIPTION: one whole stop, as the supervisor and the protocol thread run it together. `services_take` is how long the shutdown's service takes to reach its stop, `late` starts the shutdown only after the kill has gone, and `finishes` says whether a supervisor that got its shutdown reports the stop done. The result is what the stop did: when it killed, whether a shutdown was spawned, whether the marker is there, how many progress frames it wrote, and how long it waited.
        #[derive(Debug)]
        struct Run {
            killed: Option<Duration>,
            spawned: Option<Duration>,
            spawn_ended: Option<Duration>,
            marked: bool,
            frames: usize,
            waited: Duration,
        }
        let run = |services_take: Duration,
                   grace: Duration,
                   shutdown_grace: Duration,
                   after_kill: Duration,
                   finishes: bool,
                   late: bool,
                   bound: Duration,
                   spawn_takes: Duration| {
            let n = RUNS.fetch_add(1, Ordering::SeqCst);
            let marker = dir.join(format!("service-stopped-{n}"));
            let progress = dir.join(format!("progress-{n}"));
            let spawned = Mutex::new(None::<Duration>);
            let spawn_ended = Mutex::new(None::<Duration>);
            let child_pid = std::sync::atomic::AtomicI32::new(0);
            let deadline = std::sync::atomic::AtomicBool::new(false);
            *STOP.0.lock().unwrap_or_else(|e| e.into_inner()) = Phase::Stopping;
            let killed = Mutex::new(None);
            let started = Instant::now();
            // UNIT_BOUNDARY_DESCRIPTION: the stop writes a progress frame on every turn, and a connection it cannot write to ends the wait, so the frames go to a file of this test's and are counted by its length.
            let mut conn = fs::File::create(&progress).unwrap();
            let awaited = std::thread::scope(|scope| {
                // UNIT_BOUNDARY_DESCRIPTION: a stop that never returns from its own bounds would hang the suite rather than fail it, so the supervisor ends the wait at a ceiling well past every bound this test sets, and the run then fails on the elapsed time it reports.
                let ceiling = &deadline;
                scope.spawn(move || {
                    std::thread::sleep(bound * 3);
                    let (lock, cvar) = &STOP;
                    *lock.lock().unwrap_or_else(|e| e.into_inner()) = Phase::Done;
                    ceiling.store(true, Ordering::SeqCst);
                    cvar.notify_all();
                });
                scope.spawn(|| {
                    if late {
                        // UNIT_BOUNDARY_DESCRIPTION: the supervisor that reaches its shutdown only after the workload was killed waits for that kill, which is the order an entrypoint that ignores SIGTERM produces.
                        while killed.lock().unwrap_or_else(|e| e.into_inner()).is_none() {
                            std::thread::sleep(Duration::from_millis(5));
                        }
                    } else {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    let child = begin_shutdown(|| {
                        // UNIT_BOUNDARY_DESCRIPTION: a spawn that stalls, as an image's loader may, is what a stop must not be made to wait on.
                        std::thread::sleep(spawn_takes);
                        let child = std::process::Command::new("/bin/sh")
                            .arg("-c")
                            .arg(format!(
                                "sleep {}; : > {}",
                                services_take.as_secs_f64(),
                                marker.display()
                            ))
                            .process_group(0)
                            .spawn()
                            .unwrap();
                        child_pid.store(child.id() as libc::pid_t, Ordering::SeqCst);
                        let at = started.elapsed();
                        *spawned.lock().unwrap_or_else(|e| e.into_inner()) = Some(at);
                        *spawn_ended.lock().unwrap_or_else(|e| e.into_inner()) = Some(at);
                        child
                    });
                    match child {
                        Begun::Started(mut child) => {
                            let _ = child.wait();
                        }
                        Begun::TooLate(mut child) => {
                            // SAFETY: kill(2) reads no memory; the pid leads the group this test made, which holds nothing but the shutdown.
                            unsafe { libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL) };
                            let _ = child.wait();
                        }
                        Begun::Refused => {}
                    }
                    if finishes {
                        let (lock, cvar) = &STOP;
                        *lock.lock().unwrap_or_else(|e| e.into_inner()) = Phase::Done;
                        cvar.notify_all();
                    }
                });
                wait_out_stop(&mut conn, grace, shutdown_grace, after_kill, || {
                    *killed.lock().unwrap_or_else(|e| e.into_inner()) = Some(started.elapsed());
                    let pid = child_pid.load(Ordering::SeqCst);
                    if pid != 0 {
                        // SAFETY: kill(2) reads no memory; the pid leads the group this test made, which holds nothing but the shutdown.
                        unsafe { libc::kill(-pid, libc::SIGKILL) };
                    }
                });
                (started.elapsed(), deadline.load(Ordering::SeqCst))
            });
            // UNIT_BOUNDARY_DESCRIPTION: the spawn's own thread is joined by the scope, so these are read once it has ended, however late that is.
            let (waited, rescued) = awaited;
            assert!(
                !rescued,
                "the stop did not return inside its own bound; the suite had to end it"
            );
            let killed_at = *killed.lock().unwrap_or_else(|e| e.into_inner());
            let spawned_at = *spawned.lock().unwrap_or_else(|e| e.into_inner());
            let spawn_ended_at = *spawn_ended.lock().unwrap_or_else(|e| e.into_inner());
            let frame = smolvm_protocol::encode_message(&AgentResponse::Progress {
                message: "stopping the workload".into(),
                percent: None,
                layer: None,
            })
            .unwrap()
            .len();
            Run {
                killed: killed_at,
                spawned: spawned_at,
                spawn_ended: spawn_ended_at,
                marked: marker.exists(),
                frames: fs::metadata(&progress).map_or(0, |m| m.len() as usize) / frame,
                waited,
            }
        };

        // TEST_SCENARIO: the service's stop outlives the workload's grace, so a kill at the end of that grace alone takes it before it writes anything, which is the reported failure.
        let slow = run(
            Duration::from_millis(1200),
            Duration::from_millis(200),
            Duration::from_millis(1500),
            Duration::from_millis(400),
            true,
            false,
            Duration::from_millis(1500),
            Duration::ZERO,
        );
        assert!(
            slow.spawned.is_some(),
            "the supervisor never started a shutdown"
        );
        assert!(
            slow.killed.is_none() && slow.marked,
            "a stop killed openrc's shutdown before a service's stop ran ({slow:?})"
        );

        // TEST_SCENARIO: the window is added to the workload's grace, not laid over it. An openrc shutdown begins well inside that grace, so an overlap would leave it killed at the plain grace with nothing extra: a container runtime's ten-second stop ahead of the probe service still loses the probe, which is the reported trigger. The graces here keep production's two-to-one ratio, and the service's stop lands past the grace, which only the added window covers.
        // UNIT_BOUNDARY_DESCRIPTION: production's own ratio, a workload grace twice the shutdown's window, with enough room that host sleep and exec latency cannot decide the outcome.
        let early = run(
            Duration::from_millis(900),
            Duration::from_millis(800),
            Duration::from_millis(400),
            Duration::from_millis(600),
            true,
            false,
            Duration::from_millis(2400),
            Duration::ZERO,
        );
        assert!(
            early.spawned.is_some(),
            "the supervisor never started a shutdown"
        );
        assert!(
            early.marked && early.killed.is_none(),
            "the service's stop landed past the workload's grace, where an overlapped window kills it before it writes ({early:?})"
        );

        // TEST_SCENARIO: a supervisor that reaches its shutdown only after the kill starts none, because everything a shutdown stops is already gone.
        let after = run(
            Duration::from_millis(50),
            Duration::from_millis(100),
            Duration::from_millis(1500),
            Duration::from_millis(100),
            true,
            true,
            Duration::from_millis(200),
            Duration::ZERO,
        );
        assert!(
            after.killed.is_some() && after.spawned.is_none() && !after.marked,
            "a shutdown started after the kill, where everything it would stop is gone ({after:?})"
        );

        // TEST_SCENARIO: a spawn can stall for as long as the image's loader takes, and starting a shutdown must not make the stop wait on it: the host cuts a guest down after five seconds without a progress frame, and the stop's own deadlines have to keep running. So a spawn that takes longer than the whole wait still leaves frames going and the kill landing on time.
        let stalled = run(
            Duration::from_millis(3000),
            Duration::from_millis(800),
            Duration::from_millis(600),
            Duration::from_millis(200),
            false,
            false,
            Duration::from_millis(4000),
            Duration::from_millis(1800),
        );
        let spawn_ended = stalled.spawn_ended.unwrap_or_else(|| {
            panic!("the shutdown was never spawned, so nothing tested the stall ({stalled:?})")
        });
        let stalled_killed = stalled.killed.unwrap_or_else(|| {
            panic!("a stalled spawn kept the stop from killing at all ({stalled:?})")
        });
        assert!(
            stalled_killed < spawn_ended,
            "the kill came at {stalled_killed:?}, behind a spawn that only ended at {spawn_ended:?}"
        );
        assert!(
            stalled.frames >= 1,
            "the stop wrote no progress frame inside a spawn that took {spawn_ended:?} ({stalled:?})"
        );
        assert!(
            stalled_killed < Duration::from_millis(1700),
            "the kill came at {stalled_killed:?}, held behind the spawn"
        );

        // TEST_SCENARIO: a shutdown that never finishes is killed at its own window and not before, and the wait returns on its own bound without the supervisor.
        let hanging = run(
            Duration::from_secs(5),
            Duration::from_millis(200),
            Duration::from_millis(300),
            Duration::from_millis(1200),
            false,
            false,
            Duration::from_millis(600),
            Duration::ZERO,
        );
        let began = hanging
            .spawned
            .unwrap_or_else(|| panic!("the supervisor never started a shutdown"));
        let killed = hanging
            .killed
            .unwrap_or_else(|| panic!("a shutdown that hangs kept the stop from killing it"));
        assert!(
            killed >= began + Duration::from_millis(280),
            "the kill came at {killed:?}, less than the shutdown's window after it began at {began:?}"
        );
        assert!(
            hanging.waited >= Duration::from_millis(1300)
                && hanging.waited < Duration::from_millis(1800),
            "the wait did not return on its own bound: {:?}",
            hanging.waited
        );
        assert!(
            !hanging.marked,
            "a service's stop ran after the shutdown was killed ({hanging:?})"
        );
        // UNIT_BOUNDARY_DESCRIPTION: the pre-kill wait writes one progress frame a second, and the post-kill wait keeps that cadence rather than spinning.
        assert!(
            hanging.frames <= 5,
            "the stop wrote {} progress frames in {:?}",
            hanging.frames,
            hanging.waited
        );
    }

    // TEST_SCENARIO: on a new disk in the subvolume layout the home arrives with its seed: the agent's subvolume does not exist until the image's home is copied into a staged subvolume and renamed into place, so the home is the image's, with its owner and mode, and the root of a subvolume. A store that existed empty before its seed would be taken for a seeded home and never get the image's files. Needs root and mkfs.btrfs: `sudo -E cargo test -p platform-init -- --ignored seeds_a_home_subvolume`.
    #[test]
    #[ignore = "needs root and mkfs.btrfs"]
    fn seeds_a_home_subvolume() {
        use std::os::unix::fs::PermissionsExt;
        let dir =
            std::env::temp_dir().join(format!("platform-init-seed-subvol-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        mkdir_all(&dir).unwrap();
        let run = |program: &str, args: &[&std::ffi::OsStr]| {
            let out = std::process::Command::new(program)
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{program}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        };
        let image = dir.join("disk.raw");
        File::create(&image).unwrap().set_len(256 << 20).unwrap();
        run(
            "mkfs.btrfs",
            &["-q".as_ref(), "-M".as_ref(), image.as_os_str()],
        );
        let top = dir.join("top");
        mkdir_all(&top).unwrap();
        run(
            "mount",
            &[
                "-o".as_ref(),
                "loop".as_ref(),
                image.as_os_str(),
                top.as_os_str(),
            ],
        );
        let home = dir.join("image-home");
        mkdir_all(&home.join(".config")).unwrap();
        fs::write(home.join(".config/settings"), b"from the image").unwrap();
        std::os::unix::fs::lchown(&home, Some(65532), Some(65532)).unwrap();
        fs::set_permissions(&home, fs::Permissions::from_mode(0o750)).unwrap();
        let checks = || {
            ensure_subvolume(&top, guest::SYSTEM_DIR).unwrap();
            let store = guest::agent_store(&top);
            assert!(needs_seed(&store).unwrap(), "a new disk holds no home yet");
            seed(&home, &store).unwrap();
            let info = fs::metadata(&store).unwrap();
            assert_eq!(info.ino(), 256, "the home is a subvolume's root");
            assert_eq!((info.uid(), info.mode() & 0o777), (65532, 0o750));
            assert_eq!(
                fs::read(store.join(".config/settings")).unwrap(),
                b"from the image"
            );
            assert!(!needs_seed(&store).unwrap());
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(checks));
        run("umount", &[top.as_os_str()]);
        let _ = fs::remove_dir_all(&dir);
        result.unwrap();
    }
}
