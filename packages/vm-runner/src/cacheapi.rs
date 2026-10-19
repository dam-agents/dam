use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::api::{RunnerImageCache, REASON_IMAGE_UNAVAILABLE, REASON_OUT_OF_CAPACITY};
use crate::fetch::{cache_unreachable, failure_reason, Refusal};
use crate::imagecache::{Fetched, ImageCache, Images, Lookup, Resolved, RESOLVE_DEADLINE};

// UNIT_BOUNDARY_DESCRIPTION: the node image cache service's API, and the runner's client for it. It is HTTP/1.1 with JSON bodies over a Unix socket in the cache directory itself. The service mounts that directory read-write and each runner mounts it read-only, and a socket on a read-only mount can still be connected to but not replaced — so a runner reaches the service and cannot put a socket of its own in its place for other runners to reach.

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub reference: String,
    #[serde(default)]
    pub pull_auths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResolveAnswer {
    #[serde(flatten)]
    pub resolved: Resolved,
    #[serde(default)]
    pub fetched: Option<Fetched>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResolveFailure {
    pub reason: String,
    pub message: String,
    #[serde(default)]
    pub fetched: Option<Fetched>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HoldRequest {
    pub digests: BTreeSet<String>,
}

pub const RESOLVE_PATH: &str = "/images/resolve";
pub const HOLDS_PATH: &str = "/holds";

pub fn router(cache: Arc<ImageCache>) -> Router {
    Router::new()
        .route(RESOLVE_PATH, post(resolve))
        .route(HOLDS_PATH, post(hold))
        .with_state(cache)
}

async fn resolve(
    State(cache): State<Arc<ImageCache>>,
    Json(ask): Json<ResolveRequest>,
) -> Response {
    let answer = tokio::task::spawn_blocking(move || {
        Images::resolve(&*cache, &ask.reference, &ask.pull_auths)
    })
    .await;
    let Ok(lookup) = answer else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    match lookup.resolved {
        Ok(resolved) => Json(ResolveAnswer {
            resolved,
            fetched: lookup.fetched,
        })
        .into_response(),
        Err(e) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(ResolveFailure {
                reason: failure_reason(&e).to_string(),
                message: format!("{e:#}"),
                fetched: lookup.fetched,
            }),
        )
            .into_response(),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a hold takes the cache's memory lock, which an eviction or a fetch can hold for a moment, so it runs on a blocking thread and never parks one of the few threads that serve every runner's socket.
async fn hold(State(cache): State<Arc<ImageCache>>, Json(ask): Json<HoldRequest>) -> Response {
    match tokio::task::spawn_blocking(move || cache.hold(&ask.digests)).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => (StatusCode::BAD_REQUEST, format!("{e:#}")).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: serves the API on a socket at `path` until `shutdown` resolves. A socket file left by the previous process is removed first, since binding over it fails. The socket is 0600: runners run as root, and nothing else on the node has a reason to reach it.
pub async fn serve(
    path: &Path,
    cache: Arc<ImageCache>,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err(anyhow::anyhow!(
                "removing the stale socket {}: {e}",
                path.display()
            ))
        }
        _ => {}
    }
    let listener = tokio::net::UnixListener::bind(path)
        .map_err(|e| anyhow::anyhow!("binding {}: {e}", path.display()))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| anyhow::anyhow!("setting the mode of the socket {}: {e}", path.display()))?;
    axum::serve(listener, router(cache))
        .with_graceful_shutdown(shutdown)
        .await?;
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's side: one blocking request per connection, because every call is made from a machine's worker thread and one resolve can run as long as a fetch. A cache that cannot be reached is the node's problem rather than the image's, refused under the cache's own reason, and the lookup says it was unreachable so the runner can still boot a tree it already holds.
pub struct CacheClient {
    socket: PathBuf,
}

// UNIT_BOUNDARY_DESCRIPTION: a request's failure and whether the socket was connected before it. Only a connect that failed says nothing serves this node; everything after it is a service that took the request, which a fetch of one image can also cause, so the two are refused differently.
struct RequestError {
    error: std::io::Error,
    connected: bool,
}

// UNIT_BOUNDARY_DESCRIPTION: how long a request may wait for its answer. The service gives a whole resolve, fetch included, one deadline, and the client waits a minute past it, so a service that answers at its deadline is heard rather than cut off. A hold is answered at once, and it is made when the runner starts, so a service that has hung costs the runner seconds rather than a start that waits out a fetch.
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(RESOLVE_DEADLINE.as_secs() + 60);
pub const HOLD_TIMEOUT: Duration = Duration::from_secs(10);

impl CacheClient {
    pub fn new(socket: PathBuf) -> Self {
        Self { socket }
    }

    fn request(
        &self,
        path: &str,
        body: &[u8],
        timeout: Duration,
    ) -> Result<(u16, Vec<u8>), RequestError> {
        let after = |error: std::io::Error| RequestError {
            error,
            connected: true,
        };
        let mut stream = UnixStream::connect(&self.socket).map_err(|error| RequestError {
            error,
            connected: false,
        })?;
        stream.set_read_timeout(Some(timeout)).map_err(after)?;
        stream
            .set_write_timeout(Some(Duration::from_secs(30)))
            .map_err(after)?;
        let head = format!(
            "POST {path} HTTP/1.1\r\nHost: image-cache\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).map_err(after)?;
        stream.write_all(body).map_err(after)?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).map_err(after)?;
        parse_response(&raw).ok_or_else(|| RequestError {
            error: std::io::Error::other("the image cache service sent no HTTP response"),
            connected: true,
        })
    }

    fn unreachable_message(&self, e: &std::io::Error) -> String {
        format!(
            "the node's image cache service at {} cannot be reached: {e}; this runner mounts the node's image cache directory there read-only, so either no service serves this node or the service writes a different node directory than the one this runner mounts",
            self.socket.display()
        )
    }

    // UNIT_BOUNDARY_DESCRIPTION: the socket was never connected, so nothing serves this node's cache: the node's fault rather than the image's, refused under the cache's own reason and said to be unreachable, which lets the runner boot a tree it already holds.
    fn unreachable(&self, e: &std::io::Error) -> Lookup {
        Lookup {
            resolved: Err(cache_unreachable(self.unreachable_message(e))),
            fetched: None,
            unreachable: true,
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the service took the request and then failed — did not answer in time, closed the connection, answered nothing readable, or answered something this client cannot read. The image is what a resolve was asked about, so a fetch of an image that kills or wedges the service looks exactly like this, and it is refused as an image the cache cannot serve: the image update job then bounds it and moves an Agent back, where a node-fault reason would hold the move forever. The service is said to have taken the request, so an operator does not read it as a socket nobody serves.
    fn served(&self, detail: impl std::fmt::Display) -> Lookup {
        Lookup::failed(
            Refusal {
                reason: REASON_IMAGE_UNAVAILABLE,
                message: format!(
                    "the node's image cache service at {} took the request and then failed: {detail}; a fetch of this image that wedges or kills the service reads the same way",
                    self.socket.display()
                ),
            }
            .into(),
        )
    }
}

// UNIT_BOUNDARY_DESCRIPTION: status code and body of a response read to its end. The request asked the server to close, so the body is everything after the head; a chunked body is decoded because the server is free to send one.
fn parse_response(raw: &[u8]) -> Option<(u16, Vec<u8>)> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..split]).ok()?;
    let mut lines = head.split("\r\n");
    let status: u16 = lines.next()?.split_whitespace().nth(1)?.parse().ok()?;
    let chunked = lines.any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.trim().eq_ignore_ascii_case("transfer-encoding")
                && value.trim().eq_ignore_ascii_case("chunked")
        })
    });
    let body = &raw[split + 4..];
    if !chunked {
        return Some((status, body.to_vec()));
    }
    let mut decoded = Vec::new();
    let mut rest = body;
    loop {
        let end = rest.windows(2).position(|w| w == b"\r\n")?;
        let size =
            usize::from_str_radix(std::str::from_utf8(&rest[..end]).ok()?.trim(), 16).ok()?;
        rest = &rest[end + 2..];
        if size == 0 {
            return Some((status, decoded));
        }
        decoded.extend_from_slice(rest.get(..size)?);
        rest = rest.get(size + 2..)?;
    }
}

