use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

// UNIT_BOUNDARY_DESCRIPTION: runs the tools the runner fetches images with — crane, and the tar it pipes into — bounded by a deadline and by the runner's own lifetime. A fetch may take twenty minutes, and a runner that is closing must not leave one running against its image directory: the process is killed and its scratch tree is left to the caller's cleanup, which now gets to run.

// UNIT_BOUNDARY_DESCRIPTION: what a finished command produced. `stderr` is kept for the error message; it is capped by the caller before it reaches an Agent's status.
#[derive(Debug)]
pub struct Output {
    pub stdout: Vec<u8>,
    pub stderr: String,
}

const POLL: Duration = Duration::from_millis(50);

// UNIT_BOUNDARY_DESCRIPTION: runs one command to completion and returns its output, or an error naming why it did not finish: it exited non-zero, the deadline passed, or the runner was closed.
pub fn output(
    command: &mut Command,
    deadline: Instant,
    cancel: &CancellationToken,
) -> anyhow::Result<Output> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let succeeded = wait(&mut [&mut child], deadline, cancel)?;
    let stdout = stdout.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&stderr.join().unwrap_or_default()).into_owned();
    if !succeeded {
        anyhow::bail!("exit status {}: {}", exit_code(&mut child), stderr.trim());
    }
    Ok(Output { stdout, stderr })
}

// UNIT_BOUNDARY_DESCRIPTION: runs `producer | consumer` and waits for both. Each side's stderr is kept apart, so a failure names the half that failed. Either side failing fails the pipeline, and a producer that fails first is reported even though the consumer then fails too on the short stream.
pub fn pipeline(
    producer: &mut Command,
    consumer: &mut Command,
    deadline: Instant,
    cancel: &CancellationToken,
) -> Result<(), PipelineFailure> {
    let mut first = producer
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|e| PipelineFailure::Producer(e.to_string()))?;
    let stream = first
        .stdout
        .take()
        .map(Stdio::from)
        .unwrap_or(Stdio::null());
    let mut second = match consumer
        .stdin(stream)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            kill(&mut first);
            return Err(PipelineFailure::Consumer(e.to_string()));
        }
    };
    let first_err = drain(first.stderr.take());
    let second_err = drain(second.stderr.take());
    let finished = wait(&mut [&mut first, &mut second], deadline, cancel);
    let first_err = String::from_utf8_lossy(&first_err.join().unwrap_or_default()).into_owned();
    let second_err = String::from_utf8_lossy(&second_err.join().unwrap_or_default()).into_owned();
    if let Err(e) = finished {
        return Err(PipelineFailure::Producer(format!("{e}: {first_err}")));
    }
    if !succeeded(&mut first) {
        return Err(PipelineFailure::Producer(format!(
            "exit status {}: {first_err}",
            exit_code(&mut first)
        )));
    }
    if !succeeded(&mut second) {
        return Err(PipelineFailure::Consumer(format!(
            "exit status {}: {second_err}",
            exit_code(&mut second)
        )));
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub enum PipelineFailure {
    Producer(String),
    Consumer(String),
}

fn drain<R: Read + Send + 'static>(source: Option<R>) -> JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut out = Vec::new();
        if let Some(mut source) = source {
            let _ = source.read_to_end(&mut out);
        }
        out
    })
}

