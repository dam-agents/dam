use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::command;

// UNIT_BOUNDARY_DESCRIPTION: the disk templates smolvm formats a machine's disks from. The release ships them compressed beside its binary and smolvm expands one the first time a machine needs it — 24 s of a 25 s first start after every pod roll, paid by whoever creates the next agent. The runner expands each one once onto its claim instead, and links it where smolvm's embedded runtime looks: its own executable's directory is not the release's, so without that link smolvm would find no template at all.

// UNIT_BOUNDARY_DESCRIPTION: where expanded templates are kept under HOME, which is the runner's claim, so a pod roll costs a hash of each compressed template and a link rather than the expansion. One directory per compressed template's sha256: a new smolvm release lands its templates in a new directory, so a template it changed is expanded again rather than taken for the one already kept. It sits beside smolvm's own directories rather than inside them, so nothing smolvm lists or cleans up can take one.
pub const KEPT_DIR: &str = ".disk-templates";

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

// UNIT_BOUNDARY_DESCRIPTION: puts every missing template in place and links each into `home`. With `kept` a template is expanded once into it; without it the template is expanded into `install` itself, which a roll throws away. A template the release ships already expanded is linked as it is. A failure is logged and left: smolvm still expands what it needs itself.
pub fn warm(install: &Path, kept: Option<&Path>, home: &Path, cancel: &CancellationToken) {
    let mut ready = expanded_in(install);
    let packed = to_warm(install);
    if packed.is_empty() && ready.is_empty() {
        tracing::info!(dir = %install.display(), "no disk templates to warm");
    }
    for packed in packed {
        let target = expanded(&packed);
        let started = Instant::now();
        let result = match kept {
            Some(kept) => keep(&packed, kept, cancel),
            None => expand(&packed, &target, cancel).map(|()| target.clone()),
        };
        match result {
            Ok(at) => {
                tracing::info!(template = %target.display(), kept = %at.display(), duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX), "template warmed");
                if let Some(name) = at.file_name() {
                    ready.insert(name.to_os_string(), at.clone());
                }
            }
            Err(e) => {
                tracing::warn!(template = %packed.display(), error = %format!("{e:#}"), "template warm-up failed; the first machine will expand it instead")
            }
        }
    }
    link(ready.into_values(), home);
}

// UNIT_BOUNDARY_DESCRIPTION: the kept copy of a compressed template, expanded unless an earlier pod already did. The name inside the content-keyed directory is the template's own, because smolvm tells its templates apart by file name.
fn keep(packed: &Path, kept: &Path, cancel: &CancellationToken) -> anyhow::Result<PathBuf> {
    let at = kept_path(packed, kept)?;
    if !at.exists() {
        fs::create_dir_all(at.parent().unwrap_or(kept))?;
        expand(packed, &at, cancel)?;
    }
    Ok(at)
}

fn kept_path(packed: &Path, kept: &Path) -> anyhow::Result<PathBuf> {
    let mut hasher = Sha256::new();
    std::io::copy(&mut fs::File::open(packed)?, &mut hasher)?;
    let name = expanded(packed);
    let name = name
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("{} names no file", packed.display()))?;
    Ok(kept.join(format!("{:x}", hasher.finalize())).join(name))
}

// UNIT_BOUNDARY_DESCRIPTION: `--sparse` is not zstd's default when it writes to a named file, and without it a 20 GiB template of holes is written out in full: measured at 20 GiB and 33 s against 672 KiB and 4 s. The expansion goes to a temporary name and is renamed over the target, so a machine created meanwhile never opens half a template.
fn expand(packed: &Path, target: &Path, cancel: &CancellationToken) -> anyhow::Result<()> {
    let staged = target.with_extension("ext4.warming");
    let result = command::output(
        Command::new("zstd")
            .args(["-d", "-q", "-f", "--sparse", "-o"])
            .arg(&staged)
            .arg(packed),
        Instant::now() + WARM_TIMEOUT,
        cancel,
    )
    .and_then(|_| fs::rename(&staged, target).map_err(Into::into));
    if result.is_err() {
        let _ = fs::remove_file(&staged);
    }
    result
}

fn expanded_in(dir: &Path) -> BTreeMap<OsString, PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return BTreeMap::new();
    };
    entries
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".ext4"))
        .map(|e| (e.file_name(), e.path()))
        .collect()
}

