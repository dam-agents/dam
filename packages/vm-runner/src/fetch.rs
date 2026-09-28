use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::api::{
    REASON_BOOT_FAILED, REASON_IMAGE_UNAVAILABLE, REASON_OUT_OF_CAPACITY, REASON_SEED_MISSING,
};
use crate::cache::PULL_TIMEOUT;
use crate::command::{self, PipelineFailure};
use crate::files;

// UNIT_BOUNDARY_DESCRIPTION: how the runner reads an image from its registry, and how a failure is classified for the controller. A machine may reach only its gateway, so the guest cannot pull its own image: crane runs here instead, once to read what the image says to run and once to stream its filesystem into the cache. Only the cache's one writer runs it.

pub const IMAGE_UNUSABLE: &str = "the image cannot be run";

// UNIT_BOUNDARY_DESCRIPTION: a failure that carries the reason the controller reports it under. The reason is part of the error rather than guessed from its text; a failure that carries none is a boot that failed.
#[derive(Debug)]
pub struct Refusal {
    pub reason: &'static str,
    pub message: String,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Refusal {}

pub fn unusable(detail: impl std::fmt::Display) -> anyhow::Error {
    Refusal {
        reason: REASON_IMAGE_UNAVAILABLE,
        message: format!("{IMAGE_UNUSABLE}: {detail}"),
    }
    .into()
}

pub fn out_of_capacity(detail: impl std::fmt::Display) -> anyhow::Error {
    Refusal {
        reason: REASON_OUT_OF_CAPACITY,
        message: detail.to_string(),
    }
    .into()
}

pub fn seed_missing(detail: impl std::fmt::Display) -> anyhow::Error {
    Refusal {
        reason: REASON_SEED_MISSING,
        message: detail.to_string(),
    }
    .into()
}

// UNIT_BOUNDARY_DESCRIPTION: the reason a failed operation is reported under: a typed refusal's own, and a failed boot for anything else.
pub fn failure_reason(err: &anyhow::Error) -> &'static str {
    err.downcast_ref::<Refusal>()
        .map_or(REASON_BOOT_FAILED, |refusal| refusal.reason)
}

// UNIT_BOUNDARY_DESCRIPTION: a tool that fails per entry reports per entry, and for a whole image that ran to 2.6 MB. That text becomes the Agent's condition message, and the API server rejects a condition message over 32 KiB — so the status write fails, the reconcile never records why, and every retry fetches the image again. The head is kept because the first failure is the one that explains the rest.
pub const CAPTURED_OUTPUT: usize = 2000;

pub fn first_lines(out: &str) -> String {
    let out = out.trim();
    if out.len() <= CAPTURED_OUTPUT {
        return out.to_string();
    }
    let mut end = CAPTURED_OUTPUT;
    while !out.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… (truncated)", &out[..end])
}

