use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::api::{REASON_BOOT_FAILED, REASON_IMAGE_UNAVAILABLE, REASON_OUT_OF_CAPACITY};
use crate::cache::PULL_TIMEOUT;
use crate::command::{self, PipelineFailure};

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

// UNIT_BOUNDARY_DESCRIPTION: the image's config, read with the first of these docker configs the registry accepts, tried in the order a pod lists its pull Secrets: the kubelet's own fallback, so a stale credential for a registry does not hide a good one listed after it. With none it is read anonymously. The config that worked is returned too, empty for a read without one, so the layers are fetched with the same credential. A credential that fails is never quoted.
pub fn read_config(
    crane: &str,
    reference: &str,
    auths: &[String],
    cancel: &CancellationToken,
) -> anyhow::Result<(Vec<u8>, String)> {
    let anonymous = [String::new()];
    let candidates = if auths.is_empty() {
        &anonymous[..]
    } else {
        auths
    };
    let mut last = None;
    for auth in candidates {
        let credentials = DockerConfig::new(auth)?;
        match command::output(
            credentials.apply(Command::new(crane).arg("config").arg(reference)),
            Instant::now() + PULL_TIMEOUT,
            cancel,
        ) {
            Ok(out) => return Ok((out.stdout, auth.clone())),
            Err(e) => last = Some(e),
        }
    }
    let detail = last.map(|e| format!("{e:#}")).unwrap_or_default();
    Err(unusable(format!(
        "reading the config of {reference}: {}",
        first_lines(&detail)
    )))
}

// UNIT_BOUNDARY_DESCRIPTION: streams the image's flattened filesystem into `rootfs`. tar restores the owners and modes the image was built with, which is what the runner's CHOWN, FOWNER and DAC_OVERRIDE capabilities are for.
pub fn unpack(
    crane: &str,
    reference: &str,
    rootfs: &Path,
    auth: &str,
    cancel: &CancellationToken,
) -> anyhow::Result<()> {
    let credentials = DockerConfig::new(auth)?;
    let result = command::pipeline(
        credentials.apply(Command::new(crane).arg("export").arg(reference).arg("-")),
        Command::new("tar").arg("-x").arg("-C").arg(rootfs),
        Instant::now() + PULL_TIMEOUT,
        cancel,
    );
    match result {
        Ok(()) => Ok(()),
        Err(PipelineFailure::Producer(detail)) => {
            tracing::warn!(image = reference, "image fetch failed");
            anyhow::bail!("exporting {reference}: {}", first_lines(&detail))
        }
        Err(PipelineFailure::Consumer(detail)) => {
            tracing::warn!(image = reference, "image unpack failed");
            anyhow::bail!("unpacking {reference}: {}", first_lines(&detail))
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a docker config that names no registry. A probe run with it is a truly anonymous read, whatever the runner's own environment holds.
pub const ANONYMOUS: &str = "{}";

// UNIT_BOUNDARY_DESCRIPTION: how long a manifest read may take: the one-minute budget a tag resolution gets, not the pull timeout. A registry that does not answer a manifest read in a minute is treated as down.
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(60);

// UNIT_BOUNDARY_DESCRIPTION: whether these credentials can read the image's manifest — the cheapest proof of access a registry gives: one request and no layers. Both probes that ask it, the one that decides a fresh entry is public and the check that lets a caller reuse one that is not, get RESOLVE_TIMEOUT.
pub fn readable(crane: &str, reference: &str, auth: &str, cancel: &CancellationToken) -> bool {
    let Ok(credentials) = DockerConfig::new(auth) else {
        return false;
    };
    command::output(
        credentials.apply(Command::new(crane).arg("digest").arg(reference)),
        Instant::now() + RESOLVE_TIMEOUT,
        cancel,
    )
    .is_ok()
}

// UNIT_BOUNDARY_DESCRIPTION: crane reads registry credentials from $DOCKER_CONFIG/config.json, so a fetch with credentials gets a directory of its own: 0700 under the runner's temporary directory, never on the image cache or the state volume, and removed when this is dropped, so the credential is on disk only while crane runs. Only crane is given it — smolvm, the guest and the stored spec never see it. No credentials leaves crane's environment as it is.
pub struct DockerConfig(Option<PathBuf>);

impl DockerConfig {
    pub fn new(auth: &str) -> anyhow::Result<Self> {
        use std::io::Write;
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        if auth.is_empty() {
            return Ok(Self(None));
        }
        let dir = scratch_name(&std::env::temp_dir());
        fs::DirBuilder::new().mode(0o700).create(&dir)?;
        let this = Self(Some(dir.clone()));
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(dir.join("config.json"))?
            .write_all(auth.as_bytes())?;
        Ok(this)
    }

    pub fn apply<'a>(&self, command: &'a mut Command) -> &'a mut Command {
        match &self.0 {
            Some(dir) => command.env("DOCKER_CONFIG", dir),
            None => command,
        }
    }
}

impl Drop for DockerConfig {
    fn drop(&mut self) {
        if let Some(dir) = &self.0 {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

fn scratch_name(parent: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or_default();
    parent.join(format!(
        "crane-auth-{}-{nanos:x}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: a manifest read decides whether a machine may boot a private entry, and a registry that never answers must not hold that decision open for the pull timeout. The budget is pinned so a change to it is deliberate.
    #[test]
    fn a_manifest_read_gets_a_minute() {
        assert_eq!(RESOLVE_TIMEOUT, Duration::from_secs(60));
    }

    // TEST_SCENARIO: the reason is what the controller matches on to decide what the person is told — an image to fix, a runner that is full, or a boot to retry. A typed failure keeps its own reason, even under added context, and anything untyped is a boot to retry. The typed failures' own wording reaches the Agent's status, so it is pinned too.
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
}
