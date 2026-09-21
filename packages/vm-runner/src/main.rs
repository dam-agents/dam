mod api;
mod guest;

use std::path::PathBuf;

use clap::Parser;

// UNIT_BOUNDARY_DESCRIPTION: every flag the controller's chart already passes, kept name-for-name with the Go runner this replaces. The chart is the contract: a rename here is a runner that starts with a flag its own Deployment does not set, which surfaces as a pod that will not come up rather than as a build failure.
#[derive(Parser, Debug)]
#[command(name = "vm-runner", about = "Hosts vm-backend agents as microVMs")]
struct Args {
    #[arg(long, default_value = ":4600")]
    listen: String,
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
    // UNIT_BOUNDARY_DESCRIPTION: CIDRs allowed to dial published machine ports; empty admits any.
    #[arg(long = "allow-from", default_value = "")]
    allow_from: String,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();
    let args = Args::parse();
    anyhow::ensure!(
        args.memory_mib > 0,
        "--memory-mib is required: without it the runner admits machines against no limit at all"
    );
    let token = std::fs::read_to_string(&args.token_file)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", args.token_file.display()))?;
    anyhow::ensure!(!token.trim().is_empty(), "the token file is empty");

    anyhow::bail!("the machine API is not served yet: this binary is the scaffold for the Rust runner, not the runner")
}