impl Images for CacheClient {
    fn resolve(&self, reference: &str, auths: &[String]) -> Lookup {
        let body = match serde_json::to_vec(&ResolveRequest {
            reference: reference.to_string(),
            pull_auths: auths.to_vec(),
        }) {
            Ok(body) => body,
            Err(e) => return self.served(e),
        };
        let (status, body) = match self.request(RESOLVE_PATH, &body, RESOLVE_TIMEOUT) {
            Ok(answer) => answer,
            Err(e) if !e.connected => return self.unreachable(&e.error),
            Err(e) => return self.served(e.error),
        };
        if status == 200 {
            return match serde_json::from_slice::<ResolveAnswer>(&body) {
                Ok(answer) => Lookup {
                    resolved: Ok(answer.resolved),
                    fetched: answer.fetched,
                    unreachable: false,
                },
                Err(e) => self.served(e),
            };
        }
        let Ok(failure) = serde_json::from_slice::<ResolveFailure>(&body) else {
            return self.served(format!(
                "it answered {status} with no reason this client reads"
            ));
        };
        let error = match [REASON_IMAGE_UNAVAILABLE, REASON_OUT_OF_CAPACITY]
            .into_iter()
            .find(|reason| *reason == failure.reason)
        {
            Some(reason) => Refusal {
                reason,
                message: failure.message,
            }
            .into(),
            None => anyhow::anyhow!(failure.message),
        };
        Lookup {
            resolved: Err(error),
            fetched: failure.fetched,
            unreachable: false,
        }
    }

