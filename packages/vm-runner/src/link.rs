use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use smolvm::config::{PublishedSocketConfig, SocketDirection};
use tokio_util::sync::CancellationToken;

use crate::locked;

// UNIT_BOUNDARY_DESCRIPTION: the Environment Link. An owning agent's machine reaches the sshd of an Environment it owns over two vsock ports, one per machine, that smolvm maps to Unix sockets in each machine's own directory, the only directory its VMM may touch. The agent's port only dials out: its guest connects to the host and libkrun connects to a socket the runner listens on. The Environment's port only accepts: libkrun listens on a socket in its directory and hands each connection to the guest's listener. The runner joins the two, only from agent to Environment, so nothing in an Environment can open a connection towards its owning agent. The guest names the Environment on its first line; the runner refuses one the agent does not own.

// UNIT_BOUNDARY_DESCRIPTION: the guest vsock port of the link on both machines. smolvm maps a machine's published sockets to ports from 6100 up, in their order, and the link is the first, so it is 6100 on each machine; each VMM has a vsock device of its own, so the two never meet but through the runner. The guest path is never used: no smolvm guest agent runs to relay it, and the guests reach the port themselves.
pub const LINK_VSOCK_PORT: u32 = 6100;
pub const GUEST_PATH: &str = "/run/platform/env-link";

// UNIT_BOUNDARY_DESCRIPTION: the file in a machine's smolvm directory naming its part in a link — `agent`, or `environment <owning agent id>` — which the machine's VMM reads beside its boot config, as it reads the gateway host port. The runner writes it at create and at every reshape, from the machine's PLATFORM_ENVIRONMENT_OF env, so no new field crosses the machine API.
pub const LINK_ROLE_FILE: &str = "platform-link-role";
pub const AGENT_LINK_SOCKET: &str = "env-link.sock";
pub const ENVIRONMENT_LINK_SOCKET: &str = "env-sshd.sock";
pub const ENVIRONMENT_OF_ENV: &str = "PLATFORM_ENVIRONMENT_OF";

const DIAL_TIMEOUT: Duration = Duration::from_secs(5);
const NAME_LIMIT: usize = 128;
const ACCEPT_RETRY: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Role {
    Agent,
    Environment { owner: String },
}

impl Role {
    pub fn of_env(env: &std::collections::BTreeMap<String, String>) -> Self {
        match env.get(ENVIRONMENT_OF_ENV).filter(|v| !v.is_empty()) {
            Some(owner) => Role::Environment {
                owner: owner.clone(),
            },
            None => Role::Agent,
        }
    }

    pub fn encode(&self) -> String {
        match self {
            Role::Agent => "agent".into(),
            Role::Environment { owner } => format!("environment {owner}"),
        }
    }

