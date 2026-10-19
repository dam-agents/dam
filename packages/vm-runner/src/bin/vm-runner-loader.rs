use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use tokio::process::Command;
use tokio::signal::unix::{signal, SignalKind};
use tokio_util::sync::CancellationToken;
use vm_runner::api::{RunnerRelease, HELD_FAILED, HELD_RUNTIME, HELD_UNSTAGED};
use vm_runner::release::{self, Choice, Releases, RUNNER};

// UNIT_BOUNDARY_DESCRIPTION: the runner pod's entrypoint, and the node's stager. The pod's image is fixed for as long as the pod lives, and the runner's machines are processes of the pod, so a new runner release would otherwise reboot every machine with the pod. Run, the loader supervises one runner process and replaces it with the release the controller names over the runner's machine API, which the stager has copied onto the node; the machines outlive the runner process and the next one adopts them. Stage, it is the DaemonSet that does that copying.
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
        // UNIT_BOUNDARY_DESCRIPTION: the SELinux context to put on the release directory and everything in it, on a host that confines its containers: the directory the kubelet creates for a hostPath carries the host's own label, which a confined runner may not read its release from. Empty leaves the labels alone.
        #[arg(long = "selinux-label", default_value = "")]
        selinux_label: String,
    },
}

// UNIT_BOUNDARY_DESCRIPTION: how often the loader reads the release the runner wrote into the loader directory when the controller named it. The file is local, so a read costs nothing and a hand-off starts within this of the controller's call. VM_RUNNER_LOADER_POLL_MS overrides it so the hand-off test does not wait out a second per release.
const POLL: Duration = Duration::from_secs(1);

// UNIT_BOUNDARY_DESCRIPTION: how long a runner that took over must keep running before the loader trusts the release. One that exits sooner is a broken release, and the loader goes back to the one it replaced rather than restarting the broken one in a loop.
const SETTLE: Duration = Duration::from_secs(60);

// UNIT_BOUNDARY_DESCRIPTION: how long a runner handing off may take to close. Its close waits for the actions it runs, bounded by its own grace well inside this. A runner still alive past it is killed, which stops no machine: they are not its children's to lose.
const HAND_OFF_WAIT: Duration = Duration::from_secs(60);

const RESTART_BACKOFF_MAX: Duration = Duration::from_secs(30);

// UNIT_BOUNDARY_DESCRIPTION: how often a stop of the pod looks whether the runner it passes the stop to has set up its own stop yet.
const CATCH_POLL: Duration = Duration::from_millis(50);

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

