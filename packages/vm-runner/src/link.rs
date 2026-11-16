use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use smolvm::config::{PublishedSocketConfig, SocketDirection};
use tokio_util::sync::CancellationToken;

use crate::locked;

// UNIT_BOUNDARY_DESCRIPTION: the link between agents' machines. A machine reaches another's SSH server over two vsock ports of each machine, which smolvm maps to Unix sockets in each machine's own directory, the only directory its VMM may touch. The dial port only dials out: its guest connects to the host and libkrun connects to a socket the runner listens on. The accept port only accepts: libkrun listens on a socket in its directory and hands each connection to the guest's listener. The runner joins them only from a machine allowed to dial to a machine that accepts from that very machine, so an Environment never reaches its owning agent and a sub-agent never reaches its driver. The guest names the target on its first line; the runner refuses one that does not accept from it.

pub use platform_init::guest::{ENVIRONMENT_OF_ENV, LINK_FROM_ENV, LINK_VSOCK_PORT};
pub const LEGACY_GUEST_PATH: &str = "/run/platform/env-link";
pub const DIAL_GUEST_PATH: &str = "/run/platform/link-dial";
pub const ACCEPT_GUEST_PATH: &str = "/run/platform/link-accept";

// UNIT_BOUNDARY_DESCRIPTION: the file in a machine's smolvm directory naming its part in a link — `agent` (dials), `environment <id>` (accepts from that agent, never dials) or `agent accepting <id>` (both) — which the machine's VMM reads beside its boot config, as it reads the gateway host port. The runner writes it at create and at every reshape, from the machine's PLATFORM_ENVIRONMENT_OF and PLATFORM_LINK_FROM env, so no new field crosses the machine API, and a file an earlier runner wrote reads the same.
pub const LINK_ROLE_FILE: &str = "platform-link-role";
pub const AGENT_LINK_SOCKET: &str = "env-link.sock";
pub const ENVIRONMENT_LINK_SOCKET: &str = "env-sshd.sock";

const DIAL_TIMEOUT: Duration = Duration::from_secs(5);
const NAME_LIMIT: usize = 128;
const ACCEPT_RETRY: Duration = Duration::from_millis(100);

// UNIT_BOUNDARY_DESCRIPTION: a machine's part in the link: whether its guest may dial out, which every machine but an Environment may, and the one agent whose machine may dial into it, if any. An Environment accepts from its owning agent and never dials; a sub-agent dials its own Environments and accepts from its driver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Role {
    pub dials: bool,
    pub accepts_from: Option<String>,
}

impl Role {
    pub const AGENT: Role = Role {
        dials: true,
        accepts_from: None,
    };

    pub fn of_env(env: &std::collections::BTreeMap<String, String>) -> Self {
        let set = |key: &str| env.get(key).filter(|v| !v.is_empty()).cloned();
        let environment_of = set(ENVIRONMENT_OF_ENV);
        Role {
            dials: environment_of.is_none(),
            accepts_from: set(LINK_FROM_ENV).or(environment_of),
        }
    }

    pub fn encode(&self) -> String {
        match (self.dials, &self.accepts_from) {
            (true, None) => "agent".into(),
            (false, Some(from)) => format!("environment {from}"),
            (true, Some(from)) => format!("agent accepting {from}"),
            (false, None) => "none".into(),
        }
    }

    pub fn decode(text: &str) -> Option<Self> {
        let text = text.trim();
        let from = |id: &str| crate::state::is_machine_id(id).then(|| id.to_string());
        match text {
            "agent" => Some(Role::AGENT),
            "none" => Some(Role {
                dials: false,
                accepts_from: None,
            }),
            _ => {
                if let Some(id) = text.strip_prefix("agent accepting ") {
                    return Some(Role {
                        dials: true,
                        accepts_from: Some(from(id)?),
                    });
                }
                let id = text.strip_prefix("environment ")?;
                Some(Role {
                    dials: false,
                    accepts_from: Some(from(id)?),
                })
            }
        }
    }

