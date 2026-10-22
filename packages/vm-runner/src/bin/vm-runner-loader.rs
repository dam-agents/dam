use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::process::Command;
use tokio::signal::unix::{signal, SignalKind};
use vm_runner::api::{RunnerRelease, HELD_FAILED, HELD_RUNTIME, HELD_UNSTAGED};
use vm_runner::release::{self, Choice, Releases, LOADER, RUNNER};

// UNIT_BOUNDARY_DESCRIPTION: the runner pod's entrypoint, and the node's stager. The pod's image is fixed for as long as the pod lives, and the runner's machines are processes of the pod, so a new runner release would otherwise reboot every machine with the pod. Run, the loader supervises one runner process and replaces it, and itself, with the release the controller names over the runner's machine API, which the stager has copied onto the node; the machines outlive the runner process and the next one adopts them. Stage, it is the DaemonSet that does that copying.
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
        // UNIT_BOUNDARY_DESCRIPTION: every step this loader takes before it supervises, and then exit: the pod's own loader runs it on the loader a release carries before it becomes it, since the exec never comes back.
        #[arg(long)]
        check: bool,
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

// UNIT_BOUNDARY_DESCRIPTION: the two signals a stop of the pod arrives as, held or released for one call.
fn stop_signals() -> libc::sigset_t {
    // SAFETY: these take a signal set this call owns and no pointers of ours, and a zeroed set is what sigemptyset fills.
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGTERM);
        libc::sigaddset(&mut set, libc::SIGINT);
        set
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the stop of the pod, taken by a handler of this process's own rather than by an async runtime's: a stop a runtime has accepted is one this process can no longer find in the kernel, and the loader that becomes another has to know whether one is in hand before it execs.
static STOPPED: AtomicBool = AtomicBool::new(false);

extern "C" fn note_stop(_: libc::c_int) {
    STOPPED.store(true, Ordering::SeqCst);
}

// UNIT_BOUNDARY_DESCRIPTION: takes a stop of the pod into this process's own hands, which is what makes it countable: under the default action a stop ends the pod, and every machine it holds is powered off with it.
fn install_stop_handler() {
    // SAFETY: the handler only stores into a static, which is async-signal-safe, and every set this touches is the call's own.
    unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = note_stop as *const () as libc::sighandler_t;
        action.sa_flags = libc::SA_RESTART;
        libc::sigemptyset(&mut action.sa_mask);
        for signal in [libc::SIGTERM, libc::SIGINT] {
            libc::sigaction(signal, &raw const action, std::ptr::null_mut());
        }
    }
}

fn stop_seen() -> bool {
    STOPPED.load(Ordering::SeqCst)
}

