use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::api::{
    REASON_BOOT_FAILED, REASON_IMAGE_UNAVAILABLE, REASON_OUT_OF_CAPACITY, REASON_SEED_MISSING,
    REASON_STORAGE_FULL,
};
use crate::cache::{repository, PULL_TIMEOUT};
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
// UNIT_BOUNDARY_DESCRIPTION: an unpack stopped at its cap, beneath the refusal it is reported as, so a fetch whose size came from gzip trailers can tell it from a broken image and try again at the estimate.
#[derive(Debug)]
pub struct OverCap;

impl std::fmt::Display for OverCap {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the unpack passed its cap")
    }
}

impl std::error::Error for OverCap {}

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

pub fn storage_full(detail: impl std::fmt::Display) -> anyhow::Error {
    Refusal {
        reason: REASON_STORAGE_FULL,
        message: detail.to_string(),
    }
    .into()
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's own image cache sits on the owner's claim, beside every machine disk, so a cache that ran out of disk is that owner's storage running out, not memory. The cache reports it as out of capacity, which is right for a node cache, whose disk is the node's; the runner names it again here for its own.
pub fn on_own_claim(err: anyhow::Error) -> anyhow::Error {
    match err.downcast::<Refusal>() {
        Ok(refusal) if refusal.reason == REASON_OUT_OF_CAPACITY => storage_full(refusal.message),
        Ok(refusal) => refusal.into(),
        Err(err) => err,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the reason a failed operation is reported under: a typed refusal's own, a full disk for a write the filesystem refused for want of room, and a failed boot for anything else. Every file a runner writes for a machine is on the owner's claim, so a full disk anywhere in the chain is that claim filling.
pub fn failure_reason(err: &anyhow::Error) -> &'static str {
    if let Some(refusal) = err.downcast_ref::<Refusal>() {
        return refusal.reason;
    }
    let full = err.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .and_then(std::io::Error::raw_os_error)
            .is_some_and(|code| matches!(code, libc::ENOSPC | libc::EDQUOT))
    });
    if full {
        REASON_STORAGE_FULL
    } else {
        REASON_BOOT_FAILED
    }
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

// UNIT_BOUNDARY_DESCRIPTION: how much larger an unpacked layer is taken to be than its blob when its real size cannot be read: a zstd layer, a registry that refuses a ranged read, a gzip trailer that reads below its blob. The export streams of common agent and base images measured 2.2 to 3.2 times their manifest's size; this is a fixed guess above all of them.
pub const UNPACKED_RATIO: u64 = 4;

// UNIT_BOUNDARY_DESCRIPTION: what a measured layer is given on top of its size. crane's export stream is the layers flattened with their tar headers written again, and on six common images it measured 0.97 to 1.00 of the summed trailers; a tenth covers headers written larger than the layer had them, and the fixed slack the end blocks and padding of a small layer.
pub const LAYER_SLACK: u64 = 64 << 10;

// UNIT_BOUNDARY_DESCRIPTION: how long the trailer reads of one image may take, all layers together. A registry that is slow to answer them costs the fetch this much at most, and the image is then sized by the estimate.
pub const PROBE_BUDGET: Duration = Duration::from_secs(20);

// UNIT_BOUNDARY_DESCRIPTION: how many trailer reads run at once. One at a time, an image of 28 layers took 14 s; all at once, 1.3 s. The bound keeps a manifest of thousands of layers from starting a thread for each.
pub const PROBES_AT_ONCE: usize = 16;

// UNIT_BOUNDARY_DESCRIPTION: a gzip layer, by the OCI or the Docker media type.
pub fn is_gzip(media_type: &str) -> bool {
    media_type.ends_with("tar+gzip") || media_type.ends_with("tar.gzip")
}

// UNIT_BOUNDARY_DESCRIPTION: the bytes an unpacked layer is taken to stream, with its margin when its size is known. An uncompressed layer's blob is its tar. A gzip layer's trailer is its tar's size, unless it reads well below the blob: the empty last member of a multi-member gzip, such as eStargz's footer, reads 0, since a trailer counts only its own member, and a layer past 4 GiB that compresses poorly reads its size mod 2^32. An incompressible layer, a tar of archives, reads a little below its blob, which the last sixteenth allows. A trailer that wrapped above its blob, or a last member that is not most of the layer, is trusted, and the fetch it cuts short is retried at the estimate (unpacked_size). Anything else is the estimate.
pub fn layer_estimate(media_type: &str, size: u64, trailer: Option<u32>) -> u64 {
    let measured = if media_type.ends_with(".tar") {
        Some(size)
    } else {
        trailer
            .filter(|_| is_gzip(media_type))
            .map(u64::from)
            .filter(|isize| *isize >= size - size / 16)
    };
    measured.map_or(size.saturating_mul(UNPACKED_RATIO), |bytes| {
        bytes.saturating_add(bytes / 10).saturating_add(LAYER_SLACK)
    })
}

// UNIT_BOUNDARY_DESCRIPTION: where a repository's blobs are read over HTTP, named as crane names them: a first segment with no dot or port that is not localhost is a Docker Hub path, and only a loopback registry, localhost or a loopback address, speaks plain HTTP, since the read carries the caller's token. Every other registry is read over HTTPS, so an insecure one on a private network is sized by the estimate.
pub fn blob_base(repository: &str) -> String {
    let (host, path) = match repository.split_once('/') {
        Some((head, rest)) if head.contains(['.', ':']) || head == "localhost" => (head, rest),
        _ => ("docker.io", repository),
    };
    let (host, path) = match host {
        "docker.io" if !path.contains('/') => ("index.docker.io", format!("library/{path}")),
        "docker.io" => ("index.docker.io", path.to_string()),
        _ => (host, path.to_string()),
    };
    let name = host.rsplit_once(':').map_or(host, |(name, _)| name);
    let plain = name == "localhost"
        || name
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    let scheme = if plain { "http" } else { "https" };
    format!("{scheme}://{host}/v2/{path}/blobs/")
}

// UNIT_BOUNDARY_DESCRIPTION: the last four bytes of a gzip blob, its trailer: the size it inflates to, mod 2^32. One ranged read; a registry that answers with anything but those four bytes, a whole blob included, gives nothing, and at most five bytes of its answer are read. A redirect to the registry's storage drops the Authorization header, as reqwest does across hosts.
pub fn gzip_trailer(
    client: &reqwest::blocking::Client,
    url: &str,
    token: Option<&str>,
    size: u64,
    deadline: Instant,
) -> Option<u32> {
    use std::io::Read;
    let first = size.checked_sub(4)?;
    let mut request = client
        .get(url)
        .header(
            reqwest::header::RANGE,
            format!("bytes={first}-{}", size - 1),
        )
        .timeout(deadline.saturating_duration_since(Instant::now()));
    if let Some(token) = token {
        request = request.header(reqwest::header::AUTHORIZATION, token);
    }
    let response = request.send().ok()?;
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return None;
    }
    let mut body = Vec::new();
    response.take(5).read_to_end(&mut body).ok()?;
    Some(u32::from_le_bytes(body.try_into().ok()?))
}

