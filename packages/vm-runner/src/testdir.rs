use std::fs;
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
