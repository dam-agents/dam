use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};

// UNIT_BOUNDARY_DESCRIPTION: what an image says a machine should run, which a tree of its files does not carry. Read from the image when it is unpacked and kept beside the tree, because smolvm handed a bare rootfs launches nothing and waits for an exec that never comes. It never crosses the machine API: the runner writes it and the runner reads it.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct ImageLaunch {
    pub entrypoint: Vec<String>,
    pub cmd: Vec<String>,
    pub env: Vec<String>,
    #[serde(rename = "workingDir")]
    pub working_dir: String,
}

// UNIT_BOUNDARY_DESCRIPTION: what an image says to run, which a tree of its files does not carry. smolvm handed a bare root filesystem starts the machine and waits for an exec that never comes, so a machine whose launch is unknown is refused rather than booted — the failure it prevents is silent, a guest that is up with nothing running in it. Two of the runner's three sources are here, in the order it reaches for them: the record kept beside an unpacked tree, and the config inside an archive an install with no registry staged. The third, a config read from the registry when neither exists, is in the fetch module.

// UNIT_BOUNDARY_DESCRIPTION: the record written beside an unpacked tree, which a machine booted from that tree reads.
pub const LAUNCH_FILE: &str = "launch.json";

// UNIT_BOUNDARY_DESCRIPTION: the largest entry in an archive that could still be an image config. Layers are megabytes to gigabytes and configs are kilobytes, so this is what keeps a config scan from reading a whole image into memory looking for a JSON object.
pub const MAX_IMAGE_CONFIG: u64 = 1 << 20;

