// TEST_OVERVIEW: the link's accepting end serves one connection: the dialer's key on the first line, then SSH with that key alone, a command's output and exit status, a terminal, and files over sftp, on nothing but this process and a shell.
use std::sync::Arc;

use russh::client;
use russh::keys::{Algorithm, PrivateKey, PrivateKeyWithHashAlg};
use russh::ChannelMsg;
use tokio::io::AsyncWriteExt;

use super::*;

struct Home(PathBuf);

impl Home {
    fn new(name: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("platform-link-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct AnyHost;

impl client::Handler for AnyHost {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

fn login(home: &Path) -> Login {
    Login {
        shell: PathBuf::from("/bin/sh"),
        home: home.to_path_buf(),
    }
}

fn key() -> PrivateKey {
    PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap()
}

async fn dial(
    home: &Path,
    sent: &PrivateKey,
    signs: &PrivateKey,
) -> (client::Handle<AnyHost>, bool) {
    let (mut ours, theirs) = tokio::io::duplex(1 << 16);
    tokio::spawn(serve(theirs, login(home)));
    let line = format!("{}\n", sent.public_key().to_openssh().unwrap());
    ours.write_all(line.as_bytes()).await.unwrap();
    let mut handle = client::connect_stream(Arc::new(client::Config::default()), ours, AnyHost)
        .await
        .unwrap();
    let auth = handle
        .authenticate_publickey(
            "agent",
            PrivateKeyWithHashAlg::new(Arc::new(signs.clone()), None),
        )
        .await
        .unwrap();
    (handle, auth.success())
}

struct Ran {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    status: Option<u32>,
}

async fn run(handle: &client::Handle<AnyHost>, line: &str, terminal: bool) -> Ran {
    let mut channel = handle.channel_open_session().await.unwrap();
    if terminal {
        channel
            .request_pty(true, "xterm", 80, 24, 0, 0, &[])
            .await
            .unwrap();
    }
    channel.exec(true, line).await.unwrap();
    channel.eof().await.unwrap();
    let mut ran = Ran {
        stdout: Vec::new(),
        stderr: Vec::new(),
        status: None,
    };
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => ran.stdout.extend_from_slice(&data),
            ChannelMsg::ExtendedData { data, ext: 1 } => ran.stderr.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => ran.status = Some(exit_status),
            _ => {}
        }
    }
    ran
}

// TEST_SCENARIO: a shell over the link finds the image's tools, pulls through the gateway trusting its CA, and finds openrc's user services and mise's tools; nothing else of the launch record's env, a credential least of all, reaches it. An image that sets no PATH still gets the default one.
#[test]
fn a_session_gets_the_image_tools_gateway_and_ca_and_nothing_else() {
    let pair = |key: &str, value: &str| (key.to_string(), value.to_string());
    let kept = [
        pair(
            "PATH",
            "/usr/share/mise/installs/k3s/1.37.1/bin:/usr/bin:/bin",
        ),
        pair("HTTPS_PROXY", "http://gateway.test:10000"),
        pair("NO_PROXY", "localhost,127.0.0.1"),
        pair("SSL_CERT_FILE", "/run/platform/ca-certificates.crt"),
        pair("XDG_RUNTIME_DIR", "/tmp/platform-display"),
        pair("MISE_SYSTEM_DATA_DIR", "/usr/share/mise"),
    ];
    let mut launch_env = kept.to_vec();
    launch_env.push(pair("PLATFORM_ENVIRONMENT_OF", "agent-owner"));
    launch_env.push(pair("ANTHROPIC_API_KEY", "placeholder-credential"));
    launch_env.push(pair("GITHUB_TOKEN", "placeholder-credential"));
    let mut expected = kept.to_vec();
    expected.push(pair(LINK_MARK, "1"));
    assert_eq!(session_env(&launch_env, "/default/bin"), expected);

    let without_path = session_env(&launch_env[1..], "/default/bin");
    assert!(without_path.contains(&pair("PATH", "/default/bin")));
}

// TEST_SCENARIO: the dialer's command runs in the agent's home with the session's environment, and what it writes comes back split as it wrote it, with its exit status after all of its output, which is how `ssh env-x cmd` and a script reading its output tell success from failure.
#[tokio::test]
async fn a_command_runs_in_the_home_and_reports_its_output_and_status() {
    let home = Home::new("command");
    let dialer = key();
    let (handle, admitted) = dial(home.path(), &dialer, &dialer).await;
    assert!(admitted, "the key sent on the first line is accepted");
    let ran = run(&handle, "pwd; echo out; echo err >&2; exit 3", false).await;
    let home_path = std::fs::canonicalize(home.path()).unwrap();
    let stdout = String::from_utf8(ran.stdout).unwrap();
    let mut lines = stdout.lines();
    assert_eq!(
        std::fs::canonicalize(lines.next().unwrap()).unwrap(),
        home_path
    );
    assert_eq!(lines.next(), Some("out"));
    assert_eq!(String::from_utf8(ran.stderr).unwrap(), "err\n");
    assert_eq!(ran.status, Some(3));
}

// TEST_SCENARIO: the data the dialer sends is the command's stdin up to its EOF, which is how `docker save IMAGE | ssh env-x k3s ctr images import -` streams an image in.
#[tokio::test]
async fn the_channel_data_is_the_commands_stdin() {
    let home = Home::new("stdin");
    let dialer = key();
    let (handle, _) = dial(home.path(), &dialer, &dialer).await;
    let mut channel = handle.channel_open_session().await.unwrap();
    channel.exec(true, "wc -c").await.unwrap();
    channel.data_bytes(vec![b'x'; 300_000]).await.unwrap();
    channel.eof().await.unwrap();
    let mut out = Vec::new();
    let mut status = None;
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => out.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => status = Some(exit_status),
            _ => {}
        }
    }
    assert_eq!(String::from_utf8(out).unwrap().trim(), "300000");
    assert_eq!(status, Some(0));
}

