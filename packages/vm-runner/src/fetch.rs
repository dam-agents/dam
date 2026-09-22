use std::path::Path;
use std::process::Command;
use std::time::Instant;

use tokio_util::sync::CancellationToken;

use crate::api::{
    ImageLaunch, REASON_BOOT_FAILED, REASON_EGRESS_CHANGED, REASON_IMAGE_UNAVAILABLE,
    REASON_OUT_OF_CAPACITY,
};
use crate::cache::PULL_TIMEOUT;
use crate::command::{self, PipelineFailure};
use crate::launch::launch_from_config;
use crate::runtime::IMAGE_LAUNCH_UNKNOWN;

// UNIT_BOUNDARY_DESCRIPTION: how the runner reads an image from its registry, and how a failure is classified for the controller. A machine may reach only its gateway, so the guest cannot pull its own image: crane runs here instead, once to read what the image says to run and once to stream its filesystem into the cache.

pub const IMAGE_UNUSABLE: &str = "the image cannot be run";
pub const EGRESS_CHANGED: &str = "egress allowlist changed";

// UNIT_BOUNDARY_DESCRIPTION: a failure that carries the reason the controller reports it under. The reason is part of the error rather than guessed from its text, except for the failures that come from smolvm, which carry none.
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

pub fn egress_changed(detail: impl std::fmt::Display) -> anyhow::Error {
    Refusal {
        reason: REASON_EGRESS_CHANGED,
        message: format!("{EGRESS_CHANGED}: {detail}"),
    }
    .into()
}

// UNIT_BOUNDARY_DESCRIPTION: the reason a failed operation is reported under. A typed refusal says its own; anything else is read from its text by the Go runner's rules, which is how a failure that came out of smolvm is told apart from a boot that simply failed.
pub fn failure_reason(err: &anyhow::Error) -> &'static str {
    if let Some(refusal) = err.downcast_ref::<Refusal>() {
        return refusal.reason;
    }
    let message = format!("{err:#}");
    if message.contains("cannot read archive")
        || message.contains("--image")
        || message.contains("pull")
    {
        REASON_IMAGE_UNAVAILABLE
    } else if message.contains("no free machine port") {
        REASON_OUT_OF_CAPACITY
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

// UNIT_BOUNDARY_DESCRIPTION: what an image says to run, read from its registry without fetching a layer. This is the one source left for a machine that boots straight from a reference, and without it smolvm would launch the image's own entrypoint and leave the disk unmounted — so a runner that cannot fetch refuses the machine instead.
pub fn launch_from_registry(
    crane: &str,
    reference: &str,
    cancel: &CancellationToken,
) -> anyhow::Result<ImageLaunch> {
    if crane.is_empty() {
        anyhow::bail!(
            "{IMAGE_LAUNCH_UNKNOWN}: {reference} names no cached image and this runner cannot read one from the registry"
        );
    }
    let config = read_config(crane, reference, cancel)?;
    launch_from_config(&config)
        .map_err(|e| unusable(format!("reading the config of {reference}: {e:#}")))
}

pub fn read_config(
    crane: &str,
    reference: &str,
    cancel: &CancellationToken,
) -> anyhow::Result<Vec<u8>> {
    command::output(
        Command::new(crane).arg("config").arg(reference),
        Instant::now() + PULL_TIMEOUT,
        cancel,
    )
    .map(|out| out.stdout)
    .map_err(|e| {
        unusable(format!(
            "reading the config of {reference}: {}",
            first_lines(&format!("{e:#}"))
        ))
    })
}

// UNIT_BOUNDARY_DESCRIPTION: streams the image's flattened filesystem into `rootfs`. tar restores the owners and modes the image was built with, which is what the runner's CHOWN, FOWNER and DAC_OVERRIDE capabilities are for.
pub fn unpack(
    crane: &str,
    reference: &str,
    rootfs: &Path,
    cancel: &CancellationToken,
) -> anyhow::Result<()> {
    let result = command::pipeline(
        Command::new(crane).arg("export").arg(reference).arg("-"),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;

    // TEST_SCENARIO: the reason is what the controller matches on to decide what the person is told — an image to fix, a runner that is full, or a boot to retry. A typed failure keeps its own reason, and text from smolvm is sorted by the Go runner's rules, word for word.
    #[test]
    fn failures_are_reported_under_the_reason_the_go_runner_gives() {
        assert_eq!(failure_reason(&unusable("x")), REASON_IMAGE_UNAVAILABLE);
        assert_eq!(failure_reason(&egress_changed("x")), REASON_EGRESS_CHANGED);
        for (text, reason) in [
            (
                "smolvm machine create: cannot read archive /x.tar",
                REASON_IMAGE_UNAVAILABLE,
            ),
            ("invalid --image value", REASON_IMAGE_UNAVAILABLE),
            (
                "start machine: pull failed: unauthorized",
                REASON_IMAGE_UNAVAILABLE,
            ),
            ("no free machine port", REASON_OUT_OF_CAPACITY),
            (
                "start machine: guest agent never became ready",
                REASON_BOOT_FAILED,
            ),
        ] {
            assert_eq!(failure_reason(&anyhow::anyhow!(text)), reason, "{text}");
        }

        let go = gosource::read("server.go");
        let literals = gosource::literals_in(&go, "failureReason");
        for needle in [
            "cannot read archive",
            "--image",
            "pull",
            "no free machine port",
        ] {
            assert!(
                literals.iter().any(|l| l == needle),
                "the Go runner no longer matches {needle:?}"
            );
        }
        for (name, ours) in [
            ("errEgressChanged", EGRESS_CHANGED),
            ("errImageUnusable", IMAGE_UNUSABLE),
        ] {
            let theirs = go
                .lines()
                .find_map(|line| {
                    line.strip_prefix(&format!("var {name} = errors.New("))?
                        .strip_suffix(')')
                        .and_then(gosource::unquote)
                })
                .unwrap_or_else(|| panic!("server.go no longer declares {name}"));
            assert_eq!(ours, theirs);
        }
    }

    // TEST_SCENARIO: a failure's text is stored in the Agent's condition, which the API server caps at 32 KiB. The head is kept, marked as cut, and a cut never splits a character — a message ending in half of one is rejected as invalid UTF-8 by the same write it was shortened for.
    #[test]
    fn a_long_failure_is_cut_to_what_a_condition_can_hold() {
        assert_eq!(first_lines("  boom  "), "boom");
        let long = "é".repeat(CAPTURED_OUTPUT);
        let cut = first_lines(&long);
        assert!(cut.ends_with("… (truncated)"));
        assert!(cut.len() <= CAPTURED_OUTPUT + "… (truncated)".len());
        let go = gosource::read("server.go");
        assert!(
            go.lines()
                .any(|line| line.trim() == format!("const capturedOutput = {CAPTURED_OUTPUT}")),
            "the Go runner no longer caps captured output at {CAPTURED_OUTPUT}"
        );
    }

    // TEST_SCENARIO: a runner installed without crane can still boot images that are cached, but one naming only a registry reference is refused: booting it would run the image's own entrypoint, skip platform-init and lose the agent's home at the first stop.
    #[test]
    fn a_runner_that_cannot_fetch_refuses_an_uncached_image() {
        let err =
            launch_from_registry("", "quay.io/x/vm:1", &CancellationToken::new()).unwrap_err();
        assert!(err.to_string().starts_with(IMAGE_LAUNCH_UNKNOWN), "{err}");
        assert_eq!(failure_reason(&err), REASON_BOOT_FAILED);
    }
}
