// UNIT_BOUNDARY_DESCRIPTION: the Satellite mount, one FUSE filesystem at /mnt/sat inside every machine: a directory per files Satellite the Agent is granted, and under each, that machine's tree read and written one operation at a time through the platform. It runs as threads of the guest's init and not as a process beside it, because platform-init kills every process whenever the image's entrypoint exits — which is every image without openrc, and so a harness restart — and a mount whose daemon was killed answers "Transport endpoint is not connected" until the next reboot. Nothing here is a child, nothing here is installed into an image, and nothing here is started by the controller: the mount arrives with the runner release and serves whatever the platform grants.
// UNIT_BOUNDARY_DESCRIPTION: it is dormant by construction. No Satellite of kind files can exist yet, so the mount lists nothing and asks the platform on a timer. A platform older than the channel answers 404 to the grant list, which the mount logs once and backs off from, keeping an empty mount rather than disappearing.
#[cfg(test)]
pub(crate) mod trace {
    use std::sync::Mutex;

    static LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());

    pub fn add(line: String) {
        LINES
            .lock()
            .unwrap_or_else(|held| held.into_inner())
            .push(line);
    }

    pub fn take() -> Vec<String> {
        std::mem::take(&mut *LINES.lock().unwrap_or_else(|held| held.into_inner()))
    }
}

mod fs;
mod inodes;
mod platform;
#[cfg(test)]
mod tests;
mod wire;

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::Duration;

use fuser::{
    Config as FuseConfig, INodeNo, MountOption, Notifier, Session, SessionACL, SessionUnmounter,
};

use crate::boot::log;
use fs::SatelliteFs;
use wire::Grant;

pub const MOUNT_POINT: &str = "/mnt/sat";

// UNIT_BOUNDARY_DESCRIPTION: the four times the mount lives by. The grants are read every 30 s, which is the window the design promises an Agent for a grant to appear or go; the first answer is waited for at most a second, because a session that starts right after the boot reads its instructions then and should already see the mount, and the entrypoint is not held longer than that for a platform that is slow or absent; a failed poll backs off to five minutes, so a machine whose platform predates the channel asks quietly; and attributes are cached by the kernel for the same 30 s the platform promises.
const GRANTS_EVERY: Duration = Duration::from_secs(30);
const FIRST_ANSWER: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(300);
const TTL: Duration = Duration::from_secs(30);

// UNIT_BOUNDARY_DESCRIPTION: how long the mount waits before it mounts again after its session ended, which unmounting it by hand and an error in the session loop both do. It never gives up: a mount that stays broken and a mount that stays absent read the same to the Agent, so the one thing worth doing is trying again.
const SESSION_RETRY: Duration = Duration::from_secs(5);

// UNIT_BOUNDARY_DESCRIPTION: what the launch record says the mount needs. The api-server and the Agent are the two the controller sets in every machine's environment; without both there is no channel to open, and the mount does not start at all, which is what a machine booted by an older controller gets. The proxy is the gateway the machine reaches everything else through, named by an IP literal: the request goes to the proxy as its absolute URI, so the target is never resolved.
pub struct Config {
    pub api_server: String,
    pub agent: String,
    pub proxy: Option<String>,
}

pub fn config_from_env(env: &[(String, String)]) -> Option<Config> {
    let value = |key: &str| {
        env.iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
            .filter(|value| !value.is_empty())
    };
    Some(Config {
        api_server: value("API_SERVER_URL")?,
        agent: value("PLATFORM_AGENT_ID")?,
        proxy: value("HTTP_PROXY").or_else(|| value("http_proxy")),
    })
}

// UNIT_BOUNDARY_DESCRIPTION: what every thread of the mount shares: where the platform is, the grants as last read, the numbers handed to the kernel, and the handle that tells the kernel its cached attributes and pages are gone. The grants and the inode table are behind their own locks so one operation's round trip never holds up another, and the notifier is replaced on every mount, since a notification goes down the session it was taken from.
pub struct State {
    config: Config,
    client: platform::Client,
    grants: RwLock<Vec<Grant>>,
    inodes: Mutex<inodes::Table>,
    notifier: Mutex<Option<Notifier>>,
    unmount: Mutex<Option<SessionUnmounter>>,
}

impl State {
    fn new(config: Config, client: platform::Client) -> Self {
        Self {
            config,
            client,
            grants: RwLock::new(Vec::new()),
            inodes: Mutex::new(inodes::Table::new()),
            notifier: Mutex::new(None),
            unmount: Mutex::new(None),
        }
    }

