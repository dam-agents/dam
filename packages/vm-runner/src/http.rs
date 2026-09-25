use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::rejection::QueryRejection;
use axum::extract::{DefaultBodyLimit, Extension, Path, Query, Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use http_body_util::BodyExt;

use serde::Deserialize;

use crate::api::MachineSpec;
use crate::capability;
use crate::server::{Rejected, Server};

// UNIT_BOUNDARY_DESCRIPTION: the machine API as the controller's Go client reaches it: the routes, the bearer token, the status codes and the plain-text error bodies that client.go expects. Every handler hands its work to a blocking thread, because each one asks the runtime or the guest something that can take seconds.

pub fn router(server: Arc<Server>, token: Arc<Token>) -> Router {
    let machines = Router::new()
        .route("/machines", get(list))
        .route("/machines/{id}", get(status).put(ensure).delete(remove))
        .route(
            "/machines/{id}/seed",
            put(seed).delete(unseed).layer(DefaultBodyLimit::disable()),
        )
        .route_layer(middleware::from_fn_with_state(token, authorized))
        .with_state(server);
    Router::new()
        .route("/healthz", get(|| async { StatusCode::OK }))
        .merge(machines)
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

// UNIT_BOUNDARY_DESCRIPTION: how often the token file is read again. The kubelet rewrites a projected Secret in place within about a minute of a change, so a token the controller replaced is honoured without restarting the pod, and every machine with it.
pub const TOKEN_RELOAD: Duration = Duration::from_secs(10);

// UNIT_BOUNDARY_DESCRIPTION: the machine API's bearer token, as the runner's credentials volume holds it now. The file is read at start, where a missing or empty token is fatal, and again every TOKEN_RELOAD; a read that fails or finds the file empty keeps the token already held, because the kubelet swaps a projected volume's files through a symlink and a read can land between two of its steps.
pub struct Token {
    path: Option<PathBuf>,
    current: RwLock<Arc<str>>,
}

impl Token {
    pub fn fixed(token: &str) -> Arc<Self> {
        Arc::new(Self {
            path: None,
            current: RwLock::new(Arc::from(token)),
        })
    }

    pub fn from_file(path: PathBuf) -> anyhow::Result<Arc<Self>> {
        let token = read_token(&path)?;
        Ok(Arc::new(Self {
            path: Some(path),
            current: RwLock::new(Arc::from(token)),
        }))
    }

    pub fn reload(&self) {
        let Some(path) = &self.path else {
            return;
        };
        match read_token(path) {
            Ok(token) => {
                let mut current = self.current.write().unwrap_or_else(|e| e.into_inner());
                if *current.as_ref() != token {
                    *current = Arc::from(token);
                    tracing::info!(path = %path.display(), "the machine API token changed, the new one is in use");
                }
            }
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "the token file could not be read again, the token held is kept")
            }
        }
    }

    pub fn keep_fresh(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(TOKEN_RELOAD);
            tick.tick().await;
            loop {
                tick.tick().await;
                self.reload();
            }
        });
    }

    fn matches(&self, got: &[u8]) -> bool {
        let current = self
            .current
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        constant_time_eq(got, current.as_bytes())
    }

    // UNIT_BOUNDARY_DESCRIPTION: the key seed capabilities are checked with, derived from the token held now. A token the controller replaced therefore voids every capability minted under the old one, and the controller mints the next from the new.
    fn seed_key(&self) -> [u8; 32] {
        let current = self
            .current
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        capability::derive_key(current.as_bytes())
    }
}

fn read_token(path: &std::path::Path) -> anyhow::Result<String> {
    let token = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("reading {}: {e}", path.display()))?;
    let token = token.trim();
    anyhow::ensure!(
        !token.is_empty(),
        "the token file {} is empty",
        path.display()
    );
    Ok(token.to_string())
}

// UNIT_BOUNDARY_DESCRIPTION: who a request was let in as. The owner's token opens every route; a seed capability opens only the seed upload of the machine it names, and the upload is told which one it carries, since what a capability may seed is narrower still.
#[derive(Debug, Clone)]
pub enum Authority {
    Token,
    Capability(capability::Verified),
}

