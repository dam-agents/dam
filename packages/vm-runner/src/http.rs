use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};

use crate::api::MachineSpec;
use crate::server::{Rejected, Server};

// UNIT_BOUNDARY_DESCRIPTION: the machine API as the controller's Go client reaches it: the routes, the bearer token, the status codes and the plain-text error bodies that client.go expects. Every handler hands its work to a blocking thread, because each one asks the runtime or the guest something that can take seconds.

#[derive(Clone)]
struct Api {
    server: Arc<Server>,
    token: Arc<str>,
}

pub fn router(server: Arc<Server>, token: &str) -> Router {
    let api = Api {
        server,
        token: Arc::from(token),
    };
    Router::new()
        .route("/healthz", get(|| async { StatusCode::OK }))
        .route("/machines", get(list))
        .route("/machines/{id}", get(status).put(ensure).delete(remove))
        .with_state(api)
}

// UNIT_BOUNDARY_DESCRIPTION: the scrape endpoint, served on its own port and without the machine API's token. The token is what lets a caller create and delete machines, and a scraper that held it could do both; what this serves names no machine, image or owner, so the NetworkPolicy that admits only the platform's collector to its port is the whole of its gate.
pub fn metrics_router(server: Arc<Server>) -> Router {
    Router::new().route(
        "/metrics",
        get(move || {
            let server = server.clone();
            async move {
                match tokio::task::spawn_blocking(move || server.metrics_text()).await {
                    Ok(text) => (
                        StatusCode::OK,
                        [("content-type", "text/plain; version=0.0.4; charset=utf-8")],
                        text,
                    )
                        .into_response(),
                    Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                }
            }
        }),
    )
}

// UNIT_BOUNDARY_DESCRIPTION: the error body the controller's client expects: the message and a newline as text/plain. The client puts this text, trimmed, into its error.
fn plain(status: StatusCode, message: &str) -> Response {
    (
        status,
        [("content-type", "text/plain; charset=utf-8")],
        format!("{message}\n"),
    )
        .into_response()
}

