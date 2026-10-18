use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

// UNIT_BOUNDARY_DESCRIPTION: a fresh directory for one test, removed when the test ends. Tests run in parallel threads of one process, so the name carries the process id and a counter as well as the test's own label, and no two tests ever share one. The prefix is short because some tests put a Unix socket in the directory, and a socket path holds at most 104 bytes on macOS, where the temp directory alone takes about 50.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new(name: &str) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "vmr-{}-{}-{name}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a script another process execs, created by a child process so this one never holds a descriptor on the inode that is executed. Linux fails an exec with ETXTBSY while any process holds the file open for writing, and a fork on another test thread copies such a descriptor into a child that keeps it until it execs, so the body goes to a staged name nothing execs and `cp` writes the script itself.
pub(crate) fn exec_script(path: &Path, body: &str) {
    let staged = path.with_file_name(format!(".{}", path.file_name().unwrap().to_string_lossy()));
    fs::write(&staged, body).unwrap();
    let copied = std::process::Command::new("cp")
        .arg(&staged)
        .arg(path)
        .status()
        .unwrap();
    assert!(copied.success(), "cp {staged:?} into {path:?}: {copied}");
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    fs::remove_file(&staged).unwrap();
}

// UNIT_BOUNDARY_DESCRIPTION: the loopback ports a test's port block is drawn from: a published port, its neighbour, and the guest ports 1000 above them. The band lies below every platform's ephemeral range (Linux 32768, macOS 49152), because a port asked of the kernel is whichever one its allocator sits on next, and a base in the top 1000 of the range has no block at all: its guest ports would pass 65535. A retry loop there walks the allocator through that band, and every attempt fails. No block is drawn above PORT_BLOCK_TOP, so the guest ports of one block are never the published ports of another. A host that widens its ephemeral range over the band still finds blocks here, but its kernel can then hand a guest port to another socket; the band moves.
pub(crate) const PORT_BLOCK_BASE: u16 = 20000;
pub(crate) const PORT_BLOCK_TOP: u16 = 20900;

// UNIT_BOUNDARY_DESCRIPTION: a registry's blob endpoint on a loopback port, for the reads that size an image. Every request gets the response `respond` makes from its head: the request line and headers. The thread serves for as long as the test process lives.
pub(crate) fn http_stub(respond: impl Fn(&str) -> Vec<u8> + Send + 'static) -> u16 {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(&stream);
            let mut head = String::new();
            while reader.read_line(&mut head).is_ok_and(|n| n > 2) {}
            let _ = (&stream).write_all(&respond(&head));
        }
    });
    port
}

// UNIT_BOUNDARY_DESCRIPTION: the answer a registry that honours ranges gives for `blob`: the bytes the request's Range names, or the whole blob when it names none.
pub(crate) fn ranged(head: &str, blob: &[u8]) -> Vec<u8> {
    let range = head
        .lines()
        .find_map(|l| {
            l.to_ascii_lowercase()
                .strip_prefix("range: bytes=")
                .map(str::to_string)
        })
        .and_then(|r| {
            let (a, b) = r.trim().split_once('-')?;
            Some((a.parse::<usize>().ok()?, b.parse::<usize>().ok()?))
        });
    let (status, body) = match range {
        Some((a, b)) => ("206 Partial Content", &blob[a..=b]),
        None => ("200 OK", blob),
    };
    let mut out = format!(
        "HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}
