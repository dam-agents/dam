// UNIT_BOUNDARY_DESCRIPTION: platform-runc, the OCI runtime every container inside a machine is started through: docker's containers, the RUN steps of its builds, and k3s pods. A container's root is the image it runs, not the guest, so it trusts only the public roots that image ships and fails TLS to every host the gateway intercepts. On `create` and `run` this gives the container copies of the CA bundles it would read, from its image or its bind mounts, with the platform CA appended, in a directory of the wrapper's own mounted read-only, and points the CA environment variables at them; then it execs the real runc. The image's own files and the mounts' sources are never written or mounted over, so a build that rebuilds its trust store keeps working, nothing reaches the image's layers or config, and a Dockerfile needs no change. Any failure to inject is reported and the container starts without the CA, because refusing it would stop every container on the machine.
use std::collections::VecDeque;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{self, Read};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};

use crate::guest;

// UNIT_BOUNDARY_DESCRIPTION: the name the image's entrypoint moves docker's own runc to when it puts this wrapper in its place. docker's builder runs whatever `runc` it finds on PATH and ignores the daemon's default runtime, so the wrapper has to take the name itself, and it finds the binary it replaced beside it under this suffix.
pub const REAL_SUFFIX: &str = ".real";

// UNIT_BOUNDARY_DESCRIPTION: where distributions keep the CA bundle their TLS clients read: Debian, Ubuntu and Alpine; Fedora and RHEL; SUSE; and the path LibreSSL and some minimal images use. The first one the container sees as a file, in its image or in a bind mount over it, is the bundle the copies start from.
pub const BUNDLES: &[&str] = &[
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/ssl/cert.pem",
];

// UNIT_BOUNDARY_DESCRIPTION: the variables TLS clients read a CA bundle from: OpenSSL-based tools, Go, Ruby and Python's ssl; curl, including a curl built with its own bundle path; Python's requests and pip; Node, which adds these to its built-in roots; and git, whose GnuTLS build reads none of the others. Each is pointed at a copy of the bundle it would otherwise use, with the CA appended — a variable the container sets to a file keeps that file's roots, whether the image ships the file or a bind mount puts it there, like the Secret a nested platform mounts its own CA from. A client that reads only the distribution's own path and no variable, like a Java keystore or GnuTLS-based wget and apt, does not see the CA.
pub const ENV: &[&str] = &[
    "SSL_CERT_FILE",
    "CURL_CA_BUNDLE",
    "REQUESTS_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "GIT_SSL_CAINFO",
];

// UNIT_BOUNDARY_DESCRIPTION: where the copies appear inside the container. It is the wrapper's own path, so the image's bundles stay the image's: a build that regenerates one renames a new file over it, which a mount on that path would refuse.
pub const GUEST_DIR: &str = "/run/platform-ca";

// UNIT_BOUNDARY_DESCRIPTION: the copies are written into the container's bundle directory, which the caller creates for this one container and removes with it, so nothing here has to be cleaned up.
pub const MERGED_DIR: &str = "platform-ca";

// UNIT_BOUNDARY_DESCRIPTION: the image or a mount decides what sits at a bundle path, so a file larger than any real CA bundle is left alone rather than copied on every container start.
pub const MAX_BUNDLE_BYTES: u64 = 16 << 20;

const GLOBAL_FLAGS_WITH_VALUE: &[&str] =
    &["--root", "--log", "--log-format", "--criu", "--rootless"];

pub fn run(args: Vec<OsString>) -> io::Error {
    let real = match std::env::current_exe()
        .and_then(fs::canonicalize)
        .and_then(|this| real_runc(std::env::var_os("PATH").as_deref(), &this))
    {
        Ok(real) => real,
        Err(e) => return e,
    };
    if let Some(bundle) = creating_bundle(&args) {
        match fs::read(guest::GUEST_CA_FILE) {
            Ok(ca) if !ca.is_empty() => {
                if let Err(e) = inject(&bundle, &ca) {
                    eprintln!(
                        "platform-runc: WARNING: the container starts without the platform CA: {e}"
                    );
                }
            }
            _ => {}
        }
    }
    Command::new(real).args(args).exec()
}

// UNIT_BOUNDARY_DESCRIPTION: the runc this wrapper hands the container to: the first `runc` on PATH that is not this binary, or, where the one on PATH is this binary under docker's name, the original kept beside it. Under k3s that is k3s's own runc; under docker, docker's.
pub fn real_runc(path: Option<&OsStr>, this: &Path) -> io::Result<PathBuf> {
    for dir in std::env::split_paths(path.unwrap_or_default()) {
        let candidate = dir.join("runc");
        let Ok(resolved) = fs::canonicalize(&candidate) else {
            continue;
        };
        if resolved != this {
            if is_executable(&candidate) {
                return Ok(candidate);
            }
            continue;
        }
        let aside = dir.join(format!("runc{REAL_SUFFIX}"));
        if is_executable(&aside) {
            return Ok(aside);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "no runc on PATH to hand the container to",
    ))
}

