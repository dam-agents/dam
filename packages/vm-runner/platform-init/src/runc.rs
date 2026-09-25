// UNIT_BOUNDARY_DESCRIPTION: platform-runc, the OCI runtime every container inside a machine is started through: docker's containers, the RUN steps of its builds, and k3s pods. A container's root is the image it runs, not the guest, so it trusts only the public roots that image ships and fails TLS to every host the gateway intercepts. On `create` and `run` this edits the bundle's spec so the container gets the image's own CA bundles with the platform CA appended, bind-mounted read-only over the originals, plus the CA environment variables the container does not set itself; then it execs the real runc. Nothing reaches the image's layers or config, and a Dockerfile needs no change. Any failure to inject is reported and the container starts without the CA, because refusing it would stop every container on the machine.
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

// UNIT_BOUNDARY_DESCRIPTION: where distributions keep the CA bundle their TLS clients read: Debian, Ubuntu and Alpine; Fedora and RHEL; SUSE; and the path LibreSSL and some minimal images use. A path that is a symlink in the image is skipped, because its target is on this list too.
pub const BUNDLES: &[&str] = &[
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/ssl/cert.pem",
];

// UNIT_BOUNDARY_DESCRIPTION: clients that carry a trust store of their own and ignore the distribution's bundle, told where the merged one is: curl built with its own CA path, Node, Python's requests and pip, and OpenSSL-based tools. Only set when the container's spec has no value for the variable; one it already sets keeps its value, and the file that value names gets the CA instead.
pub const ENV: &[&str] = &[
    "SSL_CERT_FILE",
    "CURL_CA_BUNDLE",
    "REQUESTS_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
];

// UNIT_BOUNDARY_DESCRIPTION: the merged bundles are written into the container's bundle directory, which the caller creates for this one container and removes with it, so nothing here has to be cleaned up.
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

// UNIT_BOUNDARY_DESCRIPTION: rewrites the bundle's spec to carry the CA and returns how many bundles it covered. The spec is replaced by rename, so the runtime reads the old spec or the new one and never half of either.
pub fn inject(bundle: &Path, ca: &[u8]) -> io::Result<usize> {
    let spec_path = bundle.join("config.json");
    let mut spec: Value = serde_json::from_slice(&fs::read(&spec_path)?)?;
    let root = spec
        .pointer("/root/path")
        .and_then(Value::as_str)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "the spec names no root"))?;
    let root = bundle.join(root);
    let mounted: Vec<String> = spec
        .get("mounts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| m.get("destination")?.as_str().map(str::to_owned))
        .collect();

    let mut destinations: Vec<String> = BUNDLES.iter().map(|b| b.to_string()).collect();
    for named in named_bundles(&spec) {
        if !destinations.contains(&named) {
            destinations.push(named);
        }
    }

    let merged_dir = bundle.join(MERGED_DIR);
    let mut covered = Vec::new();
    for (index, destination) in destinations.iter().enumerate() {
        if mounted.contains(destination) {
            continue;
        }
        let Some(own) = read_in_root(&root, destination)? else {
            continue;
        };
        fs::create_dir_all(&merged_dir)?;
        let source = merged_dir.join(format!("{index}.pem"));
        fs::write(&source, merge(&own, ca))?;
        covered.push((destination.clone(), fs::canonicalize(source)?));
    }
    let Some((first, _)) = covered.first() else {
        return Ok(0);
    };

    let first = first.clone();
    let mounts = spec
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "the spec is not an object"))?
        .entry("mounts")
        .or_insert_with(|| json!([]));
    let mounts = mounts.as_array_mut().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "the spec's mounts are not a list",
        )
    })?;
    for (destination, source) in &covered {
        mounts.push(json!({
            "destination": destination,
            "type": "bind",
            "source": source,
            "options": ["rbind", "ro"],
        }));
    }
    if let Some(env) = spec
        .pointer_mut("/process/env")
        .and_then(Value::as_array_mut)
    {
        for name in ENV {
            let prefix = format!("{name}=");
            let set = env
                .iter()
                .any(|v| v.as_str().is_some_and(|v| v.starts_with(&prefix)));
            if !set {
                env.push(Value::String(format!("{prefix}{first}")));
            }
        }
    }

    let staged = bundle.join("config.json.platform-runc");
    fs::write(&staged, serde_json::to_vec(&spec)?)?;
    fs::rename(&staged, &spec_path)?;
    Ok(covered.len())
}

