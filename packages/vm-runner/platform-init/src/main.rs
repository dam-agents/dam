#[cfg(target_os = "linux")]
fn main() {
    platform_init::boot::run(std::env::args_os().skip(1).collect())
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("platform-init: FATAL: runs only as the entrypoint of a Linux guest");
    std::process::exit(1);
}