// TEST_SCENARIO: a key other than the one on the first line is refused, so the connection the runner admitted is the only way in and no key a guest kept from an earlier connection opens it.
#[tokio::test]
async fn only_the_key_on_the_first_line_is_accepted() {
    let home = Home::new("other-key");
    let (_handle, admitted) = dial(home.path(), &key(), &key()).await;
    assert!(!admitted);
}

// TEST_SCENARIO: a connection whose first line is not a public key is closed before any SSH is spoken, as the image's accept script closed it.
#[tokio::test]
async fn a_first_line_that_is_no_key_ends_the_connection() {
    let home = Home::new("no-key");
    let (mut ours, theirs) = tokio::io::duplex(1 << 12);
    let served = tokio::spawn(serve(theirs, login(home.path())));
    ours.write_all(b"SSH-2.0-OpenSSH_9.9\r\n").await.unwrap();
    let outcome = served.await.unwrap();
    assert!(outcome.is_err());
}

// TEST_SCENARIO: a command asked for with a terminal gets one as its stdin, so an interactive `ssh -t env-x` behaves like a local shell.
#[tokio::test]
async fn a_command_with_a_terminal_runs_on_one() {
    let home = Home::new("terminal");
    let dialer = key();
    let (handle, _) = dial(home.path(), &dialer, &dialer).await;
    let ran = run(&handle, "test -t 0 && echo terminal", true).await;
    assert!(String::from_utf8_lossy(&ran.stdout).contains("terminal"));
    assert_eq!(ran.status, Some(0));
}

// TEST_SCENARIO: sftp writes and reads files under the agent's home by a relative path, which is what `scp file env-x:` and `scp env-x:file .` do since OpenSSH 9.0, with no sftp-server in the image.
#[tokio::test]
async fn sftp_copies_files_in_and_out_of_the_home() {
    let home = Home::new("sftp");
    let dialer = key();
    let (handle, _) = dial(home.path(), &dialer, &dialer).await;
    let channel = handle.channel_open_session().await.unwrap();
    channel.request_subsystem(true, "sftp").await.unwrap();
    let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
        .await
        .unwrap();
    sftp.create_dir("in").await.unwrap();
    let mut file = sftp.create("in/data.txt").await.unwrap();
    file.write_all(b"hello link").await.unwrap();
    file.shutdown().await.unwrap();
    assert_eq!(
        std::fs::read(home.path().join("in/data.txt")).unwrap(),
        b"hello link"
    );
    std::fs::write(home.path().join("out.txt"), b"result").unwrap();
    assert_eq!(sftp.read("out.txt").await.unwrap(), b"result");
    let names: Vec<String> = sftp
        .read_dir(".")
        .await
        .unwrap()
        .map(|entry| entry.file_name())
        .collect();
    assert!(names.contains(&"in".to_string()) && names.contains(&"out.txt".to_string()));
}

// TEST_SCENARIO: an sftp channel that the dialer ends reports exit status 0 before it closes, as sshd does: scp counts a channel that closes with no status as a failed copy, and exits 1 after copying every file.
#[tokio::test]
async fn an_ended_sftp_channel_reports_success() {
    let home = Home::new("sftp-status");
    let dialer = key();
    let (handle, _) = dial(home.path(), &dialer, &dialer).await;
    let mut channel = handle.channel_open_session().await.unwrap();
    channel.request_subsystem(true, "sftp").await.unwrap();
    channel.eof().await.unwrap();
    let mut status = None;
    while let Some(message) = channel.wait().await {
        if let ChannelMsg::ExitStatus { exit_status } = message {
            status = Some(exit_status);
        }
    }
    assert_eq!(status, Some(0));
}

// TEST_SCENARIO: a forward reaches an address or localhost and never a name, since this static binary cannot look names up on an image of another distribution.
#[test]
fn a_forward_goes_to_an_address_or_localhost() {
    assert_eq!(
        forward_target("localhost", 80),
        Some("127.0.0.1:80".parse().unwrap())
    );
    assert_eq!(forward_target("::1", 80), Some("[::1]:80".parse().unwrap()));
    assert_eq!(
        forward_target("10.0.0.5", 443),
        Some("10.0.0.5:443".parse().unwrap())
    );
    assert_eq!(forward_target("example.com", 443), None);
}
