fn main() {
    let e = platform_init::runc::run(std::env::args_os().skip(1).collect());
    eprintln!("platform-runc: FATAL: {e}");
    std::process::exit(127);
}
