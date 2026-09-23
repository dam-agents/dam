use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ipnet::IpNet;
use tokio_util::sync::CancellationToken;

// UNIT_BOUNDARY_DESCRIPTION: publishes each machine's agent port on a port of the runner pod, which is what the agent's Service maps onto. smolvm publishes the guest's port on loopback only, at the machine's port plus LOOPBACK_OFFSET; this forwards the pod-facing port there, admitting only the sources the install names. It also answers whether a guest is up, by asking its health endpoint on that loopback port.

// UNIT_BOUNDARY_DESCRIPTION: where smolvm publishes a machine's guest port, relative to the port the runner publishes it on. The pod-facing port is the one the Service reaches; the loopback one is never reachable from outside the pod.
pub const LOOPBACK_OFFSET: u16 = 1000;

pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(3);

// UNIT_BOUNDARY_DESCRIPTION: how long a published port waits after a failed accept before it accepts again. The failures worth surviving, such as a pod out of file descriptors, pass once a connection closes, so the port keeps listening rather than dying with them, but it must not spin a worker thread while they last.
pub const ACCEPT_RETRY: Duration = Duration::from_millis(100);

// UNIT_BOUNDARY_DESCRIPTION: how a published port is bound. Tests hand over a listener they already hold, so the port is never unbound between a check that it is free and the runner taking it.
pub type Listen = dyn Fn(u16) -> std::io::Result<std::net::TcpListener> + Send + Sync;

pub struct Forwarder {
    runtime: tokio::runtime::Handle,
    allow_from: Arc<Vec<IpNet>>,
    listen: Option<Arc<Listen>>,
    published: Mutex<HashMap<String, CancellationToken>>,
}

