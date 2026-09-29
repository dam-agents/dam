// UNIT_BOUNDARY_DESCRIPTION: platform-runc, the OCI runtime every container inside a machine is started through: docker's containers, the RUN steps of its builds, and k3s pods. A container's root is the image it runs, not the guest, so it trusts only the public roots that image ships and fails TLS to every host the gateway intercepts. On `create` and `run` this gives the container copies of the image's own CA bundles with the platform CA appended, in a directory of the wrapper's own mounted read-only, and points the CA environment variables at them; then it execs the real runc. The image's own files are never mounted over, so a build that rebuilds its trust store keeps working, nothing reaches the image's layers or config, and a Dockerfile needs no change. Any failure to inject is reported and the container starts without the CA, because refusing it would stop every container on the machine.
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};

use crate::guest;

// UNIT_BOUNDARY_DESCRIPTION: the name the image's entrypoint moves docker's own runc to when it puts this wrapper in its place. docker's builder runs whatever `runc` it finds on PATH and ignores the daemon's default runtime, so the wrapper has to take the name itself, and it finds the binary it replaced beside it under this suffix.
pub const REAL_SUFFIX: &str = ".real";

// UNIT_BOUNDARY_DESCRIPTION: where distributions keep the CA bundle their TLS clients read: Debian, Ubuntu and Alpine; Fedora and RHEL; SUSE; and the path LibreSSL and some minimal images use. The first one the image ships as a real file is the bundle the copies start from; a path that is a symlink in the image is skipped, because its target is on this list too.
pub const BUNDLES: &[&str] = &[
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/ssl/cert.pem",
];

// UNIT_BOUNDARY_DESCRIPTION: the variables TLS clients read a CA bundle from: OpenSSL-based tools, Go, Ruby and Python's ssl; curl, including a curl built with its own bundle path; Python's requests and pip; Node, which adds these to its built-in roots; and git, whose GnuTLS build reads none of the others. Each is pointed at a copy of the bundle it would otherwise use, with the CA appended — a variable the container sets to a file keeps that file's roots. A client that reads only the distribution's own path and no variable, like a Java keystore or GnuTLS-based wget and apt, does not see the CA.
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

// UNIT_BOUNDARY_DESCRIPTION: the image decides what sits at a bundle path, so a file larger than any real CA bundle is left alone rather than copied on every container start.
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
    let root = bundle.join(root);
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
        if let Some(own) = read_in_root(&root, path)? {
            system = Some((path.to_string(), own));
            break;
        }
    }

    let mut copies: Vec<(String, Vec<u8>)> = Vec::new();
    let mut pointed: Vec<(&str, String)> = Vec::new();
    for name in ENV {
        let source = match value_of(&env, name) {
            Some(value) if nameable(value) => {
                read_in_root(&root, value)?.map(|own| (value.to_string(), own))
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

// UNIT_BOUNDARY_DESCRIPTION: reads a bundle path inside the container's root without following a symlink anywhere along it. The root is the image's, and a link there resolves against the guest, so following one would copy a file of the guest's into the container.
pub fn read_in_root(root: &Path, path: &str) -> io::Result<Option<Vec<u8>>> {
    let mut at = root.to_path_buf();
    for component in Path::new(path).components() {
        let Component::Normal(name) = component else {
            continue;
        };
        at.push(name);
        let meta = match fs::symlink_metadata(&at) {
            Ok(meta) => meta,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) if e.raw_os_error() == Some(libc::ENOTDIR) => return Ok(None),
            Err(e) => return Err(e),
        };
        if meta.file_type().is_symlink() {
            return Ok(None);
        }
    }
    let meta = fs::symlink_metadata(&at)?;
    if !meta.is_file() || meta.len() > MAX_BUNDLE_BYTES {
        return Ok(None);
    }
    fs::read(&at).map(Some)
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
    // TEST_OVERVIEW: platform-runc stands between every container runtime in a machine and runc. It must find the real runc whichever runtime called it, touch only the commands that start a container, give a container copies of the image's own CA bundles with the platform CA appended at a path of its own, without following the image's symlinks into the guest or mounting over the image's files, keep the roots a variable the image sets names, and change nothing when the image ships no bundle.
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

    // TEST_SCENARIO: an image's symlinks resolve against the guest when read from outside the container. A link on the way to a bundle path is not followed, so no file of the guest's is copied into a container.
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
