use std::fs;
use std::path::Path;

use anyhow::anyhow;
use serde::{Deserialize, Serialize};

// UNIT_BOUNDARY_DESCRIPTION: what an image says a machine should run: its entrypoint, command, env and working directory. It is kept beside an unpacked tree and never crosses the machine API.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct ImageLaunch {
    pub entrypoint: Vec<String>,
    pub cmd: Vec<String>,
    pub env: Vec<String>,
    #[serde(rename = "workingDir")]
    pub working_dir: String,
}

// UNIT_BOUNDARY_DESCRIPTION: what an image says to run, which a tree of its files does not carry. smolvm handed a bare root filesystem starts the machine and waits for an exec that never comes, so a machine whose launch is unknown is refused rather than booted — the failure it prevents is silent, a guest that is up with nothing running in it. The runner has two sources: the record kept beside an unpacked tree, which is here, and the config read from the registry when there is no record, which is in the fetch module.

// UNIT_BOUNDARY_DESCRIPTION: the record written beside an unpacked tree, which a machine booted from that tree reads.
pub const LAUNCH_FILE: &str = "launch.json";

pub fn read_launch(cached: &Path) -> anyhow::Result<Option<ImageLaunch>> {
    let encoded = match fs::read(cached.join(LAUNCH_FILE)) {
        Ok(encoded) => encoded,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    Ok(Some(serde_json::from_slice(&encoded)?))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir;

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

    // TEST_SCENARIO: the record beside an unpacked tree, and the one case that is not an error — a tree with no record beside it. The runner reads that as nothing to say and goes on to its other sources, so an error there would refuse a machine the registry could still launch.
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
}