impl Forwarder {
    pub fn new(
        runtime: tokio::runtime::Handle,
        allow_from: Vec<IpNet>,
        listen: Option<Arc<Listen>>,
    ) -> Self {
        Self {
            runtime,
            allow_from: Arc::new(allow_from),
            listen,
            published: Mutex::new(HashMap::new()),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: publishes one machine's port, or does nothing when it is already published. Called on every ensure, because a runner that restarted has lost its listeners while its machines' ports are still on disk.
    pub fn publish(&self, id: &str, port: u16) -> anyhow::Result<()> {
        let mut published = self.published.lock().unwrap_or_else(|e| e.into_inner());
        if published.contains_key(id) {
            return Ok(());
        }
        let listener = self
            .bind(port)
            .map_err(|e| anyhow::anyhow!("publishing machine {id} on :{port}: {e}"))?;
        listener.set_nonblocking(true)?;
        let stop = CancellationToken::new();
        published.insert(id.to_string(), stop.clone());
        let allow_from = self.allow_from.clone();
        let guest = SocketAddr::from(([127, 0, 0, 1], port + LOOPBACK_OFFSET));
        self.runtime.spawn(async move {
            let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
                return;
            };
            loop {
                let accepted = tokio::select! {
                    _ = stop.cancelled() => return,
                    accepted = listener.accept() => accepted,
                };
                let Ok((mut conn, from)) = accepted else {
                    tokio::select! {
                        _ = stop.cancelled() => return,
                        _ = tokio::time::sleep(ACCEPT_RETRY) => continue,
                    }
                };
                if !allowed(&allow_from, from.ip()) {
                    continue;
                }
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
        let mut published = self.published.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(stop) = published.remove(id) {
            stop.cancel();
        }
    }

    pub fn unpublish_all(&self) {
        let mut published = self.published.lock().unwrap_or_else(|e| e.into_inner());
        for (_, stop) in published.drain() {
            stop.cancel();
        }
    }

    pub fn is_published(&self, id: &str) -> bool {
        self.published
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(id)
    }

    fn bind(&self, port: u16) -> std::io::Result<std::net::TcpListener> {
        if let Some(listen) = &self.listen {
            return listen(port);
        }
        std::net::TcpListener::bind(("::", port))
            .or_else(|_| std::net::TcpListener::bind(("0.0.0.0", port)))
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether a source may reach a published port. An empty list admits everyone, leaving the runner's NetworkPolicy as the only gate. An IPv4 address that arrives mapped into IPv6, as it does on a dual-stack listener, is matched as the IPv4 address it is.
pub fn allowed(allow_from: &[IpNet], from: IpAddr) -> bool {
    if allow_from.is_empty() {
        return true;
    }
    let from = from.to_canonical();
    allow_from.iter().any(|net| net.contains(&from))
}

// UNIT_BOUNDARY_DESCRIPTION: whether the guest answers its health endpoint with a 200. Asked with a bare HTTP/1.1 request, bounded to HEALTH_TIMEOUT, on the loopback port smolvm publishes the guest on.
pub fn healthy(port: u16) -> bool {
    if port == 0 {
        return false;
    }
    let address = SocketAddr::from(([127, 0, 0, 1], port + LOOPBACK_OFFSET));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, HEALTH_TIMEOUT) else {
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
    let mut head = [0u8; 64];
    let mut read = 0;
    while read < head.len() {
        match stream.read(&mut head[read..]) {
            Ok(0) => break,
            Ok(n) => {
                read += n;
                if head[..read].contains(&b'\n') {
                    break;
                }
            }
            Err(_) => return false,
        }
    }
    let line = String::from_utf8_lossy(&head[..read]);
    let mut words = line.split_whitespace();
    matches!(words.next(), Some(v) if v.starts_with("HTTP/")) && words.next() == Some("200")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;
    use std::net::TcpListener;

    // TEST_SCENARIO: the allowlist is the runner's own check on a published port, on top of the NetworkPolicy. A source outside it is refused, one inside it is admitted, an IPv4 source arriving as a mapped IPv6 address is judged as IPv4, and an empty list admits everyone.
    #[test]
    fn a_published_port_admits_only_the_sources_it_was_told_to() {
        let nets: Vec<IpNet> = vec!["10.0.0.0/8".parse().unwrap()];
        assert!(allowed(&nets, "10.1.2.3".parse().unwrap()));
        assert!(!allowed(&nets, "192.168.0.1".parse().unwrap()));
        assert!(allowed(&nets, "::ffff:10.1.2.3".parse().unwrap()));
        assert!(allowed(&[], "192.168.0.1".parse().unwrap()));
    }

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

    // UNIT_BOUNDARY_DESCRIPTION: a published port and a guest at that port plus the loopback offset, both bound on loopback. The pair is retried on a fresh port when the guest's port is taken, since only the first of the two can be asked of the kernel as any free port.
    fn pair() -> (TcpListener, TcpListener) {
        for _ in 0..50 {
            let public = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = public.local_addr().unwrap().port();
            if port > u16::MAX - LOOPBACK_OFFSET {
                continue;
            }
            if let Ok(guest) = TcpListener::bind(("127.0.0.1", port + LOOPBACK_OFFSET)) {
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
            Vec::new(),
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

    // TEST_SCENARIO: a source outside the allowlist gets its connection closed without the guest ever being dialled.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_refused_source_never_reaches_the_guest() {
        let (public, upstream) = pair();
        let port = public.local_addr().unwrap().port();
        upstream.set_nonblocking(true).unwrap();
        let handed = Mutex::new(Some(public));
        let forwarder = Forwarder::new(
            tokio::runtime::Handle::current(),
            vec!["192.0.2.0/24".parse().unwrap()],
            Some(Arc::new(move |_| {
                handed
                    .lock()
                    .unwrap()
                    .take()
                    .ok_or_else(|| std::io::Error::other("the port was already handed over"))
            })),
        );
        forwarder.publish("m1", port).unwrap();
        let read = tokio::task::spawn_blocking(move || {
            let mut conn = TcpStream::connect(("127.0.0.1", port)).unwrap();
            let mut got = Vec::new();
            let _ = conn.read_to_end(&mut got);
            got
        });
        assert!(read.await.unwrap().is_empty());
        assert!(
            upstream.accept().is_err(),
            "the guest was dialled for a refused source"
        );
        forwarder.unpublish_all();
    }

    // TEST_SCENARIO: the loopback offset and both timeouts are the Go runner's. During a cutover the controller reads machines published by either runner, so a different offset would forward one runner's published port to nothing.
    #[test]
    fn the_go_runner_forwards_the_same_way() {
        let go = gosource::read("server.go");
        assert_eq!(
            gosource::int_value(&go, "loopbackOffset"),
            Some(u64::from(LOOPBACK_OFFSET))
        );
        let healthy = gosource::function_body(&go, "(s *Server) healthy").unwrap();
        assert!(healthy.contains("2 * time.Second") && healthy.contains("/healthz"));
        let forward = gosource::function_body(&go, "(s *Server) forward").unwrap();
        assert!(forward.contains("3*time.Second"));
    }
}