// UNIT_BOUNDARY_DESCRIPTION: resolves once this process has a stop in hand, which is what ends a check that would otherwise outlast the pod's grace: the kubelet kills a pod whose loader is still deciding, and every machine it holds is powered off with it.
async fn stopped() {
    while !stop_seen() {
        tokio::time::sleep(CATCH_POLL).await;
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether a stop the kernel has taken for this process but not yet handed to a handler is waiting: a stop delivered while the mask is on is one only this sees, and it is the other half of what a stop in hand means.
fn stop_waiting() -> bool {
    let mut pending: libc::sigset_t = unsafe { std::mem::zeroed() };
    // SAFETY: sigpending fills a set this call owns, and sigismember only reads one.
    unsafe { libc::sigpending(&raw mut pending) };
    [libc::SIGTERM, libc::SIGINT]
        .into_iter()
        .any(|signal| unsafe { libc::sigismember(&raw const pending, signal) } == 1)
}

// UNIT_BOUNDARY_DESCRIPTION: a moment inside the window a stop can be missed in, opened by a test so it can deliver one there; no pod sets either name.
fn pause(name: &str) {
    if let Ok(ms) = env(name).parse::<u64>() {
        std::thread::sleep(Duration::from_millis(ms));
    }
}

// UNIT_BOUNDARY_DESCRIPTION: why this process did not become a release's loader: the release is held as failed, or the pod is stopping and what this process runs must outlive the decision, so that the stop still reaches a runner.
enum Become {
    Failed(&'static str, String),
    Stopping,
}

// UNIT_BOUNDARY_DESCRIPTION: holds a stop for the transition an exec makes, which keeps a signal mask and nothing else: a stop delivered after the loader's last look at its token would otherwise be taken by a handler the exec discards, and the machines it would have stopped are powered off with the pod instead.
fn block_stop_signals() {
    let set = stop_signals();
    // SAFETY: the set lives for the call and the mask it replaces is not read.
    unsafe { libc::pthread_sigmask(libc::SIG_BLOCK, &raw const set, std::ptr::null_mut()) };
}

// UNIT_BOUNDARY_DESCRIPTION: releases what block_stop_signals held, which a loader does once it has a handler of its own: a stop held across the exec reaches that rather than the default action that would end the pod with its machines running, and a loader that gives the exec up takes the stop it held itself.
fn unblock_stop_signals() {
    let set = stop_signals();
    // SAFETY: as above.
    unsafe { libc::pthread_sigmask(libc::SIG_UNBLOCK, &raw const set, std::ptr::null_mut()) };
}

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
            check,
            args,
        } => {
            let staged = env(release::RELEASES_ENV);
            if staged.is_empty() {
                // UNIT_BOUNDARY_DESCRIPTION: a pod whose controller sets no release directory runs the pod's own runner, as the runner pod did before there was a loader. A check has nothing to look at there, and starting the runner from one would be a second runner for the same machines.
                if check {
                    return Ok(());
                }
                return Err(std::process::Command::new(builtin.join(RUNNER))
                    .args(&args)
                    .exec()
                    .into());
            }
            become_the_reaper_of_every_machine();
            let exits = exit_records(&args);
            let loader_dir = PathBuf::from(env(release::LOADER_DIR_ENV));
            let copies = loader_dir.join("releases");
            let runtimes = loader_dir.join("runtimes");
            for dir in [&copies, &runtimes] {
                std::fs::create_dir_all(dir)?;
            }
            let handover_path = release::handover_file(&loader_dir);
            // UNIT_BOUNDARY_DESCRIPTION: the loader binary this process is, by its bytes: the one the loader before it exec'd, which it wrote down, or, in a pod that never became another, the one the pod's image carries. A handover that cannot be read or taken back is said on the console, and the pod then runs as one that never became another: the release the controller names is looked up again rather than started from a note, and the pod's image is what it would go back to.
            let handover = if check {
                release::Handover::default()
            } else {
                release::take_handover(&handover_path).unwrap_or_else(|e| {
                    tracing::error!(error = %format!("{e:#}"), path = %handover_path.display(), "reading and removing what the loader this pod replaced left; running as a pod that never became another loader");
                    release::Handover::default()
                })
            };
            let identity = (!handover.loader_digest.is_empty())
                .then(|| handover.loader_digest.clone())
                .or_else(|| release::digest(&builtin.join(LOADER)).ok().flatten());
            let mut loader = Loader {
                releases: Releases {
                    builtin,
                    builtin_runtime,
                    builtin_release: env(release::BUILTIN_RELEASE_ENV),
                    staged: PathBuf::from(staged),
                },
                args,
                target_file: release::target_file(&loader_dir),
                status_file: release::status_file(&loader_dir),
                handover_file: handover_path,
                handover,
                identity,
                copies,
                runtimes,
                failed: None,
                unloadable: None,
                exits,
            };
            if check {
                return match loader.check().await {
                    Ok(()) => Ok(()),
                    Err((_, message)) => {
                        eprintln!("{message}");
                        std::process::exit(1)
                    }
                };
            }
            let code = loader.run().await?;
            std::process::exit(code)
        }
    }
}

