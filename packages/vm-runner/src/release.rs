use std::path::{Path, PathBuf};

use anyhow::Context;
use sha2::{Digest, Sha256};

use crate::api::{RunnerRelease, HELD_RUNTIME, HELD_UNSTAGED};

// UNIT_BOUNDARY_DESCRIPTION: a runner release is the runner and the two guest binaries it copies into every share, staged together on the node so the runner and platform-init stay one version. runtime-id names what the release was built against and the pod does not change: the smolvm release, crane and the base image's libc. The runner itself is the VMM of every machine it starts, so a release built against another runtime cannot adopt machines running on this one.
pub const FILES: [&str; 4] = ["vm-runner", "platform-init", "platform-runc", RUNTIME_ID];
pub const RUNNER: &str = "vm-runner";
pub const RUNTIME_ID: &str = "runtime-id";

// UNIT_BOUNDARY_DESCRIPTION: the directory a release is staged under, named from the image reference the controller and the stager both know it by. A reference holds characters a file name cannot, so the name is a hash of it.
pub fn key(release: &str) -> String {
    hex::encode(Sha256::digest(release.as_bytes()))[..32].to_string()
}

// UNIT_BOUNDARY_DESCRIPTION: which binaries the loader runs for the release the controller asks for. The pod's own image is always there; a staged one only once the stager has put it on this node, and only when it was built against the runtime this pod's image carries.
#[derive(Debug, PartialEq, Eq)]
pub enum Choice {
    Run { release: String, dir: PathBuf },
    Held { held: &'static str, message: String },
}

pub struct Releases {
    pub builtin: PathBuf,
    pub builtin_release: String,
    pub staged: PathBuf,
}

impl Releases {
    pub fn choose(&self, target: &str) -> Choice {
        if target.is_empty() || target == self.builtin_release {
            return self.builtin();
        }
        let dir = self.staged.join(key(target));
        if !dir.join(RUNNER).is_file() {
            return Choice::Held {
                held: HELD_UNSTAGED,
                message: format!("{target} is not staged on this node yet"),
            };
        }
        let runtime = |dir: &Path| std::fs::read_to_string(dir.join(RUNTIME_ID)).ok();
        if runtime(&dir).is_none() || runtime(&dir) != runtime(&self.builtin) {
            return Choice::Held {
                held: HELD_RUNTIME,
                message: format!(
                    "{target} is built against another VM runtime than this pod, so only a new pod runs it"
                ),
            };
        }
        Choice::Run {
            release: target.to_string(),
            dir,
        }
    }

