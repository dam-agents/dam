use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::Duration;

// UNIT_BOUNDARY_DESCRIPTION: the file smolvm points a machine's virtual console at, in the directory it keeps for that machine. The runtime writes it from the host side, so the runner reads it without touching the guest's disk — which is the guest's own filesystem, and parsing one the guest has had root on is not something the host should do.
pub const CONSOLE_LOG: &str = "agent-console.log";

// UNIT_BOUNDARY_DESCRIPTION: how much of the console a status carries. The status becomes the Agent's condition message, which the API server rejects over 32 KiB, and the message already holds the error that came before the console; a few kilobytes is the last screen of a boot, which is where a boot that failed stops.
pub const CONSOLE_TAIL_BYTES: u64 = 4096;

// UNIT_BOUNDARY_DESCRIPTION: how long after a start a guest that has not answered its health check is worth explaining. A cold boot that expands the runtime's disk templates takes about twenty-five seconds, so a guest silent for longer than this is stuck rather than slow. The same window paces how often the tail is read again, so a stuck machine rewrites its Agent's condition about once a minute and not on every poll.
pub const SLOW_BOOT_AFTER: Duration = Duration::from_secs(60);

pub const SLOW_BOOT: &str =
    "the guest is not answering its health check, and it was last asked to start more than 1m0s ago";

const CONSOLE_ENDS: &str = "\nthe guest console ends:\n";

pub fn with_console(message: &str, tail: &str) -> String {
    if tail.is_empty() {
        return message.to_string();
    }
    format!("{message}{CONSOLE_ENDS}{tail}")
}

// UNIT_BOUNDARY_DESCRIPTION: the last `limit` bytes of the console, from the first whole line in them, as printable text. smolvm's agent logs every connection it accepts, and the runner opens one per health probe, so within a minute those lines are all the tail would hold; they say nothing about the guest and are dropped, from a window sixteen times the limit, so the guest's own last lines stay in view.
pub fn tail_of(path: &Path, limit: u64) -> String {
    let Ok(mut file) = fs::File::open(path) else {
        return String::new();
    };
    let Ok(size) = file.metadata().map(|m| m.len()) else {
        return String::new();
    };
    let window = limit.saturating_mul(16);
    let offset = size.saturating_sub(window);
    let mut body = Vec::new();
    if file.seek(SeekFrom::Start(offset)).is_err()
        || file.take(window).read_to_end(&mut body).is_err()
    {
        return String::new();
    }
    if offset > 0 {
        if let Some(cut) = body.iter().position(|b| *b == b'\n') {
            body.drain(..=cut);
        }
    }
    let text = String::from_utf8_lossy(&body);
    let kept: Vec<&str> = text
        .lines()
        .filter(|line| {
            !(line.contains("\"target\":\"smolvm_agent\"")
                && line.contains("\"message\":\"accepted connection\""))
        })
        .collect();
    let tail = kept.join("\n");
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    let mut start = 0;
    while tail.len() - start > limit {
        match tail[start..].find('\n') {
            Some(cut) if cut < limit => start += cut + 1,
            _ => {
                start = tail.len() - limit;
                while !tail.is_char_boundary(start) {
                    start += 1;
                }
                break;
            }
        }
    }
    printable(&tail[start..])
}

// UNIT_BOUNDARY_DESCRIPTION: the console is on the runner's claim and outlives the runner, while the values that redact it are what this process was given: a restarted runner knows only the applied spec, and an earlier boot may have printed a value that spec no longer holds. So each start begins an empty console, and a tail then only shows the boot this runner started, with a spec it holds. It runs after the last VMM was waited out and, if it had to be, killed; it empties the console even if that VMM somehow still holds it, because a console that keeps an earlier boot is the leak this prevents, while a few lines lost from a VMM being killed are not. A console that cannot be emptied is removed, and one that cannot be removed either is reported, because its old lines would reach a status unredacted.
pub fn clear_console(id: &str, vm_dir: &Path) {
    let path = vm_dir.join(CONSOLE_LOG);
    let emptied = fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .and_then(|file| file.set_len(0));
    match emptied {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                tracing::warn!(machine = %id, error = %e, "could not clear the machine console before its start")
            }
        },
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the guest writes the console, so it is untrusted text on its way into a Kubernetes condition. Terminal escapes and every other control character but newline and tab are dropped, and invalid UTF-8 is replaced, so what an operator reads is text and not whatever the guest chose to print.
pub fn printable(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            let rest: String = chars.clone().skip(1).collect();
            if let Some(len) = escape_len(&rest) {
                for _ in 0..=len {
                    chars.next();
                }
                continue;
            }
        }
        if c == '\n' || c == '\t' || !c.is_control() {
            out.push(c);
        }
    }
    out.trim().to_string()
}

