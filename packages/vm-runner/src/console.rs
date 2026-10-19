use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
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

// UNIT_BOUNDARY_DESCRIPTION: how large a machine's console or VMM log may grow before the runner cuts it back. The VMM writes both from the host side, onto the claim every machine of the owner keeps its disks on, as fast as the guest makes it: whatever the guest prints to its console, and a line for every connection it opens. The runner checks every TRIM_EVERY, so a log can pass the cap by what a guest writes in that time.
pub const LOG_CAP_BYTES: u64 = 16 << 20;

pub const TRIM_EVERY: Duration = Duration::from_secs(10);

const CONSOLE_ENDS: &str = "\nthe guest console ends:\n";

// UNIT_BOUNDARY_DESCRIPTION: whether the guest's last entrypoint exit or refused boot in a console tail was with the agent's home full, as platform-init marks it (guest::HOME_FULL). Only the last one counts, so a home freed since, whose entrypoint then exited for another reason, is not reported full.
pub fn home_full(tail: &str) -> bool {
    tail.lines()
        .rev()
        .find(|line| line.contains(ENTRYPOINT_EXITED) || line.contains(BOOT_REFUSED))
        .is_some_and(|line| line.contains(crate::guest::HOME_FULL))
}

const ENTRYPOINT_EXITED: &str = "platform-init: the image entrypoint ";
const BOOT_REFUSED: &str = "platform-init: FATAL: ";

// UNIT_BOUNDARY_DESCRIPTION: the marks platform-init prints on the console about a guest that keeps running: guest::GUEST_FULL while the agent's writes fail with no space left, guest::GUEST_NEARLY_FULL while it may write a little more before they do, and guest::GUEST_ROOM once its storage gave it room again. The mark read is the one the guest made last, which is the one the kernel stamped latest: a cut of the log can leave a newer mark ahead of an older one (trim_with), so the file's order alone would keep a guest that has room reading as full for as long as it runs, with no line coming to correct it. A line the kernel did not stamp keeps the file's order, and nothing is read as full when the text holds no mark at all.
pub fn room_full(text: &str) -> Option<bool> {
    const MARKS: [&str; 3] = [
        crate::guest::GUEST_FULL,
        crate::guest::GUEST_NEARLY_FULL,
        crate::guest::GUEST_ROOM,
    ];
    let mut last: Option<(Option<f64>, bool)> = None;
    for line in text
        .lines()
        .filter(|line| MARKS.iter().any(|word| line.contains(word)))
    {
        let at = uptime(line);
        let later = match last {
            Some((was, _)) => match (was, at) {
                (Some(was), Some(at)) => at >= was,
                _ => true,
            },
            None => true,
        };
        if later {
            last = Some((at, line.contains(crate::guest::GUEST_FULL)));
        }
    }
    last.map(|(_, full)| full)
}

// UNIT_BOUNDARY_DESCRIPTION: how long after its boot the kernel printed a line, from the "[   123.456789]" the kernel puts first on each of its console lines, or None for a line it did not stamp.
fn uptime(line: &str) -> Option<f64> {
    line.split(['[', ']'])
        .skip(1)
        .step_by(2)
        .find_map(|field| field.trim().parse().ok())
}

// UNIT_BOUNDARY_DESCRIPTION: what a machine's kernel log gained since `from` bytes, and the offset to read from next time: the whole lines written after it, and one that is still being written left for the next read. A log shorter than `from` was emptied by a new boot, so it is read whole. The log holds a line for every connection the VMM relays, so the marks a minute old are not at its end, which is why the runner keeps an offset per machine rather than reading the tail.
pub fn kernel_since(path: &Path, from: u64) -> (u64, String) {
    let Ok(mut file) = fs::File::open(path) else {
        return (from, String::new());
    };
    let len = file.metadata().map_or(0, |info| info.len());
    let from = if len < from { 0 } else { from };
    let mut bytes = Vec::new();
    if file.seek(SeekFrom::Start(from)).is_err() || file.read_to_end(&mut bytes).is_err() {
        return (from, String::new());
    }
    bytes.truncate(
        bytes
            .iter()
            .rposition(|b| *b == b'\n')
            .map_or(0, |at| at + 1),
    );
    (
        from + bytes.len() as u64,
        String::from_utf8_lossy(&bytes).into_owned(),
    )
}

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

