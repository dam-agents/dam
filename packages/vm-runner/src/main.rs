use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use clap::Parser;
use vm_runner::embedded::Smolvm;
use vm_runner::runtime::MAX_IMAGE_BYTES;
use vm_runner::server::{Config, Server};
use vm_runner::{http, templates};

// UNIT_BOUNDARY_DESCRIPTION: every flag the runner defines. Each is set by exactly one of two callers, and neither relies on a default: the image's ENTRYPOINT sets the paths that are the image's own layout, and the controller sets everything it has chosen — the ports it opens in the runner's NetworkPolicy, where it mounts the runner's state and credentials and the runner's budgets. The controller builds those args in Go, so a rename is not a build failure on either side: it is a runner that rejects an argument its own Deployment sets, which surfaces as a pod that will not start. contract/runner-args.json holds the args the controller renders, and both sides test against it.
#[derive(Parser, Debug)]
#[command(name = "vm-runner", about = "Hosts vm-backend agents as microVMs")]
struct Args {
    #[arg(long, default_value = ":4600")]
    listen: String,
    // UNIT_BOUNDARY_DESCRIPTION: where Prometheus metrics are served, in plain HTTP and without the machine API's token. Empty serves none.
    #[arg(long = "metrics-listen", default_value = "")]
    metrics_listen: String,
    // UNIT_BOUNDARY_DESCRIPTION: per-machine state: published port, applied spec, and the share each guest reads its CA and platform-init from.
    #[arg(long = "state-dir", default_value = "/var/lib/platform/machines")]
    state_dir: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: unpacked agent images, or the archives an install with no registry stages. On a node cache this is the node's directory, mounted read-only.
    #[arg(long = "image-dir", default_value = "/var/lib/platform/images")]
    image_dir: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: the node image cache service's socket. Set, every image is resolved and fetched by that service and this runner only reads the image directory; empty makes this runner the one writer of its own cache.
    #[arg(long = "image-cache-socket", default_value = "")]
    image_cache_socket: String,
    // UNIT_BOUNDARY_DESCRIPTION: bytes the cached images may occupy; 0 evicts nothing, and the controller refuses to start a runner without a positive budget.
    #[arg(long = "image-budget-bytes", default_value_t = 0)]
    image_budget_bytes: i64,
    // UNIT_BOUNDARY_DESCRIPTION: the smolvm release's launcher. The runner drives smolvm as a library and forks no CLI, but the release is still where the libraries the VMM loads, the guest agent's root filesystem and the disk templates live — all beside this path, as the release's own launcher script finds them.
    #[arg(long, default_value = "/opt/smolvm/smolvm")]
    smolvm: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: crane fetches an agent image this runner's own cache does not hold; empty disables the fetch. Unused with a node cache, whose service fetches.
    #[arg(long, default_value = "crane")]
    crane: String,
    // UNIT_BOUNDARY_DESCRIPTION: platform-init is copied into every machine's share and run as its entrypoint. It is the binary that mounts the agent's home inside the guest: the platform-init package beside this one, linked statically because it runs against the agent image's libc and not this one's.
    #[arg(
        long = "platform-init",
        default_value = "/usr/local/libexec/platform-init"
    )]
    platform_init: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: the pod ports machines are published on. The controller opens exactly this range in the runner's NetworkPolicy and passes it here from the same constants, so a machine is never published on a port the policy drops.
    #[arg(long = "port-min", default_value_t = 31000)]
    port_min: u16,
    #[arg(long = "port-max", default_value_t = 31099)]
    port_max: u16,
    // UNIT_BOUNDARY_DESCRIPTION: memory the runner may commit to machines. Required: without it the runner admits machines against no limit at all.
    #[arg(long = "memory-mib", default_value_t = 0)]
    memory_mib: i64,
    #[arg(long = "reserve-mib", default_value_t = 512)]
    reserve_mib: i64,
    #[arg(long = "token-file", default_value = "/etc/vm-runner/token")]
    token_file: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: the serving certificate and key cert-manager issues for the runner's Service host. The machine API carries the runner's token, so it is served over TLS only.
    #[arg(long = "tls-cert")]
    tls_cert: String,
    #[arg(long = "tls-key")]
    tls_key: String,
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm boots every VMM by spawning its own executable again with `_boot-vm` and a boot-config path, so this binary is also the VMM. The subcommand is checked before anything else runs: a boot process must never parse runner flags, bind the machine API or start a runtime of its own. Serving it here rather than pointing smolvm at a separate binary means the VMM is always the smolvm library this runner was built against.
fn boot_config(mut args: impl Iterator<Item = std::ffi::OsString>) -> Option<Option<PathBuf>> {
    args.next();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("_boot-vm")) {
        return None;
    }
    Some(args.next().map(PathBuf::from))
}

