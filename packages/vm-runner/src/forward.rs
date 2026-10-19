use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::locked;

// UNIT_BOUNDARY_DESCRIPTION: publishes each machine's agent port on a port of the runner pod, which is what the agent's Service maps onto. smolvm publishes the guest's port on loopback only, at the machine's port plus LOOPBACK_OFFSET; this forwards the pod-facing port there. Who may dial it is for the runner's NetworkPolicy to decide. It also answers whether a guest is up, by asking its health endpoint on that loopback port.

// UNIT_BOUNDARY_DESCRIPTION: where smolvm publishes a machine's guest port, relative to the port the runner publishes it on. The pod-facing port is the one the Service reaches; the loopback one is never reachable from outside the pod.
pub const LOOPBACK_OFFSET: u16 = 1000;

pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(3);

// UNIT_BOUNDARY_DESCRIPTION: how much of a health reply the runner reads. The guest's /healthz reply is about 120 bytes. The whole reply is read to its end, so the runner closes a socket with nothing left unread: a close with unread bytes makes the kernel send a reset, and smolvm logs each reset it relays as a line on the guest's console. A reply longer than this is cut off and judged on its status line.
pub const HEALTH_REPLY_CAP: usize = 4096;

// UNIT_BOUNDARY_DESCRIPTION: how long a published port waits after a failed accept before it accepts again. The failures worth surviving, such as a pod out of file descriptors, pass once a connection closes, so the port keeps listening rather than dying with them, but it must not spin a worker thread while they last.
pub const ACCEPT_RETRY: Duration = Duration::from_millis(100);

// UNIT_BOUNDARY_DESCRIPTION: how a published port is bound. Tests hand over a listener they already hold, so the port is never unbound between a check that it is free and the runner taking it.
pub type Listen = dyn Fn(u16) -> std::io::Result<std::net::TcpListener> + Send + Sync;

pub struct Forwarder {
    runtime: tokio::runtime::Handle,
    listen: Option<Arc<Listen>>,
    published: Mutex<HashMap<String, CancellationToken>>,
}

impl Forwarder {
    pub fn new(runtime: tokio::runtime::Handle, listen: Option<Arc<Listen>>) -> Self {
        Self {
            runtime,
            listen,
            published: Mutex::new(HashMap::new()),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: publishes one machine's port, or does nothing when it is already published. Called on every ensure, because a runner that restarted has lost its listeners while its machines' ports are still on disk.
    pub fn publish(&self, id: &str, port: u16) -> anyhow::Result<()> {
        let mut published = locked(&self.published);
        if published.contains_key(id) {
            return Ok(());
        }
        let listener = self
            .bind(port)
            .map_err(|e| anyhow::anyhow!("publishing machine {id} on :{port}: {e}"))?;
        listener.set_nonblocking(true)?;
        let stop = CancellationToken::new();
        published.insert(id.to_string(), stop.clone());
        let guest = guest_address(port);
        self.runtime.spawn(async move {
            let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
                return;
            };
            loop {
                let accepted = tokio::select! {
                    _ = stop.cancelled() => return,
                    accepted = listener.accept() => accepted,
                };
                let Ok((mut conn, _)) = accepted else {
                    tokio::select! {
                        _ = stop.cancelled() => return,
                        _ = tokio::time::sleep(ACCEPT_RETRY) => continue,
                    }
                };
                tokio::spawn(async move {
                    let dial =
                        tokio::time::timeout(DIAL_TIMEOUT, tokio::net::TcpStream::connect(guest));
                    if let Ok(Ok(mut upstream)) = dial.await {
                        let _ = tokio::io::copy_bidirectional(&mut conn, &mut upstream).await;
                    }
                });
            }
        });
        Ok(())
    }

    // UNIT_BOUNDARY_DESCRIPTION: stops publishing one machine. Connections already open are left to finish; the port stops accepting new ones.
    pub fn unpublish(&self, id: &str) {
        let mut published = locked(&self.published);
        if let Some(stop) = published.remove(id) {
            stop.cancel();
        }
    }

    pub fn unpublish_all(&self) {
        let mut published = locked(&self.published);
        for (_, stop) in published.drain() {
            stop.cancel();
        }
    }

    #[cfg(test)]
    pub fn is_published(&self, id: &str) -> bool {
        locked(&self.published).contains_key(id)
    }

    fn bind(&self, port: u16) -> std::io::Result<std::net::TcpListener> {
        if let Some(listen) = &self.listen {
            return listen(port);
        }
        std::net::TcpListener::bind(("::", port))
            .or_else(|_| std::net::TcpListener::bind(("0.0.0.0", port)))
    }
}

fn guest_address(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port + LOOPBACK_OFFSET))
}

