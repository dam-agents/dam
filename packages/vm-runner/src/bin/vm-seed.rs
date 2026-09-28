use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::Context;
use clap::Parser;
use vm_runner::api::SeedResult;
use vm_runner::seed::{write_layout, Graft, Limits, Link, Options, OwnerMap, Tally};

// UNIT_BOUNDARY_DESCRIPTION: the flags the controller's migration Job sets: the mount of the agent's old home volume, one `--graft` for each of the agent's other volumes with where it goes below the home, the moved paths to link back at boot, the runner's seed URL for the agent's machine, and the runner's token and CA, mounted from the Secrets the controller already keeps for that runner. `--map-owner` names the install's agent uid and gid, which go to the machine's root, and defaults to the chart's 65532 for both; `--max-bytes`, when set, fails a home with more file data than that before the runner has to refuse it.
#[derive(Parser, Debug)]
#[command(
    name = "vm-seed",
    about = "Uploads a directory as the seed of a VM runner machine's home: archives it and streams the tar to the runner"
)]
struct Args {
    #[arg(long)]
    source: PathBuf,
    #[arg(long = "graft", value_parser = parse_graft)]
    grafts: Vec<Graft>,
    #[arg(long, value_parser = parse_links, default_value = "[]")]
    links: Links,
    #[arg(long)]
    url: String,
    #[arg(long = "token-file")]
    token_file: PathBuf,
    #[arg(long = "ca-file")]
    ca_file: PathBuf,
    #[arg(long = "map-owner", value_parser = parse_owner_map, default_value = CONTAINER_TO_MACHINE)]
    map_owner: OwnerMap,
    #[arg(long = "max-bytes")]
    max_bytes: Option<u64>,
}

// UNIT_BOUNDARY_DESCRIPTION: the container ran the agent as uid and gid 65532, and a machine's harness runs as root.
const CONTAINER_TO_MACHINE: &str = "65532:0";

// UNIT_BOUNDARY_DESCRIPTION: an owner map is `UID:GID:TO`, or `FROM:TO` when the uid and gid are the same, all numeric ids; each entry owned by that uid, or by that gid, is stored as owned by TO.
fn parse_owner_map(value: &str) -> Result<OwnerMap, String> {
    let id = |part: &str| {
        part.parse::<u32>()
            .map_err(|e| format!("{part:?} in {value:?} is not a numeric id: {e}"))
    };
    match value.split(':').collect::<Vec<_>>()[..] {
        [from, to] => Ok(OwnerMap {
            uid: id(from)?,
            gid: id(from)?,
            to: id(to)?,
        }),
        [uid, gid, to] => Ok(OwnerMap {
            uid: id(uid)?,
            gid: id(gid)?,
            to: id(to)?,
        }),
        _ => Err(format!("{value:?} is not UID:GID:TO or FROM:TO")),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a graft is `AT=DIR`: where the volume goes, relative to the home, and where the Job mounted it. The split is at the last `=`, because the Job names the mount and never puts one in it, while the place comes from a path the agent's spec declared.
fn parse_graft(value: &str) -> Result<Graft, String> {
    let (at, source) = value
        .rsplit_once('=')
        .ok_or_else(|| format!("{value:?} is not AT=DIR"))?;
    Ok(Graft {
        at: PathBuf::from(at),
        source: PathBuf::from(source),
    })
}

// UNIT_BOUNDARY_DESCRIPTION: the persisted paths from outside the home the migration moved, as a JSON list of `{"path", "at"}`. JSON rather than a separator, because a path the agent's spec named may hold any character a separator could be.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Links(Vec<Link>);

fn parse_links(value: &str) -> Result<Links, String> {
    serde_json::from_str(value)
        .map(Links)
        .map_err(|e| format!("{value:?} is not a JSON list of {{\"path\", \"at\"}}: {e}"))
}

// UNIT_BOUNDARY_DESCRIPTION: how much of the tar is gathered before it is handed to the connection, and how many such chunks may wait for it. Together they bound what the upload holds in memory, whatever the size of the home.
const CHUNK: usize = 256 << 10;
const CHUNKS: usize = 16;

// UNIT_BOUNDARY_DESCRIPTION: the longest a partial chunk waits before it is sent anyway. The runner drops an upload that sends nothing for minutes, and a walk over many small entries on a slow volume can take that long to fill a chunk while it is still making progress.
const CHUNK_WAIT: Duration = Duration::from_secs(10);

type Chunks = tokio::sync::mpsc::Sender<io::Result<Vec<u8>>>;

// UNIT_BOUNDARY_DESCRIPTION: the tar's writer: it hands the archive to the request body in chunks, from the blocking thread that walks the home. A connection that is gone is a write that fails, which stops the walk.
struct Channel {
    chunks: Chunks,
    buf: Vec<u8>,
    flushed: Instant,
}

impl Write for Channel {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(data);
        if self.buf.len() >= CHUNK || self.flushed.elapsed() >= CHUNK_WAIT {
            self.flush()?;
        }
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.flushed = Instant::now();
        if self.buf.is_empty() {
            return Ok(());
        }
        let chunk = std::mem::replace(&mut self.buf, Vec::with_capacity(CHUNK));
        self.chunks
            .blocking_send(Ok(chunk))
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "the upload ended"))
    }
}

