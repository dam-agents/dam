//! TEST_OVERVIEW: the loader supervises one runner process and replaces it with the release the controller names, once the stager has put that release on the node. The machines a runner starts must outlive the hand-off, a release that exits right after it takes over must give the machines back to the one it replaced, and a stop of the pod must reach the runner. Each runner here is a shell script that starts one long sleep as its "machine".

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use vm_runner::api::{RunnerRelease, HELD_FAILED, HELD_REBOOT, HELD_RUNTIME};
use vm_runner::release::{self, FILES, LOADER, REBOOT_ID, RUNNER, RUNTIME_ID};

// UNIT_BOUNDARY_DESCRIPTION: the machine is logged only once the traps are set, so a test that waits for a runner's machine to appear knows the runner takes its stop. The loader forwards a stop as soon as it spawned the process, and on macOS it forwards without waiting for a handler to exist, so a stop that arrives earlier kills the shell outright and fails the loader.
const RUNS: &str = r#"#!/bin/sh
[ "$1" = --help ] && exit 0
echo $$ >> "$RUNNER_PID_LOG"
echo "$0 $*" >> "$RUNNER_LOG"
sleep 1000 &
trap 'exit 0' USR1 TERM
echo $! >> "$MACHINE_LOG"
while :; do sleep 0.1; done
"#;

const CRASHES: &str =
    "#!/bin/sh\n[ \"$1\" = --help ] && exit 0\necho $$ >> \"$RUNNER_PID_LOG\"\necho \"$0 $*\" >> \"$RUNNER_LOG\"\nexit 1\n";

// UNIT_BOUNDARY_DESCRIPTION: a loader another release carries, standing in for that release's own: it logs that it ran and becomes this build's loader with the arguments the pod's loader passed on, which is what an exec keeps — the pid, the subreaper and every machine held under it.
const STAGED_LOADER: &str = r#"#!/bin/sh
[ "$1" = --help ] && exit 0
echo "$0 $*" >> "$LOADER_LOG"
exec "$REAL_LOADER" "$@"
"#;

// UNIT_BOUNDARY_DESCRIPTION: the same release staged again with another loader, which is what a change to the loader reaches a pod as: another binary under the release's own name, replacing the file the pod copied the last one into.
const STAGED_LOADER_AGAIN: &str = r#"#!/bin/sh
[ "$1" = --help ] && exit 0
echo "$0 $* again" >> "$LOADER_LOG"
exec "$REAL_LOADER" "$@"
"#;

// UNIT_BOUNDARY_DESCRIPTION: a loader whose check takes as long as a start of a whole release does, which is what a release's loader with a release and a runtime to copy in does.
const SLOW_CHECK_LOADER: &str = r#"#!/bin/sh
echo "$0 $*" >> "$LOADER_LOG"
case "$*" in *--check*) sleep 5;; esac
exec "$REAL_LOADER" "$@"
"#;

// UNIT_BOUNDARY_DESCRIPTION: a loader of a release that cannot start in this pod, which is what a release built for another pod's libc looks like.
const BROKEN_LOADER: &str = "#!/bin/sh\nexit 1\n";

// UNIT_BOUNDARY_DESCRIPTION: a loader that starts, prints its usage as any loader does, and cannot do the one thing it is started for, which is the failure a probe that only runs it with a flag would miss.
const CANNOT_START: &str = "#!/bin/sh\ncase \"$*\" in *--check*) echo \"this loader cannot take the release\" >&2; exit 3;; esac\nexec \"$REAL_LOADER\" \"$@\"\n";

