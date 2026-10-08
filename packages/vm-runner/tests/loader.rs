//! TEST_OVERVIEW: the loader supervises one runner process and replaces it with the release the controller names, once the stager has put that release on the node. The machines a runner starts must outlive the hand-off, a release that exits right after it takes over must give the machines back to the one it replaced, and a stop of the pod must reach the runner. Each runner here is a shell script that starts one long sleep as its "machine".

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use vm_runner::api::{RunnerRelease, HELD_FAILED, HELD_RUNTIME};
use vm_runner::release::{self, FILES, RUNNER, RUNTIME_ID};

const RUNS: &str = r#"#!/bin/sh
[ "$1" = --help ] && exit 0
echo "$0 $*" >> "$RUNNER_LOG"
sleep 1000 &
echo $! >> "$MACHINE_LOG"
trap 'exit 0' USR1 TERM
while :; do sleep 0.1; done
"#;

const CRASHES: &str =
    "#!/bin/sh\n[ \"$1\" = --help ] && exit 0\necho \"$0 $*\" >> \"$RUNNER_LOG\"\nexit 1\n";

fn release_dir(dir: &Path, script: &str, runtime: &str) {
    std::fs::create_dir_all(dir).unwrap();
    for file in FILES {
        std::fs::write(dir.join(file), file).unwrap();
    }
    std::fs::write(dir.join(RUNTIME_ID), runtime).unwrap();
    std::fs::write(dir.join(RUNNER), script).unwrap();
    std::fs::set_permissions(dir.join(RUNNER), std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(100));
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
    fn status(&self) -> RunnerRelease {
        release::read_status(&release::status_file(&self.dir.join("loader")))
    }

    fn name(&self, release: &str) {
        std::fs::write(self.dir.join("release"), release).unwrap();
    }

    fn stage(&self, release: &str, script: &str, runtime: &str) {
        let image = self.dir.join(format!("image-{}", release::key(release)));
        release_dir(&image, script, runtime);
        let tree = self.dir.join(format!("runtime-tree-{runtime}"));
        std::fs::create_dir_all(&tree).unwrap();
        std::fs::write(tree.join("smolvm"), runtime).unwrap();
        release::stage(&image, &tree, &self.dir.join("releases"), release, 10).unwrap();
    }
}

impl Drop for Pod {
    fn drop(&mut self) {
        let _ = self.loader.kill();
        for pid in lines(&self.dir.join("machines")) {
            let _ = Command::new("kill").arg(&pid).status();
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

// TEST_SCENARIO: a new release takes over without the machine the old runner started going down, against the pod's runtime or against its own; a release that exits right after it took over is held as failed while the machines go back to the release it replaced; one that does not even load in the pod is held for a new pod; and the pod's stop reaches the runner and ends the loader.
#[test]
fn a_release_takes_over_the_machines_and_a_broken_one_gives_them_back() {
    let dir = std::env::temp_dir().join(format!("vm-runner-loader-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let builtin = dir.join("builtin");
    let builtin_runtime = dir.join("builtin-runtime");
    release_dir(&builtin, RUNS, "runtime-a");
    std::fs::create_dir_all(dir.join("releases")).unwrap();
    std::fs::write(dir.join("release"), "runner:1").unwrap();
    let smolvm = |runtime: &Path| format!("--smolvm {}/smolvm", runtime.display());
    let loader = Command::new(env!("CARGO_BIN_EXE_vm-runner-loader"))
        .args(["run", "--builtin"])
        .arg(&builtin)
        .arg("--builtin-runtime")
        .arg(&builtin_runtime)
        .args(["--", "--smolvm"])
        .arg(builtin_runtime.join("smolvm"))
        .env(release::RELEASES_ENV, dir.join("releases"))
        .env(release::RELEASE_FILE_ENV, dir.join("release"))
        .env(release::LOADER_DIR_ENV, dir.join("loader"))
        .env(release::BUILTIN_RELEASE_ENV, "runner:1")
        .env("RUNNER_LOG", dir.join("runners"))
        .env("MACHINE_LOG", dir.join("machines"))
        .spawn()
        .unwrap();
    let mut pod = Pod {
        dir: dir.clone(),
        loader,
    };

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

    // SAFETY: kill(2) takes plain integers and touches no memory of this process.
    unsafe { libc::kill(i32::try_from(pod.loader.id()).unwrap(), libc::SIGTERM) };
    let exited = pod.loader.wait().unwrap();
    assert!(exited.success(), "the loader exited with {exited}");
    let runners = lines(&dir.join("runners"));
    let copies = dir.join("loader").join("releases");
    let ran = |release: &str, runtime: &Path| {
        format!(
            "{} {}",
            copies.join(release::key(release)).join(RUNNER).display(),
            smolvm(runtime)
        )
    };
    let pod_runtime = dir.join("loader").join("runtimes").join("runtime-b");
    assert_eq!(
        runners,
        [
            format!(
                "{} {}",
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
