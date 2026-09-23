use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::command;

// UNIT_BOUNDARY_DESCRIPTION: the disk templates smolvm formats a machine's disks from. The release ships them compressed beside its binary and smolvm expands one the first time a machine needs it — 24 s of a 25 s first start after every pod roll, paid by whoever creates the next agent. The runner expands them in the background as it starts instead, into the same directory the Go runner used, and links them where smolvm's embedded runtime looks: its own executable's directory is not the release's, so without the links smolvm would find no template at all.

// UNIT_BOUNDARY_DESCRIPTION: long enough never to cut a healthy expansion short, and there so a decompressor that hangs cannot hold the warm-up for the life of the runner.
pub const WARM_TIMEOUT: Duration = Duration::from_secs(5 * 60);

const PACKED_SUFFIX: &str = ".ext4.zst";

// UNIT_BOUNDARY_DESCRIPTION: the packed templates in `dir` that have no expanded copy beside them. A template already expanded is left alone, so a warm pod does no work.
pub fn to_warm(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut packed: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.to_string_lossy().ends_with(PACKED_SUFFIX))
        .filter(|p| !expanded(p).exists())
        .collect();
    packed.sort();
    packed
}

fn expanded(packed: &Path) -> PathBuf {
    packed.with_extension("")
}

// UNIT_BOUNDARY_DESCRIPTION: expands every missing template in `install` and links every expanded one into `home`. `--sparse` is not zstd's default when it writes to a named file, and without it a 20 GiB template of holes is written out in full: measured at 20 GiB and 33 s against 672 KiB and 4 s. Each expansion goes to a temporary name and is renamed over the target, so a machine created meanwhile never opens half a template. A failure is logged and left: smolvm still expands what it needs itself.
pub fn warm(install: &Path, home: &Path, cancel: &CancellationToken) {
    let packed = to_warm(install);
    if packed.is_empty() && !has_expanded(install) {
        tracing::info!(dir = %install.display(), "no disk templates to warm");
    }
    for packed in packed {
        let target = expanded(&packed);
        let staged = target.with_extension("ext4.warming");
        let started = Instant::now();
        let result = command::output(
            Command::new("zstd")
                .args(["-d", "-q", "-f", "--sparse", "-o"])
                .arg(&staged)
                .arg(&packed),
            Instant::now() + WARM_TIMEOUT,
            cancel,
        );
        if let Err(e) = result {
            tracing::warn!(template = %packed.display(), error = %format!("{e:#}"), "template warm-up failed; the first machine will expand it instead");
            let _ = fs::remove_file(&staged);
            continue;
        }
        if let Err(e) = fs::rename(&staged, &target) {
            tracing::warn!(template = %target.display(), error = %e, "template warm-up could not be put in place");
            let _ = fs::remove_file(&staged);
            continue;
        }
        tracing::info!(template = %target.display(), duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX), "template warmed");
    }
    link(install, home);
}

fn has_expanded(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .any(|e| e.file_name().to_string_lossy().ends_with(".ext4"))
        })
        .unwrap_or(false)
}

// UNIT_BOUNDARY_DESCRIPTION: points `home/.smolvm/<template>` at each expanded template in `install`. That is the first place smolvm looks, and a link rather than a copy keeps a qcow2 overlay's recorded backing path the one the Go runner's overlays name, since smolvm resolves the link before writing it.
pub fn link(install: &Path, home: &Path) {
    let dir = home.join(".smolvm");
    if let Err(e) = fs::create_dir_all(&dir) {
        tracing::warn!(dir = %dir.display(), error = %e, "cannot link the disk templates");
        return;
    }
    let Ok(entries) = fs::read_dir(install) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_string_lossy().ends_with(".ext4") {
            continue;
        }
        let at = dir.join(&name);
        if fs::read_link(&at).ok().as_deref() == Some(entry.path().as_path()) {
            continue;
        }
        let _ = fs::remove_file(&at);
        if let Err(e) = std::os::unix::fs::symlink(entry.path(), &at) {
            tracing::warn!(template = %at.display(), error = %e, "cannot link a disk template");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("vm-runner-templates-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // TEST_SCENARIO: warming picks exactly the templates that are missing: one already expanded is left alone, so a warm pod does no work, and nothing that is not a packed template is touched.
    #[test]
    fn only_the_templates_that_are_missing_are_warmed() {
        let dir = TempDir::new("pick");
        for name in [
            "storage-template.ext4.zst",
            "overlay-template.ext4.zst",
            "overlay-template.ext4",
            "smolvm",
            "notes.txt.zst",
        ] {
            fs::write(dir.0.join(name), "x").unwrap();
        }
        assert_eq!(
            to_warm(&dir.0),
            vec![dir.0.join("storage-template.ext4.zst")]
        );
        fs::write(dir.0.join("storage-template.ext4"), "x").unwrap();
        assert!(to_warm(&dir.0).is_empty());
    }

    // TEST_SCENARIO: smolvm looks for templates in HOME/.smolvm and beside its own executable, and this runner is not installed beside the release. Each expanded template is linked there, a stale link is replaced, and a link already right is kept.
    #[test]
    fn expanded_templates_are_linked_where_smolvm_looks() {
        let install = TempDir::new("install");
        let home = TempDir::new("home");
        fs::write(install.0.join("overlay-template.ext4"), "x").unwrap();
        fs::write(install.0.join("overlay-template.ext4.zst"), "x").unwrap();
        fs::create_dir_all(home.0.join(".smolvm")).unwrap();
        std::os::unix::fs::symlink("/nowhere", home.0.join(".smolvm/overlay-template.ext4"))
            .unwrap();

        link(&install.0, &home.0);
        link(&install.0, &home.0);
        assert_eq!(
            fs::read_link(home.0.join(".smolvm/overlay-template.ext4")).unwrap(),
            install.0.join("overlay-template.ext4")
        );
        assert!(!home.0.join(".smolvm/overlay-template.ext4.zst").exists());
    }

    // TEST_SCENARIO: the expansion must stay sparse and bounded as the Go runner's is, or warming a 20 GiB template fills the pod's filesystem.
    #[test]
    fn the_go_runner_expands_the_same_way() {
        let go = gosource::read("smolvm.go");
        assert!(gosource::literals_in(&go, "expandTemplate")
            .iter()
            .any(|l| l == "--sparse"));
        assert_eq!(
            gosource::duration_value(&go, "warmTimeout"),
            Some(WARM_TIMEOUT)
        );
    }
}