    fn inodes(&self) -> MutexGuard<'_, inodes::Table> {
        self.inodes.lock().unwrap_or_else(|held| held.into_inner())
    }

    fn grants(&self) -> Vec<Grant> {
        self.grants
            .read()
            .unwrap_or_else(|held| held.into_inner())
            .clone()
    }

    fn grant(&self, name: &str) -> Option<Grant> {
        self.grants
            .read()
            .unwrap_or_else(|held| held.into_inner())
            .iter()
            .find(|grant| grant.name == name)
            .cloned()
    }

    // UNIT_BOUNDARY_DESCRIPTION: a new grant list, and the kernel's cache of what it took away. The list is published first, so an operation already in flight already answers ENOENT for a revoked grant and EHOSTDOWN for a Satellite that went quiet; then the kernel is told to drop the pages and attributes it cached for each of them, because a read it answered from its page cache would otherwise keep the bytes it read before the machine went quiet. A Satellite that is only quiet keeps the numbers of its tree, since a process whose working directory is inside it must still have one when the machine answers again; one whose grant is gone is forgotten whole.
    fn set_grants(&self, next: Vec<Grant>) {
        let withdrawn = {
            let mut held = self.grants.write().unwrap_or_else(|held| held.into_inner());
            let withdrawn = wire::withdrawn(&held, &next);
            *held = next;
            withdrawn
        };
        for satellite in withdrawn.quiet {
            self.invalidate(&satellite);
        }
        for satellite in withdrawn.gone {
            self.invalidate(&satellite);
            let numbers = self.inodes().forget(&satellite);
            self.invalidate_numbers(&numbers, &satellite);
        }
    }

    fn invalidate(&self, satellite: &str) {
        let numbers = self.inodes().numbers(satellite);
        self.invalidate_numbers(&numbers, satellite);
    }

    fn invalidate_numbers(&self, numbers: &[u64], satellite: &str) {
        let held = self
            .notifier
            .lock()
            .unwrap_or_else(|held| held.into_inner());
        let Some(notifier) = held.as_ref() else {
            return;
        };
        for number in numbers {
            let _ = notifier.inval_inode(INodeNo(*number), 0, 0);
        }
        let _ = notifier.inval_entry(INodeNo::ROOT, OsStr::new(satellite));
        let _ = notifier.inval_inode(INodeNo::ROOT, 0, 0);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the mount's start, called by the boot after the mount tree is shared and before the image's entrypoint: it mounts, reads the grants once, and returns, so an empty mount is there for whatever starts next and a session that starts immediately already sees its own. The mount comes first so the grant request — which is what the platform counts the mount's presence by — is never made for a mount that is not there. The first read is given a second, because a session that starts right after the boot reads its instructions then; the entrypoint is not held longer than that for a platform that is slow. A machine without the launch environment, or without /dev/fuse, boots without a mount and says so on the console; nothing here can fail the boot.
pub fn start(env: &[(String, String)]) {
    let Some(config) = config_from_env(env) else {
        return;
    };
    let client = match platform::Client::new(&config.api_server, config.proxy.as_deref()) {
        Ok(client) => client,
        Err(e) => {
            log(format_args!("satellite mount: {e}"));
            return;
        }
    };
    let state = Arc::new(State::new(config, client));
    let session = mount(&state, Path::new(MOUNT_POINT));
    match &session {
        Ok(_) => log(format_args!("satellite mount: mounted at {MOUNT_POINT}")),
        Err(e) => log(format_args!(
            "satellite mount: {MOUNT_POINT} is not mounted: {e}"
        )),
    }
    // UNIT_BOUNDARY_DESCRIPTION: the first grant read happens only once the mount stands, because that same read is what records the mount's presence: a guest without /dev/fuse would otherwise tell the platform it serves a mount that is not there, and the Agent's instructions would name it.
    if session.is_ok() {
        match state.client.grants(&state.config.agent, FIRST_ANSWER) {
            Ok(grants) => state.set_grants(grants),
            Err(platform::GrantsError::NotServed) => log(format_args!(
                "satellite mount: this platform answers no satellite-file grants, so nothing appears under {MOUNT_POINT} until it does"
            )),
            Err(platform::GrantsError::Failed(e)) => log(format_args!(
                "satellite mount: reading the grants for {}: {e}",
                state.config.agent
            )),
        }
    }
    std::thread::spawn(move || serve(state, PathBuf::from(MOUNT_POINT), session.ok()));
}

// UNIT_BOUNDARY_DESCRIPTION: one session, mounted and recorded as the one the mount is. The notifier and the unmounter both belong to the session, not to the state, so a session that ended and a session that replaced it never send each other's notifications or unmount each other's mount.
fn mount(state: &Arc<State>, at: &Path) -> std::io::Result<Session<SatelliteFs>> {
    std::fs::create_dir_all(at)?;
    let mut session = Session::new(SatelliteFs::new(state.clone()), at, &mount_config())?;
    *state
        .notifier
        .lock()
        .unwrap_or_else(|held| held.into_inner()) = Some(session.notifier());
    *state
        .unmount
        .lock()
        .unwrap_or_else(|held| held.into_inner()) = Some(session.unmount_callable());
    Ok(session)
}

// UNIT_BOUNDARY_DESCRIPTION: unmounts the session the mount is serving now, for a test that has to take the mount away and watch the thread above put it back. The mount itself never does this: a machine keeps its mount until it stops.
#[cfg(test)]
fn unmount(state: &State) -> std::io::Result<()> {
    let mut held = state
        .unmount
        .lock()
        .unwrap_or_else(|held| held.into_inner());
    match held.as_mut() {
        Some(unmount) => unmount.unmount(),
        None => Ok(()),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the options the mount is made with. Read-write, because the platform decides per grant and per operation whether a change may land, and nosuid and nodev, because nothing in a Satellite's tree is a device or a setuid binary the Agent should be given. allow_other (SessionACL::All) so the harness's own users reach the mount. Four threads, each with its own descriptor to the kernel, so one operation waiting on a machine does not stop the kernel asking about another.
fn mount_config() -> FuseConfig {
    let mut config = FuseConfig::default();
    config.mount_options = vec![
        MountOption::RW,
        MountOption::NoSuid,
        MountOption::NoDev,
        MountOption::FSName(String::from("satellite-files")),
    ];
    config.acl = SessionACL::All;
    config.n_threads = Some(4);
    config.clone_fd = true;
    config
}

// UNIT_BOUNDARY_DESCRIPTION: the session's own thread: it runs the filesystem the kernel talks to, mounts it where the boot could not, and mounts it again whenever it ends. The session ends when the mount is unmounted by hand or when the kernel's descriptor fails; either way the numbers the kernel knows survive in the table, so what mounts again is the same tree with the same grants. The grant list starts being polled only once a mount stands, because that poll is what records the mount's presence, and instructions that name a mount the machine does not have are worse than none.
fn serve(state: Arc<State>, at: PathBuf, first: Option<Session<SatelliteFs>>) {
    let mut next = first;
    let mut polling = false;
    loop {
        let session = match next.take() {
            Some(session) => session,
            None => {
                std::thread::sleep(SESSION_RETRY);
                match mount(&state, &at) {
                    Ok(session) => session,
                    Err(e) => {
                        log(format_args!(
                            "satellite mount: {} is still not mounted: {e}",
                            at.display()
                        ));
                        continue;
                    }
                }
            }
        };
        if !polling {
            polling = true;
            let polling = state.clone();
            std::thread::spawn(move || poll_grants(polling));
        }
        match session.run() {
            Ok(()) => log(format_args!(
                "satellite mount: {} was unmounted",
                at.display()
            )),
            Err(e) => log(format_args!("satellite mount: {} ended: {e}", at.display())),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one piece of work on a thread of the mount, and the panic it may raise. A panic inside PID 1 would reset the machine, so every body a callback or the poller runs goes through here: the panic is caught, said once on the console, and the mount carries on. The thread-local flag is what the boot's panic hook reads to tell this apart from a panic that ends the boot and should print FATAL, and the hook is why a caught panic costs no second of sleep.
thread_local! {
    static IN_CALLBACK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub fn in_callback() -> bool {
    IN_CALLBACK.with(std::cell::Cell::get)
}

fn guarded<T>(what: &str, body: impl FnOnce() -> T) -> Option<T> {
    IN_CALLBACK.with(|flag| flag.set(true));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(body));
    IN_CALLBACK.with(|flag| flag.set(false));
    match outcome {
        Ok(value) => Some(value),
        Err(_) => {
            log(format_args!(
                "satellite mount: {what} panicked, and the mount carries on"
            ));
            None
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the grant list's own thread: every 30 s, one GET, which is also what the platform counts the mount as present by and so what the Agent's instructions are written from. A failed read is asked for again on that same cadence, because a grant that a transient failure delayed is exactly what AC-3 promises within 30 s; only a platform that answers no grants at all — one older than the channel — is backed off from, since nothing will change there until it is upgraded. Either is said once per streak rather than every 30 s, and the thread never ends: a poller that panicked once and stopped would leave the mount listing whatever it last saw.
fn poll_grants(state: Arc<State>) {
    let mut wait = GRANTS_EVERY;
    let mut failing = false;
    let mut not_served = false;
    loop {
        std::thread::sleep(wait);
        let polled = guarded("the grant list", || {
            match state.client.grants(&state.config.agent, GRANTS_EVERY) {
                Ok(grants) => {
                    state.set_grants(grants);
                    Polled::Read
                }
                Err(platform::GrantsError::NotServed) => Polled::NotServed,
                Err(platform::GrantsError::Failed(e)) => Polled::Failed(e),
            }
        });
        match polled {
            Some(Polled::Read) => {
                if failing {
                    log(format_args!("satellite mount: the grants are read again"));
                    failing = false;
                    not_served = false;
                }
                wait = GRANTS_EVERY;
            }
            Some(Polled::NotServed) => {
                if !not_served {
                    log(format_args!(
                        "satellite mount: this platform answers no satellite-file grants yet; nothing appears under {MOUNT_POINT} until it does"
                    ));
                    not_served = true;
                    failing = true;
                }
                wait = (wait * 2).min(BACKOFF_MAX);
            }
            Some(Polled::Failed(e)) => {
                if !failing {
                    log(format_args!(
                        "satellite mount: reading the grants for {}: {e}",
                        state.config.agent
                    ));
                    failing = true;
                }
                wait = GRANTS_EVERY;
            }
            None => {
                failing = true;
                wait = GRANTS_EVERY;
            }
        }
    }
}

enum Polled {
    Read,
    NotServed,
    Failed(String),
}