struct Loader {
    releases: Releases,
    args: Vec<String>,
    target_file: PathBuf,
    status_file: PathBuf,
    handover_file: PathBuf,
    // UNIT_BOUNDARY_DESCRIPTION: what the loader this process replaced left for it, which an exec keeps no other trace of: the loader binary this process is, the release it accepted for this one to start, and the release it ran before.
    handover: release::Handover,
    // UNIT_BOUNDARY_DESCRIPTION: the bytes of the loader binary this process runs, which is what a release's loader is compared with: the file it was staged at can be replaced under the same name, so a path cannot tell this pod what it already is.
    identity: Option<Vec<u8>>,
    copies: PathBuf,
    runtimes: PathBuf,
    failed: Option<(String, String)>,
    unloadable: Option<(String, String)>,
    // UNIT_BOUNDARY_DESCRIPTION: where a reaped VMM's signal is recorded for the runner that adopted its machine, which is the only way a kill is still named after a hand-off: the machine outlives the runner process, and the next runner is not its VMM's parent. The loader inherits those VMMs because it asks to be the pod's subreaper, so this process is the one that reads their status.
    exits: PathBuf,
}

// UNIT_BOUNDARY_DESCRIPTION: a release the loader can run: its name, the directory of its binaries and the runtime it runs against, both in the pod.
#[derive(Clone)]
struct Release {
    name: String,
    dir: PathBuf,
    runtime: PathBuf,
}

impl From<release::Snapshot> for Release {
    fn from(snapshot: release::Snapshot) -> Self {
        Self {
            name: snapshot.name,
            dir: snapshot.dir,
            runtime: snapshot.runtime,
        }
    }
}

struct Running {
    release: Release,
    // UNIT_BOUNDARY_DESCRIPTION: the runner's pid rather than a handle to wait on: the loader reaps every child itself, because after a hand-off the machines' VMMs are its children too and a death it does not read is a death nothing records — the next runner is not their parent and cannot read their status. The runner is started with `std::process::Command`, not tokio's, whose dropped handle reaps the child in the background and would read the very status this reap waits for.
    pid: i32,
    started: Instant,
    replaced: Option<Release>,
}

// UNIT_BOUNDARY_DESCRIPTION: how long the check that a release's binary loads in this pod may take. It only prints the binary's usage.
const LOAD_CHECK: Duration = Duration::from_secs(10);

// UNIT_BOUNDARY_DESCRIPTION: how long a release's loader may take to say it starts here: it does everything a start does but supervise, which includes copying the release and its runtime into the pod, so it takes as long as a start instead of as long as a usage line.
const START_CHECK: Duration = Duration::from_secs(120);

