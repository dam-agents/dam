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

use crate::api::REASON_IMAGE_UNAVAILABLE;
use crate::cache::PULL_TIMEOUT;
use crate::fetch::{failure_reason, unusable, Refusal};
use crate::imagecache::{Fetched, ImageCache, Images, Lookup, Resolved};

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

async fn hold(State(cache): State<Arc<ImageCache>>, Json(ask): Json<HoldRequest>) -> StatusCode {
    cache.hold(&ask.digests);
    StatusCode::NO_CONTENT
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
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    axum::serve(listener, router(cache))
        .with_graceful_shutdown(shutdown)
        .await?;
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's side: one blocking request per connection, because every call is made from a machine's worker thread and one resolve can run as long as a fetch. A cache that cannot be reached is an image problem for the controller, and the lookup says it was unreachable so the runner can still boot a tree it already holds.
pub struct CacheClient {
    socket: PathBuf,
}

// UNIT_BOUNDARY_DESCRIPTION: how long a request may wait for its answer. A resolve can include a whole fetch, so it gets longer than one may run. A hold is answered at once, and it is made when the runner starts, so a service that has hung costs the runner seconds rather than a start that waits out a fetch.
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(PULL_TIMEOUT.as_secs() + 60);
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
    ) -> Result<(u16, Vec<u8>), std::io::Error> {
        let mut stream = UnixStream::connect(&self.socket)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(Duration::from_secs(30)))?;
        let head = format!(
            "POST {path} HTTP/1.1\r\nHost: image-cache\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes())?;
        stream.write_all(body)?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw)?;
        parse_response(&raw)
            .ok_or_else(|| std::io::Error::other("the image cache service sent no HTTP response"))
    }

    fn unreachable(&self, e: std::io::Error) -> Lookup {
        Lookup {
            resolved: Err(unusable(format!(
                "the node's image cache service at {} cannot be reached: {e}",
                self.socket.display()
            ))),
            fetched: None,
            unreachable: true,
        }
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
            Err(e) => return self.unreachable(std::io::Error::other(e)),
        };
        let (status, body) = match self.request(RESOLVE_PATH, &body, RESOLVE_TIMEOUT) {
            Ok(answer) => answer,
            Err(e) => return self.unreachable(e),
        };
        if status == 200 {
            return match serde_json::from_slice::<ResolveAnswer>(&body) {
                Ok(answer) => Lookup {
                    resolved: Ok(answer.resolved),
                    fetched: answer.fetched,
                    unreachable: false,
                },
                Err(e) => self.unreachable(std::io::Error::other(e)),
            };
        }
        let Ok(failure) = serde_json::from_slice::<ResolveFailure>(&body) else {
            return self.unreachable(std::io::Error::other(format!(
                "the image cache service answered {status}"
            )));
        };
        let error = if failure.reason == REASON_IMAGE_UNAVAILABLE {
            Refusal {
                reason: REASON_IMAGE_UNAVAILABLE,
                message: failure.message,
            }
            .into()
        } else {
            anyhow::anyhow!(failure.message)
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
        let (status, _) = self.request(HOLDS_PATH, &body, HOLD_TIMEOUT).map_err(|e| {
            anyhow::anyhow!(
                "the node's image cache service at {} cannot be reached: {e}",
                self.socket.display()
            )
        })?;
        anyhow::ensure!(
            (200..300).contains(&status),
            "the image cache service answered {status} to a hold"
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