// UNIT_BOUNDARY_DESCRIPTION: the last `limit` bytes of the kernel's lines in the VMM log, as printable text. The VMM writes lines of its own as well, so the kernel's few lines are searched for through the whole file: a window of its end may hold none of them once a guest has run for a while. The read grows with the file, which the trim keeps under LOG_CAP_BYTES, and a runner that must read less would keep an offset per machine.
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

// UNIT_BOUNDARY_DESCRIPTION: the last `limit` bytes of the console, from the first whole line in them, as printable text. smolvm's agent logs every connection it accepts, one for each command the runner runs in the guest, and enough of them are all the tail would hold; they say nothing about the guest and are dropped, from a window sixteen times the limit, so the guest's own last lines stay in view.
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

// UNIT_BOUNDARY_DESCRIPTION: cuts each of a machine's logs that is over `cap` back to what a status reads of it: the kernel's last lines and the window at the end that tail_of reads. The VMM appends to both, so once the file is emptied it writes on at its new end; a line it writes between the emptying and the write-back lands before the kept lines, which a tail read at the end tolerates. It says whether it cut one, because a cut moves the kept lines to offsets the runner's last read of the file did not count from (kernel_since).
pub fn trim_logs(id: &str, dir: &Path, cap: u64) -> bool {
    let mut cut = false;
    for path in [dir.join(CONSOLE_LOG), dir.join(VMM_LOG)] {
        let Ok(size) = fs::metadata(&path).map(|m| m.len()) else {
            continue;
        };
        if size <= cap {
            continue;
        }
        match trim(&path, size) {
            Ok(()) => cut = true,
            Err(e) => {
                tracing::warn!(machine = %id, file = %path.display(), error = %e, "could not cut back a machine log over its cap")
            }
        }
    }
    cut
}

fn trim(path: &Path, size: u64) -> std::io::Result<()> {
    trim_with(path, size, &mut || {})
}