pub fn read_launch(cached: &Path) -> anyhow::Result<Option<ImageLaunch>> {
    let encoded = match fs::read(cached.join(LAUNCH_FILE)) {
        Ok(encoded) => encoded,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    Ok(Some(serde_json::from_slice(&encoded)?))
}

// UNIT_BOUNDARY_DESCRIPTION: an archive boots a machine without a tree beside it, and it carries the image's own config as well as its layers — but smolvm reads the layers out of it and not the config, so the config is read here. Entries are held only while they could still be that config: a layer is skipped by its size, and anything that is not an object by its first byte, so a scan of a ten-gigabyte archive holds kilobytes.
pub fn launch_from_archive(path: &Path) -> anyhow::Result<ImageLaunch> {
    let reading = || format!("reading the archive {}", path.display());
    let file = fs::File::open(path)?;
    let mut archive = tar::Archive::new(file);

    let mut manifest: Option<Vec<u8>> = None;
    let mut documents: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for entry in archive.entries().with_context(reading)? {
        let mut entry = entry.with_context(reading)?;
        if entry.header().entry_type() != tar::EntryType::Regular
            || entry.header().size().with_context(reading)? > MAX_IMAGE_CONFIG
        {
            continue;
        }
        let name = clean_name(&entry.path().with_context(reading)?.to_string_lossy());
        let mut body = Vec::new();
        entry.read_to_end(&mut body).with_context(reading)?;
        if name == "manifest.json" {
            manifest = Some(body);
            continue;
        }
        if body.first() == Some(&b'{') {
            documents.insert(name, body);
        }
    }

    #[derive(Deserialize)]
    struct Entry {
        #[serde(rename = "Config")]
        config: Option<String>,
    }
    let manifest = manifest.unwrap_or_default();
    let entries: Vec<Entry> = serde_json::from_slice(&manifest)
        .with_context(|| format!("reading the manifest of {}", path.display()))?;
    let named = entries
        .first()
        .and_then(|first| first.config.as_deref())
        .filter(|config| !config.is_empty())
        .ok_or_else(|| anyhow!("the archive {} names no image config", path.display()))?;
    let config = documents.get(&clean_name(named)).ok_or_else(|| {
        anyhow!(
            "the archive {} is missing its image config {named}",
            path.display()
        )
    })?;
    launch_from_config(config)
}

pub fn launch_from_config(config: &[u8]) -> anyhow::Result<ImageLaunch> {
    // UNIT_BOUNDARY_DESCRIPTION: every list here is optional twice over — absent, and present as JSON null, which is what a real image config writes for a field it does not set. Go's decoder reads a null list as an empty one; a decoder that refused it would fail on ordinary images and only on the boot path, so the two nothings are spelled out rather than left to the derive.
    #[derive(Deserialize, Default)]
    struct Body {
        #[serde(rename = "Entrypoint")]
        entrypoint: Option<Vec<String>>,
        #[serde(rename = "Cmd")]
        cmd: Option<Vec<String>>,
        #[serde(rename = "Env")]
        env: Option<Vec<String>>,
        #[serde(rename = "WorkingDir")]
        working_dir: Option<String>,
    }
    #[derive(Deserialize, Default)]
    struct Parsed {
        #[serde(default)]
        config: Body,
    }

    let parsed: Parsed = serde_json::from_slice(config)?;
    let launch = ImageLaunch {
        entrypoint: parsed.config.entrypoint.unwrap_or_default(),
        cmd: parsed.config.cmd.unwrap_or_default(),
        env: parsed.config.env.unwrap_or_default(),
        working_dir: parsed.config.working_dir.unwrap_or_default(),
    };
    if launch.entrypoint.is_empty() && launch.cmd.is_empty() {
        return Err(anyhow!(
            "the image names neither an entrypoint nor a command"
        ));
    }
    Ok(launch)
}

// UNIT_BOUNDARY_DESCRIPTION: the archive's own name for an entry, reduced the way Go's filepath.Clean reduces it, because the manifest names the config one way and the entry header may spell it another — `./sha256:abc.json` and `sha256:abc.json` are one file, and a lookup that told them apart would report an archive as missing the config it contains. Both sides of the comparison go through this, so what matters is that it is the same reduction on each.
fn clean_name(name: &str) -> String {
    let rooted = name.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in name.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if matches!(parts.last(), Some(&last) if last != "..") {
                    parts.pop();
                } else if !rooted {
                    parts.push("..");
                }
            }
            part => parts.push(part),
        }
    }
    let cleaned = parts.join("/");
    match (rooted, cleaned.is_empty()) {
        (true, _) => format!("/{cleaned}"),
        (false, true) => ".".to_string(),
        (false, false) => cleaned,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // TEST_SCENARIO: these five names are the OCI image config's own spelling, capitals and all, and nothing on this side would notice one being wrong — a mis-spelled key reads as absent, which for Entrypoint and Cmd together is a refusal to boot and for Env is a machine started without its image's environment.
    #[test]
    fn the_image_config_is_read_under_the_oci_spellings() {
        let launch = launch_from_config(
            br#"{"config":{"Entrypoint":["/init"],"Cmd":["serve"],"Env":["A=1"],"WorkingDir":"/srv"}}"#,
        )
        .unwrap();
        assert_eq!(launch.entrypoint, ["/init"]);
        assert_eq!(launch.cmd, ["serve"]);
        assert_eq!(launch.env, ["A=1"]);
        assert_eq!(launch.working_dir, "/srv");
    }

    // TEST_SCENARIO: a real image config writes JSON null for a list it does not set, and Go's decoder reads that as an empty list. A decoder that refused it would fail on ordinary images, on the boot path, and only once a machine was already being created.
    #[test]
    fn a_config_that_sets_nothing_it_does_not_have_is_still_read() {
        let launch = launch_from_config(
            br#"{"config":{"Entrypoint":["/bin/sh"],"Cmd":null,"Env":null,"WorkingDir":null}}"#,
        )
        .expect("a null list is what an image writes for a field it does not set");
        assert_eq!(launch.entrypoint, ["/bin/sh"]);
        assert!(launch.cmd.is_empty());
        assert!(launch.env.is_empty());
        assert_eq!(launch.working_dir, "");

        let missing = launch_from_config(br#"{"config":{"Cmd":["/bin/agent"]}}"#)
            .expect("an absent field is the same as an unset one");
        assert_eq!(missing.cmd, ["/bin/agent"]);
    }

    // TEST_SCENARIO: a machine whose image names nothing to run is refused rather than created. smolvm handed a root filesystem and no command starts the machine and waits for an exec that never comes, so the guest comes up with no agent in it and nothing says why.
    #[test]
    fn an_image_that_names_nothing_to_run_is_refused_rather_than_booted() {
        for names_nothing in [
            &br#"{"config":{"Env":["A=1"]}}"#[..],
            &br#"{"config":{"Entrypoint":[],"Cmd":[]}}"#[..],
            &br#"{}"#[..],
        ] {
            let refusal = launch_from_config(names_nothing).unwrap_err().to_string();
            assert!(
                refusal.contains("entrypoint"),
                "the refusal does not say what is missing: {refusal}"
            );
        }
        assert!(
            launch_from_config(b"not json").is_err(),
            "a config that is not a config was accepted"
        );
    }

    // TEST_SCENARIO: the record beside an unpacked tree, and the one case that is not an error — a tree with no record beside it. The runner reads that as nothing to say and goes on to its other sources, so an error there would refuse a machine one of those sources could still launch: a staged archive, or the registry.
    #[test]
    fn a_tree_with_no_record_beside_it_is_nothing_to_say_rather_than_a_failure() {
        let dir = TempDir::new("record");
        assert!(
            read_launch(dir.path()).unwrap().is_none(),
            "a tree with no record was reported as broken"
        );

        fs::write(
            dir.path().join(LAUNCH_FILE),
            br#"{"entrypoint":["/init"],"cmd":["serve"],"env":["A=1"],"workingDir":"/srv"}"#,
        )
        .unwrap();
        let launch = read_launch(dir.path())
            .unwrap()
            .expect("the record is there");
        assert_eq!(launch.entrypoint, ["/init"]);
        assert_eq!(launch.cmd, ["serve"]);
        assert_eq!(launch.env, ["A=1"]);
        assert_eq!(launch.working_dir, "/srv");

        fs::write(dir.path().join(LAUNCH_FILE), b"not json").unwrap();
        assert!(
            read_launch(dir.path()).is_err(),
            "a record that cannot be read is not the same as no record: one means go on, the other means this tree is broken"
        );
    }

    // TEST_SCENARIO: an archive staged for an install with no registry boots a machine, and the config that says how is inside it. The manifest names the config, the entry headers spell the same file differently, and a lookup that told the two spellings apart would report an archive as missing a config it contains.
    #[test]
    fn an_archive_yields_the_launch_its_manifest_points_at() {
        let dir = TempDir::new("archive");
        let path = dir.path().join("image.tar");
        write_archive(
            &path,
            &[
                (
                    "./manifest.json",
                    br#"[{"Config":"./sha256_abc.json"}]"#.to_vec(),
                ),
                (
                    "sha256_abc.json",
                    br#"{"config":{"Entrypoint":["/init"],"Cmd":["serve"],"WorkingDir":"/srv"}}"#
                        .to_vec(),
                ),
                ("layer.tar", vec![b'x'; 64]),
            ],
        );

        let launch = launch_from_archive(&path).expect("the archive carries its config");
        assert_eq!(launch.entrypoint, ["/init"]);
        assert_eq!(launch.cmd, ["serve"]);
        assert_eq!(launch.working_dir, "/srv");
    }

    // TEST_SCENARIO: an archive that cannot say what to run is refused with a reason, because the alternative is a machine created against a filesystem with nothing running in it. Each shape of missing is named separately: the manifest, the reference inside it, and the file it points at.
    #[test]
    fn an_archive_that_cannot_say_what_to_run_says_which_part_is_missing() {
        let dir = TempDir::new("archive-broken");

        let no_manifest = dir.path().join("no-manifest.tar");
        write_archive(&no_manifest, &[("layer.tar", vec![b'x'; 8])]);
        assert!(launch_from_archive(&no_manifest)
            .unwrap_err()
            .to_string()
            .contains("manifest"));

        for (what, manifest) in [
            ("an empty manifest", &b"[]"[..]),
            ("an entry naming nothing", &br#"[{"Config":""}]"#[..]),
        ] {
            let empty = dir.path().join(format!("empty-{}.tar", what.len()));
            write_archive(&empty, &[("manifest.json", manifest.to_vec())]);
            assert!(
                launch_from_archive(&empty)
                    .unwrap_err()
                    .to_string()
                    .contains("names no image config"),
                "{what} was not refused"
            );
        }

        let dangling = dir.path().join("dangling.tar");
        write_archive(
            &dangling,
            &[("manifest.json", br#"[{"Config":"gone.json"}]"#.to_vec())],
        );
        assert!(launch_from_archive(&dangling)
            .unwrap_err()
            .to_string()
            .contains("missing its image config"));
    }

    // TEST_SCENARIO: the scan holds only what could still be a config, which is what keeps it from reading a ten-gigabyte image into memory. A layer is skipped by its size before its body is read, and anything that is not a JSON object by its first byte is dropped after — so a large file named like a config never becomes one.
    #[test]
    fn a_scan_holds_nothing_that_could_not_be_a_config() {
        let dir = TempDir::new("archive-big");
        let path = dir.path().join("big.tar");
        let oversized = MAX_IMAGE_CONFIG as usize + 1;
        write_archive(
            &path,
            &[
                ("manifest.json", br#"[{"Config":"big.json"}]"#.to_vec()),
                ("big.json", vec![b'{'; oversized]),
            ],
        );

        assert!(
            launch_from_archive(&path)
                .unwrap_err()
                .to_string()
                .contains("missing its image config"),
            "an entry over the size limit was read and held"
        );

        let not_json = dir.path().join("not-json.tar");
        write_archive(
            &not_json,
            &[
                ("manifest.json", br#"[{"Config":"cfg.json"}]"#.to_vec()),
                ("cfg.json", b"plain text".to_vec()),
            ],
        );
        assert!(
            launch_from_archive(&not_json)
                .unwrap_err()
                .to_string()
                .contains("missing its image config"),
            "an entry that is not an object by its first byte was held"
        );
    }

    // TEST_SCENARIO: the manifest and the entry headers may spell one file differently, so both go through the same reduction. What matters is that it is the same one on each side — these are the spellings an archive actually uses.
    #[test]
    fn one_file_named_two_ways_is_one_name() {
        assert_eq!(clean_name("./manifest.json"), "manifest.json");
        assert_eq!(clean_name("manifest.json"), "manifest.json");
        assert_eq!(clean_name("blobs/./sha256/abc"), "blobs/sha256/abc");
        assert_eq!(clean_name("blobs/sha256/../abc"), "blobs/abc");
        assert_eq!(clean_name("/blobs/abc"), "/blobs/abc");
        assert_eq!(clean_name("."), ".");
        assert_eq!(clean_name("../outside"), "../outside");
    }

    // UNIT_BOUNDARY_DESCRIPTION: writes each entry's name into the header exactly as given. The builder's own `append_data` reduces a path before storing it — `./manifest.json` goes in as `manifest.json` — so a fixture built with it cannot produce the spelling the reader exists to cope with, and a test that cannot produce it would agree with a reader that had dropped the handling.
    fn write_archive(path: &Path, entries: &[(&str, Vec<u8>)]) {
        let file = fs::File::create(path).unwrap();
        let mut builder = tar::Builder::new(file);
        for (name, body) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            let stored = header.as_gnu_mut().expect("a gnu header was just made");
            stored.name[..name.len()].copy_from_slice(name.as_bytes());
            header.set_cksum();
            builder.append(&header, body.as_slice()).unwrap();
        }
        builder.finish().unwrap();
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("vm-runner-launch-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
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
}