    fn hold(&self, digests: &BTreeSet<String>) -> anyhow::Result<()> {
        let body = serde_json::to_vec(&HoldRequest {
            digests: digests.clone(),
        })?;
        let (status, _) = self
            .request(HOLDS_PATH, &body, HOLD_TIMEOUT)
            .map_err(|e| anyhow::anyhow!(self.unreachable_message(&e.error)))?;
        anyhow::ensure!(
            (200..300).contains(&status),
            "the image cache service answered {status} to a hold"
        );
        Ok(())
    }

    // UNIT_BOUNDARY_DESCRIPTION: one connect, no request: the question is whether anything serves the socket this runner's own mount holds. A connection is closed at once, and the service sees it as a caller that said nothing.
    fn reach(&self) -> RunnerImageCache {
        let socket = self.socket.display().to_string();
        match UnixStream::connect(&self.socket) {
            Ok(_) => RunnerImageCache {
                socket,
                error: String::new(),
            },
            Err(e) => RunnerImageCache {
                socket,
                error: self.unreachable_message(&e),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::REASON_CACHE_UNREACHABLE;

    // TEST_SCENARIO: the client reads the answer to its own request by hand, so both body framings a server may use must read as the same body, and a reply that is not HTTP must read as nothing rather than as some status.
    #[test]
    fn a_response_reads_the_same_however_its_body_is_framed() {
        let plain = b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}";
        assert_eq!(parse_response(plain), Some((200, b"{}".to_vec())));
        let chunked =
            b"HTTP/1.1 422 Unprocessable Entity\r\nTransfer-Encoding: chunked\r\n\r\n1\r\n{\r\n1\r\n}\r\n0\r\n\r\n";
        assert_eq!(parse_response(chunked), Some((422, b"{}".to_vec())));
        assert_eq!(parse_response(b"garbage"), None);
    }

    // TEST_SCENARIO: a socket nobody serves is the node's fault and lets the runner boot a tree it holds, while a service that took the request and then failed is refused as an image the cache cannot serve, since a fetch of one image can wedge or kill the service too. Both name the socket and the mount that carried it, so an operator looking at a "connection refused" finds the directory this runner mounted beside it.
    #[test]
    fn an_unreachable_socket_is_told_apart_from_a_service_that_failed() {
        assert!(RESOLVE_TIMEOUT > RESOLVE_DEADLINE);
        let client = CacheClient::new(PathBuf::from("/nonexistent/.cache.sock"));
        let lost = client.unreachable(&std::io::ErrorKind::ConnectionRefused.into());
        assert!(lost.unreachable);
        let lost = lost.resolved.err().unwrap();
        assert_eq!(failure_reason(&lost), REASON_CACHE_UNREACHABLE);
        assert!(
            lost.to_string()
                .contains("/nonexistent/.cache.sock cannot be reached"),
            "{lost}"
        );
        assert!(lost.to_string().contains("read-only"), "{lost}");
        let slow = client.served("it did not answer within 400s");
        assert!(!slow.unreachable);
        let slow = slow.resolved.err().unwrap();
        assert_eq!(failure_reason(&slow), REASON_IMAGE_UNAVAILABLE);
        assert!(slow.to_string().contains("took the request"), "{slow}");
        assert!(
            slow.to_string().contains("did not answer within 400s"),
            "{slow}"
        );
        let reach = client.reach();
        assert_eq!(reach.socket, "/nonexistent/.cache.sock");
        assert!(
            reach
                .error
                .contains("/nonexistent/.cache.sock cannot be reached"),
            "{reach:?}"
        );
        assert!(reach.error.contains("read-only"), "{reach:?}");
    }
}