// UNIT_BOUNDARY_DESCRIPTION: points the embedded runtime at the smolvm release the image installed, as the release's launcher script does for its own binary: libkrun and libkrunfw from its lib directory, the guest agent from its agent-rootfs. The environment is read by this process and inherited by every VMM it spawns, so it is set before any thread starts. The archive cap is the `--max-image-size` flag.
fn configure_smolvm(launcher: &Path) {
    let install = launcher.parent().unwrap_or(Path::new("/"));
    let lib = install.join("lib");
    std::env::set_var("SMOLVM_LIB_DIR", &lib);
    let ld = match std::env::var_os("LD_LIBRARY_PATH") {
        Some(existing) if !existing.is_empty() => {
            let mut joined = lib.into_os_string();
            joined.push(":");
            joined.push(existing);
            joined
        }
        _ => lib.into_os_string(),
    };
    std::env::set_var("LD_LIBRARY_PATH", ld);
    let rootfs = install.join("agent-rootfs");
    if rootfs.is_dir() && std::env::var_os("SMOLVM_AGENT_ROOTFS").is_none() {
        std::env::set_var("SMOLVM_AGENT_ROOTFS", rootfs);
    }
    if std::env::var_os("SMOLVM_MAX_IMAGE_BYTES").is_none() {
        std::env::set_var("SMOLVM_MAX_IMAGE_BYTES", MAX_IMAGE_BYTES.to_string());
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the listen address, `:4600` meaning every interface. Bound dual-stack where the pod has IPv6 and IPv4-only where it does not.
fn bind(listen: &str) -> anyhow::Result<std::net::TcpListener> {
    let listener = match listen.strip_prefix(':') {
        Some(port) => {
            let port: u16 = port
                .parse()
                .map_err(|e| anyhow::anyhow!("listen address {listen}: {e}"))?;
            std::net::TcpListener::bind(("::", port))
                .or_else(|_| std::net::TcpListener::bind(("0.0.0.0", port)))?
        }
        None => std::net::TcpListener::bind(listen.parse::<SocketAddr>()?)?,
    };
    listener.set_nonblocking(true)?;
    Ok(listener)
}

// UNIT_BOUNDARY_DESCRIPTION: how long the machine API has to finish the requests it already has. Inside the thirty seconds kubelet allows before SIGKILL, so the runner's own close still gets a turn after it.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

// UNIT_BOUNDARY_DESCRIPTION: how often the VMMs that have exited are reaped.
const REAP_EVERY: Duration = Duration::from_secs(1);

// UNIT_BOUNDARY_DESCRIPTION: how often the serving certificate is read again. cert-manager renews it in the mounted Secret well before it expires, and restarting to pick it up would reboot every machine, so the runner re-reads it in place instead.
const TLS_RELOAD_EVERY: Duration = Duration::from_secs(300);

fn reload_tls(tls: axum_server::tls_rustls::RustlsConfig, cert: String, key: String) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(TLS_RELOAD_EVERY);
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = tls.reload_from_pem_file(&cert, &key).await {
                tracing::warn!(error = %e, "the serving certificate could not be re-read; keeping the one loaded");
            }
        }
    });
}