    pub fn builtin(&self) -> Choice {
        Choice::Run {
            release: self.builtin_release.clone(),
            dir: self.builtin.clone(),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's arguments for a release. The image's entrypoint names the pod's own binaries, platform-init and platform-runc among them; a staged release runs its own, from its own directory.
pub fn args_for(args: &[String], builtin: &Path, dir: &Path) -> Vec<String> {
    let from = format!("{}/", builtin.display());
    let to = format!("{}/", dir.display());
    args.iter()
        .map(|arg| match arg.strip_prefix(&from) {
            Some(rest) => format!("{to}{rest}"),
            None => arg.clone(),
        })
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: the environment the controller gives a runner pod's loader: the node's staged releases, the file naming the release to run, the loader's own directory, and the reference of the release the pod's image carries. None set, the loader runs the pod's own release and nothing else. contract/loader-env.json holds the controller to these names.
pub const RELEASES_ENV: &str = "VM_RUNNER_RELEASES";
pub const RELEASE_FILE_ENV: &str = "VM_RUNNER_RELEASE_FILE";
pub const BUILTIN_RELEASE_ENV: &str = "VM_RUNNER_BUILTIN_RELEASE";

// UNIT_BOUNDARY_DESCRIPTION: the loader's own directory, an emptyDir of the pod: the status it writes for the runner to serve, and its copies of the staged releases it runs. A copy is what the runner runs from, because the stager may remove a release from the node while a runner still copies its platform-init into every share.
pub const LOADER_DIR_ENV: &str = "VM_RUNNER_LOADER_DIR";

pub fn status_file(loader_dir: &Path) -> PathBuf {
    loader_dir.join("status.json")
}

// UNIT_BOUNDARY_DESCRIPTION: writes the release status the runner serves to the controller. Replaced whole, so the runner never reads half of one.
pub fn write_status(path: &Path, status: &RunnerRelease) -> anyhow::Result<()> {
    let scratch = path.with_extension("partial");
    std::fs::write(&scratch, serde_json::to_vec(status)?)
        .with_context(|| format!("writing {}", scratch.display()))?;
    std::fs::rename(&scratch, path).with_context(|| format!("replacing {}", path.display()))
}

pub fn read_status(path: &Path) -> RunnerRelease {
    std::fs::read(path)
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default()
}

// UNIT_BOUNDARY_DESCRIPTION: copies the release this image carries into the node's release directory, under its key, and keeps the `keep` most recently staged there. A release appears whole or not at all: it is copied into a scratch directory and renamed into place, so a loader never runs a release still being written. A release staged again under the same reference with other bytes, which a mutable tag gives, replaces the one there. Removing a release a runner still runs is safe: the process keeps its binary, and the guest binaries were copied into each share. A loader that later needs a removed release falls back to the pod's own.
pub fn stage(builtin: &Path, into: &Path, release: &str, keep: usize) -> anyhow::Result<PathBuf> {
    let name = key(release);
    let dest = into.join(&name);
    if !same_release(builtin, &dest) {
        let scratch = into.join(format!(".staging-{name}"));
        let retired = into.join(format!(".retired-{name}"));
        for dir in [&scratch, &retired] {
            remove_if_present(dir)?;
        }
        std::fs::create_dir_all(&scratch)
            .with_context(|| format!("creating {}", scratch.display()))?;
        for file in FILES {
            std::fs::copy(builtin.join(file), scratch.join(file))
                .with_context(|| format!("copying {file} into {}", scratch.display()))?;
            std::fs::File::open(scratch.join(file))?.sync_all()?;
        }
        std::fs::File::open(&scratch)?.sync_all()?;
        if dest.exists() {
            std::fs::rename(&dest, &retired)?;
        }
        std::fs::rename(&scratch, &dest)
            .with_context(|| format!("moving the staged release to {}", dest.display()))?;
        remove_if_present(&retired)?;
    }
    std::fs::File::open(&dest)?.set_modified(std::time::SystemTime::now())?;
    let mut staged: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(into)?
        .filter_map(Result::ok)
        .filter(|entry| entry.path() != dest)
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    staged.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    for (_, old) in staged.into_iter().skip(keep.saturating_sub(1)) {
        remove_if_present(&old)?;
    }
    Ok(dest)
}

// UNIT_BOUNDARY_DESCRIPTION: whether two release directories hold the same bytes, hashed as streams: the runner binary is tens of MiB and the stager runs in a few.
fn same_release(a: &Path, b: &Path) -> bool {
    let digest = |path: PathBuf| -> Option<Vec<u8>> {
        use std::io::Read;
        let mut file = std::fs::File::open(path).ok()?;
        let mut hasher = Sha256::new();
        let mut chunk = vec![0; 1 << 16];
        loop {
            match file.read(&mut chunk).ok()? {
                0 => return Some(hasher.finalize().to_vec()),
                n => hasher.update(&chunk[..n]),
            }
        }
    };
    FILES
        .iter()
        .all(|file| match (digest(a.join(file)), digest(b.join(file))) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        })
}

fn remove_if_present(dir: &Path) -> anyhow::Result<()> {
    match std::fs::remove_dir_all(dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(e).with_context(|| format!("removing {}", dir.display()))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir;

    fn release(dir: &Path, runner: &str, runtime: &str) {
        std::fs::create_dir_all(dir).unwrap();
        for file in FILES {
            std::fs::write(dir.join(file), file).unwrap();
        }
        std::fs::write(dir.join(RUNNER), runner).unwrap();
        std::fs::write(dir.join(RUNTIME_ID), runtime).unwrap();
    }

    fn releases(dir: &Path) -> Releases {
        Releases {
            builtin: dir.join("builtin"),
            builtin_release: "runner:1".into(),
            staged: dir.join("staged"),
        }
    }

    // TEST_SCENARIO: the loader runs a staged release only when it can adopt the machines running: a release the stager has not reached this node with yet is waited for, one built against another runtime is held for a new pod, and the pod's own release needs no staging at all.
    #[test]
    fn a_release_runs_only_once_it_is_staged_against_the_same_runtime() {
        let dir = TempDir::new("release-choose");
        let r = releases(dir.path());
        release(&r.builtin, "one", "runtime-a");
        assert_eq!(r.choose("runner:1"), r.builtin());
        assert_eq!(r.choose(""), r.builtin());
        assert!(matches!(
            r.choose("runner:2"),
            Choice::Held {
                held: HELD_UNSTAGED,
                ..
            }
        ));
        stage_as(&r, "runner:2", "two", "runtime-a");
        assert_eq!(
            r.choose("runner:2"),
            Choice::Run {
                release: "runner:2".into(),
                dir: r.staged.join(key("runner:2"))
            }
        );
        stage_as(&r, "runner:3", "three", "runtime-b");
        assert!(matches!(
            r.choose("runner:3"),
            Choice::Held {
                held: HELD_RUNTIME,
                ..
            }
        ));
    }

    fn stage_as(r: &Releases, name: &str, runner: &str, runtime: &str) {
        let image = r.staged.parent().unwrap().join(format!("image-{runner}"));
        release(&image, runner, runtime);
        stage(&image, &r.staged, name, 10).unwrap();
    }

    // TEST_SCENARIO: a staged release runs its own guest binaries, so every argument naming one of the pod's own binaries is pointed at the release's copy, and nothing else changes.
    #[test]
    fn a_staged_release_runs_its_own_guest_binaries() {
        let args = [
            "--platform-init".to_string(),
            "/usr/local/libexec/vm-runner/platform-init".to_string(),
            "--smolvm".to_string(),
            "/opt/smolvm/smolvm".to_string(),
        ];
        assert_eq!(
            args_for(
                &args,
                Path::new("/usr/local/libexec/vm-runner"),
                Path::new("/releases/abc")
            ),
            [
                "--platform-init",
                "/releases/abc/platform-init",
                "--smolvm",
                "/opt/smolvm/smolvm"
            ]
        );
    }

    // TEST_SCENARIO: the node keeps only the newest few releases, the one just staged always among them, and staging the same bytes again keeps them; a mutable tag staged again with other bytes replaces what is there, since a loader would otherwise run the old bytes under the new name.
    #[test]
    fn staging_keeps_the_newest_releases_and_replaces_changed_bytes() {
        let dir = TempDir::new("release-stage");
        let into = dir.path().join("staged");
        std::fs::create_dir_all(&into).unwrap();
        let image = dir.path().join("image");
        for (n, name) in ["runner:1", "runner:2", "runner:3"].iter().enumerate() {
            release(&image, &format!("bytes-{n}"), "runtime");
            stage(&image, &into, name, 2).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let mut left: Vec<String> = std::fs::read_dir(&into)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        let mut want = vec![key("runner:2"), key("runner:3")];
        want.sort();
        assert_eq!(left, want);

        release(&image, "rebuilt", "runtime");
        let dest = stage(&image, &into, "runner:3", 2).unwrap();
        assert_eq!(
            std::fs::read_to_string(dest.join(RUNNER)).unwrap(),
            "rebuilt"
        );
    }

    // TEST_SCENARIO: the controller sets the loader's environment from Go, so a renamed variable is a loader that silently runs only the pod's own release. Both sides are held to the names in contract/loader-env.json.
    #[test]
    fn the_loader_reads_the_environment_the_controller_sets() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/contract/loader-env.json");
        let names: Vec<String> =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(
            names,
            [
                RELEASES_ENV,
                RELEASE_FILE_ENV,
                LOADER_DIR_ENV,
                BUILTIN_RELEASE_ENV
            ]
        );
    }

    // TEST_SCENARIO: the runner serves what the loader last wrote, and before the loader has written anything, or where no loader runs, an empty status rather than an error.
    #[test]
    fn the_status_reads_as_written_and_as_empty_before_it_is() {
        let dir = TempDir::new("release-status");
        let path = dir.path().join("status.json");
        assert_eq!(read_status(&path), RunnerRelease::default());
        let status = RunnerRelease {
            running: "runner:1".into(),
            target: "runner:2".into(),
            held: HELD_UNSTAGED.into(),
            message: "waiting".into(),
        };
        write_status(&path, &status).unwrap();
        assert_eq!(read_status(&path), status);
    }
}
