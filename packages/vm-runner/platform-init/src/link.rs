// UNIT_BOUNDARY_DESCRIPTION: the accepting end of the link between two agents' machines, one process per connection. The guest's init accepts each connection the runner joins to this machine and starts this process with the connection as its stdin and stdout, as inetd starts `sshd -i`. The dialing agent sends its public key on the first line, then speaks SSH: that one key is the only one accepted, and only for this connection, since only the agent the runner admits can open the link at all. It serves what an agent needs inside another agent's machine, whatever the image: a shell or a command, with or without a terminal, sftp (which scp uses) and port forwards. Commands run as root, the user the machine's harness runs as and the uid of the `agent` login, in part of the environment the image's entrypoint got (SESSION_ENV), and carry PLATFORM_LINK, by which the agent-runtime counts an open link as busy. The host key is made for each connection: the dialer keeps no host keys, because the runner already decides which machine it reaches.
use std::collections::HashMap;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use russh::keys::{Algorithm, PrivateKey, PublicKey};
use russh::server::{Auth, ChannelOpenHandle, Config, Handler, Msg, Session};
use russh::{Channel, ChannelId, ChannelMsg, ChannelOpenFailure, MethodKind, MethodSet, Sig};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

mod sftp;

pub const LINK_MARK: &str = "PLATFORM_LINK";
pub const PROCESS_NAME: &str = "platform-link";
const LINK_KEY_LINE_MAX: usize = 16 << 10;
const KEY_PREFIXES: [&str; 3] = ["ssh-ed25519 ", "ecdsa-sha2-nistp", "ssh-rsa "];
const FALLBACK_SHELL: &str = "/bin/sh";
const LOGIN_NAME: &str = "agent";
// UNIT_BOUNDARY_DESCRIPTION: what a session over the link gets of the environment the image's entrypoint got: the image's PATH, the agent's gateway and CA, through which docker and k3s pull as they do at boot, the runtime directory where `rc-service --user` finds the agent's own services, where a login shell's mise finds the image's tools, and the home. Nothing else, so none of the agent's credentials reaches the dialer.
pub const SESSION_ENV: [&str; 12] = [
    "PATH",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "https_proxy",
    "http_proxy",
    "NO_PROXY",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "XDG_RUNTIME_DIR",
    "MISE_SYSTEM_DATA_DIR",
];
const ACCEPTED_CLIENT_ENV: [&str; 2] = ["LANG", "TERM"];

// UNIT_BOUNDARY_DESCRIPTION: what a command over the link runs in: the shell the image gives root, or /bin/sh when it names none or one it lacks, and the home the platform mounts on every machine.
#[derive(Debug, Clone)]
pub struct Login {
    pub shell: PathBuf,
    pub home: PathBuf,
}

impl Login {
    pub fn of_this_machine() -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(crate::guest::AGENT_HOME));
        let shell = std::fs::read_to_string("/etc/passwd")
            .ok()
            .and_then(|passwd| root_shell(&passwd))
            .filter(|shell| shell.is_file())
            .unwrap_or_else(|| PathBuf::from(FALLBACK_SHELL));
        Self { shell, home }
    }
}

fn root_shell(passwd: &str) -> Option<PathBuf> {
    passwd
        .lines()
        .map(|line| line.split(':').collect::<Vec<_>>())
        .find(|fields| fields.len() == 7 && fields[2] == "0")
        .map(|fields| PathBuf::from(fields[6]))
        .filter(|shell| shell.is_absolute())
}

// UNIT_BOUNDARY_DESCRIPTION: the first line of a connection, read one byte at a time so that nothing of the SSH stream behind it is consumed. It must be an OpenSSH public key line of a kind the dialer makes; anything else closes the connection before any SSH is spoken. A connection that ends before its first byte is the runner checking that this machine's link answers, before it tells the dialer `ok`, and reads as no key rather than as a failure.
pub async fn read_key_line<R: AsyncRead + Unpin>(conn: &mut R) -> io::Result<Option<PublicKey>> {
    let mut line = Vec::new();
    loop {
        let byte = match conn.read_u8().await {
            Ok(byte) => byte,
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof && line.is_empty() => {
                return Ok(None)
            }
            Err(e) => return Err(e),
        };
        if byte == b'\n' {
            break;
        }
        if line.len() >= LINK_KEY_LINE_MAX {
            return Err(io::Error::other("the key line is too long"));
        }
        line.push(byte);
    }
    let line = String::from_utf8(line).map_err(|_| io::Error::other("the key line is not text"))?;
    let line = line.trim_end_matches('\r');
    if !KEY_PREFIXES.iter().any(|prefix| line.starts_with(prefix)) {
        return Err(io::Error::other("the connection sent no public key"));
    }
    PublicKey::from_openssh(line)
        .map(Some)
        .map_err(|e| io::Error::other(format!("unreadable key: {e}")))
}