    pub fn decode(text: &str) -> Option<Self> {
        let text = text.trim();
        if text == "agent" {
            return Some(Role::Agent);
        }
        text.strip_prefix("environment ")
            .filter(|owner| crate::state::is_machine_id(owner))
            .map(|owner| Role::Environment {
                owner: owner.to_string(),
            })
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether libkrun listens on this machine's host socket — the Environment, whose guest accepts — or connects to it — the agent, whose guest dials out — and the socket's name in the machine's directory.
    pub fn socket(&self) -> (SocketDirection, &'static str) {
        match self {
            Role::Agent => (SocketDirection::Mount, AGENT_LINK_SOCKET),
            Role::Environment { .. } => (SocketDirection::Expose, ENVIRONMENT_LINK_SOCKET),
        }
    }
}

pub fn published_socket(role: &Role, vm_dir: &Path) -> PublishedSocketConfig {
    let (direction, socket) = role.socket();
    PublishedSocketConfig {
        direction,
        guest_path: GUEST_PATH.into(),
        host_path: Some(vm_dir.join(socket).to_string_lossy().into_owned()),
    }
}

pub fn write_role(vm_dir: &Path, role: &Role) -> anyhow::Result<()> {
    Ok(crate::files::write(
        &vm_dir.join(LINK_ROLE_FILE),
        role.encode().as_bytes(),
        0o644,
    )?)
}

pub fn read_role(vm_dir: &Path) -> Option<Role> {
    Role::decode(&std::fs::read_to_string(vm_dir.join(LINK_ROLE_FILE)).ok()?)
}

// UNIT_BOUNDARY_DESCRIPTION: where a machine's smolvm directory is, or nothing for a runtime with none. A connection that names an Environment reads its role from there at that moment, so a role written since the link opened is the one that counts.
pub type Dirs = dyn Fn(&str) -> Option<PathBuf> + Send + Sync;

pub struct Links {
    runtime: tokio::runtime::Handle,
    dirs: std::sync::Arc<Dirs>,
    serving: Mutex<HashMap<String, CancellationToken>>,
}

impl Links {
    pub fn new(runtime: tokio::runtime::Handle, dirs: std::sync::Arc<Dirs>) -> Self {
        Self {
            runtime,
            dirs,
            serving: Mutex::new(HashMap::new()),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: listens on an agent machine's link socket, replacing a listener a crashed runner left. Called on every create, reshape and runner start for every agent machine; a second call for a machine already served does nothing.
    pub fn serve(&self, agent: &str) -> anyhow::Result<()> {
        let mut serving = locked(&self.serving);
        if serving.contains_key(agent) {
            return Ok(());
        }
        let Some(dir) = (self.dirs)(agent) else {
            return Ok(());
        };
        let path = dir.join(AGENT_LINK_SOCKET);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let _ = std::fs::remove_file(&path);
        let listener = std::os::unix::net::UnixListener::bind(&path)
            .map_err(|e| anyhow::anyhow!("listening on {}: {e}", path.display()))?;
        listener.set_nonblocking(true)?;
        let stop = CancellationToken::new();
        serving.insert(agent.to_string(), stop.clone());
        let dirs = self.dirs.clone();
        let agent = agent.to_string();
        self.runtime.spawn(async move {
            let Ok(listener) = tokio::net::UnixListener::from_std(listener) else {
                return;
            };
            loop {
                let accepted = tokio::select! {
                    _ = stop.cancelled() => return,
                    accepted = listener.accept() => accepted,
                };
                let Ok((conn, _)) = accepted else {
                    tokio::select! {
                        _ = stop.cancelled() => return,
                        _ = tokio::time::sleep(ACCEPT_RETRY) => continue,
                    }
                };
                let dirs = dirs.clone();
                let agent = agent.clone();
                tokio::spawn(async move {
                    if let Err(e) = splice(&*dirs, &agent, conn).await {
                        tracing::info!(machine = %agent, error = %e, "environment link refused");
                    }
                });
            }
        });
        Ok(())
    }

    pub fn stop(&self, agent: &str) {
        if let Some(stop) = locked(&self.serving).remove(agent) {
            stop.cancel();
        }
    }

    pub fn stop_all(&self) {
        for (_, stop) in locked(&self.serving).drain() {
            stop.cancel();
        }
    }

    #[cfg(test)]
    pub fn is_serving(&self, agent: &str) -> bool {
        locked(&self.serving).contains_key(agent)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one connection from an agent's guest. Its first line names the Environment; the runner joins it to that Environment's sshd socket only when the Environment's role names this agent as its owner, answers `ok` or a reason, and from then on copies bytes both ways on the one connection the agent opened.
async fn splice(dirs: &Dirs, agent: &str, mut conn: tokio::net::UnixStream) -> anyhow::Result<()> {
    use tokio::io::AsyncWriteExt;
    let (env, buffered) = match read_name(&mut conn).await {
        Ok(read) => read,
        Err(why) => return refuse(&mut conn, why).await,
    };
    let upstream = match resolve(dirs, agent, &env).await {
        Ok(upstream) => upstream,
        Err(why) => return refuse(&mut conn, why).await,
    };
    let mut upstream = upstream;
    conn.write_all(b"ok\n").await?;
    if !buffered.is_empty() {
        upstream.write_all(&buffered).await?;
    }
    tracing::info!(machine = %agent, environment = %env, "environment link opened");
    let _ = tokio::io::copy_bidirectional(&mut conn, &mut upstream).await;
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the Environment id on the connection's first line, within NAME_LIMIT bytes and DIAL_TIMEOUT, and whatever the guest sent past it, which belongs to the Environment's sshd.
async fn read_name(conn: &mut tokio::net::UnixStream) -> Result<(String, Vec<u8>), String> {
    use tokio::io::AsyncReadExt;
    let mut got = Vec::new();
    let read = tokio::time::timeout(DIAL_TIMEOUT, async {
        let mut chunk = [0u8; 256];
        while !got.contains(&b'\n') && got.len() < NAME_LIMIT {
            let n = conn.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            got.extend_from_slice(&chunk[..n]);
        }
        std::io::Result::Ok(())
    })
    .await;
    if !matches!(read, Ok(Ok(()))) {
        return Err("no Environment named".into());
    }
    let Some(end) = got.iter().position(|&b| b == b'\n') else {
        return Err("no Environment named".into());
    };
    let env = String::from_utf8_lossy(&got[..end]).trim().to_string();
    if !crate::state::is_machine_id(&env) {
        return Err(format!("{env:?} is not an Environment id"));
    }
    Ok((env, got[end + 1..].to_vec()))
}

async fn resolve(dirs: &Dirs, agent: &str, env: &str) -> Result<tokio::net::UnixStream, String> {
    let dir = dirs(env).ok_or_else(|| format!("{env} has no machine here"))?;
    match read_role(&dir) {
        Some(Role::Environment { owner }) if owner == agent => {}
        _ => return Err(format!("{env} is not an Environment of {agent}")),
    }
    let dial = tokio::time::timeout(
        DIAL_TIMEOUT,
        tokio::net::UnixStream::connect(dir.join(ENVIRONMENT_LINK_SOCKET)),
    )
    .await;
    match dial {
        Ok(Ok(upstream)) => Ok(upstream),
        _ => Err(format!("{env} is not running")),
    }
}

async fn refuse(conn: &mut tokio::net::UnixStream, why: String) -> anyhow::Result<()> {
    use tokio::io::AsyncWriteExt;
    let _ = conn.write_all(format!("refused {why}\n").as_bytes()).await;
    anyhow::bail!(why)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const AGENT: &str = "agent-0123456789abcdef";
    const OTHER: &str = "agent-fedcba9876543210";
    const ENV: &str = "agent-e000000000000001";

    // TEST_SCENARIO: a machine's role comes from its spec's PLATFORM_ENVIRONMENT_OF, survives the file round trip, and an owner that is not a machine id reads as no role at all, so a hand-edited file opens no link.
    #[test]
    fn a_role_round_trips_and_a_bad_owner_reads_as_none() {
        let env =
            std::collections::BTreeMap::from([(ENVIRONMENT_OF_ENV.to_string(), AGENT.to_string())]);
        let role = Role::of_env(&env);
        assert_eq!(
            role,
            Role::Environment {
                owner: AGENT.into()
            }
        );
        assert_eq!(Role::decode(&role.encode()), Some(role));
        assert_eq!(Role::of_env(&Default::default()), Role::Agent);
        assert_eq!(Role::decode("agent"), Some(Role::Agent));
        assert_eq!(Role::decode("environment ../x"), None);
        assert_eq!(Role::decode("root"), None);
    }

    // TEST_SCENARIO: the agent's half only dials out (mount: libkrun connects to the runner's socket) and the Environment's half only accepts (expose: libkrun listens), each with its host end in the machine's own directory.
    #[test]
    fn the_agent_dials_out_and_the_environment_accepts() {
        let dir = Path::new("/vm/a");
        let agent = published_socket(&Role::Agent, dir);
        assert_eq!(agent.direction, SocketDirection::Mount);
        assert_eq!(agent.host_path.as_deref(), Some("/vm/a/env-link.sock"));
        let env = published_socket(
            &Role::Environment {
                owner: AGENT.into(),
            },
            dir,
        );
        assert_eq!(env.direction, SocketDirection::Expose);
        assert_eq!(env.host_path.as_deref(), Some("/vm/a/env-sshd.sock"));
    }

    struct Fixture {
        root: TempDir,
        links: Links,
    }

    impl Fixture {
        fn new() -> Self {
            let root = TempDir::new("link");
            let base = root.path().to_path_buf();
            let links = Links::new(
                tokio::runtime::Handle::current(),
                Arc::new(move |id: &str| Some(base.join(id))),
            );
            Self { root, links }
        }

        fn dir(&self, id: &str) -> PathBuf {
            let dir = self.root.path().join(id);
            std::fs::create_dir_all(&dir).unwrap();
            dir
        }

        // UNIT_BOUNDARY_DESCRIPTION: an Environment's sshd, which echoes what it gets, prefixed, on its expose socket.
        fn environment(&self, id: &str, owner: &str) {
            let dir = self.dir(id);
            write_role(
                &dir,
                &Role::Environment {
                    owner: owner.into(),
                },
            )
            .unwrap();
            let listener =
                tokio::net::UnixListener::bind(dir.join(ENVIRONMENT_LINK_SOCKET)).unwrap();
            tokio::spawn(async move {
                while let Ok((mut conn, _)) = listener.accept().await {
                    tokio::spawn(async move {
                        let mut buf = [0u8; 64];
                        let n = conn.read(&mut buf).await.unwrap_or(0);
                        let _ = conn.write_all(b"sshd:").await;
                        let _ = conn.write_all(&buf[..n]).await;
                    });
                }
            });
        }

        async fn dial(&self, agent: &str, line: &str) -> String {
            self.dir(agent);
            self.links.serve(agent).unwrap();
            let mut conn = tokio::net::UnixStream::connect(self.dir(agent).join(AGENT_LINK_SOCKET))
                .await
                .unwrap();
            conn.write_all(line.as_bytes()).await.unwrap();
            let mut out = Vec::new();
            let _ = tokio::time::timeout(Duration::from_secs(5), conn.read_to_end(&mut out)).await;
            String::from_utf8_lossy(&out).into_owned()
        }
    }

    // TEST_SCENARIO: the owning agent names its Environment on the first line and reaches that Environment's sshd, with the bytes it sent past the name passed on.
    #[tokio::test]
    async fn the_owning_agent_reaches_its_environment() {
        let f = Fixture::new();
        f.environment(ENV, AGENT);
        let reply = f.dial(AGENT, &format!("{ENV}\nSSH-2.0")).await;
        assert_eq!(reply, "ok\nsshd:SSH-2.0");
    }

    // TEST_SCENARIO: another agent of the same owner, and a name that is not a machine id, are refused before anything reaches the Environment.
    #[tokio::test]
    async fn another_agent_and_a_bad_name_are_refused() {
        let f = Fixture::new();
        f.environment(ENV, AGENT);
        assert_eq!(
            f.dial(OTHER, &format!("{ENV}\n")).await,
            format!("refused {ENV} is not an Environment of {OTHER}\n")
        );
        assert!(f
            .dial(AGENT, "../etc\n")
            .await
            .starts_with("refused \"../etc\""));
    }

    // TEST_SCENARIO: the link only runs from agent to Environment. An Environment's own machine has no agent socket served, so its guest has nowhere to dial, and an agent naming another agent — not an Environment — is refused.
    #[tokio::test]
    async fn an_environment_cannot_reach_its_agent() {
        let f = Fixture::new();
        f.environment(ENV, AGENT);
        write_role(&f.dir(AGENT), &Role::Agent).unwrap();
        assert!(!f.links.is_serving(ENV));
        assert_eq!(
            f.dial(ENV, &format!("{AGENT}\n")).await,
            format!("refused {AGENT} is not an Environment of {ENV}\n")
        );
    }

    // TEST_SCENARIO: an Environment that is not running has no socket, and the agent is told so rather than left hanging.
    #[tokio::test]
    async fn a_stopped_environment_is_reported() {
        let f = Fixture::new();
        write_role(
            &f.dir(ENV),
            &Role::Environment {
                owner: AGENT.into(),
            },
        )
        .unwrap();
        assert_eq!(
            f.dial(AGENT, &format!("{ENV}\n")).await,
            format!("refused {ENV} is not running\n")
        );
    }
}