// UNIT_BOUNDARY_DESCRIPTION: the loader holds every machine of its owner as their parent, and the kernel weighs a victim by memory plus its own adjustment: one it inherits from the container runtime ties with a VMM at the maximum as soon as it holds a few pages. It asks for the lowest score the kernel allows it, as the runner does, and a kernel that refuses leaves the inherited one in place, which is said on the console.
fn lower_own_oom_score_adj() {
    const PATH: &str = "/proc/self/oom_score_adj";
    if std::fs::write(PATH, "-1000").is_ok() {
        return;
    }
    if let Err(e) = std::fs::write(PATH, "0") {
        tracing::warn!(path = PATH, error = %e, "could not lower the loader's own OOM score; the kernel may weigh it against a machine");
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();
    if cfg!(target_os = "linux") {
        lower_own_oom_score_adj();
    }
    match Args::parse().command {
        Mode::Stage {
            builtin,
            runtime,
            into,
            release,
            keep,
            selinux_label,
        } => {
            if !selinux_label.is_empty() {
                release::relabel_tree(&into, &selinux_label)?;
            }
            let dest = release::stage(&builtin, &runtime, &into, &release, keep)?;
            if !selinux_label.is_empty() {
                release::relabel_tree(&into, &selinux_label)?;
            }
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
            let exits = exit_records(&args);
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
                },
                args,
                target_file: release::target_file(&loader_dir),
                status_file: release::status_file(&loader_dir),
                copies,
                runtimes,
                failed: None,
                unloadable: None,
                exits,
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
    unloadable: Option<(String, String)>,
    // UNIT_BOUNDARY_DESCRIPTION: where a reaped VMM's signal is recorded for the runner that adopted its machine, which is the only way a kill is still named after a hand-off: the machine outlives the runner process, and the next runner is not its VMM's parent.
    exits: PathBuf,
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
    // UNIT_BOUNDARY_DESCRIPTION: the runner's pid rather than a handle to wait on: the loader reaps every child itself, because after a hand-off the machines' VMMs are its children too and a death it does not read is a death nothing records — the next runner is not their parent and cannot read their status. The runner is started with `std::process::Command`, not tokio's, whose dropped handle reaps the child in the background and would read the very status this reap waits for.
    pid: i32,
    started: Instant,
    replaced: Option<Release>,
}

// UNIT_BOUNDARY_DESCRIPTION: how long the check that a release loads in this pod may take. It only prints the runner's usage.
const LOAD_CHECK: Duration = Duration::from_secs(10);

impl Loader {
    fn target(&self) -> String {
        release::read_target(&self.target_file)
    }

    fn builtin(&self) -> Release {
        Release {
            name: self.releases.builtin_release.clone(),
            dir: self.releases.builtin.clone(),
            runtime: self.releases.builtin_runtime.clone(),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the release to run for `target`, from the pod's own copies of it and its runtime, so a release the stager removes from the node never leaves a runner without its guest binaries or a VMM without its runtime. A release whose runner cannot even load in this pod — one linked against a newer libc than the pod's image has — is held as built for another pod, which the controller answers by rolling the pod, and is not checked again until the controller names another.
    async fn choose(&mut self, target: &str) -> Result<Release, (&'static str, String)> {
        if self.failed.as_deref() == Some(target) {
            return Err((
                HELD_FAILED,
                format!("{target} exited right after it took over"),
            ));
        }
        if let Some((_, message)) = self.unloadable.as_ref().filter(|(name, _)| name == target) {
            return Err((HELD_RUNTIME, message.clone()));
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
            outcome => {
                let message = format!(
                    "{name} does not load in this pod ({outcome:?}), so only a new pod runs it"
                );
                self.unloadable = Some((name, message.clone()));
                Err((HELD_RUNTIME, message))
            }
        }
    }

    fn spawn(&self, release: Release, replaced: Option<Release>) -> anyhow::Result<Running> {
        let builtin = self.builtin();
        let child = std::process::Command::new(release.dir.join(RUNNER))
            .args(release::args_for(
                &self.args,
                &[
                    (&builtin.dir, &release.dir),
                    (&builtin.runtime, &release.runtime),
                ],
            ))
            .spawn()?;
        let pid = i32::try_from(child.id())
            .map_err(|e| anyhow::anyhow!("the runner's pid is not one: {e}"))?;
        tracing::info!(release = release.name, dir = %release.dir.display(), runtime = %release.runtime.display(), pid, "started the runner");
        Ok(Running {
            release,
            pid,
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

    // UNIT_BOUNDARY_DESCRIPTION: removes the pod's copies the loader no longer needs: every release but the one running and the one it would go back to, and every runtime none of those runs against and no running VMM boots from. A machine booted before a hand-off keeps the runtime it booted until it stops.
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
                .filter(|dir| release::booted_from(Path::new("/proc"), dir)),
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

    // UNIT_BOUNDARY_DESCRIPTION: supervises the runner until the pod stops. A stop can arrive while no runner is there to take it — while the old one closes for a hand-off, a release is copied in, or a crashed runner waits out its backoff — and the machines are then left running with nobody to stop them. So the stop is kept until a runner is running again: a hand-off not yet begun is dropped, a backoff is cut short, and the runner started next is given the stop, which it ends by stopping every machine.
    async fn run(mut self) -> anyhow::Result<i32> {
        let stopping = CancellationToken::new();
        {
            let mut term = signal(SignalKind::terminate())?;
            let mut interrupt = signal(SignalKind::interrupt())?;
            let stopping = stopping.clone();
            tokio::spawn(async move {
                tokio::select! {
                    _ = term.recv() => {}
                    _ = interrupt.recv() => {}
                }
                stopping.cancel();
            });
        }
        let builtin = self.builtin();
        let mut running = match self.choose(&self.target()).await {
            Ok(release) if release.dir != builtin.dir => self.take_over(release, builtin)?,
            _ => self.spawn(builtin, None)?,
        };
        let mut backoff = Duration::from_secs(1);
        let mut tick = tokio::time::interval(
            env("VM_RUNNER_LOADER_POLL_MS")
                .parse()
                .map_or(POLL, Duration::from_millis),
        );
        loop {
            tokio::select! {
                _ = tick.tick() => {
                    if let Some(exited) = reap_children(running.pid, &self.exits) {
                        running = self.after_exit(running, exited, &mut backoff, &stopping).await?;
                        continue;
                    }
                    if running.started.elapsed() >= SETTLE {
                        running.replaced = None;
                    }
                    let target = self.target();
                    if target.is_empty() || target == running.release.name {
                        self.report(&running, &target, None);
                        continue;
                    }
                    match self.choose(&target).await {
                        Ok(_) if stopping.is_cancelled() => {}
                        Ok(release) => {
                            tracing::info!(from = running.release.name, to = release.name, "handing the machines off to another runner release");
                            hand_off(running.pid, &self.exits).await;
                            let replaced = running.release.clone();
                            running = self.take_over(release, replaced)?;
                            self.prune(&running);
                            self.report(&running, &target, None);
                        }
                        Err(held) => self.report(&running, &target, Some(held)),
                    }
                }
                () = stopping.cancelled() => return stop(running.pid, &self.exits).await,
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: what runs in place of a runner that exited: the release it replaced, where the new one did not last its settle window, and otherwise the same one again after a backoff that grows while a release keeps failing on start. A stop that arrives during the backoff ends the wait, and the next runner is started with the stop already waiting for it.
    async fn after_exit(
        &mut self,
        mut running: Running,
        exited: ExitStatus,
        backoff: &mut Duration,
        stopping: &CancellationToken,
    ) -> anyhow::Result<Running> {
        let ran = running.started.elapsed();
        match running.replaced.take() {
            Some(replaced) if ran < SETTLE => {
                tracing::error!(release = running.release.name, status = %exited, "the runner release exited right after it took over; going back to the one it replaced");
                self.failed = Some(running.release.name.clone());
                self.spawn(replaced, None)
            }
            _ => {
                *backoff = if ran < SETTLE {
                    (*backoff * 2).min(RESTART_BACKOFF_MAX)
                } else {
                    Duration::from_secs(1)
                };
                tracing::warn!(release = running.release.name, status = %exited, backoff_secs = backoff.as_secs(), "the runner exited; starting it again");
                tokio::select! {
                    () = tokio::time::sleep(*backoff) => {}
                    () = stopping.cancelled() => {}
                }
                self.spawn(running.release.clone(), None)
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the pod's only reaper. A VMM is a child of whichever runner process spawned it, and that process leaves its machines running when it hands off or is replaced, so from then on the VMMs are this loader's children: a death it does not read here stays a zombie, and its signal is the one fact about how a machine went down that no later runner can recover. The runner's own exit goes back to supervision, and any other child's signal is written where the runner that adopted the machine reads it.
fn reap_children(runner: i32, exits: &Path) -> Option<ExitStatus> {
    let mut runner_status = None;
    loop {
        let mut status = 0;
        // SAFETY: WNOHANG never blocks, and the kernel writes at most the status word at `status`.
        let pid = unsafe { libc::waitpid(-1, &raw mut status, libc::WNOHANG) };
        if pid <= 0 {
            break;
        }
        if pid == runner {
            runner_status = Some(ExitStatus::from_raw(status));
            continue;
        }
        if libc::WIFSIGNALED(status) {
            if let Err(e) = std::fs::create_dir_all(exits).and_then(|()| {
                std::fs::write(
                    exits.join(pid.to_string()),
                    libc::WTERMSIG(status).to_string(),
                )
            }) {
                tracing::warn!(pid, error = %e, "recording a machine's VMM exit for the next runner");
            }
        }
    }
    runner_status
}

// UNIT_BOUNDARY_DESCRIPTION: the directory the runner reads a handed-over machine's exit from: its own state directory, which the loader sees in the arguments it passes on. The runner falls back to the same default when it names none.
fn exit_records(args: &[String]) -> PathBuf {
    let state = args
        .iter()
        .position(|arg| arg == "--state-dir")
        .and_then(|at| args.get(at + 1))
        .cloned()
        .unwrap_or_else(|| "/var/lib/platform/machines".to_string());
    PathBuf::from(state).join(vm_runner::state::EXIT_RECORDS)
}

fn signal_child(pid: i32, signal: i32) {
    // SAFETY: kill(2) takes plain integers and touches no memory of this process.
    unsafe { libc::kill(pid, signal) };
}

async fn hand_off(pid: i32, exits: &Path) {
    signal_child(pid, libc::SIGUSR1);
    let deadline = Instant::now() + HAND_OFF_WAIT;
    while Instant::now() < deadline {
        if reap_children(pid, exits).is_some() {
            return;
        }
        tokio::time::sleep(CATCH_POLL).await;
    }
    tracing::warn!(
        "the runner did not close within the hand-off window; killing it, its machines stay up"
    );
    signal_child(pid, libc::SIGKILL);
    while reap_children(pid, exits).is_none() {
        tokio::time::sleep(CATCH_POLL).await;
    }
}

// UNIT_BOUNDARY_DESCRIPTION: passes the pod's stop to the runner once it catches SIGTERM. A runner just started has not set up its stop yet, and a SIGTERM before that kills it by default with every machine left running, which the pod's end then powers off.
async fn stop(pid: i32, exits: &Path) -> anyhow::Result<i32> {
    while !catches_term(pid) {
        if let Some(exited) = reap_children(pid, exits) {
            return Ok(exit_code(exited));
        }
        tokio::time::sleep(CATCH_POLL).await;
    }
    signal_child(pid, libc::SIGTERM);
    loop {
        if let Some(exited) = reap_children(pid, exits) {
            return Ok(exit_code(exited));
        }
        tokio::time::sleep(CATCH_POLL).await;
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether the child has a SIGTERM handler, from the caught-signal mask Linux shows in its status. The spawn returns only once the child has exec'd, so the mask is the runner's own and not the loader's it was forked from. Elsewhere there is no such mask to read, and the loader runs only in a Linux pod.
fn catches_term(#[cfg_attr(not(target_os = "linux"), allow(unused_variables))] pid: i32) -> bool {
    #[cfg(target_os = "linux")]
    if let Ok(status) = std::fs::read_to_string(format!("/proc/{pid}/status")) {
        return status
            .lines()
            .find_map(|line| line.strip_prefix("SigCgt:"))
            .and_then(|mask| u64::from_str_radix(mask.trim(), 16).ok())
            .is_some_and(|mask| mask & (1 << (libc::SIGTERM - 1)) != 0);
    }
    true
}

fn exit_code(status: ExitStatus) -> i32 {
    status
        .code()
        .unwrap_or_else(|| 128 + status.signal().unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: after a hand-off the machine's VMM is this loader's child, and no later runner can read its status: the loader reaps it and writes the signal where the runner that adopted the machine reads it, one file per pid. A child that is not the runner is never taken for it, and a normal exit leaves nothing to report.
    #[test]
    #[cfg(target_os = "linux")]
    fn a_machine_that_dies_while_no_runner_is_its_parent_leaves_a_record() {
        let dir = std::env::temp_dir().join(format!("vmr-exits-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let exits = dir.join(vm_runner::state::EXIT_RECORDS);
        let mut vmm = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let pid = i32::try_from(vmm.id()).unwrap();
        // SAFETY: kill(2) takes no pointers, and the pid is this test's own child.
        unsafe { libc::kill(pid, libc::SIGSYS) };
        let deadline = Instant::now() + Duration::from_secs(5);
        while !exits.join(pid.to_string()).exists() {
            assert!(Instant::now() < deadline, "the loader never reaped the VMM");
            reap_children(-1, &exits);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            std::fs::read_to_string(exits.join(pid.to_string())).unwrap(),
            libc::SIGSYS.to_string(),
            "the VMM's signal is what the next runner names the kill by"
        );
        let _ = vmm.wait();

        // TEST_SCENARIO: a child that exits on its own has no signal to record.
        let mut quiet = std::process::Command::new("true").spawn().unwrap();
        let quiet_pid = i32::try_from(quiet.id()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while reap_children(quiet_pid, &exits).is_none() {
            assert!(
                Instant::now() < deadline,
                "the loader never reaped the child"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(
            !exits.join(quiet_pid.to_string()).exists(),
            "a child that exited on its own left a kill record"
        );
        let _ = quiet.wait();
        let _ = std::fs::remove_dir_all(&dir);
    }

    // TEST_SCENARIO: the loader reads the runner's state directory out of the arguments it passes on, since that is where the runner it starts looks for a handed-over machine's exit; an argument list with none leaves the runner's own default.
    #[test]
    fn the_exit_records_sit_where_the_runner_reads_them() {
        let named = vec!["--state-dir".to_string(), "/srv/state".to_string()];
        assert_eq!(
            exit_records(&named),
            PathBuf::from("/srv/state").join(vm_runner::state::EXIT_RECORDS)
        );
        assert_eq!(
            exit_records(&[]),
            PathBuf::from("/var/lib/platform/machines").join(vm_runner::state::EXIT_RECORDS),
        );
    }

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