// UNIT_BOUNDARY_DESCRIPTION: one connection, start to end: its key line, then SSH until the dialer closes it. Every channel ends with the connection, so a command still running when the dialer goes away is hung up, as sshd does.
pub async fn serve<S>(mut conn: S, login: Login) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let Some(key) = read_key_line(&mut conn).await? else {
        return Ok(());
    };
    let host = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .map_err(|e| io::Error::other(format!("making a host key: {e}")))?;
    let config = Config {
        methods: MethodSet::from(&[MethodKind::PublicKey][..]),
        keys: vec![host],
        auth_rejection_time: Duration::from_millis(100),
        auth_rejection_time_initial: Some(Duration::ZERO),
        keepalive_interval: Some(Duration::from_secs(30)),
        nodelay: true,
        ..Config::default()
    };
    let link = Link {
        key,
        login: Arc::new(login),
        channels: HashMap::new(),
    };
    let session = russh::server::run_stream(Arc::new(config), conn, link)
        .await
        .map_err(|e| io::Error::other(format!("starting SSH: {e}")))?;
    session
        .await
        .map_err(|e| io::Error::other(format!("SSH: {e}")))
}

struct Link {
    key: PublicKey,
    login: Arc<Login>,
    channels: HashMap<ChannelId, tokio::task::JoinHandle<()>>,
}

impl Link {
    fn admits(&self, key: &PublicKey) -> Auth {
        if key.key_data() == self.key.key_data() {
            Auth::Accept
        } else {
            Auth::reject()
        }
    }
}

impl Handler for Link {
    type Error = russh::Error;

    async fn auth_publickey_offered(
        &mut self,
        _user: &str,
        offer: russh::server::PublicKeyOffer<'_>,
    ) -> Result<Auth, Self::Error> {
        Ok(self.admits(offer.public_key))
    }

    async fn auth_publickey(
        &mut self,
        _user: &str,
        key: russh::server::VerifiedPublicKey<'_>,
    ) -> Result<Auth, Self::Error> {
        Ok(self.admits(key.public_key))
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let id = channel.id();
        reply.accept().await;
        let login = self.login.clone();
        self.channels
            .insert(id, tokio::spawn(serve_channel(channel, login)));
        Ok(())
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let target = u16::try_from(port_to_connect)
            .ok()
            .and_then(|port| forward_target(host_to_connect, port));
        let Some(target) = target else {
            reply.reject(ChannelOpenFailure::ConnectFailed).await;
            return Ok(());
        };
        match tokio::net::TcpStream::connect(target).await {
            Ok(mut tcp) => {
                reply.accept().await;
                tokio::spawn(async move {
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut stream, &mut tcp).await;
                });
            }
            Err(_) => reply.reject(ChannelOpenFailure::ConnectFailed).await,
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)
    }

    async fn env_request(
        &mut self,
        channel: ChannelId,
        variable_name: &str,
        _variable_value: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if accepted_client_env(variable_name) {
            session.channel_success(channel)
        } else {
            session.channel_failure(channel)
        }
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        _data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)
    }

    async fn subsystem_request(
        &mut self,
        channel: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name == "sftp" {
            session.channel_success(channel)
        } else {
            session.channel_failure(channel)
        }
    }

    async fn channel_close(
        &mut self,
        channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.remove(&channel);
        Ok(())
    }
}

// UNIT_BOUNDARY_DESCRIPTION: where a port forward (`ssh -L`) connects: an address, or `localhost`, never a name to look up. This binary is linked statically against glibc, whose name lookup needs the shared libraries of the glibc it was built with at run time, which an image of another distribution does not have; a forward reaches a service inside this machine, which needs no lookup.
fn forward_target(host: &str, port: u16) -> Option<std::net::SocketAddr> {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let address = if host.eq_ignore_ascii_case("localhost") {
        std::net::IpAddr::from(std::net::Ipv4Addr::LOCALHOST)
    } else {
        host.parse().ok()?
    };
    Some(std::net::SocketAddr::new(address, port))
}

fn accepted_client_env(name: &str) -> bool {
    ACCEPTED_CLIENT_ENV.contains(&name) || name.starts_with("LC_")
}

#[derive(Debug, Clone, Copy)]
struct WindowSize {
    cols: u16,
    rows: u16,
}

