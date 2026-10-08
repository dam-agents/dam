use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use tokio::process::{Child, Command};
use tokio::signal::unix::{signal, SignalKind};
use vm_runner::api::{RunnerRelease, HELD_FAILED, HELD_RUNTIME, HELD_UNSTAGED};
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
        // UNIT_BOUNDARY_DESCRIPTION: the smolvm runtime the pod's image carries, which the runner's own arguments name. A staged release built against another runtime runs against the pod's copy of that one instead.
        #[arg(long = "builtin-runtime")]
        builtin_runtime: PathBuf,
        #[arg(last = true)]
        args: Vec<String>,
    },
    // UNIT_BOUNDARY_DESCRIPTION: copies this image's release onto the node under the reference the chart names it by, then waits to be stopped, as a DaemonSet's pod must.
    Stage {
        #[arg(long)]
        builtin: PathBuf,
        #[arg(long)]
        runtime: PathBuf,
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
            runtime,
            into,
            release,
            keep,
        } => {
            let dest = release::stage(&builtin, &runtime, &into, &release, keep)?;
            tracing::info!(release, dir = %dest.display(), "staged the runner release");
            signal(SignalKind::terminate())?.recv().await;
            Ok(())
        }
        Mode::Run {
            builtin,
            builtin_runtime,
            args,
        } => {
            let staged = env(release::RELEASES_ENV);
            if staged.is_empty() {
                return Err(std::process::Command::new(builtin.join(RUNNER))
                    .args(&args)
                    .exec()
                    .into());
            }
            let loader_dir = PathBuf::from(env(release::LOADER_DIR_ENV));
            let copies = loader_dir.join("releases");
            let runtimes = loader_dir.join("runtimes");
            for dir in [&copies, &runtimes] {
                std::fs::create_dir_all(dir)?;
            }
            let code = Loader {
                releases: Releases {
                    builtin,
                    builtin_runtime,
                    builtin_release: env(release::BUILTIN_RELEASE_ENV),
                    staged: PathBuf::from(staged),
                    same_runtime_only: env(release::SAME_RUNTIME_ONLY_ENV) == "true",
                },
                args,
                target_file: PathBuf::from(env(release::RELEASE_FILE_ENV)),
                status_file: release::status_file(&loader_dir),
                copies,
                runtimes,
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
    runtimes: PathBuf,
    failed: Option<String>,
}

// UNIT_BOUNDARY_DESCRIPTION: a release the loader can run: its name, the directory of its binaries and the runtime it runs against, both in the pod.
#[derive(Clone)]
struct Release {
    name: String,
    dir: PathBuf,
    runtime: PathBuf,
}

struct Running {
    release: Release,
    child: Child,
    started: Instant,
    replaced: Option<Release>,
}

// UNIT_BOUNDARY_DESCRIPTION: how long the check that a release loads in this pod may take. It only prints the runner's usage.
const LOAD_CHECK: Duration = Duration::from_secs(10);

impl Loader {
    fn target(&self) -> String {
        std::fs::read_to_string(&self.target_file)
            .map(|t| t.trim().to_string())
            .unwrap_or_default()
    }

    fn builtin(&self) -> Release {
        Release {
            name: self.releases.builtin_release.clone(),
            dir: self.releases.builtin.clone(),
            runtime: self.releases.builtin_runtime.clone(),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the release to run for `target`, from the pod's own copies of it and its runtime, so a release the stager removes from the node never leaves a runner without its guest binaries or a VMM without its runtime. A release whose runner cannot even load in this pod — one linked against a newer libc than the pod's image has — is held as built for another pod, which the controller answers by rolling the pod.
    async fn choose(&self, target: &str) -> Result<Release, (&'static str, String)> {
        if self.failed.as_deref() == Some(target) {
            return Err((
                HELD_FAILED,
                format!("{target} exited right after it took over"),
            ));
        }
        let (name, dir, runtime) = match self.releases.choose(target) {
            Choice::Held { held, message } => return Err((held, message)),
            Choice::Run { dir, .. } if dir == self.releases.builtin => return Ok(self.builtin()),
            Choice::Run {
                release,
                dir,
                runtime,
            } => (release, dir, runtime),
        };
        let copied = release::stage_files(&dir, &self.copies, &name).and_then(|dir| {
            let runtime = match runtime {
                None => self.releases.builtin_runtime.clone(),
                Some(staged) => {
                    let id = release::runtime_id(&dir).unwrap_or_default();
                    let copy = self.runtimes.join(&id);
                    release::copy_tree(&staged, &copy)?;
                    copy
                }
            };
            Ok(Release {
                name: name.clone(),
                dir,
                runtime,
            })
        });
        let release =
            copied.map_err(|e| (HELD_UNSTAGED, format!("copying {name} into the pod: {e:#}")))?;
        let loads = Command::new(release.dir.join(RUNNER))
            .arg("--help")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .status();
        match tokio::time::timeout(LOAD_CHECK, loads).await {
            Ok(Ok(status)) if status.success() => Ok(release),
            outcome => Err((
                HELD_RUNTIME,
                format!(
                    "{name} does not load in this pod ({outcome:?}), so only a new pod runs it"
                ),
            )),
        }
    }

    fn spawn(&self, release: Release, replaced: Option<Release>) -> anyhow::Result<Running> {
        let builtin = self.builtin();
        let child = Command::new(release.dir.join(RUNNER))
            .args(release::args_for(
                &self.args,
                &[
                    (&builtin.dir, &release.dir),
                    (&builtin.runtime, &release.runtime),
                ],
            ))
            .spawn()?;
        tracing::info!(release = release.name, dir = %release.dir.display(), runtime = %release.runtime.display(), "started the runner");
        Ok(Running {
            release,
            child,
            started: Instant::now(),
            replaced,
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: starts `release` in place of `fallback`. A release that cannot even be started is held as failed and the fallback started again, because the loader exiting would end the pod and every machine in it.
    fn take_over(&mut self, release: Release, fallback: Release) -> anyhow::Result<Running> {
        let name = release.name.clone();
        match self.spawn(release, Some(fallback.clone())) {
            Ok(running) => Ok(running),
            Err(e) => {
                tracing::error!(release = name, error = %format!("{e:#}"), "the runner release could not be started; going back to the one it replaced");
                self.failed = Some(name);
                self.spawn(fallback, None)
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: removes the pod's copies the loader no longer needs: every release but the one running and the one it would go back to, and every runtime none of those runs against and no VMM still maps. A machine booted before a hand-off keeps the runtime it booted until it stops.
    fn prune(&self, running: &Running) {
        let kept: Vec<&Release> = std::iter::once(&running.release)
            .chain(running.replaced.as_ref())
            .collect();
        let releases: Vec<&Path> = kept.iter().map(|r| r.dir.as_path()).collect();
        let mut runtimes: Vec<PathBuf> = kept.iter().map(|r| r.runtime.clone()).collect();
        runtimes.extend(
            std::fs::read_dir(&self.runtimes)
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|dir| release::mapped(Path::new("/proc"), dir)),
        );
        let runtimes: Vec<&Path> = runtimes.iter().map(PathBuf::as_path).collect();
        for (dir, keep) in [(&self.copies, &releases), (&self.runtimes, &runtimes)] {
            if let Err(e) = release::prune(dir, keep) {
                tracing::warn!(error = %format!("{e:#}"), dir = %dir.display(), "removing the pod's copies it no longer needs");
            }
        }
    }

    fn report(&self, running: &Running, target: &str, held: Option<(&str, String)>) {
        let (held, message) = held.map_or_else(Default::default, |(held, message)| {
            (held.to_string(), message)
        });
        let status = RunnerRelease {
            running: running.release.name.clone(),
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
        let builtin = self.builtin();
        let mut running = match self.choose(&self.target()).await {
            Ok(release) if release.dir != builtin.dir => self.take_over(release, builtin)?,
            _ => self.spawn(builtin, None)?,
        };
        let mut backoff = Duration::from_secs(1);
        let mut tick = tokio::time::interval(POLL);
        loop {
            tokio::select! {
                exited = running.child.wait() => {
                    let exited = exited?;
                    let ran = running.started.elapsed();
                    running = match running.replaced.take() {
                        Some(replaced) if ran < SETTLE => {
                            tracing::error!(release = running.release.name, status = %exited, "the runner release exited right after it took over; going back to the one it replaced");
                            self.failed = Some(running.release.name.clone());
                            self.spawn(replaced, None)?
                        }
                        _ => {
                            backoff = if ran < SETTLE { (backoff * 2).min(RESTART_BACKOFF_MAX) } else { Duration::from_secs(1) };
                            tracing::warn!(release = running.release.name, status = %exited, backoff_secs = backoff.as_secs(), "the runner exited; starting it again");
                            tokio::time::sleep(backoff).await;
                            self.spawn(running.release.clone(), None)?
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
                    if target.is_empty() || target == running.release.name {
                        self.report(&running, &target, None);
                        continue;
                    }
                    match self.choose(&target).await {
                        Ok(release) => {
                            tracing::info!(from = running.release.name, to = release.name, "handing the machines off to another runner release");
                            hand_off(&mut running.child).await;
                            let replaced = running.release.clone();
                            running = self.take_over(release, replaced)?;
                            self.prune(&running);
                            self.report(&running, &target, None);
                        }
                        Err(held) => self.report(&running, &target, Some(held)),
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
            Ok(Mode::Run {
                builtin,
                builtin_runtime,
                args,
            }) => {
                assert_eq!(builtin_runtime, PathBuf::from("/opt/smolvm"));
                assert_eq!(builtin, PathBuf::from("/usr/local/libexec/vm-runner"));
                assert!(args.contains(&"--smolvm".to_string()), "{args:?}");
            }
            other => panic!("{words:?} is not a loader run: {other:?}"),
        }
    }
}
