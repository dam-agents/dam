use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use clap::Parser;
use ipnet::IpNet;
use vm_runner::embedded::{self, Smolvm};
use vm_runner::runtime::MAX_IMAGE_BYTES;
use vm_runner::server::{Config, Server};
use vm_runner::{http, state, templates};

// UNIT_BOUNDARY_DESCRIPTION: every flag the Go runner this replaces defines, kept name-for-name. The controller builds these args itself in packages/controller/pkg/reconciler/vm_runner.go — not the Helm chart — and it passes a subset: state-dir, metrics-listen, image-dir, runner-id, image-budget-bytes, memory-mib, reserve-mib, tls-cert, tls-key and allow-from. The image's entrypoint passes --smolvm. The rest are defaults the pod never overrides. A rename is therefore not a build failure on either side: it is a runner that rejects an argument its own Deployment sets, which surfaces as a pod that will not start.
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
    // UNIT_BOUNDARY_DESCRIPTION: unpacked agent images and local archives, shared by every runner on this node when the install gives them a host directory.
    #[arg(long = "image-dir", default_value = "/var/lib/platform/images")]
    image_dir: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: this runner's name among the runners sharing the image directory; empty keeps the cache private to this runner.
    #[arg(long = "runner-id", default_value = "")]
    runner_id: String,
    // UNIT_BOUNDARY_DESCRIPTION: bytes the cached images may occupy; 0 evicts nothing, and the controller refuses to start a runner without a positive budget.
    #[arg(long = "image-budget-bytes", default_value_t = 0)]
    image_budget_bytes: i64,
    // UNIT_BOUNDARY_DESCRIPTION: the smolvm release's launcher. The runner drives smolvm as a library and forks no CLI, but the release is still where the libraries the VMM loads, the guest agent's root filesystem and the disk templates live — all beside this path, as the release's own launcher script finds them.
    #[arg(long, default_value = "/opt/smolvm/smolvm")]
    smolvm: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: crane fetches an agent image the shared cache does not hold; empty disables the fetch.
    #[arg(long, default_value = "crane")]
    crane: String,
    // UNIT_BOUNDARY_DESCRIPTION: platform-init is copied into every machine's share and run as its entrypoint. It is the Go binary that mounts the agent's home inside the guest, which is why this runner being Rust does not move it.
    #[arg(
        long = "platform-init",
        default_value = "/usr/local/libexec/platform-init"
    )]
    platform_init: PathBuf,
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
    #[arg(long = "tls-cert", default_value = "")]
    tls_cert: String,
    #[arg(long = "tls-key", default_value = "")]
    tls_key: String,
    // UNIT_BOUNDARY_DESCRIPTION: CIDRs allowed to dial published machine ports; empty admits any. Parsed at startup rather than at first use, because the failure of an allowlist is that it admits everybody, and a runner that took a malformed entry would report nothing wrong while doing exactly that.
    #[arg(long = "allow-from", default_value = "", value_parser = allow_from)]
    allow_from: AllowFrom,
}

// UNIT_BOUNDARY_DESCRIPTION: the whole list as one flag value, which is what it is — a newtype rather than a bare Vec because clap reads a Vec field as "one of these per occurrence" and would hand the parser a single entry while expecting a single entry back. Declared as a Vec it builds, rejects a malformed CIDR correctly, and then panics on the success path downcasting what it parsed.
#[derive(Clone, Debug, Default)]
struct AllowFrom(Vec<IpNet>);

