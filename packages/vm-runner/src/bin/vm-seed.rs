use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::Context;
use clap::Parser;
use vm_runner::api::SeedResult;
use vm_runner::seed::{write_tar, Tally};

// UNIT_BOUNDARY_DESCRIPTION: the flags the controller's migration Job sets: the mount of the agent's old volume, the runner's seed URL for the agent's machine, and the runner's token and CA, mounted from the Secrets the controller already keeps for that runner.
#[derive(Parser, Debug)]
#[command(
    name = "vm-seed",
    about = "Uploads a directory as the seed of a VM runner machine's home: archives it and streams the tar to the runner"
)]
struct Args {
    #[arg(long)]
    source: PathBuf,
    #[arg(long)]
    url: String,
    #[arg(long = "token-file")]
    token_file: PathBuf,
    #[arg(long = "ca-file")]
    ca_file: PathBuf,
}

// UNIT_BOUNDARY_DESCRIPTION: how much of the tar is gathered before it is handed to the connection, and how many such chunks may wait for it. Together they bound what the upload holds in memory, whatever the size of the home.
const CHUNK: usize = 256 << 10;
const CHUNKS: usize = 16;

type Chunks = tokio::sync::mpsc::Sender<io::Result<Vec<u8>>>;

// UNIT_BOUNDARY_DESCRIPTION: the tar's writer: it hands the archive to the request body in chunks, from the blocking thread that walks the home. A connection that is gone is a write that fails, which stops the walk.
struct Channel {
    chunks: Chunks,
    buf: Vec<u8>,
}

impl Write for Channel {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(data);
        if self.buf.len() >= CHUNK {
            self.flush()?;
        }
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
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
    let tarred = write_tar(
        &args.source,
        Tally::new(Channel {
            chunks,
            buf: Vec::with_capacity(CHUNK),
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
    tracing::info!(source = %args.source.display(), url = %args.url, "seed upload starting");
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async move {
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

    // TEST_SCENARIO: the migration Job runs this binary with these four flags, and a flag it does not know is a Job that fails on every attempt without moving a byte.
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
    }
}