impl WindowSize {
    fn of(cols: u32, rows: u32) -> Self {
        Self {
            cols: u16::try_from(cols).unwrap_or(u16::MAX),
            rows: u16::try_from(rows).unwrap_or(u16::MAX),
        }
    }
}

enum Run {
    Command(String),
    Shell,
    Sftp,
}

// UNIT_BOUNDARY_DESCRIPTION: one session channel. Its requests come in order — a terminal, variables, then one of a command, a shell or sftp — and the handler has already answered each, so this task only collects them until the one that starts the work.
async fn serve_channel(mut channel: Channel<Msg>, login: Arc<Login>) {
    let mut terminal: Option<(String, WindowSize)> = None;
    let mut env: Vec<(String, String)> = Vec::new();
    let run = loop {
        match channel.wait().await {
            Some(ChannelMsg::RequestPty {
                term,
                col_width,
                row_height,
                ..
            }) => terminal = Some((term, WindowSize::of(col_width, row_height))),
            Some(ChannelMsg::SetEnv {
                variable_name,
                variable_value,
                ..
            }) if accepted_client_env(&variable_name) => env.push((variable_name, variable_value)),
            Some(ChannelMsg::Exec { command, .. }) => {
                break Run::Command(String::from_utf8_lossy(&command).into_owned())
            }
            Some(ChannelMsg::RequestShell { .. }) => break Run::Shell,
            Some(ChannelMsg::RequestSubsystem { name, .. }) if name == "sftp" => break Run::Sftp,
            Some(ChannelMsg::Close) | None => return,
            Some(_) => {}
        }
    };
    let outcome = match run {
        Run::Sftp => run_sftp(&mut channel, &login.home).await,
        Run::Command(line) => run_command(&mut channel, &login, Some(&line), terminal, env).await,
        Run::Shell => run_command(&mut channel, &login, None, terminal, env).await,
    };
    let _ = match outcome {
        Ok(Ended::Exited(code)) => channel.exit_status(code).await,
        Ok(Ended::Signalled(signal)) => {
            channel
                .exit_status(128 + u32::try_from(signal).unwrap_or(0))
                .await
        }
        Ok(Ended::HungUp) => return,
        Err(e) => {
            let _ = channel
                .extended_data_bytes(1, format!("platform-init: {e}\r\n").into_bytes())
                .await;
            channel.exit_status(127).await
        }
    };
    let _ = channel.eof().await;
    let _ = channel.close().await;
}

// UNIT_BOUNDARY_DESCRIPTION: sftp on a channel, relayed through a pipe rather than handed the channel itself, so the channel is still here when sftp ends and reports exit status 0 as sshd does; scp counts a channel that closes without a status as a failed copy.
async fn run_sftp(channel: &mut Channel<Msg>, home: &Path) -> io::Result<Ended> {
    let (ours, theirs) = tokio::io::duplex(1 << 20);
    russh_sftp::server::run(theirs, sftp::Files::new(home.to_path_buf())).await;
    let (from_sftp, mut to_sftp) = tokio::io::split(ours);
    let replies = tokio::spawn(pump(from_sftp, channel.make_writer()));
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                if to_sftp.write_all(&data).await.is_err() {
                    break;
                }
            }
            Some(ChannelMsg::Eof) => break,
            Some(ChannelMsg::Close) | None => return Ok(Ended::HungUp),
            Some(_) => {}
        }
    }
    let _ = to_sftp.shutdown().await;
    let _ = replies.await;
    Ok(Ended::Exited(0))
}

async fn run_command(
    channel: &mut Channel<Msg>,
    login: &Login,
    line: Option<&str>,
    terminal: Option<(String, WindowSize)>,
    env: Vec<(String, String)>,
) -> io::Result<Ended> {
    let mut command = std::process::Command::new(&login.shell);
    let shell_name = login
        .shell
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sh".into());
    match line {
        Some(line) => {
            command.arg0(&shell_name).arg("-c").arg(line);
        }
        None => {
            command.arg0(format!("-{shell_name}"));
        }
    }
    command
        .env("HOME", &login.home)
        .env("USER", LOGIN_NAME)
        .env("LOGNAME", LOGIN_NAME)
        .env("SHELL", &login.shell)
        .envs(env)
        .current_dir(if login.home.is_dir() {
            login.home.as_path()
        } else {
            Path::new("/")
        });
    match terminal {
        Some((term, size)) => {
            command.env("TERM", term);
            run_on_terminal(channel, command, size).await
        }
        None => run_on_pipes(channel, command).await,
    }
}