// UNIT_BOUNDARY_DESCRIPTION: the Go runner splits this flag on commas, skips blank entries and exits on anything net.ParseCIDR rejects. Same three rules here, so an install's value means what it meant before.
fn allow_from(value: &str) -> anyhow::Result<AllowFrom> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| {
            entry
                .parse::<IpNet>()
                .map_err(|e| anyhow::anyhow!("--allow-from {entry}: {e}"))
        })
        .collect::<anyhow::Result<Vec<IpNet>>>()
        .map(AllowFrom)
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm boots every VMM by spawning its own executable again with `_boot-vm` and a boot-config path, so this binary is also the VMM. The subcommand is checked before anything else runs: a boot process must never parse runner flags, bind the machine API or start a runtime of its own. Serving it here rather than pointing smolvm at a separate binary means the VMM is always the smolvm library this runner was built against.
fn boot_config(mut args: impl Iterator<Item = std::ffi::OsString>) -> Option<Option<PathBuf>> {
    args.next();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("_boot-vm")) {
        return None;
    }
    Some(args.next().map(PathBuf::from))
}

// UNIT_BOUNDARY_DESCRIPTION: points the embedded runtime at the smolvm release the image installed, as the release's launcher script does for its own binary: libkrun and libkrunfw from its lib directory, the guest agent from its agent-rootfs. The environment is read by this process and inherited by every VMM it spawns, so it is set before any thread starts. The archive cap is the Go runner's `--max-image-size`.
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

// UNIT_BOUNDARY_DESCRIPTION: the Go runner's listen address, `:4600` meaning every interface. Bound dual-stack where the pod has IPv6 and IPv4-only where it does not.
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

