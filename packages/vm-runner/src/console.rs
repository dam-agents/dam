use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::time::Duration;

// UNIT_BOUNDARY_DESCRIPTION: the file smolvm points a machine's virtual console at, in the directory it keeps for that machine. The runtime writes it from the host side, so the runner reads it without touching the guest's disk — which is the guest's own filesystem, and parsing one the guest has had root on is not something the host should do.
pub const CONSOLE_LOG: &str = "agent-console.log";

// UNIT_BOUNDARY_DESCRIPTION: the log smolvm's VMM writes beside the console. The console file holds only the guest agent's output: the guest kernel's own console is a port smolvm connects to nothing, and the VMM logs each line the kernel prints to it here, under KERNEL_TARGET at error level, which the runner's `info` filter keeps. platform-init's refusals, hand-offs and exits are kernel lines, so this is the one place the host sees them. The VMM writes it from the host side, like the console, and a start empties it with the console, so it holds one boot.
pub const VMM_LOG: &str = "agent-startup-error.log";
const KERNEL_TARGET: &[u8] = b" init_or_kernel] ";

// UNIT_BOUNDARY_DESCRIPTION: how much of each of the console's two sources a status carries. The status becomes the Agent's condition message, which the API server rejects over 32 KiB, and the message already holds the error that came before the console; a few kilobytes is the last screen of a boot, which is where a boot that failed stops.
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

