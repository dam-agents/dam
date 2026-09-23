use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use tokio_util::sync::CancellationToken;
use vm_runner::cacheapi;
use vm_runner::imagecache::{CacheConfig, ImageCache, HOLD_LEASE, REF_FRESH};
use vm_runner::preload::{self, parse_duration, parse_quantity};

// UNIT_BOUNDARY_DESCRIPTION: the flags the chart's DaemonSet sets: where the node's cache directory is mounted and the socket in it runners reach this service on, the budget, the harness images to preload and how often, and the directory the install's default pull Secrets are mounted in when it names any.
#[derive(Parser, Debug)]
#[command(
    name = "vm-image-cache",
    about = "The only writer of a node's VM image cache: fetches, preloads and evicts for every runner on the node"
)]
struct Args {
    #[arg(long = "image-dir", default_value = "/var/lib/platform/images")]
    image_dir: PathBuf,
    #[arg(long, default_value = "/var/lib/platform/images/.cache.sock")]
    socket: PathBuf,
    #[arg(long = "image-budget", default_value = "")]
    image_budget: String,
    #[arg(long, default_value = "")]
    images: String,
    #[arg(long, default_value = "5m")]
    interval: String,
    // UNIT_BOUNDARY_DESCRIPTION: the projected volume of the install's default agent pull Secrets, one directory per Secret in list order. Empty preloads anonymously.
    #[arg(long = "pull-secret-dir", default_value = "")]
    pull_secret_dir: String,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();
    let args = Args::parse();
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
    anyhow::ensure!(!every.is_zero(), "--interval must be positive");
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
    let secrets = (!args.pull_secret_dir.is_empty()).then(|| PathBuf::from(&args.pull_secret_dir));
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async move {
            let lifetime = CancellationToken::new();
            let cache = Arc::new(ImageCache::open(CacheConfig {
                dir: args.image_dir.clone(),
                budget,
                crane: "crane".to_string(),
                pins: images.clone(),
                lifetime: lifetime.clone(),
                check_access: true,
                ref_fresh: REF_FRESH,
                hold_lease: HOLD_LEASE,
                hold_grace: HOLD_LEASE,
            }));
            tracing::info!(image_dir = %args.image_dir.display(), socket = %args.socket.display(), images = images.len(), pull_secrets = secrets.is_some(), interval = %args.interval, "VM image cache serving");
            let preloading = tokio::spawn(preload::run(
                cache.clone(),
                every,
                secrets,
                lifetime.clone(),
            ));
            let stop = lifetime.clone();
            let serving = tokio::spawn({
                let socket = args.socket.clone();
                async move {
                    cacheapi::serve(&socket, cache, async move { stop.cancelled().await }).await
                }
            });
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
            tokio::select! {
                _ = term.recv() => {}
                _ = tokio::signal::ctrl_c() => {}
            }
            lifetime.cancel();
            let _ = preloading.await;
            serving.await??;
            anyhow::Ok(())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: the chart's DaemonSet sets this binary's flags in a template, and a flag the binary does not know is a pod that exits on start on every node. Every `--flag` the template can pass is read from the template itself and must be one this binary defines, and the socket it names must be the one the controller tells every runner to dial.
    #[test]
    fn every_flag_the_chart_passes_is_known() {
        use clap::CommandFactory;
        let path = "../../helm/templates/controller/vm-image-cache.yaml";
        let template = std::fs::read_to_string(path).unwrap_or_else(|e| {
            panic!("the chart renders this service's DaemonSet from {path}: {e}")
        });
        let passed: Vec<(&str, &str)> = template
            .lines()
            .filter_map(|line| line.trim().strip_prefix("- --"))
            .filter_map(|rest| rest.split_once('='))
            .collect();
        let names: Vec<&str> = passed.iter().map(|(name, _)| *name).collect();
        for expected in ["image-dir", "socket", "images", "pull-secret-dir"] {
            assert!(names.contains(&expected), "{names:?}");
        }
        let command = Args::command();
        for flag in &names {
            assert!(
                command.get_arguments().any(|a| a.get_long() == Some(flag)),
                "the chart passes --{flag}, which this binary does not define"
            );
        }
        assert!(
            passed.contains(&("socket", "/var/lib/platform/images/.cache.sock")),
            "{passed:?}"
        );
    }
}