// UNIT_BOUNDARY_DESCRIPTION: the bundle of a `create` or `run`, the two commands that start a container from a spec. Every other command passes through untouched. runc's default bundle is its working directory.
pub fn creating_bundle(args: &[OsString]) -> Option<PathBuf> {
    let mut args = args.iter();
    let command = loop {
        let arg = args.next()?.to_str()?;
        if !arg.starts_with('-') {
            break arg;
        }
        if GLOBAL_FLAGS_WITH_VALUE.contains(&arg) {
            args.next();
        }
    };
    if command != "create" && command != "run" {
        return None;
    }
    let mut bundle = PathBuf::from(".");
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--bundle" | "-b") => bundle = PathBuf::from(args.next()?),
            Some(arg) if arg.starts_with("--bundle=") => {
                bundle = PathBuf::from(&arg["--bundle=".len()..]);
            }
            _ => {}
        }
    }
    Some(bundle)
}

// UNIT_BOUNDARY_DESCRIPTION: rewrites the bundle's spec to carry the CA and returns how many variables it pointed at a copy. The spec is replaced by rename, so the runtime reads the old spec or the new one and never half of either.
pub fn inject(bundle: &Path, ca: &[u8]) -> io::Result<usize> {
    let spec_path = bundle.join("config.json");
    let mut spec: Value = serde_json::from_slice(&fs::read(&spec_path)?)?;
    let root = spec
        .pointer("/root/path")
        .and_then(Value::as_str)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "the spec names no root"))?;
    let container = Container::from_spec(bundle, Path::new(root), &spec)?;
    let taken = spec
        .get("mounts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|m| m.get("destination").and_then(Value::as_str) == Some(GUEST_DIR));
    let Some(env) = spec.pointer("/process/env").and_then(Value::as_array) else {
        return Ok(0);
    };
    if taken {
        return Ok(0);
    }
    let env: Vec<String> = env
        .iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect();

    let mut system = None;
    for path in BUNDLES {
        if let Some(own) = container.read(path)? {
            system = Some((path.to_string(), own));
            break;
        }
    }

    let mut copies: Vec<(String, Vec<u8>)> = Vec::new();
    let mut pointed: Vec<(&str, String)> = Vec::new();
    for name in ENV {
        let source = match value_of(&env, name) {
            Some(value) if nameable(value) => {
                container.read(value)?.map(|own| (value.to_string(), own))
            }
            Some(_) => None,
            None => system.clone(),
        };
        let Some((path, own)) = source else {
            continue;
        };
        let index = match copies.iter().position(|(p, _)| *p == path) {
            Some(index) => index,
            None => {
                copies.push((path, own));
                copies.len() - 1
            }
        };
        pointed.push((name, format!("{GUEST_DIR}/{index}.pem")));
    }
    if pointed.is_empty() {
        return Ok(0);
    }

    let merged_dir = bundle.join(MERGED_DIR);
    fs::create_dir_all(&merged_dir)?;
    for (index, (_, own)) in copies.iter().enumerate() {
        fs::write(merged_dir.join(format!("{index}.pem")), merge(own, ca))?;
    }
    let source = fs::canonicalize(&merged_dir)?;
    let spec_object = spec
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "the spec is not an object"))?;
    spec_object
        .entry("mounts")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "the spec's mounts are not a list",
            )
        })?
        .push(json!({
            "destination": GUEST_DIR,
            "type": "bind",
            "source": source,
            "options": ["rbind", "ro"],
        }));
    if let Some(env) = spec
        .pointer_mut("/process/env")
        .and_then(Value::as_array_mut)
    {
        for (name, value) in &pointed {
            let prefix = format!("{name}=");
            env.retain(|v| !v.as_str().is_some_and(|v| v.starts_with(&prefix)));
            env.push(Value::String(format!("{prefix}{value}")));
        }
    }

    let staged = bundle.join("config.json.platform-runc");
    fs::write(&staged, serde_json::to_vec(&spec)?)?;
    fs::rename(&staged, &spec_path)?;
    Ok(pointed.len())
}

fn value_of<'a>(env: &'a [String], name: &str) -> Option<&'a str> {
    env.iter()
        .rev()
        .find_map(|entry| entry.strip_prefix(name)?.strip_prefix('='))
}

// UNIT_BOUNDARY_DESCRIPTION: a value the image set is read as a file only when it is an absolute path that does not climb with `..`, since the path is the image's to choose. Any other value is left exactly as the image set it.
fn nameable(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute() && !path.components().any(|c| c == Component::ParentDir)
}

// UNIT_BOUNDARY_DESCRIPTION: the Linux limit on symlinks followed while resolving one path. A loop of links in an image or a volume ends the walk there and the path reads as absent.
const MAX_SYMLINKS: usize = 40;

// UNIT_BOUNDARY_DESCRIPTION: the files a container will see, read from outside it before it starts: its root, with each bind mount of the spec laid over it in the spec's order. A path resolves the way it will inside the container: a symlink resolves against the container's root, never the guest's, and a path under a bind mount reads from the mount's source. A variable the container sets to a mounted file — a Secret or ConfigMap volume, or a docker bind mount — then keeps that file's roots like a file of the image. Every read stays inside the root or a bind mount's source, so a path or link the container chose never copies one of the guest's own files into it.
struct Container {
    root: PathBuf,
    mounts: Vec<Mount>,
}

