use std::path::{Path, PathBuf};

use anyhow::Context;
use sha2::{Digest, Sha256};

use crate::api::{RunnerRelease, HELD_UNSTAGED};

// UNIT_BOUNDARY_DESCRIPTION: a runner release is the runner and the two guest binaries it copies into every share, staged together on the node so the runner and platform-init stay one version. runtime-id names the VM runtime the release was built against: the smolvm release with its patched libkrun, crane and the base image's libc. The runtime travels with the release, staged once per id beside the releases, because the runner is itself the VMM of every machine it starts and loads that runtime's libraries and guest agent.
pub const FILES: [&str; 4] = ["vm-runner", "platform-init", "platform-runc", RUNTIME_ID];
pub const RUNNER: &str = "vm-runner";
pub const RUNTIME_ID: &str = "runtime-id";

// UNIT_BOUNDARY_DESCRIPTION: the directory a release is staged under, named from the image reference the controller and the stager both know it by. A reference holds characters a file name cannot, so the name is a hash of it.
pub fn key(release: &str) -> String {
    hex::encode(Sha256::digest(release.as_bytes()))[..32].to_string()
}

// UNIT_BOUNDARY_DESCRIPTION: where the runtime a release names is staged, beside the releases: one copy for every release built against it.
pub fn runtime_dir(staged: &Path, id: &str) -> PathBuf {
    staged.join(format!("runtime-{id}"))
}