// UNIT_BOUNDARY_DESCRIPTION: the controller is the runner's only caller with its token, and a request without it gets nothing, not even a status. The one exception is a runtime migration's copy Job, which carries a seed capability instead and is let in to `PUT /machines/{id}/seed` alone, for the machine the capability names and before it expires. The token comparison takes the same time however much of the token matches.
async fn authorized(State(token): State<Arc<Token>>, mut request: Request, next: Next) -> Response {
    let got = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let got = got.strip_prefix("Bearer ").unwrap_or(got).to_string();
    if token.matches(got.as_bytes()) {
        request.extensions_mut().insert(Authority::Token);
        return next.run(request).await;
    }
    let Some(machine) = seed_upload_of(&request).filter(|_| capability::looks_like(&got)) else {
        return plain(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    match capability::verify(&token.seed_key(), &got, &machine, unix_now()) {
        Ok(verified) => {
            request
                .extensions_mut()
                .insert(Authority::Capability(verified));
            next.run(request).await
        }
        Err(refusal) => {
            tracing::warn!(
                target: "security",
                event = "seed.deny",
                machine = %machine,
                capability = %capability::fingerprint(&got),
                reason = ?refusal,
                "a seed capability was refused"
            );
            match refusal {
                capability::Refusal::Expired => {
                    plain(StatusCode::UNAUTHORIZED, "the seed capability has expired")
                }
                capability::Refusal::Invalid => plain(StatusCode::UNAUTHORIZED, "unauthorized"),
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the machine a request uploads a seed to, or nothing for every other route. The id is not checked here: the handler refuses an invalid one, and a capability signed for a name that is not a machine id matches no machine.
fn seed_upload_of(request: &Request) -> Option<String> {
    if request.method() != axum::http::Method::PUT {
        return None;
    }
    let id = request
        .uri()
        .path()
        .strip_prefix("/machines/")?
        .strip_suffix("/seed")?;
    (!id.is_empty() && !id.contains('/')).then(|| id.to_string())
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

async fn blocking(work: impl FnOnce() -> Response + Send + 'static) -> Response {
    tokio::task::spawn_blocking(work)
        .await
        .unwrap_or_else(|e| plain(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))
}

async fn list(State(server): State<Arc<Server>>) -> Response {
    blocking(move || match server.list() {
        Ok(ids) => Json(ids).into_response(),
        Err(e) => plain(StatusCode::INTERNAL_SERVER_ERROR, &format!("{e:#}")),
    })
    .await
}

// UNIT_BOUNDARY_DESCRIPTION: a status read that names `wait`, in seconds, and the `since` version the caller last saw waits until the machine's status version differs from it, or until the wait ends. Without `wait` it answers at once.
#[derive(Default, Deserialize)]
#[serde(default)]
struct StatusWait {
    wait: u64,
    since: u64,
}

async fn status(
    State(server): State<Arc<Server>>,
    Path(id): Path<String>,
    query: Result<Query<StatusWait>, QueryRejection>,
) -> Response {
    let Ok(Query(asked)) = query else {
        return plain(StatusCode::BAD_REQUEST, "invalid wait or since");
    };
    blocking(move || {
        let read = match asked.wait {
            0 => server.get(&id),
            wait => server.wait(&id, asked.since, Duration::from_secs(wait)),
        };
        match read {
            Ok(status) => Json(status).into_response(),
            Err(e) => rejected(e),
        }
    })
    .await
}

async fn ensure(
    State(server): State<Arc<Server>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if !crate::state::is_machine_id(&id) {
        return plain(StatusCode::BAD_REQUEST, "invalid machine id");
    }
    let spec: MachineSpec = match serde_json::from_slice(&body) {
        Ok(spec) => spec,
        Err(e) => return plain(StatusCode::BAD_REQUEST, &e.to_string()),
    };
    blocking(move || match server.put(&id, spec) {
        Ok(status) => Json(status).into_response(),
        Err(e) => rejected(e),
    })
    .await
}

async fn remove(State(server): State<Arc<Server>>, Path(id): Path<String>) -> Response {
    blocking(move || match server.delete(&id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => rejected(e),
    })
    .await
}

// UNIT_BOUNDARY_DESCRIPTION: how many body chunks may wait between the connection and the thread writing the seed. The body is streamed and never held whole, because a seed is an agent's whole home and can be many GiB; this bound is what makes a slow disk slow the uploader down instead of filling the runner's memory.
const SEED_CHUNKS: usize = 16;

// UNIT_BOUNDARY_DESCRIPTION: stores the tar of a migrated agent's old home in its machine's share, for platform-init to seed the home from on the first boot. The body goes chunk by chunk to a blocking thread that writes and hashes it, and the seed is committed only once the whole body arrived and every byte is on the disk. Any failure — the body refused as too large, the connection cut, the disk full — drops the upload, which removes what was staged. A seed refused as too large is answered before the body is read to its end.
async fn seed(
    State(server): State<Arc<Server>>,
    Path(id): Path<String>,
    Extension(authority): Extension<Authority>,
    body: Body,
) -> Response {
    receive_seed(server, id, authority, body, SEED_IDLE).await
}

// UNIT_BOUNDARY_DESCRIPTION: how long a seed upload may send nothing before it is dropped. The upload holds the machine's seed claim, and no worker starts the machine while it does, so an uploader that stalls without closing its connection would otherwise keep the machine down for as long as the connection lasts. The uploader sends at least every few seconds while it makes progress.
const SEED_IDLE: Duration = Duration::from_secs(300);

async fn receive_seed(
    server: Arc<Server>,
    id: String,
    authority: Authority,
    body: Body,
    idle: Duration,
) -> Response {
    if !crate::state::is_machine_id(&id) {
        return plain(StatusCode::BAD_REQUEST, "invalid machine id");
    }
    let capability = match authority {
        Authority::Token => None,
        Authority::Capability(verified) => Some(verified),
    };
    let claimed = tokio::task::spawn_blocking(move || server.claim_seed(&id, capability)).await;
    let mut seeding = match claimed {
        Ok(Ok(seeding)) => seeding,
        Ok(Err(e)) => return rejected(e),
        Err(e) => return plain(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let (chunks, mut received) = tokio::sync::mpsc::channel::<Bytes>(SEED_CHUNKS);
    let writer = tokio::task::spawn_blocking(move || {
        while let Some(chunk) = received.blocking_recv() {
            seeding.write(&chunk)?;
        }
        Ok(seeding)
    });
    let mut body = body;
    let read = loop {
        let Ok(frame) = tokio::time::timeout(idle, body.frame()).await else {
            break Err(format!(
                "the seed upload sent nothing for {}s and was dropped",
                idle.as_secs()
            ));
        };
        match frame {
            None => break Ok(()),
            Some(Err(e)) => break Err(format!("reading the seed: {e}")),
            Some(Ok(frame)) => {
                let Ok(data) = frame.into_data() else {
                    continue;
                };
                if chunks.send(data).await.is_err() {
                    break Ok(());
                }
            }
        }
    };
    drop(chunks);
    let seeding = match writer.await {
        Ok(Ok(seeding)) => seeding,
        Ok(Err(e)) => return rejected(e),
        Err(e) => return plain(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if let Err(message) = read {
        let _ = tokio::task::spawn_blocking(move || drop(seeding)).await;
        return plain(StatusCode::BAD_REQUEST, &message);
    }
    blocking(move || match seeding.commit() {
        Ok(result) => Json(result).into_response(),
        Err(e) => rejected(e),
    })
    .await
}

async fn unseed(State(server): State<Arc<Server>>, Path(id): Path<String>) -> Response {
    blocking(move || match server.remove_seed(&id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => rejected(e),
    })
    .await
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
        fn image_present(&self, _: &str) -> anyhow::Result<bool> {
            Ok(true)
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: a runtime that reports every machine in one state the test sets, for tests about what may be done to a machine in a given state.
    struct Parked(std::sync::Mutex<State>);

    impl Runtime for Parked {
        fn state(&self, _: &str) -> anyhow::Result<State> {
            Ok(*crate::locked(&self.0))
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
        fn image_present(&self, _: &str) -> anyhow::Result<bool> {
            Ok(true)
        }
    }

    struct Api {
        router: Router,
        server: Arc<Server>,
        dir: crate::testdir::TempDir,
    }

    impl Api {
        fn state_dir(&self) -> std::path::PathBuf {
            self.dir.path().join("machines")
        }

        // UNIT_BOUNDARY_DESCRIPTION: leaves a machine on disk as a create would, with its share and its stored spec, without fetching an image.
        fn created(&self, id: &str, storage_gib: i32) -> std::path::PathBuf {
            let share = self.state_dir().join(id).join(crate::share::SHARE_DIR);
            std::fs::create_dir_all(&share).unwrap();
            crate::state::write_spec(
                &self.state_dir(),
                id,
                &MachineSpec {
                    image: "quay.io/x/vm:1".into(),
                    storage_gib,
                    ..Default::default()
                },
            )
            .unwrap();
            share
        }
    }

    fn api(name: &str) -> Api {
        api_on(name, Arc::new(Idle))
    }

    fn api_on(name: &str, runtime: Arc<dyn Runtime>) -> Api {
        let dir = crate::testdir::TempDir::new(&format!("http-{name}"));
        let server = Server::start(
            Config {
                state_dir: dir.path().join("machines"),
                image_dir: dir.path().join("images"),
                image_cache_socket: None,
                image_budget: 0,
                crane: String::new(),
                init: None,
                runc: None,
                ports: 31000..=31099,
                memory_mib: 1 << 20,
                reserve_mib: 0,
                listen: Some(Arc::new(|_| std::net::TcpListener::bind("127.0.0.1:0"))),
            },
            runtime,
        )
        .unwrap();
        Api {
            router: router(server.clone(), Token::fixed("secret")),
            server,
            dir,
        }
    }

    async fn call(
        api: &Api,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: &str,
    ) -> (StatusCode, String) {
        send(api, method, path, token, body.as_bytes().to_vec()).await
    }

    async fn send(
        api: &Api,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Vec<u8>,
    ) -> (StatusCode, String) {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let response = api
            .router
            .clone()
            .oneshot(request.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    const SPEC: &str = r#"{"image":"quay.io/x/vm:1","cpus":1,"memoryMiB":512,"storageGiB":1,"allowCidrs":["10.0.0.1/32"],"running":false}"#;

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
            ("PUT", "/machines/m1/seed"),
            ("DELETE", "/machines/m1/seed"),
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
        for method in ["PUT", "DELETE"] {
            assert_eq!(
                call(&api, method, "/machines/Agent/seed", Some("secret"), "").await,
                (StatusCode::BAD_REQUEST, "invalid machine id\n".to_string()),
                "{method} seed"
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

    // TEST_SCENARIO: the controller's watcher reads a machine's status with `wait` and `since`. A read naming the version it already holds is answered once the wait ends, with that version; one naming another version is answered at once; a query that is not two numbers is the caller's mistake.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_status_read_can_wait_for_a_change() {
        let api = api("wait");
        let (_, body) = call(
            &api,
            "PUT",
            "/machines/m1",
            Some("secret"),
            r#"{"running":false}"#,
        )
        .await;
        let held: MachineStatus = serde_json::from_str(&body).unwrap();
        assert_ne!(held.version, 0);

        let started = std::time::Instant::now();
        let path = format!("/machines/m1?wait=1&since={}", held.version);
        let (status, body) = call(&api, "GET", &path, Some("secret"), "").await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            started.elapsed() >= Duration::from_secs(1),
            "the read did not wait"
        );
        let answer: MachineStatus = serde_json::from_str(&body).unwrap();
        assert_eq!(answer.version, held.version);

        let started = std::time::Instant::now();
        let path = format!("/machines/m1?wait=10&since={}", held.version - 1);
        let (status, _) = call(&api, "GET", &path, Some("secret"), "").await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "a stale version waited"
        );

        assert_eq!(
            call(&api, "GET", "/machines/m1?wait=soon", Some("secret"), "").await,
            (
                StatusCode::BAD_REQUEST,
                "invalid wait or since\n".to_string()
            )
        );
    }

    // TEST_SCENARIO: the migration Job uploads an agent's old home as one tar body, many times the 2 MB axum lets an extractor read by default. The body is stored whole in the machine's share and answered with the byte count and SHA-256 the uploader checks against what it sent; the seed is world-readable for the guest, and no staged copy is left beside it.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_seed_larger_than_the_default_body_limit_is_stored_and_counted() {
        use sha2::{Digest, Sha256};
        use std::os::unix::fs::PermissionsExt;
        let api = api_on("seed", Arc::new(Parked(State::Stopped.into())));
        let share = api.created("m1", 1);
        let body: Vec<u8> = (0..3u32 << 20).map(|i| (i % 251) as u8).collect();

        let (status, answer) = send(
            &api,
            "PUT",
            "/machines/m1/seed",
            Some("secret"),
            body.clone(),
        )
        .await;

        assert_eq!(status, StatusCode::OK, "{answer}");
        let result: crate::api::SeedResult = serde_json::from_str(&answer).unwrap();
        assert_eq!(result.bytes, body.len() as u64);
        assert_eq!(result.sha256, format!("{:x}", Sha256::digest(&body)));
        let stored = share.join(crate::share::SEED_FILE);
        assert_eq!(std::fs::read(&stored).unwrap(), body);
        assert_eq!(
            std::fs::metadata(&stored).unwrap().permissions().mode() & 0o777,
            crate::share::SEED_MODE
        );
        assert_eq!(
            std::fs::read_dir(&share).unwrap().count(),
            1,
            "a staged file was left in the share"
        );
    }

    // TEST_SCENARIO: a seed goes only to a machine that exists and is stopped. One never created has no share to hold it and answers 404; one that is running, or booting, has a guest that could read the seed half-written, and answers 409. Neither leaves a seed or a staged file behind.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_seed_goes_only_to_a_stopped_machine_that_exists() {
        let runtime = Arc::new(Parked(State::Running.into()));
        let api = api_on("seed-guard", runtime.clone());
        let (status, _) = call(&api, "PUT", "/machines/m1/seed", Some("secret"), "tar").await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let share = api.created("m1", 1);
        for state in [State::Running, State::Starting, State::Unknown] {
            *crate::locked(&runtime.0) = state;
            let (status, body) =
                call(&api, "PUT", "/machines/m1/seed", Some("secret"), "tar").await;
            assert_eq!(status, StatusCode::CONFLICT, "{state}: {body}");
        }
        assert_eq!(std::fs::read_dir(&share).unwrap().count(), 0);
    }

    // TEST_SCENARIO: a home larger than the disk it is restored onto could never fit there, so a body past the machine's storage size is refused with 413 and the staged file is removed. A machine whose spec gives it no storage accepts no seed at all, which is how this is reached without a GiB of test data.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_seed_larger_than_the_disk_is_refused_and_leaves_nothing() {
        let api = api_on("seed-large", Arc::new(Parked(State::Stopped.into())));
        let share = api.created("m1", 0);
        let (status, _) = send(
            &api,
            "PUT",
            "/machines/m1/seed",
            Some("secret"),
            vec![0; 1 << 20],
        )
        .await;
        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(std::fs::read_dir(&share).unwrap().count(), 0);
    }

    // TEST_SCENARIO: the controller removes a machine's seed once it has booted from it, and may retry that on every reconcile, so a delete answers 204 whether or not a seed is there — including for a machine that was never created.
    #[tokio::test(flavor = "multi_thread")]
    async fn removing_a_seed_is_idempotent() {
        let api = api_on("unseed", Arc::new(Parked(State::Stopped.into())));
        assert_eq!(
            call(&api, "DELETE", "/machines/m1/seed", Some("secret"), "").await,
            (StatusCode::NO_CONTENT, String::new())
        );
        let share = api.created("m1", 1);
        let (status, _) = call(&api, "PUT", "/machines/m1/seed", Some("secret"), "tar").await;
        assert_eq!(status, StatusCode::OK);
        for _ in 0..2 {
            assert_eq!(
                call(&api, "DELETE", "/machines/m1/seed", Some("secret"), "").await,
                (StatusCode::NO_CONTENT, String::new())
            );
        }
        assert!(!share.join(crate::share::SEED_FILE).exists());
    }

    fn created_for_migration(api: &Api, id: &str) -> std::path::PathBuf {
        let share = api.created(id, 1);
        let mut spec = crate::state::read_spec(&api.state_dir(), id).unwrap();
        spec.migration = Some(crate::api::Migration {});
        crate::state::write_spec(&api.state_dir(), id, &spec).unwrap();
        share
    }

    fn seed_capability(machine: &str, expires: u64) -> String {
        capability::mint(
            &capability::derive_key(b"secret"),
            machine,
            &capability::fresh_nonce(),
            expires,
        )
    }

    fn in_an_hour() -> u64 {
        unix_now() + 3600
    }

    // TEST_SCENARIO: the copy Job carries a seed capability instead of the runner's token. It opens exactly one door — the seed upload of the machine it was minted for — and every other route, and the same route of another machine, answers 401 as if it carried nothing.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_seed_capability_opens_only_its_own_machines_seed_upload() {
        let api = api_on("cap-scope", Arc::new(Parked(State::Stopped.into())));
        let share = created_for_migration(&api, "m1");
        created_for_migration(&api, "m2");
        let capability = seed_capability("m1", in_an_hour());
        for (method, path) in [
            ("GET", "/machines"),
            ("GET", "/machines/m1"),
            ("PUT", "/machines/m1"),
            ("DELETE", "/machines/m1"),
            ("DELETE", "/machines/m1/seed"),
            ("PUT", "/machines/m2/seed"),
        ] {
            assert_eq!(
                call(&api, method, path, Some(&capability), SPEC).await,
                (StatusCode::UNAUTHORIZED, "unauthorized\n".to_string()),
                "{method} {path}"
            );
        }
        assert!(!share.join(crate::share::SEED_FILE).exists());

        let (status, body) = call(&api, "PUT", "/machines/m1/seed", Some(&capability), "tar").await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            std::fs::read(share.join(crate::share::SEED_FILE)).unwrap(),
            b"tar"
        );
    }

    // TEST_SCENARIO: a capability outlives its Job only by its expiry. Presented after it, it is refused with a reason the Job's error carries to the Agent, and nothing is stored.
    #[tokio::test(flavor = "multi_thread")]
    async fn an_expired_seed_capability_is_refused() {
        let api = api_on("cap-expired", Arc::new(Parked(State::Stopped.into())));
        let share = created_for_migration(&api, "m1");
        let expired = seed_capability("m1", unix_now().saturating_sub(1));
        assert_eq!(
            call(&api, "PUT", "/machines/m1/seed", Some(&expired), "tar").await,
            (
                StatusCode::UNAUTHORIZED,
                "the seed capability has expired\n".to_string()
            )
        );
        assert!(!share.join(crate::share::SEED_FILE).exists());
    }

    // TEST_SCENARIO: a capability seeds once. Once it stored a seed, presenting it again is refused — while the seed is there, and after the controller removed it — and the nonce it spent is on the runner's claim, where a restarted runner still finds it.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_seed_capability_is_spent_by_its_upload() {
        let api = api_on("cap-reuse", Arc::new(Parked(State::Stopped.into())));
        let share = created_for_migration(&api, "m1");
        let capability = seed_capability("m1", in_an_hour());
        let (status, _) = call(&api, "PUT", "/machines/m1/seed", Some(&capability), "first").await;
        assert_eq!(status, StatusCode::OK);

        let (status, _) = call(
            &api,
            "PUT",
            "/machines/m1/seed",
            Some(&capability),
            "second",
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(
            call(&api, "DELETE", "/machines/m1/seed", Some("secret"), "")
                .await
                .0,
            StatusCode::NO_CONTENT
        );
        let (status, body) = call(
            &api,
            "PUT",
            "/machines/m1/seed",
            Some(&capability),
            "second",
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(body.contains("already used"), "{body}");
        assert!(!share.join(crate::share::SEED_FILE).exists());
        let spent = std::fs::read_to_string(
            api.state_dir()
                .join("m1")
                .join(crate::server::SPENT_CAPABILITIES_FILE),
        )
        .unwrap();
        assert_eq!(Some(spent.trim()), capability.split('.').nth(1));
    }

    // TEST_SCENARIO: an attempt stored its seed and then failed — its answer lost, its pod evicted — so the controller runs a new Job with a fresh capability. That capability replaces the seed the machine has not booted from yet, or the migration could never leave the copy. The first capability stays spent, and once the guest has answered from its disk no capability replaces anything.
    #[tokio::test(flavor = "multi_thread")]
    async fn the_next_jobs_capability_replaces_a_seed_not_yet_booted_from() {
        let api = api_on("cap-replace", Arc::new(Parked(State::Stopped.into())));
        let share = created_for_migration(&api, "m1");
        let first = seed_capability("m1", in_an_hour());
        let (status, _) = call(&api, "PUT", "/machines/m1/seed", Some(&first), "lost").await;
        assert_eq!(status, StatusCode::OK);

        let next = seed_capability("m1", in_an_hour());
        let (status, body) = call(&api, "PUT", "/machines/m1/seed", Some(&next), "retry").await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            std::fs::read(share.join(crate::share::SEED_FILE)).unwrap(),
            b"retry"
        );
        let answered: crate::api::SeedResult = serde_json::from_str(&body).unwrap();
        assert_eq!(
            crate::share::seed_digest(&api.state_dir().join("m1")),
            Some(answered),
            "the recorded digest follows the seed that replaced the lost one"
        );

        let (status, body) = call(&api, "PUT", "/machines/m1/seed", Some(&first), "old").await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(body.contains("already used"), "{body}");

        crate::share::record_seeded(&share, None).unwrap();
        let (status, body) = call(
            &api,
            "PUT",
            "/machines/m1/seed",
            Some(&seed_capability("m1", in_an_hour())),
            "late",
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(
            std::fs::read(share.join(crate::share::SEED_FILE)).unwrap(),
            b"retry"
        );
    }

    // TEST_SCENARIO: a capability never seeds a machine that is not being migrated — a sibling that was created as a vm Agent from the start — nor one whose disk already holds a home, since either would let the Job replace a home it has no business touching. The owner's token still seeds as it always did.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_seed_capability_seeds_only_a_migrating_machine_with_no_home() {
        let api = api_on("cap-guard", Arc::new(Parked(State::Stopped.into())));
        let plain_share = api.created("m1", 1);
        let (status, body) = call(
            &api,
            "PUT",
            "/machines/m1/seed",
            Some(&seed_capability("m1", in_an_hour())),
            "tar",
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert!(body.contains("not being migrated"), "{body}");
        assert!(!plain_share.join(crate::share::SEED_FILE).exists());

        let seeded = created_for_migration(&api, "m2");
        crate::share::record_seeded(&seeded, None).unwrap();
        let (status, _) = call(
            &api,
            "PUT",
            "/machines/m2/seed",
            Some(&seed_capability("m2", in_an_hour())),
            "tar",
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(!seeded.join(crate::share::SEED_FILE).exists());

        created_for_migration(&api, "m4");
        let (status, _) = call(&api, "PUT", "/machines/m4", Some("secret"), SPEC).await;
        assert_eq!(status, StatusCode::OK);
        let (status, body) = call(
            &api,
            "PUT",
            "/machines/m4/seed",
            Some(&seed_capability("m4", in_an_hour())),
            "tar",
        )
        .await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "the controller's latest spec dropped the mark: {body}"
        );

        let (status, _) = call(&api, "PUT", "/machines/m1/seed", Some("secret"), "tar").await;
        assert_eq!(status, StatusCode::OK);
    }

    // TEST_SCENARIO: an uploader that sends part of its seed and then nothing, without closing its connection, would hold the machine's seed claim for as long as the connection lasts, and no worker starts the machine meanwhile. Past the idle limit the upload is dropped with a message that says so, nothing is left in the share, and the claim is free for the next upload.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_seed_upload_that_stalls_is_dropped_and_frees_the_machine() {
        use futures_util::StreamExt;
        let api = api_on("seed-idle", Arc::new(Parked(State::Stopped.into())));
        let share = api.created("m1", 1);
        let stalled = futures_util::stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(
            b"part of a tar",
        ))])
        .chain(futures_util::stream::pending());

        let response = receive_seed(
            api.server.clone(),
            "m1".into(),
            Authority::Token,
            Body::from_stream(stalled),
            Duration::from_millis(200),
        )
        .await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(
            String::from_utf8_lossy(&body).contains("sent nothing"),
            "{body:?}"
        );
        assert_eq!(std::fs::read_dir(&share).unwrap().count(), 0);
        let (status, answer) = call(&api, "PUT", "/machines/m1/seed", Some("secret"), "tar").await;
        assert_eq!(status, StatusCode::OK, "{answer}");
    }

    // TEST_SCENARIO: a runner killed mid-upload leaves its staged seed in the share. Removing the seed, which the controller does once the machine has booted, removes that too when no upload holds the claim.
    #[tokio::test(flavor = "multi_thread")]
    async fn removing_a_seed_removes_one_a_dead_runner_staged() {
        let api = api_on("unseed-stale", Arc::new(Parked(State::Stopped.into())));
        let share = api.created("m1", 1);
        let staged = share.join(format!(
            "{}{}",
            crate::share::SEED_FILE,
            crate::share::STAGED_SUFFIX
        ));
        std::fs::write(&staged, b"half an upload").unwrap();

        let (status, _) = call(&api, "DELETE", "/machines/m1/seed", Some("secret"), "").await;

        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(!staged.exists());
    }

    // TEST_SCENARIO: the controller replaces the token in the runner's Secret and the kubelet rewrites the file. The next read takes the new token and the old one stops working; a file caught empty or missing mid-swap keeps the token already held rather than locking the controller out.
    #[test]
    fn a_rewritten_token_file_is_taken_and_a_broken_one_is_not() {
        let dir = crate::testdir::TempDir::new("http-token-reload");
        let path = dir.path().join("token");
        std::fs::write(&path, "first\n").unwrap();
        let token = Token::from_file(path.clone()).unwrap();
        assert!(token.matches(b"first"));

        std::fs::write(&path, "second").unwrap();
        token.reload();
        assert!(token.matches(b"second"));
        assert!(!token.matches(b"first"));

        std::fs::write(&path, "  \n").unwrap();
        token.reload();
        assert!(token.matches(b"second"));

        std::fs::remove_file(&path).unwrap();
        token.reload();
        assert!(token.matches(b"second"));
    }

    // TEST_SCENARIO: a runner started without a usable token would answer every call 401, so a missing or empty file stops it at start.
    #[test]
    fn a_runner_does_not_start_without_a_token() {
        let dir = crate::testdir::TempDir::new("http-token-start");
        let path = dir.path().join("token");
        assert!(Token::from_file(path.clone()).is_err());
        std::fs::write(&path, "\n").unwrap();
        assert!(Token::from_file(path).is_err());
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