// UNIT_BOUNDARY_DESCRIPTION: one mount of the spec. The destination is resolved through the root and the mounts before it, as runc resolves it, so a mount on `/var/run/...` in an image where `/var/run` links to `/run` covers `/run/...`. Only a bind mount has a source to read; any other mount, a tmpfs or a proc, hides what is under it, so a path there reads as absent.
struct Mount {
    destination: Vec<OsString>,
    source: Option<PathBuf>,
}

enum Reached {
    Found { base: PathBuf, host: PathBuf },
    Unreadable,
}

impl Container {
    fn from_spec(bundle: &Path, root: &Path, spec: &Value) -> io::Result<Self> {
        let mut container = Container {
            root: fs::canonicalize(bundle.join(root))?,
            mounts: Vec::new(),
        };
        for mount in spec
            .get("mounts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(destination) = mount.get("destination").and_then(Value::as_str) else {
                continue;
            };
            let destination = match container.walk(Path::new(destination)) {
                Ok((resolved, _)) => resolved,
                Err(_) => lexical(Vec::new(), steps(Path::new(destination))),
            };
            let source = mount
                .get("source")
                .and_then(Value::as_str)
                .filter(|_| is_bind(mount))
                .and_then(|source| fs::canonicalize(bundle.join(source)).ok());
            container.mounts.push(Mount {
                destination,
                source,
            });
        }
        Ok(container)
    }

    fn read(&self, path: &str) -> io::Result<Option<Vec<u8>>> {
        match self.walk(Path::new(path))? {
            (_, Reached::Found { base, host }) => read_beneath(&base, &host),
            (_, Reached::Unreadable) => Ok(None),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: resolves a path inside the container one component at a time, without following any link on the guest: each step is looked up in the root or the bind mount that covers it, and a link found there is spliced into the rest of the path, from the container's root when it is absolute. A missing component, a non-bind mount or a loop of links stops the walk, and the rest of the path is appended as written, which is how runc places a mount whose destination does not exist yet.
    fn walk(&self, path: &Path) -> io::Result<(Vec<OsString>, Reached)> {
        let mut at: Vec<OsString> = Vec::new();
        let mut rest = steps(path);
        let mut links = 0;
        while let Some(step) = rest.pop_front() {
            match step {
                Step::Into(name) => at.push(name),
                Step::Up => {
                    at.pop();
                    continue;
                }
            }
            if self.leads_to_a_mount(&at) {
                continue;
            }
            let Some((_, host)) = self.host_path(&at) else {
                return Ok((lexical(at, rest), Reached::Unreadable));
            };
            let meta = match fs::symlink_metadata(&host) {
                Ok(meta) => meta,
                Err(e) if is_absent(&e) => return Ok((lexical(at, rest), Reached::Unreadable)),
                Err(e) => return Err(e),
            };
            if !meta.file_type().is_symlink() {
                continue;
            }
            links += 1;
            if links > MAX_SYMLINKS {
                return Ok((lexical(at, rest), Reached::Unreadable));
            }
            let target = fs::read_link(&host)?;
            at.pop();
            if target.is_absolute() {
                at.clear();
            }
            for step in steps(&target).into_iter().rev() {
                rest.push_front(step);
            }
        }
        let reached = match self.host_path(&at) {
            Some((base, host)) => Reached::Found { base, host },
            None => Reached::Unreadable,
        };
        Ok((at, reached))
    }

    // UNIT_BOUNDARY_DESCRIPTION: a directory a mount placed after the one covering it is mounted inside. runc creates such a directory when it is missing, a link already resolved when the mount's destination was, so the walk goes through it as a directory without reading it: `/var/run/secrets` for a Secret mounted beneath it, or `/dev` for a file mounted inside the tmpfs there.
    fn leads_to_a_mount(&self, at: &[OsString]) -> bool {
        let after = self
            .mounts
            .iter()
            .rposition(|m| at.starts_with(&m.destination))
            .map_or(0, |covering| covering + 1);
        self.mounts[after..]
            .iter()
            .any(|m| m.destination.len() > at.len() && m.destination.starts_with(at))
    }

    fn host_path(&self, at: &[OsString]) -> Option<(PathBuf, PathBuf)> {
        let (base, under) = match self
            .mounts
            .iter()
            .rev()
            .find(|m| at.starts_with(&m.destination))
        {
            Some(mount) => (mount.source.clone()?, &at[mount.destination.len()..]),
            None => (self.root.clone(), at),
        };
        let host = under
            .iter()
            .fold(base.clone(), |path, name| path.join(name));
        Some((base, host))
    }
}

fn is_bind(mount: &Value) -> bool {
    mount.get("type").and_then(Value::as_str) == Some("bind")
        || mount
            .get("options")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|o| matches!(o.as_str(), Some("bind" | "rbind")))
}

fn is_absent(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::NotFound || e.raw_os_error() == Some(libc::ENOTDIR)
}

enum Step {
    Into(OsString),
    Up,
}

fn steps(path: &Path) -> VecDeque<Step> {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(Step::Into(name.to_owned())),
            Component::ParentDir => Some(Step::Up),
            _ => None,
        })
        .collect()
}

fn lexical(mut at: Vec<OsString>, rest: VecDeque<Step>) -> Vec<OsString> {
    for step in rest {
        match step {
            Step::Into(name) => at.push(name),
            Step::Up => {
                at.pop();
            }
        }
    }
    at
}