// UNIT_BOUNDARY_DESCRIPTION: the end of a machine's console, from the directory smolvm keeps for it: the guest kernel's lines, then the guest agent's. They come from two files on two clocks, so they are not interleaved; the kernel's go first, because a refusal to boot is one of them.
pub fn machine_tail(dir: &Path) -> String {
    [
        kernel_tail(&dir.join(VMM_LOG), CONSOLE_TAIL_BYTES),
        tail_of(&dir.join(CONSOLE_LOG), CONSOLE_TAIL_BYTES),
    ]
    .into_iter()
    .filter(|tail| !tail.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

// UNIT_BOUNDARY_DESCRIPTION: the last `limit` bytes of the kernel's lines in the VMM log, as printable text. The VMM logs every health probe as well, so the kernel's few lines are searched for through the whole file: a window of its end holds only probes once a boot has been stuck for a while. The read grows with how long the boot has run — a guest that never answers is probed twice a second, which adds a few megabytes an hour — and a runner that must read less would keep an offset per machine.
fn kernel_tail(path: &Path, limit: u64) -> String {
    let Ok(file) = fs::File::open(path) else {
        return String::new();
    };
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    let mut kept = Vec::new();
    for line in BufReader::new(file).split(b'\n') {
        let Ok(line) = line else { break };
        let Some(at) = find(&line, KERNEL_TARGET) else {
            continue;
        };
        kept.extend_from_slice(&line[at + KERNEL_TARGET.len()..]);
        kept.push(b'\n');
        if kept.len() > limit.saturating_mul(2) {
            kept.drain(..kept.len() - limit - 1);
        }
    }
    kept.pop();
    cut_to(&kept, limit)
}

fn find(line: &[u8], needle: &[u8]) -> Option<usize> {
    line.windows(needle.len()).position(|w| w == needle)
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
    if body.last() == Some(&b'\n') {
        body.pop();
    }
    let kept: Vec<&[u8]> = body
        .split(|b| *b == b'\n')
        .filter(|line| {
            !(find(line, b"\"target\":\"smolvm_agent\"").is_some()
                && find(line, b"\"message\":\"accepted connection\"").is_some())
        })
        .collect();
    cut_to(
        &kept.join(&b'\n'),
        usize::try_from(limit).unwrap_or(usize::MAX),
    )
}

// UNIT_BOUNDARY_DESCRIPTION: the last `limit` bytes of `tail`, from its first whole line in them when one fits, as printable text.
fn cut_to(tail: &[u8], limit: usize) -> String {
    let mut start = 0;
    while tail.len() - start > limit {
        match tail[start..].iter().position(|b| *b == b'\n') {
            Some(cut) if cut < limit => start += cut + 1,
            _ => {
                start = tail.len() - limit;
                break;
            }
        }
    }
    printable(&String::from_utf8_lossy(&tail[start..]))
}

// UNIT_BOUNDARY_DESCRIPTION: the console is on the runner's claim and outlives the runner, while the values that redact it are what this process was given: a restarted runner knows only the applied spec, and an earlier boot may have printed a value that spec no longer holds. So each start begins an empty console, and a tail then only shows the boot this runner started, with a spec it holds. It runs after the last VMM was waited out and, if it had to be, killed; it empties the console even if that VMM somehow still holds it, because a console that keeps an earlier boot is the leak this prevents, while a few lines lost from a VMM being killed are not. A console that cannot be emptied is removed, and one that cannot be removed either is reported, because its old lines would reach a status unredacted. Both of the console's sources are emptied: smolvm removes the VMM log before a start as well, but the runner does not leave to the runtime a guarantee its own status depends on.
pub fn clear_console(id: &str, vm_dir: &Path) {
    for path in [vm_dir.join(CONSOLE_LOG), vm_dir.join(VMM_LOG)] {
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
                    tracing::warn!(machine = %id, file = %path.display(), error = %e, "could not clear the machine console before its start")
                }
            },
        }
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

// UNIT_BOUNDARY_DESCRIPTION: the length of a CSI sequence's body after `ESC [`: parameters, then intermediates, then one final byte — the shape `\x1b\[[0-9;?]*[ -/]*[@-~]`.
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
    use crate::testdir::TempDir;

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
        let dir = TempDir::new("console");
        let log = dir.path().join(CONSOLE_LOG);
        fs::write(&log, "first line\nsecond line\nlast line\n").unwrap();
        assert_eq!(tail_of(&log, 14), "last line");
        assert_eq!(tail_of(&log, 1000), "first line\nsecond line\nlast line");
        assert_eq!(tail_of(&dir.path().join("missing"), 1000), "");
    }

    // TEST_SCENARIO: the runner probes the guest's health once a second and smolvm's agent logs each accepted connection to the console, so within a minute those lines are all a 4 KiB tail would hold. They say nothing about the guest, so the tail drops them and shows what the guest itself printed before them; the agent's other lines, which do say what it is doing, stay.
    #[test]
    fn probe_lines_do_not_crowd_the_guest_out_of_the_tail() {
        let dir = TempDir::new("console-probes");
        let log = dir.path().join(CONSOLE_LOG);
        let probe = "{\"timestamp\":\"t\",\"level\":\"INFO\",\"fields\":{\"message\":\"accepted connection\"},\"target\":\"smolvm_agent\"}\n";
        let flatten = "{\"timestamp\":\"t\",\"level\":\"INFO\",\"fields\":{\"message\":\"flattening local image archive\"},\"target\":\"smolvm_agent::storage\"}";
        let mut text = format!("kernel panic\n{flatten}\n");
        for _ in 0..200 {
            text.push_str(probe);
        }
        fs::write(&log, &text).unwrap();
        assert_eq!(tail_of(&log, 4096), format!("kernel panic\n{flatten}"));
    }

    // TEST_SCENARIO: platform-init refused the boot, and said why as a kernel line. The guest kernel's console is not the console file, so its lines reach only the VMM's log, among the lines the VMM writes for every health probe. The tail finds the refusal there after hours of probes, shows it first and without the VMM's own prefix, and then the guest agent's lines from the console file.
    #[test]
    fn a_refusal_the_kernel_printed_reaches_the_tail() {
        let dir = TempDir::new("console-kernel");
        let fatal = "[    0.412345] platform-init: FATAL: seeding /home/agent onto the disk: the agent's home is missing from a disk that held it before. Refusing to boot";
        let mut vmm = format!(
            "[2026-09-30T08:45:33.305142Z INFO  krun_devices::virtio::balloon::device] balloon stats\n[2026-09-30T08:45:33.412400Z ERROR init_or_kernel] {fatal}\n"
        );
        for _ in 0..20_000 {
            vmm.push_str("[2026-09-30T08:47:20.564077Z WARN  krun_devices::virtio::vsock::unix] error sending shutdown to socket: Socket is not connected (os error 57)\n[2026-09-30T08:47:20Z]: virtio-net: accepted published TCP connection peer=127.0.0.1:65192 host_port=34010 guest_destination=100.96.0.2:8080\n");
        }
        fs::write(dir.path().join(VMM_LOG), vmm).unwrap();
        let overlay = "{\"timestamp\":\"t\",\"level\":\"INFO\",\"fields\":{\"message\":\"overlay mounted\"},\"target\":\"smolvm_agent::storage\"}";
        fs::write(dir.path().join(CONSOLE_LOG), format!("{overlay}\n")).unwrap();
        assert_eq!(machine_tail(dir.path()), format!("{fatal}\n{overlay}"));

        let many: String = (0..1000)
            .map(|i| {
                format!(
                    "[t ERROR init_or_kernel] [    {i}.0] platform-init: the entrypoint exited\n"
                )
            })
            .collect();
        fs::write(dir.path().join(VMM_LOG), many).unwrap();
        fs::remove_file(dir.path().join(CONSOLE_LOG)).unwrap();
        let tail = machine_tail(dir.path());
        assert!(tail.len() <= CONSOLE_TAIL_BYTES as usize, "{}", tail.len());
        assert!(
            tail.starts_with("[    ")
                && tail.ends_with("[    999.0] platform-init: the entrypoint exited"),
            "{tail:?}"
        );
        assert_eq!(machine_tail(&dir.path().join("missing")), "");
    }

    // TEST_SCENARIO: a line longer than the limit, with no newline in it or with a short line after it, keeps its end. The limit counts the console's bytes before any decoding, so bytes that are not UTF-8 and CRLF line ends give a tail of the stated size, cut at a character, and never a panic.
    #[test]
    fn a_long_last_line_of_bad_bytes_is_cut_at_a_character() {
        let dir = TempDir::new("console-bytes");
        let log = dir.path().join(CONSOLE_LOG);
        let mut bytes = b"guest panic: ".to_vec();
        bytes.extend(std::iter::repeat_n(0xFF, 2000));
        fs::write(&log, &bytes).unwrap();
        let tail = tail_of(&log, 4096);
        assert_eq!(
            tail.chars().count(),
            2013,
            "the limit counts the console's bytes, not the decoded text"
        );
        assert!(
            tail.starts_with("guest panic: ") && tail.ends_with('\u{FFFD}'),
            "{tail:?}"
        );
        fs::write(&log, "ab\r\n".repeat(2000)).unwrap();
        assert_eq!(
            tail_of(&log, 4096).matches("ab").count(),
            1024,
            "a CRLF console keeps its \\r inside the limit"
        );
        fs::write(&log, format!("first\n{}\nabc", "x".repeat(6000))).unwrap();
        let tail = tail_of(&log, 4096);
        assert_eq!(tail.len(), 4096, "an over-limit line keeps its end");
        assert!(
            tail.ends_with("\nabc") && tail.starts_with("xxx"),
            "{tail:?}"
        );
    }

    // TEST_SCENARIO: an earlier boot printed a Secret, the operator rotated it, and the runner restarted and so forgot the old value. The console still holds that boot. Starting the machine again empties it first, so no later tail can quote a value the runner no longer knows to redact.
    #[test]
    fn a_start_empties_the_console_an_earlier_boot_left() {
        let root = TempDir::new("clear");
        let (vm_dir, proc_root) = (root.path().join("m1"), root.path().join("proc"));
        fs::create_dir_all(&vm_dir).unwrap();
        fs::create_dir_all(&proc_root).unwrap();
        let (log, vmm) = (vm_dir.join(CONSOLE_LOG), vm_dir.join(VMM_LOG));
        fs::write(&log, "OPENAI_API_KEY=sk-live-withdrawn\n").unwrap();
        fs::write(
            &vmm,
            "[t ERROR init_or_kernel] OPENAI_API_KEY=sk-live-withdrawn\n",
        )
        .unwrap();
        crate::runtime::clear_for_start(
            "m1",
            &proc_root,
            &vm_dir,
            Vec::new(),
            crate::runtime::VMM_EXIT_WAIT,
        )
        .unwrap();
        assert_eq!(fs::read(&log).unwrap(), b"");
        assert_eq!(fs::read(&vmm).unwrap(), b"");
    }

    // TEST_SCENARIO: the console file is where smolvm points every machine's virtual console, and the size, the wait and both sentences reach the Agent's condition, which an operator reads and a runbook quotes. All of them are pinned as literals, and the sentence that joins a message to its tail is checked on the join itself.
    #[test]
    fn the_console_file_and_the_condition_wording_are_pinned() {
        assert_eq!(CONSOLE_LOG, "agent-console.log");
        assert_eq!(CONSOLE_TAIL_BYTES, 4096);
        assert_eq!(SLOW_BOOT_AFTER, Duration::from_secs(60));
        assert_eq!(
            SLOW_BOOT,
            "the guest is not answering its health check, and it was last asked to start more than 1m0s ago"
        );
        assert_eq!(
            with_console("boot failed", "last line"),
            "boot failed\nthe guest console ends:\nlast line"
        );
        assert_eq!(with_console("boot failed", ""), "boot failed");
    }
}