    pub fn accepts(&self, agent: &str) -> bool {
        self.accepts_from.as_deref() == Some(agent)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: both halves of the link on every machine, in a fixed order, since smolvm numbers published sockets by their place from 6100 up: the dial socket first (guest port 6100, where every guest's dialer connects) and the accept socket second (6101, where the guest's init listens). A machine that may not dial still has the dial socket, which libkrun only connects through when the guest dials, and the runner never listens on it; a machine that accepts from no one still has the accept socket, on which its guest listens for nothing.
pub fn published_sockets(vm_dir: &Path) -> [PublishedSocketConfig; 2] {
    let at = |socket: &str| Some(vm_dir.join(socket).to_string_lossy().into_owned());
    [
        PublishedSocketConfig {
            direction: SocketDirection::Mount,
            guest_path: DIAL_GUEST_PATH.into(),
            host_path: at(AGENT_LINK_SOCKET),
        },
        PublishedSocketConfig {
            direction: SocketDirection::Expose,
            guest_path: ACCEPT_GUEST_PATH.into(),
            host_path: at(ENVIRONMENT_LINK_SOCKET),
        },
    ]
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

// UNIT_BOUNDARY_DESCRIPTION: where a machine's smolvm directory is, or nothing for a runtime with none. A connection that names a target reads its role from there at that moment, so a role written since the link opened is the one that counts.
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

    // UNIT_BOUNDARY_DESCRIPTION: listens on the dial socket of a machine that may dial, replacing a listener a crashed runner left. Called on every create, reshape and runner start for every such machine; a second call for a machine already served does nothing.
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
                        tracing::info!(machine = %agent, error = %e, "link refused");
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

// UNIT_BOUNDARY_DESCRIPTION: one connection from a dialing guest. Its first line names the target machine; the runner joins it to the target's accept socket only when the target's role accepts from this machine, answers `ok` or a reason, and from then on copies bytes both ways on the one connection the dialer opened.
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
    tracing::info!(machine = %agent, target = %env, "link opened");
    let _ = tokio::io::copy_bidirectional(&mut conn, &mut upstream).await;
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the target's id on the connection's first line, within NAME_LIMIT bytes and DIAL_TIMEOUT, and whatever the guest sent past it, which belongs to the target's SSH server.
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
        return Err("no machine named".into());
    }
    let Some(end) = got.iter().position(|&b| b == b'\n') else {
        return Err("no machine named".into());
    };
    let env = String::from_utf8_lossy(&got[..end]).trim().to_string();
    if !crate::state::is_machine_id(&env) {
        return Err(format!("{env:?} is not a machine id"));
    }
    Ok((env, got[end + 1..].to_vec()))
}

async fn resolve(dirs: &Dirs, agent: &str, env: &str) -> Result<tokio::net::UnixStream, String> {
    let dir = dirs(env).ok_or_else(|| format!("{env} has no machine here"))?;
    if !read_role(&dir).is_some_and(|role| role.accepts(agent)) {
        return Err(format!("{env} does not accept a link from {agent}"));
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

    const CHILD: &str = "agent-c000000000000001";

    fn env_of(pairs: &[(&str, &str)]) -> std::collections::BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // TEST_SCENARIO: a machine's role comes from its spec: an Environment (PLATFORM_ENVIRONMENT_OF) accepts from its owner and never dials, a sub-agent (PLATFORM_LINK_FROM) dials and accepts from its driver, any other agent only dials. Each survives the file round trip, the file an older runner wrote reads the same, and an id that is not a machine id reads as no role at all, so a hand-edited file opens no link.
    #[test]
    fn a_role_comes_from_the_spec_and_round_trips() {
        let environment = Role::of_env(&env_of(&[(ENVIRONMENT_OF_ENV, AGENT)]));
        assert_eq!(
            environment,
            Role {
                dials: false,
                accepts_from: Some(AGENT.into())
            }
        );
        let sub_agent = Role::of_env(&env_of(&[(LINK_FROM_ENV, AGENT)]));
        assert_eq!(
            sub_agent,
            Role {
                dials: true,
                accepts_from: Some(AGENT.into())
            }
        );
        assert_eq!(Role::of_env(&Default::default()), Role::AGENT);
        for role in [environment, sub_agent, Role::AGENT] {
            assert_eq!(Role::decode(&role.encode()), Some(role));
        }
        assert_eq!(Role::decode("agent"), Some(Role::AGENT));
        assert_eq!(
            Role::decode(&format!("environment {AGENT}")),
            Some(Role {
                dials: false,
                accepts_from: Some(AGENT.into())
            })
        );
        assert_eq!(Role::decode("environment ../x"), None);
        assert_eq!(Role::decode("agent accepting ../x"), None);
        assert_eq!(Role::decode("root"), None);
    }

    // TEST_SCENARIO: every machine publishes the dial socket first (mount: libkrun connects to the runner's socket) and the accept socket second (expose: libkrun listens), each with its host end in the machine's own directory, so the guest ports are the same on every machine.
    #[test]
    fn every_machine_publishes_dial_then_accept() {
        let [dial, accept] = published_sockets(Path::new("/vm/a"));
        assert_eq!(dial.direction, SocketDirection::Mount);
        assert_eq!(dial.host_path.as_deref(), Some("/vm/a/env-link.sock"));
        assert_eq!(accept.direction, SocketDirection::Expose);
        assert_eq!(accept.host_path.as_deref(), Some("/vm/a/env-sshd.sock"));
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

        fn environment(&self, id: &str, owner: &str) {
            self.accepting(
                id,
                Role {
                    dials: false,
                    accepts_from: Some(owner.into()),
                },
            );
        }

        // UNIT_BOUNDARY_DESCRIPTION: a machine's SSH server, which echoes what it gets, prefixed, on its accept socket.
        fn accepting(&self, id: &str, role: Role) {
            let dir = self.dir(id);
            write_role(&dir, &role).unwrap();
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

    // TEST_SCENARIO: the owning agent names its Environment on the first line and reaches that Environment's SSH server, with the bytes it sent past the name passed on.
    #[tokio::test]
    async fn the_owning_agent_reaches_its_environment() {
        let f = Fixture::new();
        f.environment(ENV, AGENT);
        let reply = f.dial(AGENT, &format!("{ENV}\nSSH-2.0")).await;
        assert_eq!(reply, "ok\nsshd:SSH-2.0");
    }

    // TEST_SCENARIO: a driver reaches its own sub-agent, which accepts from it while it may still dial, and the sub-agent reaches an Environment it owns, so one machine both accepts and dials.
    #[tokio::test]
    async fn a_driver_reaches_its_sub_agent_which_reaches_its_own_environment() {
        let f = Fixture::new();
        f.accepting(
            CHILD,
            Role {
                dials: true,
                accepts_from: Some(AGENT.into()),
            },
        );
        f.environment(ENV, CHILD);
        assert_eq!(
            f.dial(AGENT, &format!("{CHILD}\nSSH-2.0")).await,
            "ok\nsshd:SSH-2.0"
        );
        assert_eq!(
            f.dial(CHILD, &format!("{ENV}\nSSH-2.0")).await,
            "ok\nsshd:SSH-2.0"
        );
    }

    // TEST_SCENARIO: a link runs only from the one agent a machine accepts from: another agent, the driver's own driver to its grandchild, and a sub-agent to its driver are all refused, and a name that is not a machine id is refused before anything reaches a machine.
    #[tokio::test]
    async fn only_the_named_agent_is_admitted() {
        let f = Fixture::new();
        f.environment(ENV, AGENT);
        f.accepting(
            CHILD,
            Role {
                dials: true,
                accepts_from: Some(AGENT.into()),
            },
        );
        f.accepting(AGENT, Role::AGENT);
        assert_eq!(
            f.dial(OTHER, &format!("{ENV}\n")).await,
            format!("refused {ENV} does not accept a link from {OTHER}\n")
        );
        assert_eq!(
            f.dial(OTHER, &format!("{CHILD}\n")).await,
            format!("refused {CHILD} does not accept a link from {OTHER}\n")
        );
        assert_eq!(
            f.dial(CHILD, &format!("{AGENT}\n")).await,
            format!("refused {AGENT} does not accept a link from {CHILD}\n")
        );
        assert!(f
            .dial(AGENT, "../etc\n")
            .await
            .starts_with("refused \"../etc\""));
    }

    // TEST_SCENARIO: an Environment never dials: the runner serves no dial socket for it, so its guest has nowhere to dial, and naming its owning agent is refused.
    #[tokio::test]
    async fn an_environment_cannot_reach_its_agent() {
        let f = Fixture::new();
        f.environment(ENV, AGENT);
        write_role(&f.dir(AGENT), &Role::AGENT).unwrap();
        assert!(!f.links.is_serving(ENV));
        assert_eq!(
            f.dial(ENV, &format!("{AGENT}\n")).await,
            format!("refused {AGENT} does not accept a link from {ENV}\n")
        );
    }

    // TEST_SCENARIO: a target that is not running has no socket, and the dialer is told so rather than left hanging; the dialer wakes it on exactly these words.
    #[tokio::test]
    async fn a_stopped_target_is_reported() {
        let f = Fixture::new();
        write_role(
            &f.dir(ENV),
            &Role {
                dials: false,
                accepts_from: Some(AGENT.into()),
            },
        )
        .unwrap();
        assert_eq!(
            f.dial(AGENT, &format!("{ENV}\n")).await,
            format!("refused {ENV} is not running\n")
        );
    }
}