// UNIT_BOUNDARY_DESCRIPTION: whether a binary of a release loads in this pod at all: it prints its usage and exits, which one linked against a newer libc than the pod's image has cannot. A release's loader is not checked this way — the exec that becomes it never comes back, so it is asked for its whole start (below).
async fn loads(binary: &Path) -> Result<(), String> {
    let usage = Command::new(binary)
        .arg("--help")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .status();
    match tokio::time::timeout(LOAD_CHECK, usage).await {
        Ok(Ok(status)) if status.success() => Ok(()),
        outcome => Err(format!("{outcome:?}")),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether a release's loader starts in this pod at all, asked of the loader itself: it is run in check mode, which is every step it takes before it supervises — the release the controller named, the pod's copy of it, and the release's runner loading here. That is what the pod's own loader asks before it becomes another, since the exec never comes back: a loader that could not start would leave the pod with nothing to supervise its machines, and only a new pod would bring them back.
async fn starts(loader: &Path) -> Result<(), String> {
    let mut argv: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    // UNIT_BOUNDARY_DESCRIPTION: the subcommand, then the check, then the rest of what this loader was given, the runner's own arguments after its `--` among them.
    argv.insert(1, "--check".into());
    let check = Command::new(loader)
        .args(&argv)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(START_CHECK, check).await {
        Ok(Ok(out)) if out.status.success() => Ok(()),
        Ok(Ok(out)) => Err(format!(
            "{} {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        )),
        outcome => Err(format!("{outcome:?}")),
    }
}

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

    // UNIT_BOUNDARY_DESCRIPTION: the release the loader this process replaced ran, which a release that fails right after it takes over gives the machines back to. A pod that never became another loader has none, and the pod's image is what it goes back to.
    fn replaced(&self) -> Option<Release> {
        self.handover.replaced.as_ref().map(|replaced| Release {
            name: replaced.name.clone(),
            dir: replaced.dir.clone(),
            runtime: replaced.runtime.clone(),
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: every step this loader takes before it supervises, so the pod's own loader can tell whether the release's loader would start here at all. Nothing of it outlives the check: the release it copies in is what the loader that follows copies too.
    async fn check(&mut self) -> Result<(), (&'static str, String)> {
        self.choose(&self.target()).await.map(|_| ())
    }

    // UNIT_BOUNDARY_DESCRIPTION: the release to run for `target`, from the pod's own copies of it and its runtime, so a release the stager removes from the node never leaves a runner without its guest binaries or a VMM without its runtime. A release whose runner cannot even load in this pod — one linked against a newer libc than the pod's image has — is held as built for another pod, which the controller answers by rolling the pod, and is not checked again until the controller names another.
    async fn choose(&mut self, target: &str) -> Result<Release, (&'static str, String)> {
        if let Some((_, message)) = self.failed.as_ref().filter(|(name, _)| name == target) {
            return Err((HELD_FAILED, message.clone()));
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
        if let Err(outcome) = loads(&release.dir.join(RUNNER)).await {
            let message =
                format!("{name} does not load in this pod ({outcome}), so only a new pod runs it");
            self.unloadable = Some((name, message.clone()));
            return Err((HELD_RUNTIME, message));
        }
        Ok(release)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the loader a release carries, where it is not the one this process runs: a pod keeps the loader of the release it last became until the release it is named carries another. The two are compared by their bytes, since a release staged again under the same name replaces the file the pod copied before. A release that carries none, which one staged before loaders travelled in releases does, is run by the loader the pod has.
    fn release_loader(&self, release: &Release) -> Option<PathBuf> {
        let theirs = release.dir.join(LOADER);
        if !theirs.is_file() {
            return None;
        }
        match (&self.identity, release::digest(&theirs).ok().flatten()) {
            (Some(mine), Some(theirs)) if *mine == theirs => None,
            _ => Some(theirs),
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

    // UNIT_BOUNDARY_DESCRIPTION: whether a release's own loader starts in this pod, which is the release's loader where it carries one this process is not, and nothing where it does not. The loader is asked to do its whole start, since the exec that becomes it never comes back and a loader that cannot start would take the pod's machines with it.
    async fn ready(&mut self, release: &Release) -> Result<Option<PathBuf>, Become> {
        let Some(loader) = self.release_loader(release) else {
            return Ok(None);
        };
        // UNIT_BOUNDARY_DESCRIPTION: the check races the pod's stop, since it is given a start's whole time and the pod is killed long before that: a stop ends the check where it is, and the loader the check runs is killed with it.
        let started = tokio::select! {
            started = starts(&loader) => started,
            () = stopped() => return Err(Become::Stopping),
        };
        match started {
            Ok(()) => Ok(Some(loader)),
            Err(outcome) => {
                let message = format!(
                    "{}'s loader does not start in this pod ({outcome}), so the pod keeps the loader it has",
                    release.name
                );
                tracing::error!(release = release.name, error = %message, "the release's loader does not start; keeping the one this pod runs");
                self.failed = Some((release.name.clone(), message.clone()));
                Err(Become::Failed(HELD_FAILED, message))
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: starts `release` in place of `replaced`, whose machines this process holds, and becomes the release's own loader first where it carries one. A release this process cannot run at all is held as failed and `replaced` started again, because the loader exiting would end the pod and every machine in it.
    async fn take_over(
        &mut self,
        release: Release,
        replaced: Release,
    ) -> anyhow::Result<(Running, Option<(&'static str, String)>)> {
        match self.ready(&release).await {
            Ok(loader) => self.start_release(release, replaced, loader).await,
            Err(Become::Stopping) => Ok((self.spawn(replaced, None)?, None)),
            Err(Become::Failed(held, message)) => {
                Ok((self.spawn(replaced, None)?, Some((held, message))))
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the second half of a take-over, after the release's loader has been asked whether it starts and, in a hand-off, after the runner has closed: this process becomes that loader, or starts the release itself. The exec keeps the pid, the subreaper and every machine, so the release's loader takes them up as any loader does and starts the release's runner for them.
    async fn start_release(
        &mut self,
        release: Release,
        replaced: Release,
        loader: Option<PathBuf>,
    ) -> anyhow::Result<(Running, Option<(&'static str, String)>)> {
        let name = release.name.clone();
        if let Some(loader) = loader {
            return Ok(match self.turn_into(&loader, &release, &replaced) {
                Become::Stopping => (self.spawn(replaced, None)?, None),
                Become::Failed(held, message) => {
                    self.failed = Some((name, message.clone()));
                    (self.spawn(replaced, None)?, Some((held, message)))
                }
            });
        }
        match self.spawn(release, Some(replaced.clone())) {
            Ok(running) => Ok((running, None)),
            Err(e) => {
                let message = format!("the runner release could not be started: {e:#}");
                tracing::error!(release = name, error = %message, "the runner release could not be started; going back to the one it replaced");
                self.failed = Some((name, message.clone()));
                Ok((self.spawn(replaced, None)?, Some((HELD_FAILED, message))))
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: becomes the release's loader, which never returns: what the loader that replaces this process cannot work out for itself is written down first, since an exec keeps nothing but the mask it holds, and a write that fails stops the change rather than leaving a successor to guess. The mask goes on before the stop is looked for, and the stop is looked for twice over — a flag this process set before the mask, and a signal the kernel is still holding — because a stop either way would be lost with the exec.
    fn turn_into(&self, loader: &Path, release: &Release, replaced: &Release) -> Become {
        let name = release.name.clone();
        tracing::info!(release = name, to = %release.dir.display(), loader = %loader.display(), "becoming the release's loader");
        block_stop_signals();
        pause("VM_RUNNER_LOADER_TEST_STOP_WINDOW_MS");
        if stop_seen() || stop_waiting() {
            unblock_stop_signals();
            tracing::info!(
                release = name,
                "dropping the change to a release's loader: the pod is stopping"
            );
            return Become::Stopping;
        }
        pause("VM_RUNNER_LOADER_TEST_EXEC_WINDOW_MS");
        if let Err(e) = self.leave_handover(loader, release, replaced) {
            unblock_stop_signals();
            let message = format!(
                "{name}'s loader was not taken ({e:#}), so the pod keeps the loader and the release it has"
            );
            tracing::error!(release = name, error = %format!("{e:#}"), "what the loader that replaces this one needs was not written; keeping this one");
            return Become::Failed(HELD_FAILED, message);
        }
        self.prune(release, Some(replaced));
        // UNIT_BOUNDARY_DESCRIPTION: an exec that returns is one that could not start the release's loader, and the runner that was handed off is gone: the release is held as failed, the note to a successor that never ran is taken back, and the machines go back to the release this pod ran.
        let error = std::process::Command::new(loader)
            .args(std::env::args_os().skip(1))
            .exec();
        unblock_stop_signals();
        self.discard_handover();
        let message = format!(
            "{name}'s loader could not be started ({error}), so the pod keeps the loader it has"
        );
        tracing::error!(release = name, loader = %loader.display(), error = %error, "the release's loader could not be started; going back to the release this pod ran");
        Become::Failed(HELD_FAILED, message)
    }

    // UNIT_BOUNDARY_DESCRIPTION: writes what the loader that replaces this process cannot otherwise know — the bytes of the loader it is, the release it is to start, and the release it goes back to if that one fails — where the loader reads it at start. A write that fails stops the change: a successor that knew none of it would take the pod's image for its own loader and start a release nobody accepted.
    fn leave_handover(
        &self,
        loader: &Path,
        release: &Release,
        replaced: &Release,
    ) -> anyhow::Result<()> {
        let snapshot = |release: &Release| release::Snapshot {
            name: release.name.clone(),
            dir: release.dir.clone(),
            runtime: release.runtime.clone(),
        };
        release::write_handover(
            &self.handover_file,
            &release::Handover {
                loader_digest: release::digest(loader).ok().flatten().unwrap_or_default(),
                start: Some(snapshot(release)),
                replaced: Some(snapshot(replaced)),
            },
        )
    }

    // UNIT_BOUNDARY_DESCRIPTION: takes back the note a loader that could not be started left behind, so the runner that restarts with this one is not handed a release nothing started.
    fn discard_handover(&self) {
        if let Err(e) = release::take_handover(&self.handover_file) {
            tracing::error!(error = %format!("{e:#}"), path = %self.handover_file.display(), "removing what was written for a loader that could not be started");
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: removes the pod's copies the loader no longer needs: every release but the one it runs or is about to run and the one it would go back to. The release whose loader this process became is not among them: that file is already this process, and what it is made of is kept as bytes rather than as a path. A machine booted before a hand-off keeps the runtime it booted until it stops.
    fn prune(&self, running: &Release, replaced: Option<&Release>) {
        let releases: Vec<&Path> = std::iter::once(running)
            .chain(replaced)
            .map(|r| r.dir.as_path())
            .collect();
        let mut runtimes: Vec<PathBuf> = std::iter::once(running)
            .chain(replaced)
            .map(|r| r.runtime.clone())
            .collect();
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
        install_stop_handler();
        // UNIT_BOUNDARY_DESCRIPTION: the handler is this process's now, so a stop the loader this process replaced held across the exec reaches it rather than killing what runs with the default action.
        unblock_stop_signals();
        let builtin = self.builtin();
        let fallback = self.replaced().unwrap_or_else(|| builtin.clone());
        let mut running = match self.handover.start.take() {
            // UNIT_BOUNDARY_DESCRIPTION: the loader this process replaced accepted a release for it, and copied it into the pod, before it exec'd: that copy is what is started, even where the node no longer stages it, since looking the release up again would decide the hand-off a second time and fail it where the stager has moved on.
            Some(start) => self.take_over(start.into(), fallback).await?.0,
            None => {
                let target = self.target();
                match self.choose(&target).await {
                    Ok(release) if release.dir != builtin.dir => {
                        self.take_over(release, fallback).await?.0
                    }
                    _ => self.spawn(builtin, None)?,
                }
            }
        };
        let mut backoff = Duration::from_secs(1);
        let mut stop_tick = tokio::time::interval(CATCH_POLL);
        let mut tick = tokio::time::interval(
            env("VM_RUNNER_LOADER_POLL_MS")
                .parse()
                .map_or(POLL, Duration::from_millis),
        );
        loop {
            tokio::select! {
                _ = tick.tick() => {
                    if let Some(exited) = reap_children(running.pid, &self.exits) {
                        running = self.after_exit(running, exited, &mut backoff).await?;
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
                    // UNIT_BOUNDARY_DESCRIPTION: a hand-off not yet begun is dropped while a stop is in hand: the stop is this process's to pass to the runner it has, and one that became another would leave nobody to pass it.
                    if stop_seen() {
                        continue;
                    }
                    match self.choose(&target).await {
                        Ok(release) => {
                            let (next, held) = self.hand_over(running, release).await?;
                            if held.is_none() {
                                self.prune(&next.release, next.replaced.as_ref());
                            }
                            self.report(&next, &target, held);
                            running = next;
                        }
                        Err(held) => self.report(&running, &target, Some(held)),
                    }
                }
                // UNIT_BOUNDARY_DESCRIPTION: the stop of the pod is read from the flag this process's handler sets, which is the one account of it that cannot be lost: a stop an async runtime has accepted cannot be read back from the kernel, and the exec that becomes another loader has to know whether one is in hand.
                _ = stop_tick.tick() => {
                    if stop_seen() {
                        return stop(running.pid, &self.exits).await;
                    }
                }
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: hands `running`'s machines to `release`. The release's loader is asked whether it starts before anything is handed over, since the exec that becomes it never comes back; then the runner is signalled, which closes as it would for a stop but leaves every machine running, and the release, or the loader above it, takes the machines up.
    async fn hand_over(
        &mut self,
        running: Running,
        release: Release,
    ) -> anyhow::Result<(Running, Option<(&'static str, String)>)> {
        let loader = match self.ready(&release).await {
            Ok(loader) => loader,
            // UNIT_BOUNDARY_DESCRIPTION: a stop that arrives while the release's loader is checked keeps the runner this pod has, which the stop then reaches: the check is given a start's whole time, and the pod's grace is shorter than that.
            Err(Become::Stopping) => return Ok((running, None)),
            Err(Become::Failed(held, message)) => return Ok((running, Some((held, message)))),
        };
        if stop_seen() {
            return Ok((running, None));
        }
        tracing::info!(
            from = running.release.name,
            to = release.name,
            "handing the machines off to another runner release"
        );
        hand_off(running.pid, &self.exits).await;
        self.start_release(release, running.release, loader).await
    }

    // UNIT_BOUNDARY_DESCRIPTION: what runs in place of a runner that exited: the release it replaced, where the new one did not last its settle window, and otherwise the same one again after a backoff that grows while a release keeps failing on start. A stop that arrives during the backoff ends the wait, and the next runner is started with the stop already waiting for it.
    async fn after_exit(
        &mut self,
        mut running: Running,
        exited: ExitStatus,
        backoff: &mut Duration,
    ) -> anyhow::Result<Running> {
        let ran = running.started.elapsed();
        match running.replaced.take() {
            Some(replaced) if ran < SETTLE => {
                tracing::error!(release = running.release.name, status = %exited, "the runner release exited right after it took over; going back to the one it replaced");
                let message = format!("{} exited right after it took over", running.release.name);
                self.failed = Some((running.release.name.clone(), message));
                self.spawn(replaced, None)
            }
            _ => {
                *backoff = if ran < SETTLE {
                    (*backoff * 2).min(RESTART_BACKOFF_MAX)
                } else {
                    Duration::from_secs(1)
                };
                tracing::warn!(release = running.release.name, status = %exited, backoff_secs = backoff.as_secs(), "the runner exited; starting it again");
                let until = Instant::now() + *backoff;
                while Instant::now() < until && !stop_seen() {
                    tokio::time::sleep(CATCH_POLL).await;
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
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        // SAFETY: WNOHANG never blocks and WNOWAIT leaves the child unreaped, so its identity can still be read before this takes it away.
        let peeked = unsafe {
            libc::waitid(
                libc::P_ALL,
                0,
                &raw mut info,
                libc::WEXITED | libc::WNOWAIT | libc::WNOHANG,
            )
        };
        if peeked != 0 {
            break;
        }
        let pid = unsafe { info.si_pid() };
        if pid <= 0 {
            break;
        }
        // UNIT_BOUNDARY_DESCRIPTION: the start time is read from the child while it is still a zombie, since the reap below is what takes its last readable trace away, and the record has to say which process it names.
        let start = smolvm::process::process_start_time(pid);
        let mut status = 0;
        // SAFETY: the child is this process's own and reaping it here is what the record above is about.
        let reaped = unsafe { libc::waitpid(pid, &raw mut status, libc::WNOHANG) };
        if reaped != pid {
            continue;
        }
        if pid == runner {
            runner_status = Some(ExitStatus::from_raw(status));
            continue;
        }
        if libc::WIFSIGNALED(status) {
            if let Err(e) = record_exit(exits, pid, start, libc::WTERMSIG(status)) {
                tracing::warn!(pid, error = %e, "recording a machine's VMM exit for the next runner");
            }
        }
    }
    runner_status
}

// UNIT_BOUNDARY_DESCRIPTION: writes a reaped VMM's death where the runner that adopted the machine reads it, whole or not at all: the runner reads the moment a record appears, and a record caught half-written would name no signal — a death read as a machine that exited on its own, and pruned with the kill inside it. A rename within the directory is the one write a reader cannot see in pieces. The record carries the start time the kernel gave that process, read before the reap took it away: a pid is a number the kernel hands out again, so the number alone cannot tell the runner whether a record names the VMM the machine runs now or the one before it.
fn record_exit(exits: &Path, pid: i32, start: Option<u64>, signal: i32) -> std::io::Result<()> {
    std::fs::create_dir_all(exits)?;
    let scratch = exits.join(format!(".{pid}.part"));
    let start = start.map_or_else(String::new, |at| at.to_string());
    std::fs::write(&scratch, format!("{start}\n{signal}"))?;
    std::fs::rename(scratch, exits.join(pid.to_string()))
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

// UNIT_BOUNDARY_DESCRIPTION: makes this loader the process the kernel hands a machine to when the runner that booted it goes away. The pod's init is catatonit, which inherits every orphan and reaps it without a word: the VMM's signal is the one fact about how a machine went down that nothing else records, and it would be gone before the loader could read it. A kernel that refuses leaves the pod's init to reap them, which is said on the console. Linux only, since the loader runs only in a Linux pod.
fn become_the_reaper_of_every_machine() {
    #[cfg(target_os = "linux")]
    // SAFETY: prctl(2) with PR_SET_CHILD_SUBREAPER takes a flag and no pointers.
    if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) } != 0 {
        tracing::warn!(
            error = %std::io::Error::last_os_error(),
            "could not become the subreaper of this pod's machines; a VMM that outlives its runner is reaped by the pod's init, which records no signal"
        );
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
        let record = std::fs::read_to_string(exits.join(pid.to_string())).unwrap();
        let (start, signal) = record.split_once('\n').expect("a start time and a signal");
        assert_eq!(
            signal,
            libc::SIGSYS.to_string(),
            "the VMM's signal is what the next runner names the kill by"
        );
        // TEST_SCENARIO: the record names the process it is about, and the loader read that identity from the child while it was still a zombie: the kernel stops answering for a reaped process, so the field is what that read produced rather than anything this test can ask for now.
        assert!(
            start.parse::<u64>().is_ok(),
            "the record carries no start time, so nothing could tell this death from a predecessor's: {record:?}"
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

    // TEST_SCENARIO: the runner reads a record the moment it appears, so a record is never written in place: a reader that caught it empty would read a VMM that exited on its own, drop the kill, and let the file be pruned. It is written aside and renamed, and a write that stops before the rename leaves nothing the runner reads as a death.
    #[test]
    fn a_record_is_never_visible_half_written() {
        let dir = std::env::temp_dir().join(format!("vmr-exits-part-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let exits = dir.join(vm_runner::state::EXIT_RECORDS);
        record_exit(&exits, 4242, Some(77), libc::SIGSYS).unwrap();
        assert_eq!(
            std::fs::read_to_string(exits.join("4242")).unwrap(),
            format!("77\n{}", libc::SIGSYS),
            "the record names the death and the process it belongs to"
        );
        assert!(
            !exits.join(".4242.part").exists(),
            "the scratch file is renamed away"
        );
        // TEST_SCENARIO: what a reader sees if the write stopped before the rename, which is a name no reader looks for.
        std::fs::write(exits.join(".4243.part"), "").unwrap();
        assert!(!exits.join("4243").exists());
        // TEST_SCENARIO: a record published by rename replaces the name a reader polls, and never writes through it: a writer that opened the final path would truncate a record another death left there, and a reader of that name would catch it empty, which is the failure the rename exists to rule out. The name points at a file here, so a write through it lands in that file and the rename leaves it alone.
        let pointed_at = dir.join("pointed-at");
        std::fs::write(&pointed_at, "").unwrap();
        std::os::unix::fs::symlink(&pointed_at, exits.join("4244"))
            .expect("a name to publish over");
        record_exit(&exits, 4244, None, libc::SIGTERM).unwrap();
        assert_eq!(
            std::fs::read_to_string(&pointed_at).unwrap(),
            "",
            "the final name is replaced, never written through"
        );
        assert_eq!(
            std::fs::read_to_string(exits.join("4244")).unwrap(),
            format!("\n{}", libc::SIGTERM)
        );
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
                check: _,
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