fn main() -> anyhow::Result<()> {
    if let Some(config) = boot_config(std::env::args_os()) {
        let config =
            config.ok_or_else(|| anyhow::anyhow!("_boot-vm requires a boot-config path"))?;
        smolvm::internal_boot::run(config)?;
        return Ok(());
    }
    tracing_subscriber::fmt().json().init();
    let args = Args::parse();
    anyhow::ensure!(
        args.memory_mib > 0,
        "--memory-mib is required: without it the runner admits machines against no limit at all"
    );
    anyhow::ensure!(
        args.port_min <= args.port_max,
        "--port-min is above --port-max"
    );
    let token = std::fs::read_to_string(&args.token_file)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", args.token_file.display()))?;
    let token = token.trim().to_string();
    anyhow::ensure!(!token.is_empty(), "the token file is empty");
    configure_smolvm(&args.smolvm);
    prepare_host(&args)?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(serve(args, token))
}

// UNIT_BOUNDARY_DESCRIPTION: what the runner's pod has to give its machines before any exists. The VMMs open /dev/kvm and /dev/net/tun, and the state directories must be traversable by them; a device that cannot be opened is reported and not fatal, because the error it causes at boot names the device. An install with no registry mounts the image directory read-only, with archives staged in it, and so does a node cache, whose service is its only writer; a chmod there fails with EROFS and is not fatal either: the mount decides what machine uids see, and a tree they cannot read fails at boot with a message naming it.
fn prepare_host(args: &Args) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    for device in ["/dev/kvm", "/dev/net/tun"] {
        if let Err(e) = std::fs::set_permissions(device, std::fs::Permissions::from_mode(0o666)) {
            tracing::warn!(path = device, error = %e, "device not writable for machine uids");
        }
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    for dir in [&home, &args.state_dir, &args.image_dir] {
        if dir.as_os_str().is_empty() {
            continue;
        }
        std::fs::create_dir_all(dir)
            .map_err(|e| anyhow::anyhow!("creating state dir {}: {e}", dir.display()))?;
        if let Err(e) = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o755)) {
            if dir == &args.image_dir && e.kind() == std::io::ErrorKind::ReadOnlyFilesystem {
                tracing::warn!(path = %dir.display(), "image dir is read-only, so machine uids see the mount's own permissions");
                continue;
            }
            anyhow::bail!("opening state dir {} to machine uids: {e}", dir.display());
        }
    }
    Ok(())
}