// UNIT_BOUNDARY_DESCRIPTION: points `home/.smolvm/<template>` at each expanded template. That is the first place smolvm looks, and smolvm canonicalizes the link before it writes a template's path into a qcow2 overlay, so an overlay names the expanded file and not the link. Each link is made under a temporary name and renamed over the old one, so a machine created meanwhile sees either the old template or the new one, never none.
pub fn link(templates: impl IntoIterator<Item = PathBuf>, home: &Path) {
    let dir = home.join(".smolvm");
    if let Err(e) = fs::create_dir_all(&dir) {
        tracing::warn!(dir = %dir.display(), error = %e, "cannot link the disk templates");
        return;
    }
    for template in templates {
        let Some(name) = template.file_name() else {
            continue;
        };
        let at = dir.join(name);
        if fs::read_link(&at).ok().as_deref() == Some(template.as_path()) {
            continue;
        }
        if let Err(e) = put_link(&template, &at) {
            tracing::warn!(template = %at.display(), error = %format!("{e:#}"), "cannot link a disk template");
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: points `target` at `at`, made under a temporary name and renamed over it.
fn put_link(at: &Path, target: &Path) -> anyhow::Result<()> {
    let staged = target.with_extension("ext4.linking");
    let _ = fs::remove_file(&staged);
    std::os::unix::fs::symlink(at, &staged)?;
    fs::rename(&staged, target).inspect_err(|_| {
        let _ = fs::remove_file(&staged);
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

        warm(&install.0, None, &home.0, &CancellationToken::new());
        warm(&install.0, None, &home.0, &CancellationToken::new());
        assert_eq!(
            fs::read_link(home.0.join(".smolvm/overlay-template.ext4")).unwrap(),
            install.0.join("overlay-template.ext4")
        );
        assert!(!home.0.join(".smolvm/overlay-template.ext4.zst").exists());
    }

    // TEST_SCENARIO: a kept template is named by the content of the compressed one, so a pod of the same release finds the copy an earlier pod expanded, and a new release's template lands beside it instead of being taken for the old one. The file keeps the template's own name, which is how smolvm tells its templates apart.
    #[test]
    fn a_kept_template_is_named_by_its_content() {
        let install = TempDir::new("keyed");
        let kept = install.0.join("kept");
        let old = install.0.join("storage-template.ext4.zst");
        fs::write(&old, "release one").unwrap();
        let first = kept_path(&old, &kept).unwrap();
        assert_eq!(first, kept_path(&old, &kept).unwrap());
        assert_eq!(first.parent().unwrap().parent().unwrap(), kept);
        assert_eq!(first.file_name().unwrap(), "storage-template.ext4");
        fs::write(&old, "release two").unwrap();
        assert_ne!(first, kept_path(&old, &kept).unwrap());
    }

    // TEST_SCENARIO: a pod whose claim already holds the kept copy links it where smolvm looks and expands nothing, so no compressor runs, and a link left pointing at nothing is replaced.
    #[test]
    fn a_template_already_kept_is_linked_without_expanding() {
        let install = TempDir::new("kept");
        let home = TempDir::new("kept-home");
        let packed = install.0.join("overlay-template.ext4.zst");
        fs::write(&packed, "packed").unwrap();
        let kept = home.0.join(KEPT_DIR);
        let at = kept_path(&packed, &kept).unwrap();
        fs::create_dir_all(at.parent().unwrap()).unwrap();
        fs::write(&at, "expanded").unwrap();
        fs::create_dir_all(home.0.join(".smolvm")).unwrap();
        std::os::unix::fs::symlink("/nowhere", home.0.join(".smolvm/overlay-template.ext4"))
            .unwrap();

        warm(&install.0, Some(&kept), &home.0, &CancellationToken::new());
        assert_eq!(
            fs::read_link(home.0.join(".smolvm/overlay-template.ext4")).unwrap(),
            at
        );
        assert_eq!(
            fs::read_to_string(home.0.join(".smolvm/overlay-template.ext4")).unwrap(),
            "expanded"
        );
        assert!(
            fs::symlink_metadata(install.0.join("overlay-template.ext4")).is_err(),
            "nothing is linked beside the release"
        );
    }

    // TEST_SCENARIO: templates an earlier pod expanded sit under this name on the claim, and are found there rather than expanded again after every pod roll. The name and the bound on one expansion are pinned; an unbounded expansion of a 20 GiB template could hold the runner for as long as the claim takes to fill.
    #[test]
    fn the_kept_templates_directory_and_warm_budget_are_pinned() {
        assert_eq!(KEPT_DIR, ".disk-templates");
        assert_eq!(WARM_TIMEOUT, Duration::from_secs(5 * 60));
    }
}