enum Ended {
    Exited(u32),
    Signalled(i32),
    HungUp,
}

impl Ended {
    fn of(status: std::process::ExitStatus) -> Self {
        use std::os::unix::process::ExitStatusExt;
        match (status.code(), status.signal()) {
            (Some(code), _) => Self::Exited(u32::try_from(code).unwrap_or(1)),
            (None, Some(signal)) => Self::Signalled(signal),
            (None, None) => Self::Exited(1),
        }
    }
}

fn number_of(signal: &Sig) -> Option<i32> {
    Some(match signal {
        Sig::ABRT => libc::SIGABRT,
        Sig::ALRM => libc::SIGALRM,
        Sig::FPE => libc::SIGFPE,
        Sig::HUP => libc::SIGHUP,
        Sig::ILL => libc::SIGILL,
        Sig::INT => libc::SIGINT,
        Sig::KILL => libc::SIGKILL,
        Sig::PIPE => libc::SIGPIPE,
        Sig::QUIT => libc::SIGQUIT,
        Sig::SEGV => libc::SIGSEGV,
        Sig::TERM => libc::SIGTERM,
        Sig::USR1 => libc::SIGUSR1,
        Sig::Custom(_) => return None,
    })
}

fn signal_group(pid: Option<u32>, signal: i32) {
    if let Some(pid) = pid.and_then(|pid| libc::pid_t::try_from(pid).ok()) {
        // SAFETY: kill(2) reads no memory; the child leads its own session, so its pid names its process group.
        unsafe { libc::kill(-pid, signal) };
    }
}