// UNIT_BOUNDARY_DESCRIPTION: the cut, with `during` run at each point where the VMM is free to append to the file the runner is rewriting: it holds the file open for the whole life of the machine, so what it writes there then is the case the order of the kept lines has to survive (a test drives one in at each point, which a test of a lock-free rewrite cannot otherwise reach).
fn trim_with(path: &Path, size: u64, during: &mut dyn FnMut()) -> std::io::Result<()> {
    let window = CONSOLE_TAIL_BYTES.saturating_mul(16).min(size);
    let mut kernel: std::collections::VecDeque<Vec<u8>> = Default::default();
    let mut kept = 0;
    for line in BufReader::new(fs::File::open(path)?.take(size - window)).split(b'\n') {
        let mut line = line?;
        if find(&line, KERNEL_TARGET).is_none() {
            continue;
        }
        line.push(b'\n');
        kept += line.len();
        kernel.push_back(line);
        while kept as u64 > CONSOLE_TAIL_BYTES * 2 {
            kept -= kernel.pop_front().map_or(0, |l| l.len());
        }
    }
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(size - window))?;
    let mut tail = Vec::new();
    file.take(window).read_to_end(&mut tail)?;
    let kept: Vec<u8> = kernel.into_iter().flatten().chain(tail).collect();
    let mut out = fs::OpenOptions::new().read(true).append(true).open(path)?;
    out.set_len(0)?;
    during();
    // UNIT_BOUNDARY_DESCRIPTION: an append the VMM made to the emptied file is at its start, before the lines this puts back, so it is read here and put back after them.
    let mut fresh = Vec::new();
    out.seek(SeekFrom::Start(0))?;
    out.read_to_end(&mut fresh)?;
    out.set_len(0)?;
    // UNIT_BOUNDARY_DESCRIPTION: from here to the end the file is emptied and refilled, and an append the VMM makes in that window is at the start of it, ahead of the kept lines and behind them in time: the order of the two is not this function's to keep, and the reader tells the marks apart by the kernel's stamp (room_full). A line written between the read above and this emptying is lost, as one written at any point of the cut already is.
    during();
    out.write_all(&kept)?;
    out.write_all(&fresh)
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

    // TEST_SCENARIO: a full home inside a guest makes its agent exit as it starts, and platform-init marks that exit on the console. The runner names the home full only while the guest's last exit carries the mark, so a home freed since, whose entrypoint then exited for another reason, is not reported full; the hand-off line, which also names the entrypoint, is not an exit.
    #[test]
    fn a_full_home_is_read_from_the_last_exit_only() {
        let full = "[ 1.0] platform-init: handing off to the image entrypoint [/entry]\n[ 2.0] platform-init: the image entrypoint exited with status 1 after 1s; the agent's home is full\n[ 3.0] platform-init: starting the image entrypoint again in 1s\n[ 4.0] platform-init: handing off to the image entrypoint [/entry]";
        assert!(home_full(full));
        let freed = format!(
            "{full}\n[ 9.0] platform-init: the image entrypoint exited with status 2 after 30s"
        );
        assert!(!home_full(&freed));
        assert!(!home_full(
            "[ 1.0] platform-init: handing off to the image entrypoint [/entry]"
        ));
    }

    // TEST_SCENARIO: a disk with no space or inode left stops the boot before the entrypoint ever runs, and platform-init marks that refusal as a full home, so the runner reports it as one; a refusal for another reason is not.
    #[test]
    fn a_boot_refused_for_a_full_disk_is_a_full_home() {
        assert!(home_full("[ 1.0] platform-init: FATAL: creating /storage/.platform/rootfs/work: No space left on device (os error 28); the agent's home is full"));
        assert!(!home_full(
            "[ 1.0] platform-init: FATAL: reading the mount table: Permission denied (os error 13)"
        ));
    }

    // TEST_SCENARIO: a guest whose agent filled the disk keeps running, so platform-init marks it on the console instead of exiting: the last mark the guest made decides whether it has room, a guest that freed space since stops reading as full, one that may write a little more is not full either, and a text with no mark says nothing at all. Each mark carries the kernel's time, so the newest one decides even where a cut of the log left it ahead of an older one; a line with no time keeps the file's order. The kernel log is read from where the last read stopped, so a mark a minute old is found among the connections the VMM logs, and a line still being written waits for the next read.
    #[test]
    fn a_running_guests_room_is_read_from_the_last_mark() {
        let full = format!(
            "[ 9.1] platform-init: {}: this agent may write nothing more until space is freed",
            crate::guest::GUEST_FULL
        );
        let room = format!("[ 60.2] platform-init: {}", crate::guest::GUEST_ROOM);
        let nearly = format!(
            "[ 30.0] platform-init: {}: this agent may write 4096 more bytes",
            crate::guest::GUEST_NEARLY_FULL
        );
        let bare = format!("platform-init: {}", crate::guest::GUEST_ROOM);
        assert_eq!(room_full(&full), Some(true));
        assert_eq!(room_full(&format!("{full}\n{nearly}")), Some(false));
        assert_eq!(room_full(&format!("{full}\n{room}")), Some(false));
        assert_eq!(
            room_full(&format!("{room}\n{full}")),
            Some(false),
            "the later stamp decides, wherever the cut left the line"
        );
        assert_eq!(
            room_full(&format!("{bare}\n{full}")),
            Some(true),
            "a line with no stamp keeps the file's order"
        );
        assert_eq!(room_full(&format!("{full}\n{bare}")), Some(false));
        assert_eq!(
            room_full("[ 9.3] platform-init: FATAL: x; the agent's home is full"),
            None
        );
        assert!(
            !home_full(&full),
            "a running guest read as a boot that failed"
        );

        let dir = TempDir::new("kernel");
        let path = dir.path().join(VMM_LOG);
        fs::write(&path, format!("[ 1.0] init_or_kernel] boot\n{full}\n")).unwrap();
        let (at, text) = kernel_since(&path, 0);
        assert_eq!(room_full(&text), Some(true));
        fs::write(&path, format!("[ 2.0] init_or_kernel] more\n{room}\n")).unwrap();
        let (at2, text) = kernel_since(&path, at);
        assert_eq!(room_full(&text), Some(false));
        assert!(text.contains("more") && !text.contains("boot"));
        let (at3, text) = kernel_since(&path, at2);
        assert!(text.is_empty() && at3 == at2);
        assert_eq!(room_full(&kernel_since(&path, u64::MAX).1), Some(false));
    }

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

    // TEST_SCENARIO: smolvm's agent logs each accepted connection to the console, and enough of those lines are all a 4 KiB tail would hold. They say nothing about the guest, so the tail drops them and shows what the guest itself printed before them; the agent's other lines, which do say what it is doing, stay.
    #[test]
    fn accepted_connection_lines_do_not_crowd_the_guest_out_of_the_tail() {
        let dir = TempDir::new("console-accepted");
        let log = dir.path().join(CONSOLE_LOG);
        let accepted = "{\"timestamp\":\"t\",\"level\":\"INFO\",\"fields\":{\"message\":\"accepted connection\"},\"target\":\"smolvm_agent\"}\n";
        let flatten = "{\"timestamp\":\"t\",\"level\":\"INFO\",\"fields\":{\"message\":\"flattening local image archive\"},\"target\":\"smolvm_agent::storage\"}";
        let mut text = format!("kernel panic\n{flatten}\n");
        for _ in 0..200 {
            text.push_str(accepted);
        }
        fs::write(&log, &text).unwrap();
        assert_eq!(tail_of(&log, 4096), format!("kernel panic\n{flatten}"));
    }

    // TEST_SCENARIO: platform-init refused the boot, and said why as a kernel line. The guest kernel's console is not the console file, so its lines reach only the VMM's log, among the VMM's own lines. The tail finds the refusal there after hours of them, shows it first and without the VMM's own prefix, and then the guest agent's lines from the console file.
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

    // TEST_SCENARIO: a guest writing without end to its console, or opening connection after connection, grows two host files on the claim its siblings' disks are on. Each is cut back once it passes the cap, and what a status shows of the machine is the same after the cut as before it: the kernel's refusal from the start of the boot, and the last lines.
    #[test]
    fn a_log_over_its_cap_is_cut_back_to_what_a_status_reads() {
        let dir = TempDir::new("console-trim");
        let fatal = "[    0.4] platform-init: FATAL: refusing to boot";
        let mut vmm = format!("[t ERROR init_or_kernel] {fatal}\n");
        let mut console = String::new();
        for i in 0..20_000 {
            vmm.push_str("[t WARN  smolvm_network::stack] guest SYN to a denied address\n");
            console.push_str(&format!("guest line {i}\n"));
        }
        fs::write(dir.path().join(VMM_LOG), &vmm).unwrap();
        fs::write(dir.path().join(CONSOLE_LOG), &console).unwrap();
        let before = machine_tail(dir.path());

        assert!(
            trim_logs("m1", dir.path(), 64 * 1024),
            "a log over its cap is cut"
        );

        for name in [VMM_LOG, CONSOLE_LOG] {
            let size = fs::metadata(dir.path().join(name)).unwrap().len();
            assert!(
                size <= CONSOLE_TAIL_BYTES * 18,
                "{name} is still {size} bytes"
            );
        }
        assert_eq!(machine_tail(dir.path()), before);
        assert!(before.starts_with(fatal), "{before:?}");

        let small = fs::metadata(dir.path().join(CONSOLE_LOG)).unwrap().len();
        assert!(
            !trim_logs("m1", dir.path(), CONSOLE_TAIL_BYTES * 20),
            "logs under the cap are left alone"
        );
        assert_eq!(
            fs::metadata(dir.path().join(CONSOLE_LOG)).unwrap().len(),
            small,
            "a log under its cap is left alone"
        );
    }

    // TEST_SCENARIO: the VMM appends to a log while the runner cuts it, and what it writes while the log is emptied must not be lost by the emptying: platform-init marks the agent's room only when it changes, so a mark the cut dropped leaves the runner reading the mark before it for as long as the agent runs. What the VMM writes there is read back and put after the lines the cut kept.
    #[test]
    fn a_line_the_vmm_writes_while_the_log_is_emptied_is_kept() {
        let dir = TempDir::new("console-cut-race");
        let (path, size, room) = a_cut_log_a_mark_can_land_in(&dir);
        let mut calls = 0;
        trim_with(&path, size, &mut || {
            calls += 1;
            if calls == 1 {
                append(&path, &room);
            }
        })
        .unwrap();
        assert_eq!(calls, 2, "the VMM writes at both windows of a cut");
        let text = fs::read_to_string(&path).unwrap();
        assert!(
            text.contains(crate::guest::GUEST_ROOM),
            "the mark written during the cut was dropped: {text:.120}"
        );
        assert_eq!(room_full(&text), Some(false));
    }

    // TEST_SCENARIO: the window between reading that back and writing the kept lines is one where a mark lands ahead of them, so the file ends with a GUEST_FULL older than the GUEST_ROOM at its start. The guest announces a mark only when its room changes, so nothing corrects it: the runner reads the marks by the kernel's time, which puts the newer one first whatever the file's order, instead of calling a guest that has room full for as long as it runs.
    #[test]
    fn a_line_the_vmm_writes_behind_a_kept_mark_is_still_the_newest() {
        let dir = TempDir::new("console-cut-window");
        let (path, size, room) = a_cut_log_a_mark_can_land_in(&dir);
        let mut calls = 0;
        trim_with(&path, size, &mut || {
            calls += 1;
            if calls == 2 {
                append(&path, &room);
            }
        })
        .unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(
            text.find(crate::guest::GUEST_ROOM) < text.find(crate::guest::GUEST_FULL),
            "the mark did not land ahead of the kept lines: {text:.120}"
        );
        assert_eq!(
            room_full(&text),
            Some(false),
            "the newest mark was read as the oldest: {text:.120}"
        );
    }

    // TEST_SCENARIO: the log both cuts above are made on: a GUEST_FULL at its start, then lines enough for the cut to keep only the start of it.
    fn a_cut_log_a_mark_can_land_in(dir: &TempDir) -> (std::path::PathBuf, u64, String) {
        let path = dir.path().join(VMM_LOG);
        let full = format!(
            "[t ERROR init_or_kernel] [    9.1] platform-init: {}: this agent may write nothing more\n",
            crate::guest::GUEST_FULL
        );
        let room = format!(
            "[t ERROR init_or_kernel] [   60.2] platform-init: {}: the agent's writes are no longer held back\n",
            crate::guest::GUEST_ROOM
        );
        let mut vmm = full;
        for i in 0..20_000 {
            vmm.push_str(&format!("[t WARN  smolvm_network::stack] guest SYN {i}\n"));
        }
        fs::write(&path, &vmm).unwrap();
        let size = fs::metadata(&path).unwrap().len();
        (path, size, room)
    }

    fn append(path: &Path, line: &str) {
        fs::OpenOptions::new()
            .append(true)
            .open(path)
            .unwrap()
            .write_all(line.as_bytes())
            .unwrap();
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