// UNIT_BOUNDARY_DESCRIPTION: waits for every child to exit. Past the deadline, or once the runner is closing, every child is killed with its whole process group and reaped before this returns. The group matters: crane and a shell both leave children of their own, and one of them holding the output pipe open would keep the caller waiting after the process it started is gone. Ok(true) is every child exiting zero.
fn wait(
    children: &mut [&mut Child],
    deadline: Instant,
    cancel: &CancellationToken,
) -> anyhow::Result<bool> {
    loop {
        let mut all_done = true;
        for child in children.iter_mut() {
            if child.try_wait()?.is_none() {
                all_done = false;
            }
        }
        if all_done {
            return Ok(children.iter_mut().all(|child| succeeded(child)));
        }
        let why = if cancel.is_cancelled() {
            Some("the runner is closing")
        } else if Instant::now() >= deadline {
            Some("timed out")
        } else {
            None
        };
        if let Some(why) = why {
            for child in children.iter_mut() {
                kill(child);
            }
            anyhow::bail!(why);
        }
        std::thread::sleep(POLL);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: kills a child and every process in its group, then reaps it. Each child is spawned as the leader of its own group, so the group id is its pid.
fn kill(child: &mut Child) {
    if let Ok(pid) = i32::try_from(child.id()) {
        // SAFETY: kill(2) takes no pointers; a group that has already exited returns ESRCH, which is ignored.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn succeeded(child: &mut Child) -> bool {
    matches!(child.try_wait(), Ok(Some(status)) if status.success())
}

fn exit_code(child: &mut Child) -> String {
    match child.try_wait() {
        Ok(Some(status)) => status.to_string(),
        _ => "unknown".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn soon() -> Instant {
        Instant::now() + Duration::from_secs(10)
    }

    fn sh(script: &str) -> Command {
        let mut command = Command::new("sh");
        command.arg("-c").arg(script);
        command
    }

    // TEST_SCENARIO: a config fetch returns what crane printed, and a failed one says why in crane's own words — which is what reaches the Agent's status when an image cannot be read.
    #[test]
    fn a_command_returns_its_output_or_its_complaint() {
        let ok = output(
            &mut sh("printf out; printf err >&2"),
            soon(),
            &CancellationToken::new(),
        )
        .unwrap();
        assert_eq!(ok.stdout, b"out");
        assert_eq!(ok.stderr, "err");

        let failed = output(
            &mut sh("echo denied >&2; exit 3"),
            soon(),
            &CancellationToken::new(),
        )
        .unwrap_err();
        assert!(format!("{failed:#}").contains("denied"), "{failed:#}");
    }

    // TEST_SCENARIO: a runner that is closing must not leave a twenty-minute fetch running against its image directory. Cancelling ends the command at once rather than at its deadline.
    #[test]
    fn closing_the_runner_ends_a_command_instead_of_waiting_for_it() {
        let cancel = CancellationToken::new();
        let later = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            later.cancel();
        });
        let started = Instant::now();
        let err = output(&mut sh("sleep 30; echo late"), soon(), &cancel).unwrap_err();
        assert!(format!("{err:#}").contains("closing"), "{err:#}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    // TEST_SCENARIO: a fetch that hangs is ended at its deadline rather than holding the machine's operation forever.
    #[test]
    fn a_command_past_its_deadline_is_ended() {
        let started = Instant::now();
        let err = output(
            &mut sh("sleep 30"),
            Instant::now() + Duration::from_millis(100),
            &CancellationToken::new(),
        )
        .unwrap_err();
        assert!(format!("{err:#}").contains("timed out"), "{err:#}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    // TEST_SCENARIO: an image is exported and unpacked in one stream. The error must say which half failed: a registry that refused the export and a tar that could not write are different problems for the person reading the status.
    #[test]
    fn a_pipeline_names_the_half_that_failed() {
        assert_eq!(
            pipeline(
                &mut sh("printf data"),
                &mut sh("cat >/dev/null"),
                soon(),
                &CancellationToken::new()
            ),
            Ok(())
        );
        assert!(matches!(
            pipeline(&mut sh("echo refused >&2; exit 1"), &mut sh("cat >/dev/null"), soon(), &CancellationToken::new()),
            Err(PipelineFailure::Producer(e)) if e.contains("refused")
        ));
        assert!(matches!(
            pipeline(&mut sh("printf data"), &mut sh("cat >/dev/null; echo full >&2; exit 2"), soon(), &CancellationToken::new()),
            Err(PipelineFailure::Consumer(e)) if e.contains("full")
        ));
    }
}