fn own_session(command: &mut std::process::Command) {
    // SAFETY: setsid is async-signal-safe and touches no memory of the parent.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a command without a terminal: its stdout and stderr go back as the channel's data and extended data, and the channel's data is its stdin until the dialer's EOF closes it. The exit is reported only once both streams are drained, so no output arrives after the status.
async fn run_on_pipes(
    channel: &mut Channel<Msg>,
    command: std::process::Command,
) -> io::Result<Ended> {
    let mut command = tokio::process::Command::from(command);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    own_session(command.as_std_mut());
    let mut child = command.spawn()?;
    let pid = child.id();
    let mut stdin = child.stdin.take();
    let stdout = child.stdout.take().map(|out| {
        let writer = channel.make_writer();
        tokio::spawn(pump(out, writer))
    });
    let stderr = child.stderr.take().map(|err| {
        let writer = channel.make_writer_ext(Some(1));
        tokio::spawn(pump(err, writer))
    });
    let status = loop {
        tokio::select! {
            status = child.wait() => break status?,
            message = channel.wait() => match message {
                Some(ChannelMsg::Data { data }) => {
                    if let Some(input) = stdin.as_mut() {
                        if input.write_all(&data).await.is_err() {
                            stdin = None;
                        }
                    }
                }
                Some(ChannelMsg::Eof) => stdin = None,
                Some(ChannelMsg::Signal { signal }) => {
                    if let Some(number) = number_of(&signal) {
                        signal_group(pid, number);
                    }
                }
                Some(ChannelMsg::Close) | None => {
                    signal_group(pid, libc::SIGHUP);
                    return Ok(Ended::HungUp);
                }
                Some(_) => {}
            },
        }
    };
    for pump in [stdout, stderr].into_iter().flatten() {
        let _ = pump.await;
    }
    Ok(Ended::of(status))
}

async fn pump(mut from: impl AsyncRead + Unpin, mut to: impl AsyncWrite + Unpin) {
    let _ = tokio::io::copy(&mut from, &mut to).await;
    let _ = to.flush().await;
}

// UNIT_BOUNDARY_DESCRIPTION: a command on a terminal: a pseudo-terminal whose controlling side the command gets as stdin, stdout and stderr, in a session of its own, so the dialer's keys reach it as a local terminal's would and a window change resizes it. The terminal's output is drained before the exit is reported; reading it fails with EIO once the command and everything it left have closed the terminal, which is its end.
async fn run_on_terminal(
    channel: &mut Channel<Msg>,
    mut command: std::process::Command,
    size: WindowSize,
) -> io::Result<Ended> {
    let (controller, terminal) = open_terminal(size)?;
    command
        .stdin(Stdio::from(terminal.try_clone()?))
        .stdout(Stdio::from(terminal.try_clone()?))
        .stderr(Stdio::from(terminal));
    // SAFETY: setsid and ioctl are async-signal-safe; fd 0 is the terminal the command was just given.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() < 0 || libc::ioctl(0, libc::TIOCSCTTY as _, 0) < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut command = tokio::process::Command::from(command);
    command.kill_on_drop(true);
    let mut child = command.spawn()?;
    let pid = child.id();
    let resize = controller.try_clone()?;
    let mut input = tokio::fs::File::from_std(std::fs::File::from(controller.try_clone()?));
    let output = tokio::fs::File::from_std(std::fs::File::from(controller));
    let output = tokio::spawn(pump(TerminalOutput(output), channel.make_writer()));
    let status = loop {
        tokio::select! {
            status = child.wait() => break status?,
            message = channel.wait() => match message {
                Some(ChannelMsg::Data { data }) => {
                    let _ = input.write_all(&data).await;
                    let _ = input.flush().await;
                }
                Some(ChannelMsg::WindowChange { col_width, row_height, .. }) => {
                    let _ = set_window(&resize, WindowSize::of(col_width, row_height));
                }
                Some(ChannelMsg::Signal { signal }) => {
                    if let Some(number) = number_of(&signal) {
                        signal_group(pid, number);
                    }
                }
                Some(ChannelMsg::Close) | None => {
                    signal_group(pid, libc::SIGHUP);
                    return Ok(Ended::HungUp);
                }
                Some(_) => {}
            },
        }
    };
    drop(input);
    drop(resize);
    let _ = tokio::time::timeout(Duration::from_secs(2), output).await;
    Ok(Ended::of(status))
}

// UNIT_BOUNDARY_DESCRIPTION: a terminal's output side, which ends with EIO rather than with an end of file once nothing holds the terminal open; that EIO is the end of its output, not a failure.
struct TerminalOutput(tokio::fs::File);

impl AsyncRead for TerminalOutput {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        match std::pin::Pin::new(&mut self.0).poll_read(cx, buf) {
            std::task::Poll::Ready(Err(e)) if e.raw_os_error() == Some(libc::EIO) => {
                std::task::Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}

fn open_terminal(size: WindowSize) -> io::Result<(OwnedFd, OwnedFd)> {
    let mut controller: libc::c_int = -1;
    let mut terminal: libc::c_int = -1;
    let window = libc::winsize {
        ws_row: size.rows,
        ws_col: size.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: openpty writes the two descriptors it opens and reads the window size it is given; no name buffer or termios is passed.
    let opened = unsafe {
        libc::openpty(
            &mut controller,
            &mut terminal,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &window as *const libc::winsize as *mut libc::winsize,
        )
    };
    if opened != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: openpty succeeded, so both descriptors are open and owned by nothing else.
    let (controller, terminal) = unsafe {
        (
            OwnedFd::from_raw_fd(controller),
            OwnedFd::from_raw_fd(terminal),
        )
    };
    for fd in [&controller, &terminal] {
        // SAFETY: fcntl(2) on a descriptor this function owns reads no memory.
        unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) };
    }
    Ok((controller, terminal))
}

fn set_window(controller: &OwnedFd, size: WindowSize) -> io::Result<()> {
    let window = libc::winsize {
        ws_row: size.rows,
        ws_col: size.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: TIOCSWINSZ reads one winsize from the pointer, which is live for the call.
    if unsafe { libc::ioctl(controller.as_raw_fd(), libc::TIOCSWINSZ as _, &window) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the process the guest's init starts for one connection, with the connection on stdin and stdout and the image's environment, PLATFORM_LINK included. Its own runtime, since the init has none; its own children, which it reaps itself, so the init's reaper never takes their exit status. Where it fails is said on stderr, which the init points at the link's log.
pub fn session() -> ! {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(e) => {
            eprintln!("platform-link: starting: {e}");
            std::process::exit(1)
        }
    };
    let code = runtime.block_on(async {
        let conn = match connection_on_stdio() {
            Ok(conn) => conn,
            Err(e) => {
                eprintln!("platform-link: the connection: {e}");
                return 1;
            }
        };
        match serve(conn, Login::of_this_machine()).await {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("platform-link: {e}");
                1
            }
        }
    });
    runtime.shutdown_timeout(Duration::from_secs(1));
    std::process::exit(code)
}

fn connection_on_stdio() -> io::Result<tokio::net::UnixStream> {
    // SAFETY: dup(2) reads no memory; stdin is the connection the init handed this process.
    let fd = unsafe { libc::dup(0) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: dup returned a descriptor nothing else owns.
    let socket = unsafe { std::os::unix::net::UnixStream::from_raw_fd(fd) };
    socket.set_nonblocking(true)?;
    tokio::net::UnixStream::from_std(socket)
}

#[cfg(test)]
mod tests;