// UNIT_BOUNDARY_DESCRIPTION: the bytes this platform's image is taken to stream unpacked, from its manifest and each gzip layer's trailer. OCI metadata names only compressed sizes, so the real size is read from the end of each gzip blob, with the bearer token crane gets for the repository from the credential that read the config. A registry crane gets no token from, such as one that takes basic auth, is read anonymously. Every layer whose size cannot be read is taken at UNPACKED_RATIO, so a failed read never fails the fetch, and the reads stop once `cancel` is. It is what a fetch reserves against the node's ceiling, checks the disk against before it downloads anything, and may unpack at most. A trailer counts only the last gzip member of its blob, and holds its size mod 2^32, so a layer of several members, or one that inflates past 4 GiB, can unpack past what it reads; the second size is the one a fetch retries at when the unpack passes the first, each layer at the larger of its measured size and UNPACKED_RATIO. A manifest that cannot be read, or is an index with no layers, gives nothing, and the fetch goes on with the whole budget as its cap.
pub fn unpacked_size(
    crane: &str,
    reference: &str,
    auth: &str,
    deadline: Instant,
    cancel: &CancellationToken,
) -> Option<(u64, u64)> {
    #[derive(serde::Deserialize)]
    struct Layer {
        #[serde(rename = "mediaType", default)]
        media_type: String,
        #[serde(default)]
        digest: String,
        size: u64,
    }
    #[derive(serde::Deserialize)]
    struct Manifest {
        layers: Vec<Layer>,
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
    let gzip = |layer: &Layer| {
        is_gzip(&layer.media_type)
            && layer.digest.starts_with("sha256:")
            && layer.digest[7..].bytes().all(|b| b.is_ascii_hexdigit())
    };
    let probe = within(PROBE_BUDGET, deadline);
    let mut trailers = vec![None; manifest.layers.len()];
    if manifest.layers.iter().any(gzip) {
        let repo = repository(reference);
        let token = crane_output(crane, "auth", &["token", "-H", repo], auth, probe, cancel)
            .ok()
            .and_then(|out| {
                String::from_utf8(out)
                    .ok()?
                    .trim()
                    .strip_prefix("Authorization: ")
                    .map(str::to_string)
            });
        let _ = rustls::crypto::ring::default_provider().install_default();
        if let Ok(client) = reqwest::blocking::Client::builder().build() {
            let base = blob_base(repo);
            for (layers, read) in manifest
                .layers
                .chunks(PROBES_AT_ONCE)
                .zip(trailers.chunks_mut(PROBES_AT_ONCE))
            {
                if cancel.is_cancelled() {
                    break;
                }
                std::thread::scope(|s| {
                    for (layer, trailer) in layers.iter().zip(read.iter_mut()) {
                        if gzip(layer) {
                            let (client, base, token) = (&client, &base, token.as_deref());
                            s.spawn(move || {
                                *trailer = gzip_trailer(
                                    client,
                                    &format!("{base}{}", layer.digest),
                                    token,
                                    layer.size,
                                    probe,
                                );
                            });
                        }
                    }
                });
            }
        }
    }
    let measured = trailers.iter().flatten().count();
    let (bytes, estimate) = manifest.layers.iter().zip(&trailers).fold(
        (0u64, 0u64),
        |(bytes, estimate), (layer, trailer)| {
            let taken = layer_estimate(&layer.media_type, layer.size, *trailer);
            let unread = layer_estimate(&layer.media_type, layer.size, None);
            (
                bytes.saturating_add(taken),
                estimate.saturating_add(taken.max(unread)),
            )
        },
    );
    tracing::info!(
        image = reference,
        layers = manifest.layers.len(),
        measured,
        bytes,
        estimate,
        "image unpacked size read"
    );
    Some((bytes, estimate))
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

// UNIT_BOUNDARY_DESCRIPTION: streams the image's flattened filesystem into `rootfs`, at most `cap` bytes of it. A registry that fails the export, a stream tar cannot unpack, or one larger than the cap is a problem with the image; a disk that fills while it unpacks is a problem of capacity. Neither is a boot to retry at once, which would download the whole image again into the same state. Past the cap the unpack is stopped and the caller's scratch tree goes with it, so a small image whose layers inflate cannot fill the disk the cache shares with every machine on it. Its ceiling: the cap counts the stream, not the blocks the tree takes, so a stream of many tiny files can take a few times the cap on disk; counting blocks would mean polling the tree as it grows.
pub fn unpack(
    crane: &str,
    reference: &str,
    rootfs: &Path,
    auth: &str,
    cap: Option<u64>,
    deadline: Instant,
    cancel: &CancellationToken,
) -> anyhow::Result<()> {
    gnu_tar()?;
    let credentials = DockerConfig::new(auth)?;
    let result = command::pipeline(
        &mut crane_command(crane, "export", &[reference, "-"], &credentials),
        Command::new("tar").args(tar_args(rootfs)),
        cap,
        within(PULL_TIMEOUT, deadline),
        cancel,
    );
    let (step, detail) = match result {
        Ok(()) => return Ok(()),
        Err(PipelineFailure::OverLimit) => {
            tracing::warn!(image = reference, cap, "image unpack passed its cap");
            return Err(anyhow::Error::new(OverCap).context(Refusal {
                reason: REASON_IMAGE_UNAVAILABLE,
                message: format!(
                    "{IMAGE_UNUSABLE}: {reference} unpacks to more than {} bytes, the most the image cache allows it",
                    cap.unwrap_or_default()
                ),
            }));
        }
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

    // TEST_SCENARIO: a gzip blob ends in its trailer, the size its member inflates to mod 2^32, little-endian. A real gzip of a known payload is read back through one ranged read of its last four bytes, with the token passed on; a registry that refuses the token, or ignores the range and sends the whole blob, gives no size rather than a wrong one.
    #[test]
    fn a_gzip_trailer_is_its_inflated_size() {
        let payload = vec![7u8; 300_000];
        let dir = crate::testdir::TempDir::new("isize");
        fs::write(dir.path().join("layer"), &payload).unwrap();
        let gz = Command::new("gzip")
            .arg("-c")
            .arg(dir.path().join("layer"))
            .output()
            .unwrap()
            .stdout;
        let size = gz.len() as u64;
        let blob = gz.clone();
        let honours = crate::testdir::http_stub(move |head| {
            if head.contains("authorization: Bearer t0k")
                || head.contains("Authorization: Bearer t0k")
            {
                crate::testdir::ranged(head, &blob)
            } else {
                b"HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                    .to_vec()
            }
        });
        let ignores = crate::testdir::http_stub(move |_| crate::testdir::ranged("", &gz));
        let client = reqwest::blocking::Client::new();
        let soon = Instant::now() + Duration::from_secs(10);
        let url = |port: u16| format!("http://127.0.0.1:{port}/v2/x/blobs/sha256:a");
        assert_eq!(
            gzip_trailer(&client, &url(honours), Some("Bearer t0k"), size, soon),
            Some(300_000)
        );
        assert_eq!(gzip_trailer(&client, &url(honours), None, size, soon), None);
        assert_eq!(
            gzip_trailer(&client, &url(ignores), Some("Bearer t0k"), size, soon),
            None,
            "a whole blob was read as a trailer"
        );
    }

    // TEST_SCENARIO: a layer whose size is read is reserved at that size and a tenth more, plus a fixed slack; one whose size cannot be read, at four times its blob. An uncompressed layer's blob is its size. A zstd layer and a gzip one whose trailer could not be read take the estimate, as does a trailer far below its blob: an eStargz footer's 0, or a poorly compressed layer past 4 GiB whose trailer wrapped. A large layer is trusted at its trailer; one that wrapped above its blob is caught by the fetch's retry, not here.
    #[test]
    fn a_layer_is_sized_by_its_trailer_unless_it_reads_below_its_blob() {
        const GZIP: &str = "application/vnd.oci.image.layer.v1.tar+gzip";
        const DOCKER: &str = "application/vnd.docker.image.rootfs.diff.tar.gzip";
        let margin = |bytes: u64| bytes + bytes / 10 + LAYER_SLACK;
        assert_eq!(layer_estimate(GZIP, 1000, Some(32_000)), margin(32_000));
        assert_eq!(layer_estimate(DOCKER, 1000, Some(32_000)), margin(32_000));
        assert_eq!(
            layer_estimate("application/vnd.oci.image.layer.v1.tar", 5000, None),
            margin(5000)
        );
        assert_eq!(layer_estimate(GZIP, 1000, None), 4000);
        assert_eq!(
            layer_estimate(
                "application/vnd.oci.image.layer.v1.tar+zstd",
                1000,
                Some(32_000)
            ),
            4000
        );
        assert_eq!(layer_estimate(GZIP, 1000, Some(0)), 4000);
        assert_eq!(layer_estimate(GZIP, 1000, Some(990)), margin(990));
        assert_eq!(
            layer_estimate(GZIP, 2 << 30, Some(u32::MAX)),
            margin(u64::from(u32::MAX))
        );
        assert_eq!(
            layer_estimate(GZIP, 5 << 30, Some(1 << 30)),
            (5 << 30) * UNPACKED_RATIO,
            "a trailer that wrapped below its blob was trusted"
        );
    }

    // TEST_SCENARIO: a layer's trailer is read from the registry crane reads it from. A bare Docker Hub name is under library/, a host is the first segment only when it has a dot or a port or is localhost, and a loopback registry is read over plain HTTP, as crane reads it.
    #[test]
    fn blobs_are_read_where_crane_reads_them() {
        assert_eq!(
            blob_base("alpine"),
            "https://index.docker.io/v2/library/alpine/blobs/"
        );
        assert_eq!(
            blob_base("docker.io/jupyter/base"),
            "https://index.docker.io/v2/jupyter/base/blobs/"
        );
        assert_eq!(blob_base("quay.io/x/vm"), "https://quay.io/v2/x/vm/blobs/");
        assert_eq!(
            blob_base("127.0.0.1:5000/x/vm"),
            "http://127.0.0.1:5000/v2/x/vm/blobs/"
        );
        assert_eq!(
            blob_base("localhost:5000/vm"),
            "http://localhost:5000/v2/vm/blobs/"
        );
        assert_eq!(blob_base("[::1]:5000/vm"), "http://[::1]:5000/v2/vm/blobs/");
        for lookalike in [
            "127.evil.io/vm",
            "localhost.evil.io/vm",
            "127.0.0.1.nip.io/vm",
        ] {
            assert!(
                blob_base(lookalike).starts_with("https://"),
                "{lookalike} would get its token over plain HTTP"
            );
        }
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

    // TEST_SCENARIO: an image is untrusted input unpacked by a writer that holds DAC_OVERRIDE, so no entry may land outside the tree. GNU tar has no flag that pins this, only `-P` that turns it off, so its default is pinned here with a crafted stream: a leading `/` is stripped into the tree, a member naming `..` is skipped and fails the unpack, and a file written through a symlink the image points out of the tree is refused.
    #[test]
    fn tar_never_writes_outside_the_tree() {
        let dir = crate::testdir::TempDir::new("tar-escape");
        let outside = dir.path().join("outside");
        fs::create_dir(&outside).unwrap();
        let rootfs = dir.path().join("rootfs");
        fs::create_dir(&rootfs).unwrap();
        let mut archive = tar::Builder::new(Vec::new());
        let mut entry = |name: &str, kind: tar::EntryType, link: Option<&Path>| {
            let mut header = tar::Header::new_gnu();
            header.as_old_mut().name[..name.len()].copy_from_slice(name.as_bytes());
            header.set_entry_type(kind);
            if let Some(link) = link {
                header.set_link_name(link).unwrap();
            }
            let body: &[u8] = if kind.is_file() { b"x" } else { b"" };
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive.append(&header, body).unwrap();
        };
        let absolute = outside.join("absolute");
        entry(absolute.to_str().unwrap(), tar::EntryType::Regular, None);
        entry("../outside/dotdot", tar::EntryType::Regular, None);
        entry("ok/../../outside/inner", tar::EntryType::Regular, None);
        entry("link", tar::EntryType::Symlink, Some(&outside));
        entry("link/through", tar::EntryType::Regular, None);
        entry("kept", tar::EntryType::Regular, None);
        let stream = archive.into_inner().unwrap();
        let mut tar = Command::new("tar")
            .args(tar_args(&rootfs))
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::io::Write::write_all(&mut tar.stdin.take().unwrap(), &stream).unwrap();
        assert!(
            !tar.wait().unwrap().success(),
            "a `..` member did not fail the unpack"
        );
        assert_eq!(
            fs::read_dir(&outside).unwrap().count(),
            0,
            "tar wrote outside the tree"
        );
        assert!(rootfs.join(absolute.strip_prefix("/").unwrap()).exists());
        assert!(rootfs.join("kept").exists());
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

    // TEST_SCENARIO: every file a runner writes for a machine is on its owner's claim, so a write the filesystem refused for want of room is that owner's storage filling, under any context the error gathered on the way up, and not a boot to retry. The runner's own image cache sits on the same claim, so its full disk is named the same; any other refusal it makes keeps its reason.
    #[test]
    fn a_full_disk_is_reported_as_the_owners_storage_full() {
        let full = anyhow::Error::from(std::io::Error::from_raw_os_error(libc::ENOSPC))
            .context("copying the overlay template")
            .context("creating the machine");
        assert_eq!(failure_reason(&full), REASON_STORAGE_FULL);
        let quota = anyhow::Error::from(std::io::Error::from_raw_os_error(libc::EDQUOT));
        assert_eq!(failure_reason(&quota), REASON_STORAGE_FULL);
        let denied = anyhow::Error::from(std::io::Error::from_raw_os_error(libc::EACCES));
        assert_eq!(failure_reason(&denied), REASON_BOOT_FAILED);
        let cache = on_own_claim(out_of_capacity("the image cache ran out of disk"));
        assert_eq!(failure_reason(&cache), REASON_STORAGE_FULL);
        assert_eq!(cache.to_string(), "the image cache ran out of disk");
        assert_eq!(
            failure_reason(&on_own_claim(unusable("x"))),
            REASON_IMAGE_UNAVAILABLE
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
