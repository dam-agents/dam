// UNIT_BOUNDARY_DESCRIPTION: one binary, two stages. As /sbin/platform-init of the agent rootfs it is the first stage, which mounts the share and executes the share's copy of itself; that copy, the runner release's, is the guest's init.
#[cfg(target_os = "linux")]
fn main() {
    if std::env::args_os().next().as_deref() == Some(std::ffi::OsStr::new("/sbin/platform-init")) {
        platform_init::boot::stage0()
    }
    platform_init::boot::run()
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("platform-init: FATAL: runs only as the entrypoint of a Linux guest");
    std::process::exit(1);
}