// UNIT_BOUNDARY_DESCRIPTION: archives the source into the channel and answers with the tally of what it sent. An archive that fails part-way ends the body with an error rather than letting it end cleanly, so the runner sees a broken upload and stores nothing, instead of committing a tar that stops in the middle.
fn archive(args: &Args, chunks: Chunks) -> io::Result<SeedResult> {
    let abort = chunks.clone();
    let options = Options {
        owner: Some(args.map_owner),
        limits: Limits {
            bytes: args.max_bytes,
            ..Limits::default()
        },
    };
    let tarred = write_layout(
        &args.source,
        &args.grafts,
        &args.links.0,
        &options,
        Tally::new(Channel {
            chunks,
            buf: Vec::with_capacity(CHUNK),
            flushed: Instant::now(),
        }),
    )
    .and_then(Tally::finish);
    match tarred {
        Ok((_, sent)) => Ok(sent),
        Err(e) => {
            let _ = abort.blocking_send(Err(io::Error::new(e.kind(), e.to_string())));
            Err(e)
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a client that trusts the runner's CA and nothing else — not the public roots, and not a proxy the Job's environment may name — because the runner's CA signs runner certificates alone, and the token this upload carries is the runner's whole machine API.
fn client(ca_file: &Path) -> anyhow::Result<reqwest::Client> {
    let pem = std::fs::read(ca_file).with_context(|| format!("reading {}", ca_file.display()))?;
    let certs = reqwest::Certificate::from_pem_bundle(&pem)
        .with_context(|| format!("parsing {}", ca_file.display()))?;
    anyhow::ensure!(
        !certs.is_empty(),
        "{} holds no certificate",
        ca_file.display()
    );
    let mut builder = reqwest::Client::builder()
        .use_rustls_tls()
        .tls_built_in_root_certs(false)
        .https_only(true)
        .no_proxy()
        .connect_timeout(Duration::from_secs(30));
    for cert in certs {
        builder = builder.add_root_certificate(cert);
    }
    Ok(builder.build()?)
}

// UNIT_BOUNDARY_DESCRIPTION: how long a Job's fresh pod waits for the runner to accept a connection before it gives up. The runner admits the Job by a NetworkPolicy that names its labels, and a policy engine adds a new pod to that rule only after the pod exists, so the first connections a pod makes can be refused though the rule allows it. Waiting here costs one attempt a few seconds; failing costs the whole Job a retry delay.
const REACH_DEADLINE: Duration = Duration::from_secs(180);

// UNIT_BOUNDARY_DESCRIPTION: waits until the runner's address accepts a TCP connection, retrying a refused or unreachable one with a growing pause, and fails with the last error once the deadline passes. The upload itself is not retried: its body is the archive being written, so it can be sent only once.
async fn await_reachable(url: &str, deadline: Duration) -> anyhow::Result<()> {
    let parsed = reqwest::Url::parse(url).with_context(|| format!("parsing {url}"))?;
    let host = parsed
        .host_str()
        .with_context(|| format!("{url} names no host"))?
        .to_string();
    let port = parsed
        .port_or_known_default()
        .with_context(|| format!("{url} names no port"))?;
    let started = Instant::now();
    let mut pause = Duration::from_millis(500);
    loop {
        let err = match tokio::time::timeout(
            Duration::from_secs(10),
            tokio::net::TcpStream::connect((host.as_str(), port)),
        )
        .await
        {
            Ok(Ok(_)) => return Ok(()),
            Ok(Err(e)) => anyhow::Error::new(e),
            Err(_) => anyhow::anyhow!("connecting timed out"),
        };
        if started.elapsed() + pause > deadline {
            return Err(err.context(format!(
                "the runner at {host}:{port} accepted no connection in {}s",
                deadline.as_secs()
            )));
        }
        tracing::warn!(host = %host, port, error = %err, "the runner is not reachable yet; retrying");
        tokio::time::sleep(pause).await;
        pause = (pause * 2).min(Duration::from_secs(10));
    }
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().json().init();
    let args = Args::parse();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let token = std::fs::read_to_string(&args.token_file)
        .with_context(|| format!("reading {}", args.token_file.display()))?
        .trim()
        .to_string();
    anyhow::ensure!(!token.is_empty(), "{} is empty", args.token_file.display());
    let client = client(&args.ca_file)?;
    let started = Instant::now();
    tracing::info!(source = %args.source.display(), grafts = args.grafts.len(), url = %args.url, "seed upload starting");
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async move {
            await_reachable(&args.url, REACH_DEADLINE).await?;
            let (chunks, mut received) = tokio::sync::mpsc::channel(CHUNKS);
            let url = args.url.clone();
            let archiving = tokio::task::spawn_blocking(move || archive(&args, chunks));
            let body = reqwest::Body::wrap_stream(futures_util::stream::poll_fn(move |cx| {
                received.poll_recv(cx)
            }));
            let response = client
                .put(&url)
                .bearer_auth(token)
                .header("content-type", "application/x-tar")
                .body(body)
                .send()
                .await;
            let archived = archiving.await?;
            let response = match (response, &archived) {
                (Ok(response), _) => response,
                (Err(_), Err(e)) if e.kind() != io::ErrorKind::BrokenPipe => {
                    anyhow::bail!("archiving the seed: {e}")
                }
                (Err(e), _) => {
                    return Err(anyhow::Error::new(e).context(format!("uploading the seed to {url}")))
                }
            };
            let status = response.status();
            let answer = response.text().await.unwrap_or_default();
            anyhow::ensure!(
                status.is_success(),
                "the runner refused the seed: {status}: {}",
                answer.trim()
            );
            let sent = archived.context("archiving the seed")?;
            let stored: SeedResult = serde_json::from_str(&answer)
                .with_context(|| format!("reading the runner's answer {answer:?}"))?;
            anyhow::ensure!(
                stored == sent,
                "the runner stored {} bytes with SHA-256 {}, but {} bytes with SHA-256 {} were sent",
                stored.bytes,
                stored.sha256,
                sent.bytes,
                sent.sha256
            );
            tracing::info!(
                bytes = sent.bytes,
                sha256 = %sent.sha256,
                elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
                "seed upload finished"
            );
            anyhow::Ok(())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: a runner that starts accepting connections a moment after the pod starts is waited for, not failed on — the refusal a fresh pod meets while its NetworkPolicy catches up looks exactly like this.
    #[tokio::test]
    async fn a_runner_that_opens_late_is_waited_for() {
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let opener = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(700)).await;
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
                .await
                .unwrap();
            let _ = listener.accept().await;
        });
        await_reachable(
            &format!("https://127.0.0.1:{port}/machines/m1/seed"),
            Duration::from_secs(20),
        )
        .await
        .unwrap();
        opener.abort();
    }

    // TEST_SCENARIO: a runner that never answers fails the wait once the deadline passes, and the error names the address, so the Job's message says where it could not reach.
    #[tokio::test]
    async fn a_runner_that_never_opens_fails_with_its_address() {
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let err = await_reachable(
            &format!("https://127.0.0.1:{port}/x"),
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
        assert!(
            format!("{err:#}").contains(&format!("127.0.0.1:{port}")),
            "{err:#}"
        );
    }

    // TEST_SCENARIO: the migration Job runs this binary with these four flags and no graft for an agent that persists only its home, and a flag it does not know is a Job that fails on every attempt without moving a byte.
    #[test]
    fn the_flags_the_migration_job_passes_are_accepted() {
        let args = Args::try_parse_from([
            "vm-seed",
            "--source",
            "/old-home",
            "--url",
            "https://runner:8443/machines/m1/seed",
            "--token-file",
            "/run/secrets/runner/token",
            "--ca-file",
            "/run/secrets/runner/ca.crt",
        ])
        .unwrap();
        assert_eq!(args.source, PathBuf::from("/old-home"));
        assert_eq!(args.url, "https://runner:8443/machines/m1/seed");
        assert!(args.grafts.is_empty());
        assert!(args.links.0.is_empty());
        assert_eq!(
            args.map_owner,
            OwnerMap {
                uid: 65532,
                gid: 65532,
                to: 0
            }
        );
        assert_eq!(args.max_bytes, None);
    }

    // TEST_SCENARIO: without `--map-owner` every migration maps the container's agent to the machine's root, so the controller's Job needs no new flag. One that names another uid and gid is read as those, and one that is not two or three numeric ids is refused at the start rather than seeding a home with the wrong owner.
    #[test]
    fn the_owner_map_defaults_to_the_containers_agent_becoming_root() {
        let base = [
            "vm-seed",
            "--source",
            "/h",
            "--url",
            "u",
            "--token-file",
            "t",
            "--ca-file",
            "c",
        ];
        let args = Args::try_parse_from(base.iter().copied().chain([
            "--map-owner",
            "1000:2000:0",
            "--max-bytes",
            "4096",
        ]))
        .unwrap();
        assert_eq!(
            args.map_owner,
            OwnerMap {
                uid: 1000,
                gid: 2000,
                to: 0
            }
        );
        assert_eq!(args.max_bytes, Some(4096));
        for bad in ["65532", "a:0", "0:-1", "1:2:3:4", ""] {
            assert!(
                Args::try_parse_from(base.iter().copied().chain(["--map-owner", bad])).is_err(),
                "{bad:?}"
            );
        }
    }

    // TEST_SCENARIO: the Job passes the moved paths as one JSON list, and a list that does not parse is refused at the start rather than seeding a machine whose paths are never linked.
    #[test]
    fn the_links_the_migration_job_passes_are_read() {
        let base = [
            "vm-seed",
            "--source",
            "/h",
            "--url",
            "u",
            "--token-file",
            "t",
            "--ca-file",
            "c",
        ];
        let args = Args::try_parse_from(
            base.iter()
                .copied()
                .chain(["--links", r#"[{"path":"/data","at":".persisted/data"}]"#]),
        )
        .unwrap();
        assert_eq!(
            args.links.0,
            vec![Link {
                path: PathBuf::from("/data"),
                at: PathBuf::from(".persisted/data")
            }]
        );
        assert!(Args::try_parse_from(base.iter().copied().chain(["--links", "/data"])).is_err());
    }

    // TEST_SCENARIO: the Job passes one `--graft` per other volume, in the order it mounted them. Each is read as the place below the home and the mount, split at the last `=` so a place the spec named with one in it still reaches the archive whole.
    #[test]
    fn the_grafts_the_migration_job_passes_are_read_in_order() {
        let args = Args::try_parse_from([
            "vm-seed",
            "--source",
            "/mnt/home",
            "--graft",
            ".persisted/data=/mnt/extra/0",
            "--graft",
            ".persisted/a=b=/mnt/extra/1",
            "--url",
            "https://runner:8443/machines/m1/seed",
            "--token-file",
            "/t",
            "--ca-file",
            "/c",
        ])
        .unwrap();
        assert_eq!(
            args.grafts,
            vec![
                Graft {
                    at: PathBuf::from(".persisted/data"),
                    source: PathBuf::from("/mnt/extra/0")
                },
                Graft {
                    at: PathBuf::from(".persisted/a=b"),
                    source: PathBuf::from("/mnt/extra/1")
                },
            ]
        );
        assert!(Args::try_parse_from([
            "vm-seed",
            "--source",
            "/h",
            "--graft",
            "no-equals",
            "--url",
            "u",
            "--token-file",
            "t",
            "--ca-file",
            "c",
        ])
        .is_err());
    }
}