// UNIT_BOUNDARY_DESCRIPTION: reads one resolved file only if it is still a regular file beneath `base` once open. A volume another container writes to can swap a directory for a link between the walk and the open; the open refuses a link in the last component, and the opened file's real path is checked against `base`, so the swap reads nothing. A FIFO is opened without blocking and then refused as not a file.
fn read_beneath(base: &Path, host: &Path) -> io::Result<Option<Vec<u8>>> {
    let file = match fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(host)
    {
        Ok(file) => file,
        Err(e) if is_absent(&e) || e.raw_os_error() == Some(libc::ELOOP) => return Ok(None),
        Err(e) => return Err(e),
    };
    let meta = file.metadata()?;
    if !meta.is_file() || meta.len() > MAX_BUNDLE_BYTES {
        return Ok(None);
    }
    let opened = fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))?;
    if !opened.starts_with(base) {
        return Ok(None);
    }
    let mut own = Vec::new();
    file.take(MAX_BUNDLE_BYTES + 1).read_to_end(&mut own)?;
    if own.len() as u64 > MAX_BUNDLE_BYTES {
        return Ok(None);
    }
    Ok(Some(own))
}

fn merge(own: &[u8], ca: &[u8]) -> Vec<u8> {
    let mut merged = own.to_vec();
    if !merged.is_empty() && !merged.ends_with(b"\n") {
        merged.push(b'\n');
    }
    merged.extend_from_slice(ca);
    if !merged.ends_with(b"\n") {
        merged.push(b'\n');
    }
    merged
}

fn is_executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(test)]
mod tests {
    // TEST_OVERVIEW: platform-runc stands between every container runtime in a machine and runc. It must find the real runc whichever runtime called it, touch only the commands that start a container, give a container copies of the image's own CA bundles with the platform CA appended at a path of its own, resolve links and bind mounts as the container will see them without ever reading a file of the guest's, never write or mount over the image's files or a mount's source, keep the roots a variable names whether the image ships the file or a bind mount puts it there, and change nothing when the container has no bundle.
    use super::*;
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "platform-runc-{name}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TempDir(fs::canonicalize(path).unwrap())
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const CA: &[u8] = b"-----BEGIN CERTIFICATE-----\nplatform\n-----END CERTIFICATE-----\n";

    fn executable(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"#!/bin/true\n").unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn os(args: &[&str]) -> Vec<OsString> {
        args.iter().map(OsString::from).collect()
    }

    fn bundle_with(dir: &Path, files: &[(&str, &str)], spec: Value) -> PathBuf {
        let bundle = dir.join("bundle");
        for (path, content) in files {
            let at = bundle.join("rootfs").join(path.trim_start_matches('/'));
            fs::create_dir_all(at.parent().unwrap()).unwrap();
            fs::write(at, content).unwrap();
        }
        fs::create_dir_all(bundle.join("rootfs")).unwrap();
        fs::write(
            bundle.join("config.json"),
            serde_json::to_vec(&spec).unwrap(),
        )
        .unwrap();
        bundle
    }

    fn spec() -> Value {
        json!({
            "root": {"path": "rootfs"},
            "process": {"env": ["PATH=/usr/bin"]},
            "mounts": [{"destination": "/proc", "type": "proc", "source": "proc"}],
        })
    }

    fn read_spec(bundle: &Path) -> Value {
        serde_json::from_slice(&fs::read(bundle.join("config.json")).unwrap()).unwrap()
    }

    // TEST_SCENARIO: under k3s the wrapper is named directly and k3s's own runc is on PATH; the wrapper hands the container to the first runc that is not itself.
    #[test]
    fn the_first_other_runc_on_path_is_the_real_one() {
        let dir = TempDir::new("path");
        let this = dir.path().join("platform/runc");
        executable(&this);
        executable(&dir.path().join("k3s/bin/runc"));
        executable(&dir.path().join("docker/runc"));
        let path =
            std::env::join_paths([dir.path().join("k3s/bin"), dir.path().join("docker")]).unwrap();

        assert_eq!(
            real_runc(Some(&path), &this).unwrap(),
            dir.path().join("k3s/bin/runc")
        );
    }

    // TEST_SCENARIO: under docker the wrapper is docker's runc: the entrypoint moved the original aside and linked this binary in its place, because docker's builder only ever runs the runc on PATH. The wrapper must pick the original from beside the link and never exec itself.
    #[test]
    fn under_dockers_name_the_original_is_kept_beside_it() {
        let dir = TempDir::new("aside");
        let this = dir.path().join("platform/runc");
        executable(&this);
        let docker = dir.path().join("docker");
        executable(&docker.join("runc.real"));
        symlink(&this, docker.join("runc")).unwrap();
        let path = std::env::join_paths([&docker]).unwrap();

        assert_eq!(
            real_runc(Some(&path), &this).unwrap(),
            docker.join("runc.real")
        );
    }

    // TEST_SCENARIO: a PATH with only the wrapper on it has no runtime to hand to. That is an error, never an exec of the wrapper itself, which would loop.
    #[test]
    fn a_path_with_only_the_wrapper_is_an_error() {
        let dir = TempDir::new("alone");
        let this = dir.path().join("platform/runc");
        executable(&this);
        let docker = dir.path().join("docker");
        fs::create_dir_all(&docker).unwrap();
        symlink(&this, docker.join("runc")).unwrap();
        let path = std::env::join_paths([&docker, &dir.path().join("platform")]).unwrap();

        assert!(real_runc(Some(&path), &this).is_err());
    }

