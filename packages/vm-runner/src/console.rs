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

// UNIT_BOUNDARY_DESCRIPTION: the last `limit` bytes of the console, from the first whole line in them, as printable text.
pub fn tail_of(path: &Path, limit: u64) -> String {
    let Ok(mut file) = fs::File::open(path) else {
        return String::new();
    };
    let Ok(size) = file.metadata().map(|m| m.len()) else {
        return String::new();
    };
    let offset = size.saturating_sub(limit);
    let mut body = Vec::new();
    if file.seek(SeekFrom::Start(offset)).is_err()
        || file.take(limit).read_to_end(&mut body).is_err()
    {
        return String::new();
    }
    if offset > 0 {
        if let Some(cut) = body.iter().position(|b| *b == b'\n') {
            body.drain(..=cut);
        }
    }
    printable(&String::from_utf8_lossy(&body))
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
