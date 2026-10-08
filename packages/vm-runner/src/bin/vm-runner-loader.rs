use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::PathBuf;
use std::process::ExitStatus;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use tokio::process::{Child, Command};
use tokio::signal::unix::{signal, SignalKind};
use vm_runner::api::{RunnerRelease, HELD_FAILED, HELD_UNSTAGED};
use vm_runner::release::{self, Choice, Releases, RUNNER};

// UNIT_BOUNDARY_DESCRIPTION: the runner pod's entrypoint, and the node's stager. The pod's image is fixed for as long as the pod lives, and the runner's machines are processes of the pod, so a new runner release would otherwise reboot every machine with the pod. Run, the loader supervises one runner process and replaces it with the release the controller names, which the stager has copied onto the node; the machines outlive the runner process and the next one adopts them. Stage, it is the DaemonSet that does that copying.
#[derive(Parser, Debug)]
#[command(
    name = "vm-runner-loader",
    about = "Runs the VM runner release the controller names, without restarting its machines"
)]
struct Args {
    #[command(subcommand)]
    command: Mode,
}

#[derive(Subcommand, Debug)]
enum Mode {
    // UNIT_BOUNDARY_DESCRIPTION: supervises the runner, passing it every argument after `--`. Where the controller has set no release directory the loader becomes the pod's own runner instead, as the runner pod was before there was a loader.
    Run {
        #[arg(long)]
        builtin: PathBuf,
        #[arg(last = true)]
        args: Vec<String>,
    },
    // UNIT_BOUNDARY_DESCRIPTION: copies this image's release onto the node under the reference the chart names it by, then waits to be stopped, as a DaemonSet's pod must.
    Stage {
        #[arg(long)]
        builtin: PathBuf,
        #[arg(long)]
        into: PathBuf,
        #[arg(long)]
        release: String,
        #[arg(long, default_value_t = 3)]
        keep: usize,
    },
}

// UNIT_BOUNDARY_DESCRIPTION: how often the loader reads the release the controller names. The kubelet refreshes a mounted ConfigMap within about a minute, so a faster read buys nothing.
const POLL: Duration = Duration::from_secs(5);

// UNIT_BOUNDARY_DESCRIPTION: how long a runner that took over must keep running before the loader trusts the release. One that exits sooner is a broken release, and the loader goes back to the one it replaced rather than restarting the broken one in a loop.
const SETTLE: Duration = Duration::from_secs(60);

// UNIT_BOUNDARY_DESCRIPTION: how long a runner handing off may take to close. Its close waits for the actions it runs, bounded by its own grace well inside this. A runner still alive past it is killed, which stops no machine: they are not its children's to lose.
const HAND_OFF_WAIT: Duration = Duration::from_secs(60);

const RESTART_BACKOFF_MAX: Duration = Duration::from_secs(30);

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();
    match Args::parse().command {
        Mode::Stage {
            builtin,
            into,
            release,
            keep,
        } => {
            let dest = release::stage(&builtin, &into, &release, keep)?;
            tracing::info!(release, dir = %dest.display(), "staged the runner release");
            signal(SignalKind::terminate())?.recv().await;
            Ok(())
        }
        Mode::Run { builtin, args } => {
            let staged = env(release::RELEASES_ENV);
            if staged.is_empty() {
                return Err(std::process::Command::new(builtin.join(RUNNER))
                    .args(&args)
                    .exec()
                    .into());
            }
            let loader_dir = PathBuf::from(env(release::LOADER_DIR_ENV));
            let copies = loader_dir.join("releases");
            std::fs::create_dir_all(&copies)?;
            let code = Loader {
                releases: Releases {
                    builtin,
                    builtin_release: env(release::BUILTIN_RELEASE_ENV),
                    staged: PathBuf::from(staged),
                },
                args,
                target_file: PathBuf::from(env(release::RELEASE_FILE_ENV)),
                status_file: release::status_file(&loader_dir),
                copies,
                failed: None,
            }
            .run()
            .await?;
            std::process::exit(code)
        }
    }
}

struct Loader {
    releases: Releases,
    args: Vec<String>,
    target_file: PathBuf,
    status_file: PathBuf,
    copies: PathBuf,
    failed: Option<String>,
}

struct Running {
    release: String,
    dir: PathBuf,
    child: Child,
    started: Instant,
    replaced: Option<(String, PathBuf)>,
}

impl Loader {
    fn target(&self) -> String {
        std::fs::read_to_string(&self.target_file)
            .map(|t| t.trim().to_string())
            .unwrap_or_default()
    }

    // UNIT_BOUNDARY_DESCRIPTION: the release to run for `target`, from the pod's own copy of it. The copy keeps the release the runner runs and the one it replaced, so a release the stager removes from the node never leaves a runner without its guest binaries.
    fn choose(&self, target: &str) -> Choice {
        if self.failed.as_deref() == Some(target) {
            return Choice::Held {
                held: HELD_FAILED,
                message: format!("{target} exited right after it took over"),
            };
        }
        match self.releases.choose(target) {
            Choice::Run { release, dir } if dir != self.releases.builtin => {
                match release::stage(&dir, &self.copies, &release, 2) {
                    Ok(dir) => Choice::Run { release, dir },
                    Err(e) => Choice::Held {
                        held: HELD_UNSTAGED,
                        message: format!("copying {release} into the pod: {e:#}"),
                    },
                }
            }
            choice => choice,
        }
    }

    fn spawn(
        &self,
        release: String,
        dir: PathBuf,
        replaced: Option<(String, PathBuf)>,
    ) -> anyhow::Result<Running> {
        let child = Command::new(dir.join(RUNNER))
            .args(release::args_for(&self.args, &self.releases.builtin, &dir))
            .spawn()?;
        tracing::info!(release, dir = %dir.display(), "started the runner");
        Ok(Running {
            release,
            dir,
            child,
            started: Instant::now(),
            replaced,
        })
    }