    // TEST_SCENARIO: the command lines containerd's shim and docker's builder actually pass. Only create and run start a container from a spec; start, delete, state, features and version pass through untouched.
    #[test]
    fn only_the_commands_that_start_a_container_are_touched() {
        assert_eq!(
            creating_bundle(&os(&[
                "--root",
                "/run/containerd/runc/k8s.io",
                "--log",
                "/run/x/log.json",
                "--log-format",
                "json",
                "create",
                "--bundle",
                "/run/x/task",
                "--pid-file",
                "/run/x/init.pid",
                "abc",
            ])),
            Some(PathBuf::from("/run/x/task"))
        );
        assert_eq!(
            creating_bundle(&os(&[
                "--log",
                "/home/agent/.local/share/docker/buildkit/executor/runc-log.json",
                "--log-format",
                "json",
                "run",
                "--bundle",
                "/b/k2",
                "k2",
            ])),
            Some(PathBuf::from("/b/k2"))
        );
        assert_eq!(
            creating_bundle(&os(&["run", "--bundle=/b", "id"])),
            Some(PathBuf::from("/b"))
        );
        assert_eq!(
            creating_bundle(&os(&["create", "id"])),
            Some(PathBuf::from("."))
        );
        for passthrough in [
            &["--root", "/r", "start", "abc"][..],
            &["--root", "/r", "delete", "--force", "abc"],
            &["features"],
            &["--version"],
            &["--root", "/r", "state", "create"],
        ] {
            assert_eq!(creating_bundle(&os(passthrough)), None, "{passthrough:?}");
        }
    }