fn rejected(rejected: Rejected) -> Response {
    plain(
        StatusCode::from_u16(rejected.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        &rejected.message,
    )
}

// UNIT_BOUNDARY_DESCRIPTION: the controller is the runner's only caller, and a request without its token gets nothing, not even a status. The comparison takes the same time however much of the token matches.
fn authorized(api: &Api, headers: &HeaderMap) -> bool {
    let got = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let got = got.strip_prefix("Bearer ").unwrap_or(got);
    constant_time_eq(got.as_bytes(), api.token.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

fn unauthorized() -> Response {
    plain(StatusCode::UNAUTHORIZED, "unauthorized")
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Response> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| plain(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))
}

async fn list(State(api): State<Api>, headers: HeaderMap) -> Response {
    if !authorized(&api, &headers) {
        return unauthorized();
    }
    let server = api.server.clone();
    match blocking(move || server.list()).await {
        Ok(Ok(ids)) => Json(ids).into_response(),
        Ok(Err(e)) => plain(StatusCode::INTERNAL_SERVER_ERROR, &format!("{e:#}")),
        Err(response) => response,
    }
}

async fn status(State(api): State<Api>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    if !authorized(&api, &headers) {
        return unauthorized();
    }
    let server = api.server.clone();
    match blocking(move || server.get(&id)).await {
        Ok(Ok(status)) => Json(status).into_response(),
        Ok(Err(e)) => rejected(e),
        Err(response) => response,
    }
}

async fn ensure(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if !authorized(&api, &headers) {
        return unauthorized();
    }
    if !crate::state::is_machine_id(&id) {
        return plain(StatusCode::BAD_REQUEST, "invalid machine id");
    }
    let spec: MachineSpec = match serde_json::from_slice(&body) {
        Ok(spec) => spec,
        Err(e) => return plain(StatusCode::BAD_REQUEST, &e.to_string()),
    };
    let server = api.server.clone();
    match blocking(move || server.put(&id, spec)).await {
        Ok(Ok(status)) => Json(status).into_response(),
        Ok(Err(e)) => rejected(e),
        Err(response) => response,
    }
}

async fn remove(State(api): State<Api>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    if !authorized(&api, &headers) {
        return unauthorized();
    }
    let server = api.server.clone();
    match blocking(move || server.delete(&id)).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => rejected(e),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{MachineStatus, State, STATE_CREATING};
    use crate::runtime::{Machine, Runtime, Update};
    use crate::server::Config;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use std::path::PathBuf;
    use tower::ServiceExt;

    // UNIT_BOUNDARY_DESCRIPTION: a runtime that has no machines and accepts every call, for tests about the HTTP surface rather than about machines.
    struct Idle;

    impl Runtime for Idle {
        fn state(&self, _: &str) -> anyhow::Result<State> {
            Ok(State::Absent)
        }
        fn create(&self, _: &str, _: &Machine<'_>) -> anyhow::Result<()> {
            Ok(())
        }
        fn update(&self, _: &str, _: &Update<'_>) -> anyhow::Result<()> {
            Ok(())
        }
        fn start(&self, _: &str) -> anyhow::Result<()> {
            Ok(())
        }
        fn stop(&self, _: &str) -> anyhow::Result<()> {
            Ok(())
        }
        fn delete(&self, _: &str) -> anyhow::Result<()> {
            Ok(())
        }
    }

    struct Api(Router, PathBuf);

    impl Drop for Api {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.1);
        }
    }

    fn api(name: &str) -> Api {
        let dir =
            std::env::temp_dir().join(format!("vm-runner-http-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let server = Server::start(
            Config {
                state_dir: dir.join("machines"),
                image_dir: dir.join("images"),
                image_cache_socket: None,
                image_budget: 0,
                crane: String::new(),
                init: None,
                ports: 31000..=31099,
                memory_mib: 1 << 20,
                reserve_mib: 0,
                listen: Some(Arc::new(|_| std::net::TcpListener::bind("127.0.0.1:0"))),
            },
            Arc::new(Idle),
        )
        .unwrap();
        Api(router(server, "secret"), dir)
    }

    async fn call(
        api: &Api,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: &str,
    ) -> (StatusCode, String) {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let response = api
            .0
            .clone()
            .oneshot(request.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    const SPEC: &str =
        r#"{"image":"quay.io/x/vm:1","cpus":1,"memoryMiB":512,"storageGiB":1,"running":false}"#;

    // TEST_SCENARIO: the controller is the only caller. A request with no token or the wrong one gets 401 and nothing else, on every route but the pod's own health probe, which kubelet calls with no credentials.
    #[tokio::test(flavor = "multi_thread")]
    async fn only_the_controllers_token_is_answered() {
        let api = api("auth");
        assert_eq!(
            call(&api, "GET", "/healthz", None, "").await.0,
            StatusCode::OK
        );
        for (method, path) in [
            ("GET", "/machines"),
            ("GET", "/machines/m1"),
            ("PUT", "/machines/m1"),
            ("DELETE", "/machines/m1"),
        ] {
            assert_eq!(
                call(&api, method, path, None, SPEC).await,
                (StatusCode::UNAUTHORIZED, "unauthorized\n".to_string()),
                "{method} {path}"
            );
            assert_eq!(
                call(&api, method, path, Some("wrong"), SPEC).await.0,
                StatusCode::UNAUTHORIZED,
                "{method} {path}"
            );
        }
    }

    // TEST_SCENARIO: a machine id becomes a directory name, so one that could leave the state directory is refused with 400 before anything reads the disk, with the wording the controller has always surfaced for it.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_machine_id_that_could_escape_is_refused() {
        let api = api("guard");
        for method in ["GET", "PUT", "DELETE"] {
            assert_eq!(
                call(&api, method, "/machines/..", Some("secret"), SPEC).await,
                (StatusCode::BAD_REQUEST, "invalid machine id\n".to_string()),
                "{method}"
            );
        }
    }

    // TEST_SCENARIO: a body that is not a spec, or a running spec missing what a machine needs, is the caller's mistake and gets 400 with the reason, not a 500 or a machine created from zeroes.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_malformed_or_incomplete_spec_is_the_callers_mistake() {
        let api = api("body");
        assert_eq!(
            call(&api, "PUT", "/machines/m1", Some("secret"), "not json")
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        let (status, body) = call(
            &api,
            "PUT",
            "/machines/m1",
            Some("secret"),
            r#"{"image":"quay.io/x/vm:1","running":true}"#,
        )
        .await;
        assert_eq!(
            (status, body),
            (
                StatusCode::BAD_REQUEST,
                format!("{}\n", crate::plan::REQUIRED)
            )
        );
    }

    // TEST_SCENARIO: the round trip the controller makes: a PUT answers with the machine's status as JSON the Go client decodes, a GET reads it back, the list names the machine, and a DELETE answers 204 with no body.
    #[tokio::test(flavor = "multi_thread")]
    async fn the_controllers_round_trip_is_answered_in_its_shapes() {
        let api = api("round-trip");
        let running = SPEC.replace(r#""running":false"#, r#""running":true"#);
        let (status, body) = call(&api, "PUT", "/machines/m1", Some("secret"), &running).await;
        assert_eq!(status, StatusCode::OK);
        let answer: MachineStatus = serde_json::from_str(&body).unwrap();
        assert_eq!(answer.state, STATE_CREATING);

        let (status, body) = call(&api, "GET", "/machines/m1", Some("secret"), "").await;
        assert_eq!(status, StatusCode::OK);
        serde_json::from_str::<MachineStatus>(&body).unwrap();

        let (status, body) = call(&api, "GET", "/machines", Some("secret"), "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&body).unwrap(),
            vec!["m1"]
        );

        assert_eq!(
            call(&api, "DELETE", "/machines/m1", Some("secret"), "").await,
            (StatusCode::NO_CONTENT, String::new())
        );
        let (_, body) = call(&api, "GET", "/machines", Some("secret"), "").await;
        assert_eq!(
            body.trim(),
            "[]",
            "an empty list must be [] as the Go client decodes it, not null"
        );
    }

    // TEST_SCENARIO: the token comparison must not stop at the first differing byte, and must refuse a token that is a prefix of the real one — the two shortcuts a hand-written comparison takes.
    #[test]
    fn the_token_is_compared_whole() {
        assert!(constant_time_eq(b"secret", b"secret"));
        assert!(!constant_time_eq(b"secre", b"secret"));
        assert!(!constant_time_eq(b"secreT", b"secret"));
        assert!(!constant_time_eq(b"", b"secret"));
    }
}