async fn serve(args: Args, token: String) -> anyhow::Result<()> {
    let runtime = Arc::new(tokio::task::spawn_blocking(Smolvm::open).await??);
    let server = Server::start(
        Config {
            state_dir: args.state_dir.clone(),
            image_dir: args.image_dir.clone(),
            image_cache_socket: (!args.image_cache_socket.is_empty())
                .then(|| PathBuf::from(&args.image_cache_socket)),
            image_budget: args.image_budget_bytes,
            crane: args.crane.clone(),
            init: Some(args.platform_init.clone()),
            ports: args.port_min..=args.port_max,
            memory_mib: i32::try_from(args.memory_mib)?,
            reserve_mib: i32::try_from(args.reserve_mib)?,
            listen: None,
        },
        runtime.clone(),
    )?;

    let install = args
        .smolvm
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let kept = (!home.as_os_str().is_empty()).then(|| home.join(templates::KEPT_DIR));
    server.background(move |cancel| templates::warm(&install, kept.as_deref(), &home, &cancel));
    let reaper = runtime.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(REAP_EVERY);
        loop {
            tick.tick().await;
            reaper.reap();
        }
    });

    let listener = bind(&args.listen)?;
    let app = http::router(server.clone(), &token).into_make_service();
    let handle = axum_server::Handle::new();
    let scrape = if args.metrics_listen.is_empty() {
        None
    } else {
        let listener = bind(&args.metrics_listen)?;
        let handle = axum_server::Handle::new();
        let serving = axum_server::from_tcp(listener)
            .handle(handle.clone())
            .serve(http::metrics_router(server.clone()).into_make_service());
        Some((handle, tokio::spawn(serving)))
    };
    tracing::info!(
        listen = %args.listen,
        state_dir = %args.state_dir.display(),
        image_dir = %args.image_dir.display(),
        platform_init = %args.platform_init.display(),
        metrics = %args.metrics_listen,
        "VM runner serving"
    );
    let serving = {
        let handle = handle.clone();
        async move {
            let _ = rustls::crypto::ring::default_provider().install_default();
            let tls =
                axum_server::tls_rustls::RustlsConfig::from_pem_file(&args.tls_cert, &args.tls_key)
                    .await?;
            reload_tls(tls.clone(), args.tls_cert.clone(), args.tls_key.clone());
            axum_server::from_tcp_rustls(listener, tls)
                .handle(handle)
                .serve(app)
                .await
        }
    };
    tokio::pin!(serving);
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        result = &mut serving => {
            server.close().await;
            return result.map_err(|e| anyhow::anyhow!("serving: {e}"));
        }
        _ = term.recv() => tracing::info!(signal = "SIGTERM", "VM runner stopping"),
        _ = tokio::signal::ctrl_c() => tracing::info!(signal = "SIGINT", "VM runner stopping"),
    }
    handle.graceful_shutdown(Some(SHUTDOWN_GRACE));
    if let Err(e) = serving.await {
        tracing::warn!(error = %e, "the machine API did not shut down cleanly");
    }
    if let Some((handle, serving)) = scrape {
        handle.graceful_shutdown(Some(SHUTDOWN_GRACE));
        let _ = serving.await;
    }
    server.close().await;
    tracing::info!("VM runner stopped");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: smolvm spawns this binary as the VMM with `_boot-vm <config>`. That call must be recognised before flag parsing, which would refuse it, and nothing else may be mistaken for it — the runner's own invocation least of all.
    #[test]
    fn a_boot_process_is_told_apart_from_the_runner() {
        let args = |list: &[&str]| {
            list.iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            boot_config(
                args(&["/proc/self/exe", "_boot-vm", "/vms/abc/boot-config.json"]).into_iter()
            ),
            Some(Some(PathBuf::from("/vms/abc/boot-config.json")))
        );
        assert_eq!(
            boot_config(args(&["vm-runner", "_boot-vm"]).into_iter()),
            Some(None)
        );
        assert_eq!(
            boot_config(args(&["vm-runner", "--memory-mib=1"]).into_iter()),
            None
        );
        assert_eq!(boot_config(args(&["vm-runner"]).into_iter()), None);
    }

    // TEST_SCENARIO: `:4600` is the flag's spelling of every interface on a port. It must bind, and a port that is not a number must be refused rather than read as some default.
    #[test]
    fn a_bare_port_binds_every_interface() {
        let listener = bind(":0").unwrap();
        assert!(listener.local_addr().unwrap().ip().is_unspecified());
        assert!(bind(":http").is_err());
        assert!(bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .ip()
            .is_loopback());
    }

    // TEST_SCENARIO: the image's entrypoint names the smolvm release's launcher, and everything the VMM loads is found beside it — its libraries ahead of any already on the library path, and its guest agent's root filesystem — as the release's own launcher script finds them.
    #[test]
    fn the_smolvm_release_is_found_beside_its_launcher() {
        let install =
            std::env::temp_dir().join(format!("vm-runner-install-{}", std::process::id()));
        std::fs::create_dir_all(install.join("agent-rootfs")).unwrap();
        std::env::set_var("LD_LIBRARY_PATH", "/usr/lib/other");
        std::env::remove_var("SMOLVM_AGENT_ROOTFS");
        configure_smolvm(&install.join("smolvm"));
        assert_eq!(
            std::env::var_os("SMOLVM_LIB_DIR"),
            Some(install.join("lib").into_os_string())
        );
        assert_eq!(
            std::env::var("LD_LIBRARY_PATH").unwrap(),
            format!("{}:/usr/lib/other", install.join("lib").display())
        );
        assert_eq!(
            std::env::var_os("SMOLVM_AGENT_ROOTFS"),
            Some(install.join("agent-rootfs").into_os_string())
        );
        let _ = std::fs::remove_dir_all(&install);
    }

    // UNIT_BOUNDARY_DESCRIPTION: the arguments the image's ENTRYPOINT passes ahead of the controller's, read from the Dockerfile this binary's image is built from, which sits beside this crate.
    fn entrypoint_args() -> Vec<String> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/Dockerfile");
        let dockerfile = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("the runner image is built from {path}: {e}"));
        let line = dockerfile
            .lines()
            .find(|line| line.starts_with("ENTRYPOINT "))
            .expect("the runner image has an ENTRYPOINT");
        let words: Vec<String> =
            serde_json::from_str(line.trim_start_matches("ENTRYPOINT ").trim())
                .expect("the ENTRYPOINT is in exec form");
        let runner = words
            .iter()
            .position(|word| word == "vm-runner")
            .expect("the ENTRYPOINT runs vm-runner");
        words[runner + 1..].to_vec()
    }

    // UNIT_BOUNDARY_DESCRIPTION: the args the controller renders into the runner's Deployment, as the controller's own test records them. Kubernetes expands `$(NAME)` from the container's environment before the runner sees an arg. The controller uses one such reference, the pod's memory limit, and it is given a value here; any other reference fails, so a new one gets a stated value rather than reaching the parser unexpanded.
    fn controller_args() -> Vec<String> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/contract/runner-args.json");
        let args: Vec<String> = serde_json::from_str(
            &std::fs::read_to_string(path).unwrap_or_else(|e| panic!("reading {path}: {e}")),
        )
        .expect("the runner args fixture is a list of strings");
        args.into_iter()
            .map(|arg| {
                let arg = arg.replace("$(RUNNER_MEMORY_MIB)", "4096");
                assert!(
                    !arg.contains("$("),
                    "{arg} names an environment variable this test gives no value"
                );
                arg
            })
            .collect()
    }

    fn pod_argv() -> Vec<String> {
        let mut argv = vec!["vm-runner".to_string()];
        argv.extend(entrypoint_args());
        argv.extend(controller_args());
        argv
    }

    // TEST_SCENARIO: the pod runs this binary with the ENTRYPOINT's args followed by the controller's. A flag it does not know, a value it cannot read, or a flag both of them set is a runner pod that exits on start rather than a failed build, so the two lists must parse together, as the one argv the pod passes.
    #[test]
    fn the_args_the_pod_runs_with_are_accepted() {
        let argv = pod_argv();
        let args = Args::try_parse_from(&argv)
            .unwrap_or_else(|e| panic!("the pod's arguments {argv:?} are rejected: {e}"));
        assert!(args.memory_mib > 0 && args.port_min <= args.port_max);
    }

    // TEST_SCENARIO: a flag nobody passes runs on its default, and a default is a second copy of a value its owner already holds — the port range the controller opens in the runner's NetworkPolicy, the path the image installs platform-init at. So every flag is set by the image or by the controller, and a new flag fails here until one of them sets it.
    #[test]
    fn every_flag_is_set_by_the_image_or_the_controller() {
        use clap::CommandFactory;
        let argv = pod_argv();
        let passed: Vec<&str> = argv
            .iter()
            .filter_map(|word| word.strip_prefix("--"))
            .map(|flag| flag.split_once('=').map_or(flag, |(name, _)| name))
            .collect();
        let command = Args::command();
        for flag in command
            .get_arguments()
            .filter_map(|arg| arg.get_long())
            .filter(|flag| !matches!(*flag, "help" | "version"))
        {
            assert!(
                passed.contains(&flag),
                "--{flag} is set by neither the image's ENTRYPOINT nor the controller, so the runner runs on its default"
            );
        }
    }
}