    fn report(&self, running: &Running, target: &str, choice: Option<&Choice>) {
        let (held, message) = match choice {
            Some(Choice::Held { held, message }) => (held.to_string(), message.clone()),
            _ => (String::new(), String::new()),
        };
        let status = RunnerRelease {
            running: running.release.clone(),
            target: target.to_string(),
            held,
            message,
        };
        if release::read_status(&self.status_file) != status {
            if let Err(e) = release::write_status(&self.status_file, &status) {
                tracing::warn!(error = %format!("{e:#}"), "writing the release status");
            }
        }
    }

    async fn run(mut self) -> anyhow::Result<i32> {
        let mut term = signal(SignalKind::terminate())?;
        let mut interrupt = signal(SignalKind::interrupt())?;
        let builtin = (
            self.releases.builtin_release.clone(),
            self.releases.builtin.clone(),
        );
        let mut running = match self.choose(&self.target()) {
            Choice::Run { release, dir } if dir != builtin.1 => {
                self.spawn(release, dir, Some(builtin))?
            }
            _ => self.spawn(builtin.0, builtin.1, None)?,
        };
        let mut backoff = Duration::from_secs(1);
        let mut tick = tokio::time::interval(POLL);
        loop {
            tokio::select! {
                exited = running.child.wait() => {
                    let exited = exited?;
                    let ran = running.started.elapsed();
                    running = match running.replaced.take() {
                        Some((release, dir)) if ran < SETTLE => {
                            tracing::error!(release = running.release, status = %exited, "the runner release exited right after it took over; going back to the one it replaced");
                            self.failed = Some(running.release.clone());
                            self.spawn(release, dir, None)?
                        }
                        _ => {
                            backoff = if ran < SETTLE { (backoff * 2).min(RESTART_BACKOFF_MAX) } else { Duration::from_secs(1) };
                            tracing::warn!(release = running.release, status = %exited, backoff_secs = backoff.as_secs(), "the runner exited; starting it again");
                            tokio::time::sleep(backoff).await;
                            self.spawn(running.release.clone(), running.dir.clone(), None)?
                        }
                    };
                }
                _ = term.recv() => return stop(&mut running.child).await,
                _ = interrupt.recv() => return stop(&mut running.child).await,
                _ = tick.tick() => {
                    if running.started.elapsed() >= SETTLE {
                        running.replaced = None;
                    }
                    let target = self.target();
                    if target.is_empty() || target == running.release {
                        self.report(&running, &target, None);
                        continue;
                    }
                    let choice = self.choose(&target);
                    if let Choice::Run { release, dir } = choice {
                        tracing::info!(from = running.release, to = release, "handing the machines off to another runner release");
                        hand_off(&mut running.child).await;
                        let replaced = (running.release.clone(), running.dir.clone());
                        running = self.spawn(release, dir, Some(replaced))?;
                        self.report(&running, &target, None);
                    } else {
                        self.report(&running, &target, Some(&choice));
                    }
                }
            }
        }
    }
}

fn signal_child(child: &Child, signal: i32) {
    if let Some(pid) = child.id().and_then(|pid| i32::try_from(pid).ok()) {
        // SAFETY: kill(2) takes plain integers and touches no memory of this process.
        unsafe { libc::kill(pid, signal) };
    }
}

async fn hand_off(child: &mut Child) {
    signal_child(child, libc::SIGUSR1);
    if tokio::time::timeout(HAND_OFF_WAIT, child.wait())
        .await
        .is_err()
    {
        tracing::warn!(
            "the runner did not close within the hand-off window; killing it, its machines stay up"
        );
        let _ = child.kill().await;
    }
}

async fn stop(child: &mut Child) -> anyhow::Result<i32> {
    signal_child(child, libc::SIGTERM);
    Ok(exit_code(child.wait().await?))
}

fn exit_code(status: ExitStatus) -> i32 {
    status
        .code()
        .unwrap_or_else(|| 128 + status.signal().unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: the chart runs the stager from this binary with the flags its DaemonSet template names, and the image runs the loader with the words of its ENTRYPOINT. A flag either names that this binary does not know is a pod that exits on start rather than a failed build.
    #[test]
    fn the_chart_and_the_image_start_the_loader_with_flags_it_knows() {
        let path = "../../helm/templates/controller/vm-runner-releases.yaml";
        let template = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("the chart renders the stager from {path}: {e}"));
        let mut stage = vec!["vm-runner-loader".to_string(), "stage".to_string()];
        stage.extend(
            template
                .lines()
                .filter_map(|line| line.trim().strip_prefix("- --"))
                .map(|flag| format!("--{}", flag.split('=').next().unwrap_or(flag)) + "=x"),
        );
        assert!(
            matches!(
                Args::try_parse_from(&stage).map(|a| a.command),
                Ok(Mode::Stage { .. })
            ),
            "{stage:?}"
        );

        let image =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/image.toml")).unwrap();
        let line = image
            .lines()
            .find_map(|line| line.strip_prefix("entrypoint = "))
            .expect("the runner image has an entrypoint");
        let words: Vec<String> = serde_json::from_str(line.trim()).unwrap();
        let loader = words.iter().position(|w| w == "vm-runner-loader").unwrap();
        match Args::try_parse_from(&words[loader..]).map(|a| a.command) {
            Ok(Mode::Run { builtin, args }) => {
                assert_eq!(builtin, PathBuf::from("/usr/local/libexec/vm-runner"));
                assert!(args.contains(&"--smolvm".to_string()), "{args:?}");
            }
            other => panic!("{words:?} is not a loader run: {other:?}"),
        }
    }
}