// UNIT_BOUNDARY_DESCRIPTION: what the runner's pod has to give its machines before any exists. The VMMs open /dev/kvm and /dev/net/tun, and the state directories must be traversable by them; a device that cannot be opened is reported and not fatal, because the error it causes at boot names the device. An install with no registry mounts the image directory read-only, with archives staged in it, so a chmod there fails with EROFS and is not fatal either: the mount decides what machine uids see, and a tree they cannot read fails at boot with a message naming it.
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
            runner_id: args.runner_id.clone(),
            image_budget: args.image_budget_bytes,
            crane: args.crane.clone(),
            init: Some(args.platform_init.clone()),
            ports: args.port_min..=args.port_max,
            memory_mib: i32::try_from(args.memory_mib)?,
            reserve_mib: i32::try_from(args.reserve_mib)?,
            allow_from: args.allow_from.0.clone(),
            pinned: Vec::new(),
            listen: None,
        },
        runtime.clone(),
    )?;
    warn_template_backed(&args.state_dir);

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
        tls = !args.tls_cert.is_empty(),
        platform_init = %args.platform_init.display(),
        metrics = %args.metrics_listen,
        "VM runner serving"
    );
    let serving = {
        let handle = handle.clone();
        async move {
            if args.tls_cert.is_empty() {
                axum_server::from_tcp(listener)
                    .handle(handle)
                    .serve(app)
                    .await
            } else {
                let _ = rustls::crypto::ring::default_provider().install_default();
                let tls = axum_server::tls_rustls::RustlsConfig::from_pem_file(
                    &args.tls_cert,
                    &args.tls_key,
                )
                .await?;
                axum_server::from_tcp_rustls(listener, tls)
                    .handle(handle)
                    .serve(app)
                    .await
            }
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

// UNIT_BOUNDARY_DESCRIPTION: names the machines whose storage disk is a qcow2 overlay over the shipped template, which the Go runner made for agents sized at exactly smolvm's default. Their home depends on the template file in this image; an upgrade that changes it changes the bytes under them. Reported so an operator can find them before an upgrade does.
fn warn_template_backed(state_dir: &Path) {
    let backed: Vec<String> = state::machine_ids(state_dir)
        .unwrap_or_default()
        .into_iter()
        .filter(|id| embedded::template_backed_storage(id))
        .collect();
    if !backed.is_empty() {
        tracing::warn!(machines = ?backed, "these machines' storage disks are overlays over the shipped disk template; a runner image with a different template would change the data under them");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: an allowlist fails open — a value it cannot read admits everybody rather than nobody, and says nothing. So each of the Go runner's three rules is pinned: entries split on commas, surrounding space ignored, blanks skipped, and anything that is not a CIDR refused before the runner starts rather than ignored while it runs.
    #[test]
    fn the_allowlist_reads_every_shape_the_go_runner_accepts_and_no_others() {
        assert_eq!(allow_from("").unwrap().0, vec![]);
        assert_eq!(allow_from(" , ").unwrap().0, vec![]);
        assert_eq!(
            allow_from("10.0.0.0/8, 192.168.1.0/24").unwrap().0,
            vec![
                "10.0.0.0/8".parse::<IpNet>().unwrap(),
                "192.168.1.0/24".parse().unwrap()
            ]
        );
        assert_eq!(
            allow_from("fd00::/8").unwrap().0,
            vec!["fd00::/8".parse::<IpNet>().unwrap()]
        );

        let err = allow_from("10.0.0.0/8,not-a-cidr").unwrap_err().to_string();
        assert!(
            err.contains("not-a-cidr"),
            "the refusal has to name the entry: {err}"
        );
    }

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

    // TEST_SCENARIO: `:4600` is the Go runner's spelling of every interface on a port. It must bind, and a port that is not a number must be refused rather than read as some default.
    #[test]
    fn the_go_runners_listen_address_binds_every_interface() {
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

    // TEST_SCENARIO: clap reads a Vec field as one value per occurrence, so a parser that returns the whole list against a Vec field builds, refuses a bad CIDR correctly, and then panics downcasting a good one. Parsing the flag through the real Args is what tells the two apart — the unit test above passes either way.
    #[test]
    fn a_parsed_allowlist_survives_being_read_back_off_the_args() {
        let args = Args::try_parse_from([
            "vm-runner",
            "--memory-mib=1",
            "--allow-from=10.0.0.0/8,192.168.1.0/24",
        ])
        .expect("these are the flags the controller passes");
        assert_eq!(args.allow_from.0.len(), 2);
        assert!(Args::try_parse_from(["vm-runner", "--allow-from=nope"]).is_err());
    }

    // TEST_SCENARIO: the controller builds the runner's arguments in code, and a flag this binary does not know is a runner pod that exits on start rather than a failed build. Every flag the controller's Deployment passes is read from that code and must be one this binary defines.
    #[test]
    fn every_flag_the_controller_passes_is_known() {
        use clap::CommandFactory;
        let path = "../controller/pkg/reconciler/vm_runner.go";
        let go = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("the controller builds the runner's args in {path}: {e}"));
        let deployment = go
            .split_once("func (r *AgentReconciler) applyRunnerDeployment(")
            .expect("vm_runner.go still builds the runner's Deployment")
            .1;
        let deployment = deployment.split_once("\n}").unwrap().0;
        let passed: Vec<&str> = deployment
            .split("\"--")
            .skip(1)
            .filter_map(|rest| rest.split_once('=').map(|(name, _)| name))
            .collect();
        assert!(passed.contains(&"metrics-listen"), "{passed:?}");
        let command = Args::command();
        for flag in passed {
            assert!(
                command.get_arguments().any(|a| a.get_long() == Some(flag)),
                "the controller passes --{flag}, which this runner does not define"
            );
        }
    }

    // TEST_SCENARIO: the image's ENTRYPOINT passes its own arguments ahead of the controller's, and this binary is meant to replace the Go runner under that same ENTRYPOINT. The arguments are read from the Dockerfile itself rather than copied here, so an ENTRYPOINT that gains a flag this binary does not know fails here instead of as a runner pod that exits on start.
    #[test]
    fn the_images_entrypoint_arguments_are_accepted() {
        let path = "../controller/Dockerfile.vm-runner";
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
        let mut argv = vec!["vm-runner".to_string()];
        argv.extend(words[runner + 1..].iter().cloned());
        argv.push("--memory-mib=1".to_string());
        Args::try_parse_from(&argv)
            .unwrap_or_else(|e| panic!("the ENTRYPOINT's arguments {argv:?} are rejected: {e}"));
    }
}