    fn mount_at<'a>(spec: &'a Value, destination: &str) -> Vec<&'a Value> {
        spec["mounts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["destination"] == destination)
            .collect()
    }

    fn copy_named_by(bundle: &Path, spec: &Value, name: &str) -> Vec<u8> {
        let value = value_of(
            &spec["process"]["env"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect::<Vec<_>>(),
            name,
        )
        .unwrap_or_else(|| panic!("{name} is not set"))
        .to_string();
        let file = value
            .strip_prefix(&format!("{GUEST_DIR}/"))
            .unwrap_or_else(|| panic!("{name}={value} is not a copy in {GUEST_DIR}"));
        fs::read(bundle.join(MERGED_DIR).join(file)).unwrap()
    }

    // TEST_SCENARIO: the case that breaks today. A Fedora image keeps its bundle at a real file and links the other path to it; the container gets a copy of that file with the CA appended, in the wrapper's own directory mounted read-only, and every CA variable names the copy. The image's roots come first, and nothing is mounted over the image's own paths, so a build step that regenerates the bundle can still rename a new one into place.
    #[test]
    fn every_variable_names_a_copy_of_the_images_bundle_with_the_ca() {
        let dir = TempDir::new("fedora");
        let bundle = bundle_with(
            dir.path(),
            &[(
                "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
                "public roots",
            )],
            spec(),
        );
        fs::create_dir_all(bundle.join("rootfs/etc/pki/tls/certs")).unwrap();
        symlink(
            "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
            bundle.join("rootfs/etc/pki/tls/certs/ca-bundle.crt"),
        )
        .unwrap();

        assert_eq!(inject(&bundle, CA).unwrap(), ENV.len());

        let spec = read_spec(&bundle);
        let mounts = mount_at(&spec, GUEST_DIR);
        assert_eq!(mounts.len(), 1);
        assert_eq!(mounts[0]["type"], "bind");
        assert_eq!(mounts[0]["options"], json!(["rbind", "ro"]));
        assert!(Path::new(mounts[0]["source"].as_str().unwrap()).starts_with(&bundle));
        for name in ENV {
            assert_eq!(
                copy_named_by(&bundle, &spec, name),
                [b"public roots\n".as_slice(), CA].concat(),
                "{name}"
            );
        }
        for path in BUNDLES {
            assert!(
                mount_at(&spec, path).is_empty(),
                "{path} is mounted over, so a build could not regenerate it"
            );
        }
        assert_eq!(
            fs::read(bundle.join("rootfs/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"))
                .unwrap(),
            b"public roots",
            "the image's own file must not change: it is a layer of the image"
        );
    }

    // TEST_SCENARIO: an image's symlinks resolve against the guest when read naively from outside the container. A link on the way to a bundle path resolves against the container's root instead, so a link naming a guest directory finds nothing and no file of the guest's is copied into a container.
    #[test]
    fn a_symlink_in_the_image_is_never_followed() {
        let dir = TempDir::new("escape");
        let bundle = bundle_with(dir.path(), &[], spec());
        fs::create_dir_all(bundle.join("rootfs/etc")).unwrap();
        symlink(dir.path(), bundle.join("rootfs/etc/ssl")).unwrap();
        fs::create_dir_all(dir.path().join("certs")).unwrap();
        fs::write(dir.path().join("certs/ca-certificates.crt"), "guest file").unwrap();

        assert_eq!(inject(&bundle, CA).unwrap(), 0);
        assert_eq!(
            read_spec(&bundle),
            spec(),
            "the spec must be left as it was"
        );
    }

    // TEST_SCENARIO: an image with no CA bundle cannot do TLS at all, so there is nothing to add the CA to and the spec is left exactly as the runtime wrote it — no mount, no variables pointing at a file that is not there.
    #[test]
    fn an_image_without_a_bundle_is_left_alone() {
        let dir = TempDir::new("slim");
        let bundle = bundle_with(dir.path(), &[("/etc/os-release", "debian")], spec());

        assert_eq!(inject(&bundle, CA).unwrap(), 0);
        assert_eq!(read_spec(&bundle), spec());
        assert!(!bundle.join(MERGED_DIR).exists());
    }

    // TEST_SCENARIO: a variable the image sets names the bundle that client reads, like the official curl image pointing CURL_CA_BUNDLE at a file outside every distribution path. It is pointed at a copy of that same file with the CA appended, so the image keeps its own roots. A value that is not a readable absolute path — one that climbs out with `..`, or names nothing — is left exactly as the image set it.
    #[test]
    fn a_variable_the_image_sets_keeps_its_roots_and_gains_the_ca() {
        let dir = TempDir::new("named");
        let mut spec = spec();
        spec["process"]["env"] = json!([
            "PATH=/usr/bin",
            "CURL_CA_BUNDLE=/cacert.pem",
            "REQUESTS_CA_BUNDLE=/etc/../outside.pem",
            "NODE_EXTRA_CA_CERTS=/missing.pem",
        ]);
        let bundle = bundle_with(
            dir.path(),
            &[
                ("/etc/ssl/certs/ca-certificates.crt", "alpine roots"),
                ("/cacert.pem", "curl roots"),
                ("/outside.pem", "not read"),
            ],
            spec,
        );

        assert_eq!(inject(&bundle, CA).unwrap(), 3);

        let spec = read_spec(&bundle);
        assert_eq!(
            copy_named_by(&bundle, &spec, "CURL_CA_BUNDLE"),
            [b"curl roots\n".as_slice(), CA].concat()
        );
        assert_eq!(
            copy_named_by(&bundle, &spec, "SSL_CERT_FILE"),
            [b"alpine roots\n".as_slice(), CA].concat()
        );
        let env = spec["process"]["env"].as_array().unwrap();
        assert!(env.contains(&json!("REQUESTS_CA_BUNDLE=/etc/../outside.pem")));
        assert!(env.contains(&json!("NODE_EXTRA_CA_CERTS=/missing.pem")));
        assert!(env.contains(&json!("PATH=/usr/bin")));
        assert_eq!(
            env.iter()
                .filter(|v| v.as_str().unwrap().starts_with("CURL_CA_BUNDLE="))
                .count(),
            1,
            "the image's value is replaced, not shadowed by a second entry"
        );
    }

    // TEST_SCENARIO: something already mounted at the wrapper's own path — a user's own volume there — is not mounted over a second time, and the spec is left alone.
    #[test]
    fn a_spec_that_already_mounts_the_wrappers_path_is_left_alone() {
        let dir = TempDir::new("taken");
        let mut spec = spec();
        spec["mounts"] = json!([{"destination": GUEST_DIR, "type": "bind", "source": "/x"}]);
        let bundle = bundle_with(
            dir.path(),
            &[("/etc/ssl/certs/ca-certificates.crt", "roots")],
            spec.clone(),
        );

        assert_eq!(inject(&bundle, CA).unwrap(), 0);
        assert_eq!(read_spec(&bundle), spec);
    }

    // TEST_SCENARIO: docker's builder writes an absolute root path into the spec, containerd a relative one. Both resolve to the same rootfs.
    #[test]
    fn an_absolute_root_path_is_read_as_is() {
        let dir = TempDir::new("absolute");
        let mut spec = spec();
        spec["root"]["path"] = json!(dir.path().join("bundle/rootfs"));
        let bundle = bundle_with(
            dir.path(),
            &[("/etc/ssl/certs/ca-certificates.crt", "roots")],
            spec,
        );

        assert_eq!(inject(&bundle, CA).unwrap(), ENV.len());
    }

    fn with_mounts(mut spec: Value, env: &[&str], mounts: Value) -> Value {
        let mut all = spec["mounts"].as_array().unwrap().clone();
        all.extend(mounts.as_array().unwrap().iter().cloned());
        spec["mounts"] = Value::Array(all);
        let mut vars = vec![json!("PATH=/usr/bin")];
        vars.extend(env.iter().map(|v| json!(v)));
        spec["process"]["env"] = Value::Array(vars);
        spec
    }

    fn secret_volume(dir: &Path, files: &[(&str, &str)]) -> PathBuf {
        let volume = dir.join("kubelet/volumes/secret");
        let data = volume.join("..2026_10_01_00_00_00.000000000");
        fs::create_dir_all(&data).unwrap();
        symlink("..2026_10_01_00_00_00.000000000", volume.join("..data")).unwrap();
        for (name, content) in files {
            fs::write(data.join(name), content).unwrap();
            symlink(format!("..data/{name}"), volume.join(name)).unwrap();
        }
        volume
    }

    fn bind(destination: &str, source: &Path) -> Value {
        json!({
            "destination": destination,
            "type": "bind",
            "source": source,
            "options": ["rbind", "rprivate", "ro"],
        })
    }

    // TEST_SCENARIO: the nested platform case. Its agent pods set NODE_EXTRA_CA_CERTS to the nested gateway's CA, which kubelet mounts from a Secret: a directory of links through `..data` to a timestamped directory. Node reads only that variable, so it must name a copy of the Secret's file with the platform CA appended, written beside the other copies, while the read-only volume itself stays as kubelet wrote it.
    #[test]
    fn a_variable_naming_a_file_in_a_secret_volume_keeps_its_roots_and_gains_the_ca() {
        let dir = TempDir::new("secret");
        let volume = secret_volume(dir.path(), &[("ca.crt", "nested gateway ca")]);
        let bundle = bundle_with(
            dir.path(),
            &[("/etc/ssl/certs/ca-certificates.crt", "debian roots")],
            with_mounts(
                spec(),
                &["NODE_EXTRA_CA_CERTS=/var/run/platform/ca/ca.crt"],
                json!([bind("/var/run/platform/ca", &volume)]),
            ),
        );

        assert_eq!(inject(&bundle, CA).unwrap(), ENV.len());

        let spec = read_spec(&bundle);
        assert_eq!(
            copy_named_by(&bundle, &spec, "NODE_EXTRA_CA_CERTS"),
            [b"nested gateway ca\n".as_slice(), CA].concat()
        );
        assert_eq!(
            copy_named_by(&bundle, &spec, "SSL_CERT_FILE"),
            [b"debian roots\n".as_slice(), CA].concat()
        );
        assert_eq!(
            fs::read(volume.join("ca.crt")).unwrap(),
            b"nested gateway ca",
            "the mount's source must not change: it is the Secret's"
        );
        assert_eq!(mount_at(&spec, "/var/run/platform/ca").len(), 1);
    }

    // TEST_SCENARIO: a Secret or ConfigMap key mounted with subPath, or a docker bind mount of one file, makes the mount's source the file itself.
    #[test]
    fn a_file_mounted_on_its_own_is_read_from_its_source() {
        let dir = TempDir::new("subpath");
        let source = dir.path().join("host/ca.pem");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "mounted roots").unwrap();
        let bundle = bundle_with(
            dir.path(),
            &[],
            with_mounts(
                spec(),
                &["SSL_CERT_FILE=/etc/custom/ca.pem"],
                json!([bind("/etc/custom/ca.pem", &source)]),
            ),
        );

        assert_eq!(inject(&bundle, CA).unwrap(), 1);
        assert_eq!(
            copy_named_by(&bundle, &read_spec(&bundle), "SSL_CERT_FILE"),
            [b"mounted roots\n".as_slice(), CA].concat()
        );
    }

    // TEST_SCENARIO: runc places mounts in the spec's order, so a later mount covers what an earlier one or the image put at its path, and a mount inside another one's directory covers only its own part of it. Each variable reads the file the container will see there: the inner mount's, the outer mount's, and not the image's file the outer mount hides.
    #[test]
    fn the_mount_that_covers_a_path_last_is_the_one_read() {
        let dir = TempDir::new("nested");
        let outer = dir.path().join("outer");
        let inner = dir.path().join("inner");
        let replaced = dir.path().join("replaced");
        for (source, content) in [(&outer, "outer"), (&inner, "inner"), (&replaced, "hidden")] {
            fs::create_dir_all(source).unwrap();
            fs::write(source.join("ca.pem"), content).unwrap();
        }
        let bundle = bundle_with(
            dir.path(),
            &[("/certs/image.pem", "image")],
            with_mounts(
                spec(),
                &[
                    "SSL_CERT_FILE=/certs/ca.pem",
                    "CURL_CA_BUNDLE=/certs/inner/ca.pem",
                    "GIT_SSL_CAINFO=/certs/image.pem",
                ],
                json!([
                    bind("/certs", &replaced),
                    bind("/certs", &outer),
                    bind("/certs/inner", &inner),
                ]),
            ),
        );

        assert_eq!(inject(&bundle, CA).unwrap(), 2);

        let spec = read_spec(&bundle);
        assert_eq!(
            copy_named_by(&bundle, &spec, "SSL_CERT_FILE"),
            [b"outer\n".as_slice(), CA].concat()
        );
        assert_eq!(
            copy_named_by(&bundle, &spec, "CURL_CA_BUNDLE"),
            [b"inner\n".as_slice(), CA].concat()
        );
        assert!(spec["process"]["env"]
            .as_array()
            .unwrap()
            .contains(&json!("GIT_SSL_CAINFO=/certs/image.pem")));
    }

    // TEST_SCENARIO: Debian links `/var/run` to `/run`, and kubelet mounts volumes under `/var/run/...`. runc resolves a mount's destination inside the image, so the mount lands under `/run`, and a variable naming the file by either path reads the mount's file.
    #[test]
    fn a_mount_under_a_link_in_the_image_is_found_by_either_path() {
        let dir = TempDir::new("varrun");
        let volume = secret_volume(dir.path(), &[("ca.crt", "nested")]);
        let bundle = bundle_with(
            dir.path(),
            &[],
            with_mounts(
                spec(),
                &[
                    "NODE_EXTRA_CA_CERTS=/var/run/secrets/ca/ca.crt",
                    "SSL_CERT_FILE=/run/secrets/ca/ca.crt",
                ],
                json!([bind("/var/run/secrets/ca", &volume)]),
            ),
        );
        fs::create_dir_all(bundle.join("rootfs/run")).unwrap();
        fs::create_dir_all(bundle.join("rootfs/var")).unwrap();
        symlink("../run", bundle.join("rootfs/var/run")).unwrap();

        assert_eq!(inject(&bundle, CA).unwrap(), 2);

        let spec = read_spec(&bundle);
        for name in ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"] {
            assert_eq!(
                copy_named_by(&bundle, &spec, name),
                [b"nested\n".as_slice(), CA].concat(),
                "{name}"
            );
        }
    }

    // TEST_SCENARIO: a link in a volume resolves inside the container. One that climbs out of the mount with `..` lands in the container's own directories, not beside the mount's source on the guest, and one with an absolute target starts again from the container's root. Neither reads a guest file, even one sitting where the naive host path would point.
    #[test]
    fn a_link_in_a_volume_never_reads_beside_its_source() {
        let dir = TempDir::new("volume-escape");
        let volume = dir.path().join("volume");
        fs::create_dir_all(&volume).unwrap();
        fs::write(dir.path().join("guest.pem"), "guest file").unwrap();
        symlink("../guest.pem", volume.join("up.pem")).unwrap();
        symlink(dir.path().join("guest.pem"), volume.join("absolute.pem")).unwrap();
        symlink("/etc/image.pem", volume.join("image.pem")).unwrap();
        let bundle = bundle_with(
            dir.path(),
            &[("/etc/image.pem", "image roots")],
            with_mounts(
                spec(),
                &[
                    "SSL_CERT_FILE=/mnt/up.pem",
                    "CURL_CA_BUNDLE=/mnt/absolute.pem",
                    "GIT_SSL_CAINFO=/mnt/image.pem",
                ],
                json!([bind("/mnt", &volume)]),
            ),
        );

        assert_eq!(inject(&bundle, CA).unwrap(), 1);

        let spec = read_spec(&bundle);
        assert_eq!(
            copy_named_by(&bundle, &spec, "GIT_SSL_CAINFO"),
            [b"image roots\n".as_slice(), CA].concat()
        );
        let env = spec["process"]["env"].as_array().unwrap();
        assert!(env.contains(&json!("SSL_CERT_FILE=/mnt/up.pem")));
        assert!(env.contains(&json!("CURL_CA_BUNDLE=/mnt/absolute.pem")));
    }

    // TEST_SCENARIO: a tmpfs or any other mount that is not a bind has no source to read and hides what the image has beneath it, so the image's bundle there is not the one the container sees. A file the variable names that does not exist yet, in a volume that does, is left exactly as set.
    #[test]
    fn a_path_under_a_non_bind_mount_or_missing_from_a_volume_is_left_alone() {
        let dir = TempDir::new("tmpfs");
        let volume = dir.path().join("volume");
        fs::create_dir_all(&volume).unwrap();
        let bundle = bundle_with(
            dir.path(),
            &[("/etc/ssl/certs/ca-certificates.crt", "hidden roots")],
            with_mounts(
                spec(),
                &["NODE_EXTRA_CA_CERTS=/mnt/later.pem"],
                json!([
                    {"destination": "/etc/ssl", "type": "tmpfs", "source": "tmpfs"},
                    bind("/mnt", &volume),
                ]),
            ),
        );

        assert_eq!(inject(&bundle, CA).unwrap(), 0);
        assert!(!bundle.join(MERGED_DIR).exists());
    }

    // TEST_SCENARIO: a volume another container writes to can swap a directory for a link to the guest between the walk and the read. The read checks where the opened file really is, so a file outside the root or mount it was resolved under is never returned, and a link in the last component is refused at open.
    #[test]
    fn a_file_outside_the_base_it_was_resolved_under_is_not_read() {
        let dir = TempDir::new("swap");
        let base = dir.path().join("volume");
        fs::create_dir_all(&base).unwrap();
        fs::write(dir.path().join("guest.pem"), "guest file").unwrap();
        symlink(dir.path(), base.join("swapped")).unwrap();
        symlink(dir.path().join("guest.pem"), base.join("link.pem")).unwrap();

        assert_eq!(
            read_beneath(&base, &base.join("swapped/guest.pem")).unwrap(),
            None
        );
        assert_eq!(read_beneath(&base, &base.join("link.pem")).unwrap(), None);
        assert_eq!(
            read_beneath(dir.path(), &dir.path().join("guest.pem")).unwrap(),
            Some(b"guest file".to_vec())
        );
    }

    // TEST_SCENARIO: a spec that cannot be read is an error the caller reports, and the spec file is left as it was, so the container still starts, only without the CA.
    #[test]
    fn a_spec_that_is_not_json_is_an_error_and_left_untouched() {
        let dir = TempDir::new("broken");
        let bundle = dir.path().join("bundle");
        fs::create_dir_all(&bundle).unwrap();
        fs::write(bundle.join("config.json"), "not json").unwrap();

        assert!(inject(&bundle, CA).is_err());
        assert_eq!(fs::read(bundle.join("config.json")).unwrap(), b"not json");
    }
}