// UNIT_BOUNDARY_DESCRIPTION: the bundles the container's own CA variables already point at. An image that sets one keeps its value, so the file it names is where that client looks, and it gets the CA appended like a distribution bundle. The official curl image is the case: it points CURL_CA_BUNDLE at a bundle of its own outside every distribution path. Only absolute paths without `..` are taken, since the path is the image's to choose.
fn named_bundles(spec: &Value) -> Vec<String> {
    let env = spec
        .pointer("/process/env")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str);
    let mut named = Vec::new();
    for entry in env {
        let Some((name, value)) = entry.split_once('=') else {
            continue;
        };
        let path = Path::new(value);
        if ENV.contains(&name)
            && path.is_absolute()
            && !path.components().any(|c| c == Component::ParentDir)
        {
            named.push(value.to_string());
        }
    }
    named
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
    // TEST_OVERVIEW: platform-runc stands between every container runtime in a machine and runc. It must find the real runc whichever runtime called it, touch only the commands that start a container, give a container the image's own CA bundles with the platform CA appended without following the image's symlinks into the guest, leave what the spec already sets alone, and change nothing when the image ships no bundle.
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

    // TEST_SCENARIO: the case that breaks today. A Fedora image keeps its bundle at a real file and links the other path to it; the container gets that file with the CA appended, mounted read-only over it, and the CA variables point at it. The image's own roots are kept in front of the CA.
    #[test]
    fn the_images_own_bundle_gets_the_ca_appended() {
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

        assert_eq!(inject(&bundle, CA).unwrap(), 1);

        let spec = read_spec(&bundle);
        let mount = spec["mounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["destination"] == "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem")
            .expect("the bundle is mounted");
        assert_eq!(mount["type"], "bind");
        assert_eq!(mount["options"], json!(["rbind", "ro"]));
        let merged = fs::read(mount["source"].as_str().unwrap()).unwrap();
        assert_eq!(merged, [b"public roots\n".as_slice(), CA].concat());
        assert!(
            Path::new(mount["source"].as_str().unwrap()).starts_with(bundle.join(MERGED_DIR)),
            "the merged bundle must live in the container's own bundle directory"
        );
        let env = spec["process"]["env"].as_array().unwrap();
        for name in ENV {
            assert!(
                env.contains(&json!(format!(
                    "{name}=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"
                ))),
                "{name} is not set"
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
        let secret = dir.path().join("guest-secret");
        fs::write(&secret, "guest only").unwrap();
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

    // TEST_SCENARIO: an image with no CA bundle cannot do TLS at all, so there is nothing to add the CA to and the spec is left exactly as the runtime wrote it — no mounts, no variables pointing at a file that is not there.
    #[test]
    fn an_image_without_a_bundle_is_left_alone() {
        let dir = TempDir::new("slim");
        let bundle = bundle_with(dir.path(), &[("/etc/os-release", "debian")], spec());

        assert_eq!(inject(&bundle, CA).unwrap(), 0);
        assert_eq!(read_spec(&bundle), spec());
        assert!(!bundle.join(MERGED_DIR).exists());
    }

    // TEST_SCENARIO: what the container already says wins. A variable the image or Dockerfile set keeps its value, and a bundle path something already mounts over — a user's own `-v` of a CA file — is not mounted a second time.
    #[test]
    fn what_the_spec_already_sets_is_kept() {
        let dir = TempDir::new("kept");
        let mut spec = spec();
        spec["process"]["env"] = json!(["SSL_CERT_FILE=/mine.pem"]);
        spec["mounts"] =
            json!([{"destination": "/etc/ssl/cert.pem", "type": "bind", "source": "/x"}]);
        let bundle = bundle_with(
            dir.path(),
            &[
                ("/etc/ssl/certs/ca-certificates.crt", "debian roots"),
                ("/etc/ssl/cert.pem", "other roots"),
            ],
            spec,
        );

        assert_eq!(inject(&bundle, CA).unwrap(), 1);

        let spec = read_spec(&bundle);
        let env = spec["process"]["env"].as_array().unwrap();
        assert!(env.contains(&json!("SSL_CERT_FILE=/mine.pem")));
        assert!(!env
            .iter()
            .any(|v| v == "SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt"));
        assert!(env.contains(&json!("CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt")));
        let over_cert_pem = spec["mounts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["destination"] == "/etc/ssl/cert.pem")
            .count();
        assert_eq!(over_cert_pem, 1);
    }

    // TEST_SCENARIO: the official curl image sets CURL_CA_BUNDLE to a bundle of its own, outside every distribution path. The variable keeps the image's value, and the file it names gets the CA appended, so curl in that image trusts the platform CA too. A value that climbs out with `..` is not read.
    #[test]
    fn a_bundle_the_images_own_variable_names_gets_the_ca_too() {
        let dir = TempDir::new("named");
        let mut spec = spec();
        spec["process"]["env"] = json!([
            "CURL_CA_BUNDLE=/cacert.pem",
            "REQUESTS_CA_BUNDLE=/etc/../outside.pem",
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

        assert_eq!(inject(&bundle, CA).unwrap(), 2);

        let spec = read_spec(&bundle);
        let env = spec["process"]["env"].as_array().unwrap();
        assert!(env.contains(&json!("CURL_CA_BUNDLE=/cacert.pem")));
        let mount = spec["mounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["destination"] == "/cacert.pem")
            .expect("the image's own bundle is mounted");
        assert_eq!(
            fs::read(mount["source"].as_str().unwrap()).unwrap(),
            [b"curl roots\n".as_slice(), CA].concat()
        );
        assert!(!spec["mounts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["destination"] == "/etc/../outside.pem"));
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

        assert_eq!(inject(&bundle, CA).unwrap(), 1);
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