// UNIT_BOUNDARY_DESCRIPTION: whether the guest answers its health endpoint with a 200. Asked with a bare HTTP/1.1 request, bounded to HEALTH_TIMEOUT, on the loopback port smolvm publishes the guest on. Only the status line decides; the rest of the reply is read up to the guest's close, HEALTH_REPLY_CAP or the timeout, and a failure after the status line does not change the verdict.
pub fn healthy(port: u16) -> bool {
    if port == 0 {
        return false;
    }
    let Ok(mut stream) = TcpStream::connect_timeout(&guest_address(port), HEALTH_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(HEALTH_TIMEOUT));
    let _ = stream.set_write_timeout(Some(HEALTH_TIMEOUT));
    if stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    let mut reply = Vec::new();
    let mut chunk = [0u8; 512];
    while reply.len() < HEALTH_REPLY_CAP {
        let left = deadline.saturating_duration_since(Instant::now());
        let read = if left.is_zero() {
            Err(std::io::ErrorKind::TimedOut.into())
        } else {
            let _ = stream.set_read_timeout(Some(left));
            stream.read(&mut chunk)
        };
        match read {
            Ok(0) => break,
            Ok(n) => reply.extend_from_slice(&chunk[..n]),
            Err(_) if reply.contains(&b'\n') => break,
            Err(_) => return false,
        }
    }
    let status = reply.split(|&b| b == b'\n').next().unwrap_or_default();
    let line = String::from_utf8_lossy(status);
    let mut words = line.split_whitespace();
    matches!(words.next(), Some(v) if v.starts_with("HTTP/")) && words.next() == Some("200")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn guest(status: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let guest_port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for conn in listener.incoming().flatten().take(4) {
                let mut conn = conn;
                let mut buf = [0u8; 256];
                let _ = conn.read(&mut buf);
                let _ = conn.write_all(
                    format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\n\r\n").as_bytes(),
                );
            }
        });
        guest_port - LOOPBACK_OFFSET
    }

    // TEST_SCENARIO: a guest is up when its health endpoint answers 200, and not when it answers anything else or nothing listens. A machine with no port is never up.
    #[test]
    fn a_guest_is_up_only_when_its_health_endpoint_says_so() {
        assert!(healthy(guest("200 OK")));
        assert!(!healthy(guest("503 Service Unavailable")));
        assert!(!healthy(0));
    }

    // UNIT_BOUNDARY_DESCRIPTION: a guest whose reply is the given bytes, written at once and then held open for `hold`. Returns the port to probe and what the guest's socket read after the probe closed: Ok(0) for a clean close, an error for a reset.
    fn guest_replying(
        reply: Vec<u8>,
        hold: Duration,
    ) -> (u16, std::sync::mpsc::Receiver<std::io::Result<usize>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let guest_port = listener.local_addr().unwrap().port();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = [0u8; 256];
            let _ = conn.read(&mut buf);
            let _ = conn.set_write_timeout(Some(Duration::from_secs(5)));
            let _ = conn.write_all(&reply);
            std::thread::sleep(hold);
            let _ = conn.shutdown(std::net::Shutdown::Write);
            let _ = conn.set_read_timeout(Some(Duration::from_secs(5)));
            let _ = tx.send(conn.read(&mut buf));
        });
        (guest_port - LOOPBACK_OFFSET, rx)
    }

    // TEST_SCENARIO: the guest's /healthz reply is longer than the status line, and a probe that closed after the status line left the rest unread, so the kernel reset the connection and smolvm logged the reset on the guest's console every STEADY_PROBE. The probe reads the reply to the guest's close, so the guest sees a clean close, and the verdict still comes from the status line.
    #[test]
    fn a_probe_reads_the_whole_reply_so_the_guest_sees_a_clean_close() {
        let body = "x".repeat(100);
        let reply = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        assert!(reply.len() > 64);
        let (port, closed) = guest_replying(reply.into_bytes(), Duration::ZERO);
        assert!(healthy(port));
        assert_eq!(closed.recv().unwrap().unwrap(), 0);
    }

    // TEST_SCENARIO: a guest that keeps its socket open after a 200, or sends more than HEALTH_REPLY_CAP, must not hold the prober past HEALTH_TIMEOUT. The verdict is still the status line's, and a guest that sends nothing is not up.
    #[test]
    fn a_slow_or_oversized_reply_is_bounded_by_the_timeout_and_the_cap() {
        let slack = HEALTH_TIMEOUT + Duration::from_secs(1);
        for (reply, up) in [
            (b"HTTP/1.1 200 OK\r\n".to_vec(), true),
            (
                [b"HTTP/1.1 200 OK\r\n".as_slice(), &[b'x'; 1 << 20]].concat(),
                true,
            ),
            (Vec::new(), false),
        ] {
            let (port, _) = guest_replying(reply, Duration::from_secs(10));
            let started = Instant::now();
            assert_eq!(healthy(port), up);
            assert!(started.elapsed() < slack, "{:?}", started.elapsed());
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: a published port and a guest at that port plus the loopback offset, both bound on loopback. The pair is drawn from the same band as the server tests' blocks, for the same reason: an ephemeral base in the top 1000 of the range has no guest port to find, so a retry from there fails every time.
    fn pair() -> (TcpListener, TcpListener) {
        for base in crate::testdir::PORT_BLOCK_BASE..crate::testdir::PORT_BLOCK_TOP {
            let Ok(public) = TcpListener::bind(("127.0.0.1", base)) else {
                continue;
            };
            if let Ok(guest) = TcpListener::bind(("127.0.0.1", base + LOOPBACK_OFFSET)) {
                return (public, guest);
            }
        }
        panic!("no free port pair");
    }

    // TEST_SCENARIO: the published port forwards to the guest's loopback port, so what the guest writes arrives at the client unchanged. Once the machine is unpublished the port stops accepting.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_published_port_reaches_the_guest_until_it_is_unpublished() {
        let (public, upstream) = pair();
        let port = public.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut conn in upstream.incoming().flatten() {
                let _ = conn.write_all(b"hello");
            }
        });
        let handed = Mutex::new(Some(public));
        let forwarder = Forwarder::new(
            tokio::runtime::Handle::current(),
            Some(Arc::new(move |_| {
                handed
                    .lock()
                    .unwrap()
                    .take()
                    .ok_or_else(|| std::io::Error::other("the port was already handed over"))
            })),
        );
        forwarder.publish("m1", port).unwrap();
        forwarder.publish("m1", port).unwrap();

        let read = tokio::task::spawn_blocking(move || {
            let mut conn = TcpStream::connect(("127.0.0.1", port)).unwrap();
            let mut got = String::new();
            conn.read_to_string(&mut got).unwrap();
            got
        });
        assert_eq!(read.await.unwrap(), "hello");

        forwarder.unpublish("m1");
        assert!(!forwarder.is_published("m1"));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while TcpStream::connect(("127.0.0.1", port)).is_ok() {
            assert!(
                std::time::Instant::now() < deadline,
                "the port still accepts after unpublish"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    // TEST_SCENARIO: a machine's guest port is published on loopback at this offset when it is created, and forwarded to at the same offset for as long as it lives, so the offset and both timeouts are pinned; a longer health timeout makes every readiness poll wait on a guest that is not there.
    #[test]
    fn the_loopback_offset_and_timeouts_are_pinned() {
        assert_eq!(LOOPBACK_OFFSET, 1000);
        assert_eq!(HEALTH_TIMEOUT, Duration::from_secs(2));
        assert_eq!(DIAL_TIMEOUT, Duration::from_secs(3));
    }
}