// UNIT_BOUNDARY_DESCRIPTION: the length of a CSI sequence's body after `ESC [`: parameters, then intermediates, then one final byte — the shape `\x1b\[[0-9;?]*[ -/]*[@-~]` the Go runner strips.
fn escape_len(rest: &str) -> Option<usize> {
    let mut chars = rest.chars();
    let mut len = 0;
    let mut next = chars.next();
    while matches!(next, Some('0'..='9' | ';' | '?')) {
        len += 1;
        next = chars.next();
    }
    while matches!(next, Some(' '..='/')) {
        len += 1;
        next = chars.next();
    }
    match next {
        Some('@'..='~') => Some(len + 1),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;

    // TEST_SCENARIO: a guest can print anything to its console, and the tail goes into a Kubernetes condition that an operator reads. Colour codes and cursor moves are dropped whole, other control characters are dropped, and the text between them is kept as it was.
    #[test]
    fn a_console_tail_is_only_printable_text() {
        assert_eq!(
            printable("\u{1b}[1;31mkernel panic\u{1b}[0m\r\n\tat boot\u{7}\u{0}"),
            "kernel panic\n\tat boot"
        );
        assert_eq!(printable("\u{1b}[?25lhidden\u{1b}[2J"), "hidden");
        assert_eq!(printable("a\u{1b}[b"), "a");
        assert_eq!(printable("a\u{1b}[\u{1b}"), "a[");
    }

    // TEST_SCENARIO: the tail starts at a whole line when the file is longer than what a status carries, so the first line an operator reads is not the end of one they cannot see; a short file is shown whole, and a machine with no console shows nothing.
    #[test]
    fn a_long_console_is_cut_at_a_line() {
        let dir = std::env::temp_dir().join(format!("vm-runner-console-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join(CONSOLE_LOG);
        fs::write(&log, "first line\nsecond line\nlast line\n").unwrap();
        assert_eq!(tail_of(&log, 14), "last line");
        assert_eq!(tail_of(&log, 1000), "first line\nsecond line\nlast line");
        assert_eq!(tail_of(&dir.join("missing"), 1000), "");
        let _ = fs::remove_dir_all(&dir);
    }

    // TEST_SCENARIO: the runner probes the guest's health once a second and smolvm's agent logs each accepted connection to the console, so within a minute those lines are all a 4 KiB tail would hold. They say nothing about the guest, so the tail drops them and shows what the guest itself printed before them; the agent's other lines, which do say what it is doing, stay.
    #[test]
    fn probe_lines_do_not_crowd_the_guest_out_of_the_tail() {
        let dir =
            std::env::temp_dir().join(format!("vm-runner-console-probes-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join(CONSOLE_LOG);
        let probe = "{\"timestamp\":\"t\",\"level\":\"INFO\",\"fields\":{\"message\":\"accepted connection\"},\"target\":\"smolvm_agent\"}\n";
        let flatten = "{\"timestamp\":\"t\",\"level\":\"INFO\",\"fields\":{\"message\":\"flattening local image archive\"},\"target\":\"smolvm_agent::storage\"}";
        let mut text = format!("kernel panic\n{flatten}\n");
        for _ in 0..200 {
            text.push_str(probe);
        }
        fs::write(&log, &text).unwrap();
        assert_eq!(tail_of(&log, 4096), format!("kernel panic\n{flatten}"));
        let _ = fs::remove_dir_all(&dir);
    }

    // TEST_SCENARIO: a line longer than the limit, with no newline in it or with a short line after it, keeps its end, as the Go runner keeps it: the two tails must agree on one console. Bytes that are not UTF-8 must still give a tail, so the cut lands on a character boundary, never inside one.
    #[test]
    fn a_long_last_line_of_bad_bytes_is_cut_at_a_character() {
        let dir =
            std::env::temp_dir().join(format!("vm-runner-console-bytes-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join(CONSOLE_LOG);
        let mut bytes = b"guest panic: ".to_vec();
        bytes.extend(std::iter::repeat_n(0xFF, 2000));
        fs::write(&log, &bytes).unwrap();
        let tail = tail_of(&log, 4096);
        assert!(!tail.is_empty());
        assert!(tail.ends_with('\u{FFFD}'), "{tail:?}");
        fs::write(&log, format!("first\n{}\nabc", "x".repeat(6000))).unwrap();
        let tail = tail_of(&log, 4096);
        assert_eq!(
            tail.len(),
            4096,
            "an over-limit line keeps its end, as the Go runner keeps it"
        );
        assert!(
            tail.ends_with("\nabc") && tail.starts_with("xxx"),
            "{tail:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    // TEST_SCENARIO: an earlier boot printed a Secret, the operator rotated it, and the runner restarted and so forgot the old value. The console still holds that boot. Starting the machine again empties it first, so no later tail can quote a value the runner no longer knows to redact.
    #[test]
    fn a_start_empties_the_console_an_earlier_boot_left() {
        let root = std::env::temp_dir().join(format!("vm-runner-clear-{}", std::process::id()));
        let (vm_dir, proc_root) = (root.join("m1"), root.join("proc"));
        fs::create_dir_all(&vm_dir).unwrap();
        fs::create_dir_all(&proc_root).unwrap();
        let log = vm_dir.join(CONSOLE_LOG);
        fs::write(&log, "OPENAI_API_KEY=sk-live-withdrawn\n").unwrap();
        crate::runtime::clear_for_start("m1", &proc_root, &vm_dir);
        assert_eq!(fs::read(&log).unwrap(), b"");
        let _ = fs::remove_dir_all(&root);
    }

    // TEST_SCENARIO: the two runners share the claim, so a console one of them left must be emptied by the other's start too.
    #[test]
    fn the_go_runner_empties_the_console_at_start_too() {
        let go = gosource::read("smolvm.go");
        let start = gosource::function_body(&go, "(r *Smolvm) Start").expect("smolvm.go has Start");
        assert!(
            start.contains("clearConsole(id, dir)"),
            "the Go runner no longer empties the console at start: {start}"
        );
    }

    // TEST_SCENARIO: an Agent's condition reads the same whichever runner wrote it, so the file, the size, the window and both sentences are the Go runner's.
    #[test]
    fn the_console_is_read_as_the_go_runner_reads_it() {
        let go = gosource::read("console.go");
        assert_eq!(
            gosource::const_value(&go, "consoleLogName").as_deref(),
            Some(CONSOLE_LOG)
        );
        assert_eq!(
            gosource::int_value(&go, "consoleTailBytes"),
            Some(CONSOLE_TAIL_BYTES)
        );
        assert!(
            go.lines()
                .any(|line| line.trim() == "slowBootAfter = time.Minute"),
            "the Go runner no longer waits a minute before explaining a slow boot"
        );
        assert_eq!(SLOW_BOOT_AFTER, Duration::from_secs(60));
        let literals = gosource::literals_in(&go, "(s *Server) watchBoot");
        assert!(
            literals.iter().any(|l| l
                == "the guest is not answering its health check, and it was last asked to start more than %s ago"),
            "{literals:?}"
        );
        assert!(SLOW_BOOT.ends_with("more than 1m0s ago"));
        assert!(gosource::literals_in(&go, "withConsole")
            .iter()
            .any(|l| l == "\\nthe guest console ends:\\n"));
    }
}