pub fn runtime_id(release_dir: &Path) -> Option<String> {
    std::fs::read_to_string(release_dir.join(RUNTIME_ID))
        .ok()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

// UNIT_BOUNDARY_DESCRIPTION: which binaries and runtime the loader runs for the release the controller asks for. The pod's own image is always there; a staged one only once the stager has put it, and the runtime it names, on this node. A release built against another runtime than the pod's is taken too: machines already running stay on the runtime they booted, and only machines started after the hand-off boot the new one. `runtime` is None for the pod's own runtime.
#[derive(Debug, PartialEq, Eq)]
pub enum Choice {
    Run {
        release: String,
        dir: PathBuf,
        runtime: Option<PathBuf>,
    },
    Held {
        held: &'static str,
        message: String,
    },
}

pub struct Releases {
    pub builtin: PathBuf,
    pub builtin_runtime: PathBuf,
    pub builtin_release: String,
    pub staged: PathBuf,
}

impl Releases {
    pub fn choose(&self, target: &str) -> Choice {
        if target.is_empty() || target == self.builtin_release {
            return self.builtin();
        }
        let dir = self.staged.join(key(target));
        let unstaged = |what: &str| Choice::Held {
            held: HELD_UNSTAGED,
            message: format!("{what} of {target} is not staged on this node yet"),
        };
        let (Some(id), true) = (runtime_id(&dir), dir.join(RUNNER).is_file()) else {
            return unstaged("the release");
        };
        if Some(&id) == runtime_id(&self.builtin).as_ref() {
            return Choice::Run {
                release: target.to_string(),
                dir,
                runtime: None,
            };
        }
        let runtime = runtime_dir(&self.staged, &id);
        if !runtime.is_dir() {
            return unstaged("the VM runtime");
        }
        Choice::Run {
            release: target.to_string(),
            dir,
            runtime: Some(runtime),
        }
    }

    pub fn builtin(&self) -> Choice {
        Choice::Run {
            release: self.builtin_release.clone(),
            dir: self.builtin.clone(),
            runtime: None,
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's arguments for a release and runtime. The image's entrypoint names the pod's own binaries and smolvm; a staged release runs its own binaries, from its own directory, against its own runtime.
pub fn args_for(args: &[String], moves: &[(&Path, &Path)]) -> Vec<String> {
    args.iter()
        .map(|arg| {
            moves
                .iter()
                .find_map(|(from, to)| {
                    arg.strip_prefix(&format!("{}/", from.display()))
                        .map(|rest| format!("{}/{rest}", to.display()))
                })
                .unwrap_or_else(|| arg.clone())
        })
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: the environment the controller gives a runner pod's loader: the node's staged releases, the loader's own directory, and the reference of the release the pod's image carries. None set, the loader runs the pod's own release and nothing else. contract/loader-env.json holds the controller to these names.
pub const RELEASES_ENV: &str = "VM_RUNNER_RELEASES";
pub const BUILTIN_RELEASE_ENV: &str = "VM_RUNNER_BUILTIN_RELEASE";

// UNIT_BOUNDARY_DESCRIPTION: the loader's own directory, an emptyDir of the pod: the release the controller named over the machine API, which the runner writes and the loader reads; the status the loader writes for the runner to serve; and its copies of the staged releases it runs. A copy is what the runner runs from, because the stager may remove a release from the node while a runner still copies its platform-init into every share. The named release outlives a runner process, so a release that crashes and restarts keeps its target, but not the pod: a new pod runs its own image until the controller names the release again.
pub const LOADER_DIR_ENV: &str = "VM_RUNNER_LOADER_DIR";

pub fn status_file(loader_dir: &Path) -> PathBuf {
    loader_dir.join("status.json")
}

pub fn target_file(loader_dir: &Path) -> PathBuf {
    loader_dir.join("target")
}

// UNIT_BOUNDARY_DESCRIPTION: replaces a file of the loader directory whole, so the side that reads it never reads half of one.
pub fn replace(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let scratch = path.with_extension("partial");
    std::fs::write(&scratch, bytes).with_context(|| format!("writing {}", scratch.display()))?;
    std::fs::rename(&scratch, path).with_context(|| format!("replacing {}", path.display()))
}

pub fn write_status(path: &Path, status: &RunnerRelease) -> anyhow::Result<()> {
    replace(path, &serde_json::to_vec(status)?)
}

pub fn read_target(path: &Path) -> String {
    std::fs::read_to_string(path)
        .map(|t| t.trim().to_string())
        .unwrap_or_default()
}

pub fn read_status(path: &Path) -> RunnerRelease {
    std::fs::read(path)
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default()
}

// UNIT_BOUNDARY_DESCRIPTION: copies the release this image carries into the node's release directory, under its key, with the runtime it names, and keeps the `keep` most recently staged releases and the runtimes they name. A release or runtime appears whole or not at all: it is copied into a scratch directory and renamed into place, so a loader never takes one still being written. A release staged again under the same reference with other bytes, which a mutable tag gives, replaces the one there; a runtime is named by its build inputs, so one already staged is kept. Removing what a runner still runs is safe: the loader runs its own copies.
pub fn stage(
    builtin: &Path,
    runtime: &Path,
    into: &Path,
    release: &str,
    keep: usize,
) -> anyhow::Result<PathBuf> {
    let dest = stage_files(builtin, into, release)?;
    let id = runtime_id(builtin).context("the release names no runtime")?;
    copy_tree(runtime, &runtime_dir(into, &id))?;
    let mut staged: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(into)?
        .filter_map(Result::ok)
        .filter(|entry| entry.path() != dest && !is_runtime(&entry.path()))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    staged.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    for (_, old) in staged.into_iter().skip(keep.saturating_sub(1)) {
        remove_if_present(&old)?;
    }
    let named: Vec<PathBuf> = std::fs::read_dir(into)?
        .filter_map(Result::ok)
        .filter_map(|entry| runtime_id(&entry.path()))
        .map(|id| runtime_dir(into, &id))
        .collect();
    for entry in std::fs::read_dir(into)?.filter_map(Result::ok) {
        if is_runtime(&entry.path()) && !named.contains(&entry.path()) {
            remove_if_present(&entry.path())?;
        }
    }
    Ok(dest)
}

fn is_runtime(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("runtime-"))
}

// UNIT_BOUNDARY_DESCRIPTION: copies a release's own files under its key in `into`, replacing a copy whose bytes differ, and returns where it is. The loader uses it to copy a staged release into the pod.
pub fn stage_files(builtin: &Path, into: &Path, release: &str) -> anyhow::Result<PathBuf> {
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
    Ok(dest)
}

// UNIT_BOUNDARY_DESCRIPTION: copies a directory tree to `dest` unless it is already there, through a scratch directory renamed into place. A runtime holds the guest agent's whole root filesystem, with its links and modes, which `cp -a` keeps.
pub fn copy_tree(from: &Path, dest: &Path) -> anyhow::Result<()> {
    if dest.is_dir() {
        return Ok(());
    }
    let name = dest.file_name().context("a copy needs a name")?;
    let scratch = dest.with_file_name(format!(".staging-{}", name.to_string_lossy()));
    remove_if_present(&scratch)?;
    let copied = std::process::Command::new("cp")
        .arg("-a")
        .arg(from)
        .arg(&scratch)
        .status()
        .context("running cp")?;
    anyhow::ensure!(
        copied.success(),
        "copying {} to {}: cp {copied}",
        from.display(),
        scratch.display()
    );
    std::fs::rename(&scratch, dest)
        .with_context(|| format!("moving the copy to {}", dest.display()))
}

// UNIT_BOUNDARY_DESCRIPTION: whether a VMM running under `proc` boots from the runtime in `dir`. smolvm runs every VMM as `_boot-vm <boot-config>`, and beside that config the runner records the guest agent root the VMM serves, which lies in the runtime it booted on; smolvm deletes the config itself once the VMM has read it, while the record stays. A VMM makes itself non-dumpable, so its maps and exe are shut to the loader, but its command line and that record are not. A VMM with no readable record, one an older release started, keeps every runtime: nothing else says which one it needs.
pub fn booted_from(proc: &Path, dir: &Path) -> bool {
    std::fs::read_dir(proc)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let cmdline = std::fs::read(entry.path().join("cmdline")).ok()?;
            let mut args = cmdline.split(|b| *b == 0);
            args.position(|arg| arg == b"_boot-vm")?;
            Some(PathBuf::from(
                String::from_utf8_lossy(args.next()?).into_owned(),
            ))
        })
        .any(|config| {
            std::fs::read_to_string(config.with_file_name(crate::runtime::AGENT_ROOTFS_FILE))
                .ok()
                .is_none_or(|rootfs| Path::new(rootfs.trim()).starts_with(dir))
        })
}

// UNIT_BOUNDARY_DESCRIPTION: removes every release under `dir` but those in `keep`. The loader keeps exactly the release it runs and the one it would go back to, whatever was copied last.
pub fn prune(dir: &Path, keep: &[&Path]) -> anyhow::Result<()> {
    for entry in std::fs::read_dir(dir)?.filter_map(Result::ok) {
        if !keep.contains(&entry.path().as_path()) {
            remove_if_present(&entry.path())?;
        }
    }
    Ok(())
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

// UNIT_BOUNDARY_DESCRIPTION: sets the SELinux context of one file, or of a link itself rather than what it points at, as `chcon -h` would. Only Linux has one, and the binaries that call it run only from the runner image.
pub fn relabel(path: &Path, context: &str) -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
        // SAFETY: both names are NUL-terminated and live for the call, and the value pointer and length describe one live byte slice.
        let rc = unsafe {
            libc::lsetxattr(
                path.as_ptr(),
                c"security.selinux".as_ptr(),
                context.as_ptr().cast(),
                context.len(),
                0,
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (path, context);
        Err(std::io::ErrorKind::Unsupported.into())
    }
}

// UNIT_BOUNDARY_DESCRIPTION: sets the SELinux context of `dir` and of everything below it, as `chcon -hR` would. A file the stager creates inherits the label of the directory it is created in, but `cp -a` keeps the label a runtime's files had in the stager's own image, which a runner confined to its own categories may not read.
pub fn relabel_tree(dir: &Path, context: &str) -> anyhow::Result<()> {
    relabel(dir, context).with_context(|| format!("labelling {} {context}", dir.display()))?;
    if std::fs::symlink_metadata(dir)?.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            relabel_tree(&entry?.path(), context)?;
        }
    }
    Ok(())
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

    fn runtime(dir: &Path, agent: &str) {
        std::fs::create_dir_all(dir.join("agent-rootfs/etc")).unwrap();
        std::fs::write(dir.join("agent-rootfs/etc/agent"), agent).unwrap();
        std::os::unix::fs::symlink("etc/agent", dir.join("agent-rootfs/agent")).unwrap();
    }

    fn releases(dir: &Path) -> Releases {
        Releases {
            builtin: dir.join("builtin"),
            builtin_runtime: dir.join("builtin-runtime"),
            builtin_release: "runner:1".into(),
            staged: dir.join("staged"),
        }
    }

    fn stage_as(r: &Releases, name: &str, runner: &str, id: &str) {
        let image = r.staged.parent().unwrap().join(format!("image-{runner}"));
        release(&image, runner, id);
        let tree = r
            .staged
            .parent()
            .unwrap()
            .join(format!("runtime-tree-{id}"));
        if !tree.exists() {
            runtime(&tree, id);
        }
        stage(&image, &tree, &r.staged, name, 10).unwrap();
    }

    // TEST_SCENARIO: the loader runs a staged release once it, and the runtime it names, are on this node. A release built against the pod's own runtime runs against that runtime; one built against another runs against its own staged runtime.
    #[test]
    fn a_release_runs_once_it_and_its_runtime_are_staged() {
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
                dir: r.staged.join(key("runner:2")),
                runtime: None,
            }
        );
        stage_as(&r, "runner:3", "three", "runtime-b");
        assert_eq!(
            r.choose("runner:3"),
            Choice::Run {
                release: "runner:3".into(),
                dir: r.staged.join(key("runner:3")),
                runtime: Some(runtime_dir(&r.staged, "runtime-b")),
            }
        );
    }

    // TEST_SCENARIO: a staged release runs its own binaries against its own runtime, so every argument naming one of the pod's own binaries or its smolvm is pointed at the release's copy, and nothing else changes.
    #[test]
    fn a_staged_release_runs_its_own_binaries_and_runtime() {
        let args = [
            "--platform-init".to_string(),
            "/usr/local/libexec/vm-runner/platform-init".to_string(),
            "--smolvm".to_string(),
            "/opt/smolvm/smolvm".to_string(),
            "--crane".to_string(),
            "/usr/local/bin/crane".to_string(),
        ];
        assert_eq!(
            args_for(
                &args,
                &[
                    (
                        Path::new("/usr/local/libexec/vm-runner"),
                        Path::new("/releases/abc")
                    ),
                    (Path::new("/opt/smolvm"), Path::new("/runtimes/b")),
                ]
            ),
            [
                "--platform-init",
                "/releases/abc/platform-init",
                "--smolvm",
                "/runtimes/b/smolvm",
                "--crane",
                "/usr/local/bin/crane"
            ]
        );
    }

    // TEST_SCENARIO: the node keeps only the newest few releases, the one just staged always among them, and only the runtimes those name, each once however many releases share it; a runtime keeps its links. Staging the same bytes again keeps them; a mutable tag staged again with other bytes replaces what is there, since a loader would otherwise run the old bytes under the new name.
    #[test]
    fn staging_keeps_the_newest_releases_and_the_runtimes_they_name() {
        let dir = TempDir::new("release-stage");
        let r = releases(dir.path());
        std::fs::create_dir_all(&r.staged).unwrap();
        stage_as(&r, "runner:1", "bytes-1", "runtime-a");
        std::thread::sleep(std::time::Duration::from_millis(20));
        stage_as(&r, "runner:2", "bytes-2", "runtime-b");
        std::thread::sleep(std::time::Duration::from_millis(20));
        stage_as(&r, "runner:3", "bytes-3", "runtime-b");
        let names = |dir: &Path| {
            let mut names: Vec<String> = std::fs::read_dir(dir)
                .unwrap()
                .map(|e| e.unwrap().file_name().into_string().unwrap())
                .collect();
            names.sort();
            names
        };
        let mut all = vec![
            key("runner:1"),
            key("runner:2"),
            key("runner:3"),
            "runtime-runtime-a".to_string(),
            "runtime-runtime-b".to_string(),
        ];
        all.sort();
        assert_eq!(names(&r.staged), all, "one runtime-b for two releases");
        let staged = runtime_dir(&r.staged, "runtime-b");
        assert_eq!(
            std::fs::read_link(staged.join("agent-rootfs/agent")).unwrap(),
            Path::new("etc/agent")
        );

        let image = dir.path().join("rebuilt");
        release(&image, "rebuilt", "runtime-b");
        let dest = stage(
            &image,
            &dir.path().join("runtime-tree-runtime-b"),
            &r.staged,
            "runner:3",
            2,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(dest.join(RUNNER)).unwrap(),
            "rebuilt"
        );
        let mut two = vec![
            key("runner:2"),
            key("runner:3"),
            "runtime-runtime-b".to_string(),
        ];
        two.sort();
        assert_eq!(
            names(&r.staged),
            two,
            "runtime-a is named by no kept release"
        );
    }

    // TEST_SCENARIO: a runtime stays in the pod while any VMM boots from it, which is how a machine booted before a hand-off keeps the runtime it booted. A VMM is non-dumpable, so it shows the loader no maps, and smolvm has deleted its boot config: the loader finds it by its `_boot-vm` command line and reads the guest agent root the runner recorded beside that config. A VMM with no record keeps every runtime.
    #[test]
    fn a_runtime_a_vmm_boots_from_is_in_use() {
        let dir = TempDir::new("release-booted");
        let proc = dir.path().join("proc");
        let vmm = |pid: &str, vm: &str| {
            std::fs::create_dir_all(proc.join(pid)).unwrap();
            let config = dir.path().join(vm).join("boot-config.json");
            let cmdline = format!("/proc/self/exe\0_boot-vm\0{}\0", config.display());
            std::fs::write(proc.join(pid).join("cmdline"), cmdline).unwrap();
            dir.path().join(vm)
        };
        let booted = vmm("42", "vm-a");
        std::fs::create_dir_all(&booted).unwrap();
        std::fs::write(
            booted.join(crate::runtime::AGENT_ROOTFS_FILE),
            "/pod/runtimes/a/agent-rootfs",
        )
        .unwrap();
        std::fs::create_dir_all(proc.join("7")).unwrap();
        std::fs::write(
            proc.join("7/cmdline"),
            "vm-runner\0--state-dir=/pod/runtimes/b\0",
        )
        .unwrap();
        assert!(booted_from(&proc, Path::new("/pod/runtimes/a")));
        assert!(!booted_from(&proc, Path::new("/pod/runtimes/ab")));
        assert!(!booted_from(&proc, Path::new("/pod/runtimes/b")));

        vmm("43", "vm-older");
        assert!(booted_from(&proc, Path::new("/pod/runtimes/b")));
    }

    // TEST_SCENARIO: the controller sets the loader's environment from Go, so a renamed variable is a loader that silently runs only the pod's own release. Both sides are held to the names in contract/loader-env.json.
    #[test]
    fn the_loader_reads_the_environment_the_controller_sets() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/contract/loader-env.json");
        let names: Vec<String> =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(names, [RELEASES_ENV, LOADER_DIR_ENV, BUILTIN_RELEASE_ENV]);
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