// UNIT_BOUNDARY_DESCRIPTION: the release a loader reads on the node: its files, its runtime id, and its runner script, which `cp` writes so this process holds no descriptor on the inode the loader execs. A fork on another test thread copies such a descriptor into a child that keeps it until it execs, and Linux fails that exec with ETXTBSY.
fn release_dir(dir: &Path, script: &str, runtime: &str) {
    std::fs::create_dir_all(dir).unwrap();
    for file in FILES {
        std::fs::write(dir.join(file), file).unwrap();
    }
    std::fs::write(dir.join(RUNTIME_ID), runtime).unwrap();
    let staged = dir.join(format!(".{RUNNER}"));
    std::fs::write(&staged, script).unwrap();
    let copied = Command::new("cp")
        .arg(&staged)
        .arg(dir.join(RUNNER))
        .status()
        .unwrap();
    assert!(
        copied.success(),
        "cp the runner script into place: {copied}"
    );
    std::fs::set_permissions(dir.join(RUNNER), std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::remove_file(&staged).unwrap();
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn lines(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(String::from)
        .collect()
}

fn alive(pid: &str) -> bool {
    Command::new("kill")
        .args(["-0", pid])
        .status()
        .unwrap()
        .success()
}

struct Pod {
    dir: PathBuf,
    loader: Child,
}

impl Pod {
    // UNIT_BOUNDARY_DESCRIPTION: a loader running the pod's own release, runner:1, whose runner is `script`.
    fn start(name: &str, script: &str) -> Self {
        Self::start_named(name, script, None, &[])
    }

    // UNIT_BOUNDARY_DESCRIPTION: a pod that has already been told which release to run — the target file of the loader directory outlives the container, so a restarted pod starts with one — and that finds that release staged on the node, with a loader of its own. `env` sets what only a test sets.
    fn start_named(
        name: &str,
        script: &str,
        target: Option<(&str, &str)>,
        env: &[(&str, &str)],
    ) -> Self {
        let dir =
            std::env::temp_dir().join(format!("vm-runner-loader-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let builtin = dir.join("builtin");
        let builtin_runtime = dir.join("builtin-runtime");
        release_dir(&builtin, script, "runtime-a");
        std::fs::create_dir_all(dir.join("releases")).unwrap();
        if let Some((release, loader)) = target {
            stage_release(&dir, release, RUNS, "runtime-a", None, Some(loader));
            let loader_dir = dir.join("loader");
            std::fs::create_dir_all(&loader_dir).unwrap();
            release::replace(&release::target_file(&loader_dir), release.as_bytes()).unwrap();
        }
        let loader = Command::new(env!("CARGO_BIN_EXE_vm-runner-loader"))
            .args(["run", "--builtin"])
            .arg(&builtin)
            .arg("--builtin-runtime")
            .arg(&builtin_runtime)
            .args(["--", "--state-dir"])
            .arg(dir.join("state"))
            .args(["--smolvm"])
            .arg(builtin_runtime.join("smolvm"))
            .env(release::RELEASES_ENV, dir.join("releases"))
            .env(release::LOADER_DIR_ENV, dir.join("loader"))
            .env(release::BUILTIN_RELEASE_ENV, "runner:1")
            .env("VM_RUNNER_LOADER_POLL_MS", "50")
            .env("RUNNER_LOG", dir.join("runners"))
            .env("MACHINE_LOG", dir.join("machines"))
            .env("RUNNER_PID_LOG", dir.join("runner-pids"))
            .env("LOADER_LOG", dir.join("loaders"))
            .env("REAL_LOADER", env!("CARGO_BIN_EXE_vm-runner-loader"))
            .envs(env.iter().copied())
            .spawn()
            .unwrap();
        Self { dir, loader }
    }

    fn terminate(&mut self) -> std::process::ExitStatus {
        // SAFETY: kill(2) takes plain integers and touches no memory of this process.
        unsafe { libc::kill(i32::try_from(self.loader.id()).unwrap(), libc::SIGTERM) };
        self.loader.wait().unwrap()
    }

    fn status(&self) -> RunnerRelease {
        release::read_status(&release::status_file(&self.dir.join("loader")))
    }

    // UNIT_BOUNDARY_DESCRIPTION: names a release as the runner does when the controller calls its machine API.
    fn name(&self, release: &str) {
        let loader = self.dir.join("loader");
        std::fs::create_dir_all(&loader).unwrap();
        release::replace(&release::target_file(&loader), release.as_bytes()).unwrap();
    }

    fn stage(&self, release: &str, script: &str, runtime: &str) {
        self.stage_declaring(release, script, runtime, None, None);
    }

    // UNIT_BOUNDARY_DESCRIPTION: stages a release that declares the reboot key its machines were booted by, or none at all for one built before keys, and a loader of its own or none at all for one built before loaders travelled in releases. The stager copies the key with the rest of the release, since it is part of what the release changes in a machine, and the loader with it, since that is what the pod becomes.
    fn stage_declaring(
        &self,
        release: &str,
        script: &str,
        runtime: &str,
        key: Option<&str>,
        loader: Option<&str>,
    ) {
        stage_release(&self.dir, release, script, runtime, key, loader);
    }

    // UNIT_BOUNDARY_DESCRIPTION: the node's stager for one release: the image the chart's runner image would carry, the runtime it was built against, and the directory the pod reads.
    fn drop_from_node(&self, release: &str) {
        std::fs::remove_dir_all(self.dir.join("releases").join(release::key(release))).unwrap();
    }
}

fn stage_release(
    dir: &Path,
    release: &str,
    script: &str,
    runtime: &str,
    key: Option<&str>,
    loader: Option<&str>,
) {
    {
        let image = dir.join(format!("image-{}", release::key(release)));
        release_dir(&image, script, runtime);
        if let Some(key) = key {
            std::fs::write(image.join(REBOOT_ID), key).unwrap();
        }
        if let Some(loader) = loader {
            std::fs::write(image.join(LOADER), loader).unwrap();
            std::fs::set_permissions(image.join(LOADER), std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        let tree = dir.join(format!("runtime-tree-{runtime}"));
        std::fs::create_dir_all(&tree).unwrap();
        std::fs::write(tree.join("smolvm"), runtime).unwrap();
        release::stage(&image, &tree, &dir.join("releases"), release, 10).unwrap();
    }
}

impl Pod {
    // UNIT_BOUNDARY_DESCRIPTION: the reboot key the pod's own release declares, which its loader compares every release it is named against.
    fn boots(&self, key: &str) {
        std::fs::write(self.dir.join("builtin").join(REBOOT_ID), key).unwrap();
    }
}

impl Drop for Pod {
    // UNIT_BOUNDARY_DESCRIPTION: a runner the loader left running is a shell the loader's own kill does not reach, and one of those waits on its machine for ever and holds the test's output open: every runner script names its pid for this.
    fn drop(&mut self) {
        let _ = self.loader.kill();
        let _ = self.loader.wait();
        for log in ["runner-pids", "machines"] {
            for pid in lines(&self.dir.join(log)) {
                let _ = Command::new("kill").arg("-9").arg(&pid).status();
            }
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

// TEST_SCENARIO: a new release takes over without the machine the old runner started going down, against the pod's runtime or against its own; a release that exits right after it took over is held as failed while the machines go back to the release it replaced; one that does not even load in the pod is held for a new pod; and the pod's stop reaches the runner and ends the loader.
#[test]
fn a_release_takes_over_the_machines_and_a_broken_one_gives_them_back() {
    let mut pod = Pod::start("hand-off", RUNS);
    let dir = pod.dir.clone();
    let builtin = dir.join("builtin");
    let builtin_runtime = dir.join("builtin-runtime");
    let smolvm = |runtime: &Path| format!("--smolvm {}/smolvm", runtime.display());

    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    let first_machine = lines(&dir.join("machines"))[0].clone();

    pod.stage("runner:2", RUNS, "runtime-a");
    pod.name("runner:2");
    wait_for("the hand-off to runner:2", || {
        pod.status().running == "runner:2" && lines(&dir.join("machines")).len() == 2
    });
    assert!(
        alive(&first_machine),
        "the hand-off took the first runner's machine down"
    );

    pod.stage("runner:3", CRASHES, "runtime-a");
    pod.name("runner:3");
    wait_for("runner:3 to be held as failed", || {
        pod.status().held == HELD_FAILED
    });
    let status = pod.status();
    assert_eq!(
        (status.running.as_str(), status.target.as_str()),
        ("runner:2", "runner:3")
    );
    assert!(alive(&first_machine));

    pod.stage("runner:4", RUNS, "runtime-a");
    let staged = dir
        .join("releases")
        .join(release::key("runner:4"))
        .join(RUNNER);
    std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o644)).unwrap();
    pod.name("runner:4");
    wait_for(
        "runner:4, which does not load, to be held for a new pod",
        || {
            let status = pod.status();
            status.target == "runner:4" && status.held == HELD_RUNTIME
        },
    );
    assert_eq!(pod.status().running, "runner:2");

    pod.stage("runner:5", RUNS, "runtime-b");
    pod.name("runner:5");
    wait_for("the hand-off to runner:5, on another runtime", || {
        pod.status().running == "runner:5" && lines(&dir.join("machines")).len() == 4
    });
    assert!(
        alive(&first_machine),
        "a machine on the old runtime went down with the hand-off"
    );

    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
    let runners = lines(&dir.join("runners"));
    let copies = dir.join("loader").join("releases");
    let state = format!("--state-dir {}", dir.join("state").display());
    let ran = |release: &str, runtime: &Path| {
        format!(
            "{} {state} {}",
            copies.join(release::key(release)).join(RUNNER).display(),
            smolvm(runtime)
        )
    };
    let pod_runtime = dir.join("loader").join("runtimes").join("runtime-b");
    assert_eq!(
        runners,
        [
            format!(
                "{} {state} {}",
                builtin.join(RUNNER).display(),
                smolvm(&builtin_runtime)
            ),
            ran("runner:2", &builtin_runtime),
            ran("runner:3", &builtin_runtime),
            ran("runner:2", &builtin_runtime),
            ran("runner:5", &pod_runtime),
        ]
    );
    assert_eq!(
        std::fs::read_to_string(pod_runtime.join("smolvm")).unwrap(),
        "runtime-b"
    );
}

// UNIT_BOUNDARY_DESCRIPTION: the parent of a process, from the fourth field of its status, after the command name's closing parenthesis.
#[cfg(target_os = "linux")]
fn parent_of(pid: &str) -> String {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let rest = &stat[stat.rfind(')').unwrap() + 1..];
    rest.split_whitespace().nth(1).unwrap().to_string()
}

// TEST_SCENARIO: the pod's init is catatonit, and an orphan is handed to whatever the kernel finds first: without a subreaper, catatonit inherits every machine a replaced runner leaves and reaps it without a word, and the VMM's signal — the only record of how the machine went down — is gone before any runner could read it. The loader asks to be the pod's subreaper, so the machine a hand-off orphaned is its child, and the death it reaps there is the record the runner that adopted the machine names the kill by. Linux only, as the loader runs only in a Linux pod.
#[test]
#[cfg(target_os = "linux")]
fn a_machine_a_hand_off_orphaned_is_the_loaders_to_reap() {
    let mut pod = Pod::start("subreaper", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own machine", || {
        lines(&dir.join("machines")).len() == 1
    });
    let machine = lines(&dir.join("machines"))[0].clone();
    pod.stage("runner:2", RUNS, "runtime-a");
    pod.name("runner:2");
    wait_for("the hand-off to runner:2", || {
        lines(&dir.join("machines")).len() == 2
    });
    assert_eq!(
        parent_of(&machine),
        pod.loader.id().to_string(),
        "the pod's init reaped the machine the hand-off orphaned"
    );

    // TEST_SCENARIO: the machine dies while no runner it belongs to is watching, and the signal is where the next runner reads it.
    // SAFETY: kill(2) takes plain integers and touches no memory of this process.
    unsafe { libc::kill(machine.parse().unwrap(), libc::SIGSYS) };
    let record = dir
        .join("state")
        .join(vm_runner::state::EXIT_RECORDS)
        .join(&machine);
    wait_for("the record of the machine's death", || record.exists());
    // UNIT_BOUNDARY_DESCRIPTION: the loader's record names the death and the process it belongs to, since a pid alone cannot tell this VMM from the one the kernel handed the number to before it: the signal is the second line.
    let written = std::fs::read_to_string(&record).unwrap();
    let (start, signal) = written.split_once('\n').expect("a start time and a signal");
    assert_eq!(signal, libc::SIGSYS.to_string());
    assert!(
        start.parse::<u64>().is_ok(),
        "the record carries no start time: {written:?}"
    );
    let _ = pod.loader.kill();
}

// UNIT_BOUNDARY_DESCRIPTION: a runner that, like the real one, sets up its stop only some time after it starts, and takes two seconds to close for a hand-off. Each step is logged to the pod's runner log.
const SLOW: &str = r#"#!/bin/sh
[ "$1" = --help ] && exit 0
echo $$ >> "$RUNNER_PID_LOG"
sleep 0.5
trap 'echo "stopped $0" >> "$RUNNER_LOG"; exit 0' TERM
trap 'echo "closing $0" >> "$RUNNER_LOG"; sleep 2; exit 0' USR1
echo "started $0" >> "$RUNNER_LOG"
while :; do sleep 0.1; done
"#;

// TEST_SCENARIO: a stop of the pod that arrives while the old runner is still closing for a hand-off must reach a runner that stops the machines: the loader starts the next release, waits for it to set up its stop, and passes the stop on, rather than killing it before its first line and leaving the machines to be powered off with the pod. The caught-signal mask the loader waits on is Linux's, the only place the loader runs.
#[test]
#[cfg_attr(not(target_os = "linux"), ignore = "reads /proc/<pid>/status")]
fn a_stop_during_a_hand_off_reaches_the_next_runner() {
    let mut pod = Pod::start("stop-mid-hand-off", SLOW);
    let log = pod.dir.join("runners");
    wait_for("the pod's own runner", || lines(&log).len() == 1);
    pod.stage("runner:2", SLOW, "runtime-a");
    pod.name("runner:2");
    wait_for("the hand-off to begin", || {
        lines(&log).iter().any(|l| l.starts_with("closing "))
    });

    let exited = pod.terminate();
    let copy = pod
        .dir
        .join("loader/releases")
        .join(release::key("runner:2"))
        .join(RUNNER);
    assert_eq!(
        lines(&log).last().map(String::as_str),
        Some(format!("stopped {}", copy.display()).as_str()),
        "{:?}",
        lines(&log)
    );
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a release declaring another reboot key than the pod's is held as rebooting, since only a new pod reboots the machines onto what it changes: the loader keeps the release it runs, the machines it booted stay up, and nothing of the new release is started. The same release declaring the pod's key is handed off as any release was.
#[test]
fn a_release_declaring_another_reboot_key_is_held_and_hands_nothing_over() {
    let mut pod = Pod::start("reboot", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    let machine = lines(&dir.join("machines"))[0].clone();
    pod.boots("generation-1");

    pod.stage_declaring("runner:2", RUNS, "runtime-a", Some("generation-2"), None);
    pod.name("runner:2");
    wait_for("runner:2 to be held as rebooting", || {
        pod.status().held == HELD_REBOOT
    });
    let status = pod.status();
    assert_eq!(
        (status.running.as_str(), status.target.as_str()),
        ("runner:1", "runner:2")
    );
    assert!(alive(&machine), "the hold stopped the machine it booted");
    assert_eq!(
        lines(&dir.join("runners")).len(),
        1,
        "the loader started a release it held"
    );

    pod.stage_declaring("runner:3", RUNS, "runtime-a", Some("generation-1"), None);
    pod.name("runner:3");
    wait_for(
        "the hand-off to runner:3, which declares the pod's key, and its machine, so it takes the stop",
        || pod.status().running == "runner:3" && lines(&dir.join("machines")).len() == 2,
    );
    assert!(
        alive(&machine),
        "a hand-off between two releases of one key stopped the machine"
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: rolling a pod back to a release built before keys hands off in place: the pod declares a key and the release none, so nothing compares them, and the machine that was running keeps running on the older release.
#[test]
fn a_pod_that_declares_a_reboot_key_takes_a_keyless_release_in_place() {
    let mut pod = Pod::start("rollback-to-keyless", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    let machine = lines(&dir.join("machines"))[0].clone();
    pod.boots("generation-2");

    pod.stage("runner:2", RUNS, "runtime-a");
    pod.name("runner:2");
    wait_for(
        "the hand-off to runner:2, which declares no key, and its machine, so it takes the stop",
        || pod.status().running == "runner:2" && lines(&dir.join("machines")).len() == 2,
    );
    assert!(
        alive(&machine),
        "the rollback to a release built before keys stopped the machine"
    );
    assert_eq!(
        pod.status().held,
        "",
        "a release that declares no key is not held"
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a release carries the loader the pod becomes, so a release that changes only the loader reaches a pod in place: the loader hands the machines off, execs the release's own, and that one starts the release's runner. The exec keeps the pid, the subreaper and every machine under it, so the machine the release before it started stays up, with no pod roll and no reboot.
#[test]
fn a_release_carries_the_loader_the_pod_becomes() {
    let mut pod = Pod::start("staged-loader", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    let machine = lines(&dir.join("machines"))[0].clone();
    let loader_pid = pod.loader.id();

    pod.stage_declaring("runner:2", RUNS, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:2");
    wait_for("the hand-off to runner:2 through its own loader", || {
        pod.status().running == "runner:2" && lines(&dir.join("machines")).len() == 2
    });
    assert!(
        alive(&machine),
        "the loader a release carries stopped the machine it found"
    );
    assert_eq!(
        pod.loader.id(),
        loader_pid,
        "the loader was replaced rather than become"
    );
    // TEST_SCENARIO: the release's loader is asked to start before the machines are handed to it, and then becomes this process: the check is logged first, the supervision after it.
    let became = lines(&dir.join("loaders"));
    let staged_loader = dir
        .join("loader/releases")
        .join(release::key("runner:2"))
        .join(LOADER);
    assert_eq!(
        became.len(),
        2,
        "the pod's loader neither checked nor became the release's: {became:?}"
    );
    assert!(
        became[0].starts_with(&format!("{} run --check ", staged_loader.display())),
        "the pod did not ask the release's loader to start: {became:?}"
    );
    assert!(
        became[1].starts_with(&format!("{} run --builtin ", staged_loader.display())),
        "the pod became another loader than the release's: {became:?}"
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a release's loader that cannot start costs the pod nothing: it is checked before the machines are handed off, since the exec that becomes it never comes back, so the pod keeps the loader and the release it runs, every machine stays up, and the release is held as failed.
#[test]
fn a_release_whose_loader_does_not_start_is_held() {
    let mut pod = Pod::start("broken-loader", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    let machine = lines(&dir.join("machines"))[0].clone();

    pod.stage_declaring("runner:2", RUNS, "runtime-a", None, Some(BROKEN_LOADER));
    pod.name("runner:2");
    wait_for("runner:2 to be held as failed", || {
        pod.status().held == HELD_FAILED
    });
    let status = pod.status();
    assert_eq!(
        (status.running.as_str(), status.target.as_str()),
        ("runner:1", "runner:2")
    );
    assert!(
        status.message.contains("loader"),
        "the hold does not say what could not start: {}",
        status.message
    );
    assert!(alive(&machine), "the hold stopped the machine it booted");
    assert_eq!(
        lines(&dir.join("runners")).len(),
        1,
        "the loader started a release whose loader it could not become"
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a stop of the pod that arrives while the old runner closes for a hand-off to a release carrying another loader must not be lost inside the exec that becomes it: the loader drops the hand-off, starts the release it ran, and that runner takes the stop, rather than a signal this process already took going with the exec and leaving the machines to be powered off with the pod.
#[test]
#[cfg_attr(not(target_os = "linux"), ignore = "reads /proc/<pid>/status")]
fn a_stop_during_a_hand_off_to_another_loader_reaches_a_runner() {
    let mut pod = Pod::start("stop-mid-loader-hand-off", SLOW);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        lines(&dir.join("runners")).len() == 1
    });
    pod.stage_declaring("runner:2", SLOW, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:2");
    wait_for("the hand-off to begin", || {
        lines(&dir.join("runners"))
            .iter()
            .any(|l| l.starts_with("closing "))
    });

    let exited = pod.terminate();
    // TEST_SCENARIO: the release's loader was asked to start, and never started: one entry, and it is the probe.
    let loaders = lines(&dir.join("loaders"));
    assert_eq!(
        loaders.len(),
        1,
        "the loader became another with the pod's stop already in hand: {loaders:?}"
    );
    assert!(
        loaders[0].contains("run --check "),
        "the pod did more than ask whether the release's loader starts: {loaders:?}"
    );
    assert_eq!(
        lines(&dir.join("runners")).last().map(String::as_str),
        Some(format!("stopped {}", dir.join("builtin").join(RUNNER).display()).as_str()),
        "{:?}",
        lines(&dir.join("runners"))
    );
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a release whose loader replaced the pod's own and whose runner then fails gives the machines back to the release the pod ran before it, not to the pod's image: the loader records what it ran when it becomes another. And the loader it became stays the one it is: a later release carrying the same loader is handed off under it rather than becoming it again, which is what an identity taken from the release it happens to run would get wrong.
#[test]
fn a_loader_that_became_another_gives_the_machines_back_to_the_release_it_replaced() {
    let mut pod = Pod::start("loader-fallback", RUNS);
    let dir = pod.dir.clone();
    let copies = dir.join("loader").join("releases");
    let ran = |release: &str| {
        copies
            .join(release::key(release))
            .join(RUNNER)
            .display()
            .to_string()
    };
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    let machine = lines(&dir.join("machines"))[0].clone();

    pod.stage("runner:2", RUNS, "runtime-a");
    pod.name("runner:2");
    wait_for("the hand-off to runner:2", || {
        pod.status().running == "runner:2" && lines(&dir.join("machines")).len() == 2
    });

    // TEST_SCENARIO: the release with a loader of its own takes over and its runner exits at once, so the machines go back to runner:2 — the release the pod ran — and never to runner:1.
    pod.stage_declaring("runner:3", CRASHES, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:3");
    wait_for("runner:3 to be held as failed", || {
        pod.status().held == HELD_FAILED && pod.status().running == "runner:2"
    });
    let runners = lines(&dir.join("runners"));
    assert_eq!(
        runners.last().map(String::as_str),
        Some(
            format!(
                "{} --state-dir {} --smolvm {}",
                ran("runner:2"),
                dir.join("state").display(),
                dir.join("builtin-runtime").join("smolvm").display()
            )
            .as_str()
        ),
        "the machines did not go back to the release the pod ran: {runners:?}"
    );
    assert!(alive(&machine), "the fallback stopped the machine it found");

    // TEST_SCENARIO: the pod's loader is runner:3's now, so a release carrying those very bytes is handed off under it: a second becoming would be an identity taken from the runner it went back to.
    pod.stage_declaring("runner:4", RUNS, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:4");
    wait_for("the hand-off to runner:4, and its machine", || {
        pod.status().running == "runner:4" && lines(&dir.join("machines")).len() == 4
    });
    assert_eq!(
        lines(&dir.join("loaders")).len(),
        2,
        "the pod became a loader it already was: {:?}",
        lines(&dir.join("loaders"))
    );
    assert!(
        alive(&machine),
        "a hand-off between two releases of one loader stopped the machine"
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a release's loader is asked to do the work it would be started for, not merely to print its usage: one that answers a flag and cannot take the pod's release is held as failed with what it said on its stderr, and the pod keeps the loader and the release it runs, with every machine up.
#[test]
fn a_release_whose_loader_loads_but_cannot_start_is_held() {
    let mut pod = Pod::start("cannot-start-loader", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    let machine = lines(&dir.join("machines"))[0].clone();

    pod.stage_declaring("runner:2", RUNS, "runtime-a", None, Some(CANNOT_START));
    pod.name("runner:2");
    wait_for("runner:2 to be held as failed", || {
        pod.status().held == HELD_FAILED
    });
    let status = pod.status();
    assert_eq!(
        (status.running.as_str(), status.target.as_str()),
        ("runner:1", "runner:2")
    );
    assert!(
        status.message.contains("cannot take the release"),
        "the hold does not say what the loader said: {}",
        status.message
    );
    assert!(alive(&machine), "the hold stopped the machine it booted");
    assert_eq!(
        lines(&dir.join("runners")).len(),
        1,
        "the pod started a release whose loader cannot start"
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a pod that restarts finds the release the controller named already in its loader directory, and its own image's loader is not the one that release carries: it asks the release's loader to start, becomes it, and only then starts the release's runner. Nothing else would ever do it, since the loop sees the release it runs as the one that was asked for.
#[test]
fn a_restarted_pod_becomes_the_loader_of_the_release_it_finds_named() {
    let mut pod = Pod::start_named(
        "restart-into-loader",
        RUNS,
        Some(("runner:2", STAGED_LOADER)),
        &[],
    );
    let dir = pod.dir.clone();
    wait_for("the release the pod found named", || {
        pod.status().running == "runner:2" && lines(&dir.join("machines")).len() == 1
    });
    let copy = dir.join("loader/releases").join(release::key("runner:2"));
    let loaders = lines(&dir.join("loaders"));
    assert_eq!(
        loaders.len(),
        2,
        "the pod started the release without becoming its loader: {loaders:?}"
    );
    assert!(
        loaders[0].starts_with(&format!("{} run --check ", copy.join(LOADER).display())),
        "the release's loader was not asked to start before it was become: {loaders:?}"
    );
    assert!(
        loaders[1].starts_with(&format!("{} run --builtin ", copy.join(LOADER).display())),
        "the pod became another loader than the release's: {loaders:?}"
    );
    let runners = lines(&dir.join("runners"));
    assert_eq!(
        runners.len(),
        1,
        "the release was started before the pod became its loader, or twice: {runners:?}"
    );
    assert!(
        runners[0].starts_with(&copy.join(RUNNER).display().to_string()),
        "the release's runner did not run from the pod's own copy: {runners:?}"
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a loader that became another starts the release it was given, from the copy it accepted, even where the node no longer stages it: a hand-off is decided once, and a stager that moves on between the loader's decision and the release's start does not turn it into a fallback to the pod's image.
#[test]
fn a_loader_starts_the_release_it_was_given_after_the_node_drops_it() {
    let mut pod = Pod::start("hand-off-to-a-dropped-release", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1"
    });
    pod.stage_declaring("runner:2", SLOW, "runtime-a", None, None);
    pod.name("runner:2");
    // UNIT_BOUNDARY_DESCRIPTION: the runner logs that it started only after it takes its own stop, so a hand-off that comes later is one it closes for rather than dies of.
    wait_for("runner:2 to take its stop", || {
        lines(&dir.join("runners"))
            .iter()
            .any(|line| line.starts_with("started "))
    });

    pod.stage_declaring("runner:3", RUNS, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:3");
    wait_for("runner:2 to begin closing", || {
        lines(&dir.join("runners"))
            .iter()
            .any(|line| line.starts_with("closing "))
    });
    // TEST_SCENARIO: the node drops the release the pod is handing off to, after the pod copied it and before the release starts.
    pod.drop_from_node("runner:3");
    let copy = dir.join("loader/releases").join(release::key("runner:3"));
    wait_for("runner:3 to run from the pod's own copy", || {
        lines(&dir.join("runners"))
            .iter()
            .any(|line| line.starts_with(&format!("{} ", copy.join(RUNNER).display())))
    });
    assert_eq!(
        pod.status().running,
        "runner:3",
        "the successor did not settle on the release it was given: {:?}",
        lines(&dir.join("runners"))
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a loader that cannot write down what the loader after it needs does not become it: the release is held as failed and the pod goes on running the release it has, rather than a successor that would take the pod's image for its own loader and start a release nobody accepted.
#[test]
fn a_loader_that_cannot_write_down_what_follows_it_is_not_become() {
    let mut pod = Pod::start("handover-not-written", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    let machine = lines(&dir.join("machines"))[0].clone();
    // UNIT_BOUNDARY_DESCRIPTION: a directory where the handover belongs, which no write can replace.
    std::fs::create_dir_all(dir.join("loader/handover.json")).unwrap();
    std::fs::write(dir.join("loader/handover.json/keep"), "x").unwrap();

    pod.stage_declaring("runner:2", RUNS, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:2");
    wait_for("runner:2 to be held as failed", || {
        pod.status().held == HELD_FAILED
    });
    let status = pod.status();
    assert_eq!(
        (status.running.as_str(), status.target.as_str()),
        ("runner:1", "runner:2"),
        "{status:?}"
    );
    assert!(
        status.message.contains("was not taken"),
        "the hold does not say why: {}",
        status.message
    );
    let loaders = lines(&dir.join("loaders"));
    assert_eq!(
        loaders.len(),
        1,
        "the pod became a loader it could not describe to the one that follows: {loaders:?}"
    );
    assert!(
        loaders[0].contains("run --check "),
        "the pod did no more than ask: {loaders:?}"
    );
    assert!(alive(&machine), "the failed change stopped a machine");
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a release staged again under the same name with another loader is become: the pod compares the bytes of the loader it is against the release's, not the file that a path names, which the restaging replaced under this very process.
#[test]
fn a_release_staged_again_with_another_loader_is_become_again() {
    let mut pod = Pod::start("restaged-loader", RUNS);
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1"
    });
    pod.stage_declaring("runner:2", RUNS, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:2");
    wait_for("the pod to become runner:2's loader", || {
        pod.status().running == "runner:2"
    });
    // TEST_SCENARIO: a release of its own with no loader, so the pod keeps the loader it became for the restaging below.
    pod.stage_declaring("runner:3", RUNS, "runtime-a", None, None);
    pod.name("runner:3");
    wait_for("runner:3 to run", || pod.status().running == "runner:3");

    pod.stage_declaring(
        "runner:2",
        RUNS,
        "runtime-a",
        None,
        Some(STAGED_LOADER_AGAIN),
    );
    pod.name("runner:2");
    wait_for("the pod to become runner:2's loader again", || {
        pod.status().running == "runner:2" && lines(&dir.join("loaders")).len() == 4
    });
    let loaders = lines(&dir.join("loaders"));
    assert!(
        loaders[3].ends_with(" again"),
        "the pod compared a path rather than the bytes of the loader it is: {loaders:?}"
    );
    let exited = pod.terminate();
    assert!(exited.success(), "the loader exited with {exited}");
}

// TEST_SCENARIO: a stop that arrives while the loader is deciding whether to become another is not lost: the mask goes on before the loader looks, and the stop is then found either in the flag this process's handler set or in what the kernel still holds, so the pod keeps the release it runs and a runner of it takes the stop, rather than the pod ending from an exec that left nobody to take it.
#[test]
fn a_stop_in_the_window_before_the_exec_is_not_lost() {
    let mut pod = Pod::start_named(
        "stop-in-the-window",
        RUNS,
        None,
        &[("VM_RUNNER_LOADER_TEST_STOP_WINDOW_MS", "4000")],
    );
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1" && lines(&dir.join("machines")).len() == 1
    });
    pod.stage_declaring("runner:2", RUNS, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:2");
    // TEST_SCENARIO: the release's loader is asked to start at once, and the window the loader opens before it looks lasts four seconds, so the stop lands inside it.
    wait_for("the release's loader to be asked", || {
        !lines(&dir.join("loaders")).is_empty()
    });
    std::thread::sleep(Duration::from_millis(250));
    // SAFETY: kill(2) takes plain integers and touches no memory of this process.
    unsafe { libc::kill(i32::try_from(pod.loader.id()).unwrap(), libc::SIGTERM) };
    let exited = pod.loader.wait().unwrap();
    let loaders = lines(&dir.join("loaders"));
    assert_eq!(
        loaders.len(),
        1,
        "the pod became the release's loader with a stop already in hand ({exited}): {loaders:?}"
    );
    assert!(
        loaders[0].contains("run --check "),
        "the pod did more than ask: {loaders:?}"
    );
}

// TEST_SCENARIO: a stop that arrives after the loader has looked is held by the mask the process keeps across the exec, and the loader that follows takes it: it starts the release's runner and stops it, so no machine is left running under a pod that is ending. Linux only: the mask and the signals still waiting survive an exec there, and the loader runs only in a Linux pod.
#[cfg(target_os = "linux")]
#[test]
fn a_stop_after_the_last_look_is_taken_by_the_loader_that_follows() {
    let mut pod = Pod::start_named(
        "stop-after-the-look",
        SLOW,
        None,
        &[("VM_RUNNER_LOADER_TEST_EXEC_WINDOW_MS", "4000")],
    );
    let dir = pod.dir.clone();
    wait_for("the pod's own runner", || {
        pod.status().running == "runner:1"
    });
    pod.stage_declaring("runner:2", SLOW, "runtime-a", None, Some(STAGED_LOADER));
    pod.name("runner:2");
    wait_for("the release's loader to be asked", || {
        !lines(&dir.join("loaders")).is_empty()
    });
    // TEST_SCENARIO: the window the loader opened after its last look is four seconds, so the stop waits in the mask for whoever execs.
    std::thread::sleep(Duration::from_millis(500));
    // SAFETY: kill(2) takes plain integers and touches no memory of this process.
    unsafe { libc::kill(i32::try_from(pod.loader.id()).unwrap(), libc::SIGTERM) };
    let exited = pod.loader.wait().unwrap();
    assert!(exited.success(), "the loader exited with {exited}");
    let loaders = lines(&dir.join("loaders"));
    assert_eq!(
        loaders.len(),
        2,
        "the pod did not become the release's loader: {loaders:?}"
    );
    assert!(
        loaders[1].contains("run --builtin "),
        "the pod became another loader than the release's: {loaders:?}"
    );
    assert!(
        lines(&dir.join("runners"))
            .last()
            .is_some_and(|line| line.starts_with("stopped ")),
        "the stop was lost across the exec: {:?}",
        lines(&dir.join("runners"))
    );
}

// TEST_SCENARIO: a stop that arrives while a release's loader is being checked does not wait for the check and for the runner's close: the check ends where it is and the pod keeps the runner it has, which the stop reaches. The pod's grace is shorter than a check may take, so a loader that waited would be killed with every machine still running.
#[test]
fn a_stop_during_the_check_keeps_the_runner_the_pod_has() {
    let mut pod = Pod::start("stop-during-the-check", SLOW);
    let dir = pod.dir.clone();
    // UNIT_BOUNDARY_DESCRIPTION: the runner logs that it started only after it takes its own stop, so a close would be logged rather than ending the shell.
    wait_for("the pod's own runner to take its stop", || {
        lines(&dir.join("runners"))
            .iter()
            .any(|line| line.starts_with("started "))
    });
    pod.stage_declaring("runner:2", RUNS, "runtime-a", None, Some(SLOW_CHECK_LOADER));
    pod.name("runner:2");
    wait_for("the release's loader to begin its check", || {
        !lines(&dir.join("loaders")).is_empty()
    });
    // SAFETY: kill(2) takes plain integers and touches no memory of this process.
    unsafe { libc::kill(i32::try_from(pod.loader.id()).unwrap(), libc::SIGTERM) };
    let exited = pod.loader.wait().unwrap();
    let loaders = lines(&dir.join("loaders"));
    assert_eq!(
        loaders.len(),
        1,
        "the pod went on to become the release's loader ({exited}): {loaders:?}"
    );
    let runners = lines(&dir.join("runners"));
    assert!(
        !runners.iter().any(|line| line.starts_with("closing ")),
        "the pod closed its runner for a hand-off it should have dropped ({exited}): {runners:?}"
    );
    assert_eq!(
        runners
            .iter()
            .filter(|line| line.starts_with("started "))
            .count(),
        1,
        "the pod started a runner it did not need while stopping: {runners:?}"
    );
}
