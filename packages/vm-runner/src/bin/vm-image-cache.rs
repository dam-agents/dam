use std::path::PathBuf;

use clap::Parser;
use tokio_util::sync::CancellationToken;
use vm_runner::imagecache::ImageCache;
use vm_runner::preload::{parse_duration, parse_quantity, Preloader};
use vm_runner::pullauth::PullSecrets;

// UNIT_BOUNDARY_DESCRIPTION: the flags the Go image cache service defines, kept name-for-name, because the chart's DaemonSet sets them: image-dir, cache-id, image-budget, interval and images, and pull-secrets with pull-secret-namespace when the install names default agent pull Secrets.
#[derive(Parser, Debug)]
#[command(
    name = "vm-image-cache",
    about = "Fills a node's VM image cache before any runner needs it"
)]
struct Args {
    #[arg(long = "image-dir", default_value = "/var/lib/platform/images")]
    image_dir: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: the name this service's claims are published under. Required: an unnamed claim pins nothing.
    #[arg(long = "cache-id", default_value = "")]
    cache_id: String,
    #[arg(long = "image-budget", default_value = "")]
    image_budget: String,
    #[arg(long, default_value = "crane")]
    crane: String,
    #[arg(long, default_value = "")]
    images: String,
    #[arg(long, default_value = "5m")]
    interval: String,
    // UNIT_BOUNDARY_DESCRIPTION: comma-separated kubernetes.io/dockerconfigjson Secrets to fetch with, tried in order as the kubelet does: the install's default agent pull Secrets. Empty fetches anonymously.
    #[arg(long = "pull-secrets", default_value = "")]
    pull_secrets: String,
    // UNIT_BOUNDARY_DESCRIPTION: the namespace --pull-secrets live in, which is where agents run.
    #[arg(long = "pull-secret-namespace", default_value = "")]
    pull_secret_namespace: String,
}

// UNIT_BOUNDARY_DESCRIPTION: a runner believes a claim for thirty minutes, and this service refreshes its claims once per pass, so an interval approaching that window lets its pins lapse between two of its own passes. Fifteen minutes is the Go service's ceiling.
const MAX_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15 * 60);

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();
    let args = Args::parse();
    anyhow::ensure!(!args.cache_id.is_empty(), "--cache-id is required: it names this service's claims, and images claimed by nobody are the first thing eviction takes");
    let budget = parse_quantity(&args.image_budget)
        .ok()
        .filter(|b| *b > 0)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "--image-budget must be a positive quantity, got {:?}",
                args.image_budget
            )
        })?;
    let every = parse_duration(&args.interval)?;
    anyhow::ensure!(
        !every.is_zero() && every < MAX_INTERVAL,
        "--interval must be positive and well inside the window a runner believes a claim for"
    );
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(&args.image_dir)?;
        std::fs::set_permissions(&args.image_dir, std::fs::Permissions::from_mode(0o755))?;
    }
    let images: Vec<String> = args
        .images
        .split(',')
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(str::to_string)
        .collect();
    let secrets: Vec<String> = args
        .pull_secrets
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    let pull_secrets = if secrets.is_empty() {
        None
    } else {
        anyhow::ensure!(
            !args.pull_secret_namespace.is_empty(),
            "--pull-secret-namespace is required with --pull-secrets"
        );
        let _ = rustls::crypto::ring::default_provider().install_default();
        Some(PullSecrets::in_cluster(
            &args.pull_secret_namespace,
            secrets.clone(),
        )?)
    };
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async move {
            let lifetime = CancellationToken::new();
            tracing::info!(image_dir = %args.image_dir.display(), images = images.len(), pull_secrets = secrets.len(), interval = %args.interval, "VM image cache serving");
            let preloader = Preloader {
                cache: ImageCache {
                    dir: args.image_dir,
                    owner: args.cache_id,
                    budget,
                    crane: args.crane,
                    pinned: images,
                    lifetime: lifetime.clone(),
                },
                every,
                pull_secrets,
            };
            let running = tokio::spawn(preloader.run());
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
            tokio::select! {
                _ = term.recv() => {}
                _ = tokio::signal::ctrl_c() => {}
            }
            lifetime.cancel();
            let _ = running.await;
            anyhow::Ok(())
        })
}