// UNIT_BOUNDARY_DESCRIPTION: the docker configs a registry read tries, in the order they were sent, or a single anonymous read when none were sent.
pub fn in_turn(auths: &[String]) -> &[String] {
    static ANONYMOUS_ONLY: std::sync::LazyLock<[String; 1]> =
        std::sync::LazyLock::new(|| [ANONYMOUS.to_string()]);
    if auths.is_empty() {
        &*ANONYMOUS_ONLY
    } else {
        auths
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the platform an image is read for, as an OCI platform. Without one crane picks linux/amd64 out of a multi-arch image on every host, so an arm64 node would unpack a tree its machines cannot run. Rust names the architectures its own way, so the two the runner ships for are mapped to the OCI names.
pub fn platform_of(arch: &str) -> String {
    let arch = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    format!("linux/{arch}")
}

pub fn host_platform() -> String {
    platform_of(std::env::consts::ARCH)
}

// UNIT_BOUNDARY_DESCRIPTION: the arguments of one crane call: the operation, its operands, and the platform last. crane's `--platform` flag is global, so it may follow the operands. With it a tag resolves to the digest of this platform's own manifest rather than of the multi-arch index, so two architectures never share an entry by a tag.
pub fn crane_args(op: &str, operands: &[&str], platform: &str) -> Vec<String> {
    let mut args = vec![op.to_string()];
    args.extend(operands.iter().map(|o| o.to_string()));
    args.push("--platform".to_string());
    args.push(platform.to_string());
    args
}

fn crane_command(crane: &str, op: &str, operands: &[&str], credentials: &DockerConfig) -> Command {
    let mut command = Command::new(crane);
    command.args(crane_args(op, operands, &host_platform()));
    credentials.apply(&mut command);
    command
}

// UNIT_BOUNDARY_DESCRIPTION: the earlier of a step's own budget and the deadline of the whole resolve it is part of. A resolve may try every credential it was sent, several times over, and the runner waiting on its answer can only know how long to wait if one deadline covers all of it.
pub fn within(budget: Duration, deadline: Instant) -> Instant {
    (Instant::now() + budget).min(deadline)
}

// UNIT_BOUNDARY_DESCRIPTION: one crane call's stdout, with one docker config, for this host's platform.
pub fn crane_output(
    crane: &str,
    op: &str,
    operands: &[&str],
    auth: &str,
    deadline: Instant,
    cancel: &CancellationToken,
) -> anyhow::Result<Vec<u8>> {
    let credentials = DockerConfig::new(auth)?;
    command::output(
        &mut crane_command(crane, op, operands, &credentials),
        deadline,
        cancel,
    )
}

// UNIT_BOUNDARY_DESCRIPTION: the image's config, read with the first of these docker configs the registry accepts, tried in the order a pod lists its pull Secrets: the kubelet's own fallback, so a stale credential for a registry does not hide a good one listed after it. With none it is read anonymously. The config that worked is returned too, so the layers are fetched with the same credential. A credential that fails is never quoted.
pub fn read_config(
    crane: &str,
    reference: &str,
    auths: &[String],
    deadline: Instant,
    cancel: &CancellationToken,
) -> anyhow::Result<(Vec<u8>, String)> {
    let mut last = None;
    for auth in in_turn(auths) {
        match crane_output(
            crane,
            "config",
            &[reference],
            auth,
            within(PULL_TIMEOUT, deadline),
            cancel,
        ) {
            Ok(out) => return Ok((out, auth.clone())),
            Err(e) => last = Some(e),
        }
    }
    let detail = last.map(|e| format!("{e:#}")).unwrap_or_default();
    Err(unusable(format!(
        "reading the config of {reference}: {}",
        first_lines(&detail)
    )))
}

// UNIT_BOUNDARY_DESCRIPTION: the bytes the registry says this platform's image is, from its manifest: the config and every layer, compressed. An unpacked tree is larger, so this is a floor and not a size. It is what a fetch reserves against the node's ceiling and checks the disk against before it downloads anything. A manifest that cannot be read, or is an index with no layers, gives nothing, and the fetch goes on with no floor.
pub fn compressed_size(
    crane: &str,
    reference: &str,
    auth: &str,
    deadline: Instant,
    cancel: &CancellationToken,
) -> Option<u64> {
    #[derive(serde::Deserialize)]
    struct Blob {
        size: u64,
    }
    #[derive(serde::Deserialize)]
    struct Manifest {
        config: Blob,
        layers: Vec<Blob>,
    }
    let out = crane_output(
        crane,
        "manifest",
        &[reference],
        auth,
        within(RESOLVE_TIMEOUT, deadline),
        cancel,
    )
    .ok()?;
    let manifest: Manifest = serde_json::from_slice(&out).ok()?;
    Some(
        manifest
            .layers
            .iter()
            .fold(manifest.config.size, |sum, layer| {
                sum.saturating_add(layer.size)
            }),
    )
}

// UNIT_BOUNDARY_DESCRIPTION: the bytes free to this process on the filesystem holding `dir`, or nothing when it cannot be asked.
pub fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: statvfs is plain old data, and all-zero bytes are a valid value of it.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `path` is NUL-terminated and lives for the call, and `stat` is a live, writable statvfs.
    let rc = unsafe { libc::statvfs(path.as_ptr(), &mut stat) };
    #[allow(clippy::unnecessary_cast)]
    (rc == 0).then(|| (stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
}

// UNIT_BOUNDARY_DESCRIPTION: what is still free when an unpack that failed is taken to have filled its filesystem. The failed tree is still on disk when this is asked, so a disk it filled reads as nearly empty.
pub const FULL_SLACK: u64 = 64 << 20;

// UNIT_BOUNDARY_DESCRIPTION: whether a failed unpack ran out of room. tar says so in its own words, but when tar dies first crane is the half that fails, on a broken pipe, and the reason is only on the disk: so a filesystem left with less than FULL_SLACK free counts too.
pub fn ran_out_of_room(detail: &str, dir: &Path) -> bool {
    detail.contains("No space left on device")
        || detail.contains("Disk quota exceeded")
        || free_bytes(dir).is_some_and(|free| free < FULL_SLACK)
}

// UNIT_BOUNDARY_DESCRIPTION: an unpack must be GNU tar's, because the flags that harden it are GNU tar's own: another tar would refuse them, or read them as something else. It is asked once per process.
fn gnu_tar() -> anyhow::Result<()> {
    static GNU: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let gnu = *GNU.get_or_init(|| {
        Command::new("tar")
            .arg("--version")
            .output()
            .is_ok_and(|out| String::from_utf8_lossy(&out.stdout).contains("GNU tar"))
    });
    anyhow::ensure!(
        gnu,
        "the tar on this host is not GNU tar, which unpacking an image needs"
    );
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: how tar unpacks an image. It restores the owners and modes the image was built with, which is what the cache writer's CHOWN, FOWNER, FSETID and DAC_OVERRIDE capabilities are for. It never changes the tree's own root directory, and it sets directory modes only once every file is in, so a read-only directory in the image does not stop the files below it. What is under /dev is skipped: the writer holds no MKNOD, the guest mounts its own /dev, and a device node in a tree would be a device on every machine of it. A device node anywhere else fails the unpack.
pub fn tar_args(rootfs: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "-x",
        "--no-overwrite-dir",
        "--delay-directory-restore",
        "--anchored",
        "--exclude=dev/*",
        "--exclude=./dev/*",
        "-C",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    args.push(rootfs.into());
    args
}

// UNIT_BOUNDARY_DESCRIPTION: streams the image's flattened filesystem into `rootfs`. A registry that fails the export, or a stream tar cannot unpack, is a problem with the image; a disk that fills while it unpacks is a problem of capacity. Neither is a boot to retry at once, which would download the whole image again into the same state.
pub fn unpack(
    crane: &str,
    reference: &str,
    rootfs: &Path,
    auth: &str,
    deadline: Instant,
    cancel: &CancellationToken,
) -> anyhow::Result<()> {
    gnu_tar()?;
    let credentials = DockerConfig::new(auth)?;
    let result = command::pipeline(
        &mut crane_command(crane, "export", &[reference, "-"], &credentials),
        Command::new("tar").args(tar_args(rootfs)),
        within(PULL_TIMEOUT, deadline),
        cancel,
    );
    let (step, detail) = match result {
        Ok(()) => return Ok(()),
        Err(PipelineFailure::Producer(detail)) => ("exporting", detail),
        Err(PipelineFailure::Consumer(detail)) => ("unpacking", detail),
    };
    let message = format!("{step} {reference}: {}", first_lines(&detail));
    if ran_out_of_room(&detail, rootfs) {
        tracing::warn!(image = reference, "image unpack ran out of disk");
        return Err(out_of_capacity(format!(
            "the image cache ran out of disk: {message}"
        )));
    }
    tracing::warn!(image = reference, step, "image fetch failed");
    Err(unusable(message))
}

// UNIT_BOUNDARY_DESCRIPTION: a docker config that names no registry. A read run with it is a truly anonymous read, whatever the runner's own environment holds.
pub const ANONYMOUS: &str = "{}";

// UNIT_BOUNDARY_DESCRIPTION: how long a manifest read may take: the one-minute budget a tag resolution gets, not the pull timeout. A registry that does not answer a manifest read in a minute is treated as down.
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(60);

// UNIT_BOUNDARY_DESCRIPTION: whether these credentials can read the image's manifest — the cheapest proof of access a registry gives: one request and no layers. Both probes that ask it, the one that decides a fresh entry is public and the check that lets a caller reuse one that is not, get RESOLVE_TIMEOUT.
pub fn readable(
    crane: &str,
    reference: &str,
    auth: &str,
    deadline: Instant,
    cancel: &CancellationToken,
) -> bool {
    crane_output(
        crane,
        "digest",
        &[reference],
        auth,
        within(RESOLVE_TIMEOUT, deadline),
        cancel,
    )
    .is_ok()
}

// UNIT_BOUNDARY_DESCRIPTION: crane reads registry credentials from $DOCKER_CONFIG/config.json, so every crane call gets a directory of its own: 0700 under the runner's temporary directory, never on the image cache or the state volume, and removed when this is dropped, so a credential is on disk only while crane runs. Only crane is given it — smolvm, the guest and the stored spec never see it. A call with no credential gets the anonymous config rather than the environment's, so no keychain the process's own environment holds ever reads an image, and a read without a credential is the anonymous read it is taken for.
pub struct DockerConfig(PathBuf);

impl DockerConfig {
    pub fn new(auth: &str) -> anyhow::Result<Self> {
        let auth = if auth.is_empty() { ANONYMOUS } else { auth };
        let dir = files::create_unique_dir(&std::env::temp_dir(), "crane-auth-", 0o700)?;
        let this = Self(dir.clone());
        files::write(&dir.join("config.json"), auth.as_bytes(), 0o600)?;
        Ok(this)
    }

    pub fn apply<'a>(&self, command: &'a mut Command) -> &'a mut Command {
        command.env("DOCKER_CONFIG", &self.0)
    }
}

impl Drop for DockerConfig {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: a manifest read decides whether a machine may boot a private entry, and a registry that never answers must not hold that decision open for the pull timeout. The budget is pinned so a change to it is deliberate. A step never runs past the deadline of the resolve it is part of.
    #[test]
    fn a_manifest_read_gets_a_minute() {
        assert_eq!(RESOLVE_TIMEOUT, Duration::from_secs(60));
        let soon = Instant::now() + Duration::from_secs(1);
        assert_eq!(within(RESOLVE_TIMEOUT, soon), soon);
    }

    // TEST_SCENARIO: a multi-arch image read without a platform is read as linux/amd64 on every host. Every crane call names this host's platform in OCI's spelling, after its operands, so a fake crane and a real one see the operation first and the reference second.
    #[test]
    fn every_crane_call_names_the_host_platform() {
        assert_eq!(platform_of("x86_64"), "linux/amd64");
        assert_eq!(platform_of("aarch64"), "linux/arm64");
        assert_eq!(platform_of("riscv64"), "linux/riscv64");
        assert_eq!(
            crane_args("export", &["quay.io/x/vm@sha256:a", "-"], "linux/arm64"),
            [
                "export",
                "quay.io/x/vm@sha256:a",
                "-",
                "--platform",
                "linux/arm64"
            ]
        );
        assert!(host_platform().starts_with("linux/"));
    }

    // TEST_SCENARIO: an image is unpacked by a writer that holds no MKNOD, into a tree every machine of it boots. What is under /dev is skipped and the rest of the tree kept, the tree's own root keeps the mode the cache gave it, and a directory the image makes read-only still gets its files.
    #[test]
    fn tar_skips_the_images_dev_and_keeps_the_rest() {
        let dir = crate::testdir::TempDir::new("tar-args");
        let tree = dir.path().join("tree");
        fs::create_dir_all(tree.join("dev")).unwrap();
        fs::create_dir_all(tree.join("usr/lib/dev")).unwrap();
        fs::write(tree.join("dev/fake-node"), "x").unwrap();
        fs::write(tree.join("usr/lib/dev/keep"), "x").unwrap();
        let archive = dir.path().join("image.tar");
        let made = Command::new("tar")
            .arg("-cf")
            .arg(&archive)
            .arg("-C")
            .arg(&tree)
            .arg(".")
            .status()
            .unwrap();
        assert!(made.success());
        let rootfs = dir.path().join("rootfs");
        fs::create_dir(&rootfs).unwrap();
        let unpacked = Command::new("tar")
            .args(tar_args(&rootfs))
            .arg("-f")
            .arg(&archive)
            .status()
            .unwrap();
        assert!(unpacked.success());
        assert!(rootfs.join("dev").is_dir());
        assert!(!rootfs.join("dev/fake-node").exists());
        assert!(rootfs.join("usr/lib/dev/keep").exists());
        gnu_tar().unwrap();
    }

    // TEST_SCENARIO: the reason is what the controller matches on to decide what the person is told — an image to fix, a runner that is full, or a boot to retry. A typed failure keeps its own reason, even under added context, and anything untyped is a boot to retry. The typed failures' own wording reaches the Agent's status, so it is pinned too. A disk that filled is a capacity problem, however the pipe reported it.
    #[test]
    fn failures_are_reported_under_the_reason_the_controller_matches() {
        assert_eq!(IMAGE_UNUSABLE, "the image cannot be run");
        assert_eq!(failure_reason(&unusable("x")), REASON_IMAGE_UNAVAILABLE);
        assert_eq!(
            failure_reason(&out_of_capacity("no free machine port")),
            REASON_OUT_OF_CAPACITY
        );
        assert_eq!(
            failure_reason(&unusable("x").context("creating the machine")),
            REASON_IMAGE_UNAVAILABLE
        );
        assert_eq!(
            failure_reason(&anyhow::anyhow!("pull failed: unauthorized")),
            REASON_BOOT_FAILED,
            "a reason is never guessed from the text"
        );
        let dir = crate::testdir::TempDir::new("room");
        assert!(ran_out_of_room(
            "tar: ./a: Cannot write: No space left on device",
            dir.path()
        ));
        assert_eq!(
            ran_out_of_room("write |1: broken pipe", dir.path()),
            free_bytes(dir.path()).is_some_and(|free| free < FULL_SLACK)
        );
    }

    // TEST_SCENARIO: a failure's text is stored in the Agent's condition, which the API server caps at 32 KiB. The head is kept, marked as cut, and a cut never splits a character — a message ending in half of one is rejected as invalid UTF-8 by the same write it was shortened for.
    #[test]
    fn a_long_failure_is_cut_to_what_a_condition_can_hold() {
        assert_eq!(first_lines("  boom  "), "boom");
        let long = "é".repeat(CAPTURED_OUTPUT);
        let cut = first_lines(&long);
        assert!(cut.ends_with("… (truncated)"));
        assert!(cut.len() <= CAPTURED_OUTPUT + "… (truncated)".len());
    }

    // TEST_SCENARIO: a read with no credential must be anonymous even where the process's environment names a keychain, or an image only that keychain reads would be marked public. crane is always pointed at a config of its own, the anonymous one when none was sent.
    #[test]
    fn a_read_without_a_credential_is_anonymous() {
        assert_eq!(in_turn(&[]), [ANONYMOUS]);
        let config = DockerConfig::new("").unwrap();
        let mut command = Command::new("true");
        config.apply(&mut command);
        let dir = command
            .get_envs()
            .find(|(k, _)| *k == "DOCKER_CONFIG")
            .and_then(|(_, v)| v)
            .map(PathBuf::from)
            .expect("crane is given a config of its own");
        assert_eq!(
            fs::read_to_string(dir.join("config.json")).unwrap(),
            ANONYMOUS
        );
    }
}
