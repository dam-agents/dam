use serde::{Deserialize, Serialize};

// UNIT_BOUNDARY_DESCRIPTION: what an image says a machine should run, which a tree of its files does not carry. Read from the image when it is unpacked and kept beside the tree, because smolvm handed a bare rootfs launches nothing and waits for an exec that never comes.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ImageLaunch {
    #[serde(default, deserialize_with = "null_as_empty")]
    pub entrypoint: Vec<String>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub cmd: Vec<String>,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub env: Vec<String>,
    #[serde(rename = "workingDir")]
    pub working_dir: String,
}

// UNIT_BOUNDARY_DESCRIPTION: the controller's half of this contract is packages/controller/pkg/vmrunner/api.go, which stays Go — the controller dials this runner over HTTP, so the two sides meet as JSON and never as types. Every rename here is a wire break, which is why the field names are spelled out rather than derived from the Rust ones.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct MachineSpec {
    pub image: String,
    pub cpus: i32,
    #[serde(rename = "memoryMiB")]
    pub memory_mib: i32,
    #[serde(rename = "storageGiB")]
    pub storage_gib: i32,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(rename = "caCert", default, skip_serializing_if = "String::is_empty")]
    pub ca_cert: String,
    #[serde(rename = "allowCidrs", default, skip_serializing_if = "Vec::is_empty")]
    pub allow_cidrs: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub revision: String,
    pub running: bool,
    // UNIT_BOUNDARY_DESCRIPTION: the docker config this machine's image is fetched with, merged by the controller from the pull Secrets a pod would list. It is a credential in transit: it is cleared before the spec is stored, and it never reaches smolvm or the guest.
    #[serde(rename = "pullAuth", default, skip_serializing_if = "String::is_empty")]
    pub pull_auth: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct MachineStatus {
    pub state: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub reason: String,
    #[serde(default, skip_serializing_if = "is_zero_i32")]
    pub restarts: i32,
    #[serde(default, skip_serializing_if = "is_zero_i32")]
    pub port: i32,
    pub ready: bool,
    #[serde(default, skip_serializing_if = "is_zero_i32")]
    pub cpus: i32,
    #[serde(rename = "memoryMiB", default, skip_serializing_if = "is_zero_i32")]
    pub memory_mib: i32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub message: String,
    // UNIT_BOUNDARY_DESCRIPTION: how long ago this runner last asked the machine to start, in milliseconds; zero when it has not asked since it came up. A machine asked recently is about to become ready or fail, and is worth watching closely until one or the other.
    #[serde(rename = "startingMs", default, skip_serializing_if = "is_zero_i64")]
    pub starting_ms: i64,
}

// UNIT_BOUNDARY_DESCRIPTION: a list Go left nil, read back as an empty one. `api.go` tags these fields without `omitempty`, so `json.Marshal` writes them as JSON null rather than leaving them out, and serde's own decoder refuses a null list. Every record the Go runner writes carries at least one: it refuses an image that names neither an entrypoint nor a command, so whichever of the two the image does not set is nil in the file.
fn null_as_empty<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<Vec<String>>::deserialize(deserializer)?.unwrap_or_default())
}

fn is_zero_i32(n: &i32) -> bool {
    *n == 0
}

fn is_zero_i64(n: &i64) -> bool {
    *n == 0
}

pub const STATE_ABSENT: &str = "absent";
pub const STATE_UNKNOWN: &str = "unknown";
pub const STATE_CREATING: &str = "creating";
pub const STATE_STARTING: &str = "starting";
pub const STATE_RESTARTING: &str = "restarting";
pub const STATE_RUNNING: &str = "running";
pub const STATE_STOPPING: &str = "stopping";
pub const STATE_STOPPED: &str = "stopped";

pub const REASON_NOT_READY: &str = "MachineNotReady";
pub const REASON_OUT_OF_CAPACITY: &str = "MachineOutOfCapacity";
pub const REASON_IMAGE_UNAVAILABLE: &str = "MachineImageUnavailable";
pub const REASON_BOOT_FAILED: &str = "MachineBootFailed";
pub const REASON_EGRESS_CHANGED: &str = "MachineEgressChanged";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;

    // UNIT_BOUNDARY_DESCRIPTION: the JSON names this crate actually writes, taken from serde's own output rather than from the attributes, so a rename, a dropped field or a skip condition that does not fire is caught as the wire sees it and not as the source reads.
    fn wire_names(value: &impl Serialize) -> Vec<String> {
        match serde_json::to_value(value).expect("the wire types serialize") {
            serde_json::Value::Object(map) => map.keys().cloned().collect(),
            other => panic!("a wire type must serialize to an object, got {other}"),
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: asserts one Rust type writes exactly what its Go counterpart declares. `filled` holds a non-zero value in every field and must produce every JSON name Go declares; `Default` must produce exactly those Go does not mark omitempty, which is what makes a mismatched skip condition visible instead of merely untested.
    fn matches_go_struct<T: Serialize + Default>(go: &str, name: &str, filled: &T) {
        let fields = gosource::struct_fields(go, name);
        assert!(
            !fields.is_empty(),
            "no json-tagged fields found for Go struct {name} — the reader no longer understands api.go"
        );

        let mut declared: Vec<&str> = fields.iter().map(|f| f.json.as_str()).collect();
        let mut ours = wire_names(filled);
        declared.sort_unstable();
        ours.sort_unstable();
        assert_eq!(
            declared, ours,
            "{name} writes different JSON names than api.go declares"
        );

        let mut always: Vec<&str> = fields
            .iter()
            .filter(|f| !f.omitempty)
            .map(|f| f.json.as_str())
            .collect();
        let mut ours_when_zero = wire_names(&T::default());
        always.sort_unstable();
        ours_when_zero.sort_unstable();
        assert_eq!(
            always, ours_when_zero,
            "{name} omits a different set of fields than api.go's omitempty tags when every value is zero"
        );
    }

    // TEST_SCENARIO: these types are one half of a contract whose other half is Go, and the two processes meet as JSON over the wire and never as types — so nothing but a test can tell them apart. A renamed field, a dropped one, or an omitempty that only one side applies does not fail a build: it fails at runtime, between a controller and a runner, as a value that silently reads as its zero. api.go is read as the source of truth and every field is compared as serde actually writes it.
    #[test]
    fn the_go_half_of_the_wire_contract_says_the_same_thing() {
        let go = gosource::read("api.go");

        matches_go_struct(
            &go,
            "ImageLaunch",
            &ImageLaunch {
                entrypoint: vec!["/entry".into()],
                cmd: vec!["serve".into()],
                env: vec!["A=image".into()],
                working_dir: "/app".into(),
            },
        );
        matches_go_struct(
            &go,
            "MachineSpec",
            &MachineSpec {
                image: "quay.io/x/vm:1".into(),
                cpus: 2,
                memory_mib: 2048,
                storage_gib: 20,
                env: [("A".to_string(), "b".to_string())].into_iter().collect(),
                ca_cert: "-----BEGIN CERTIFICATE-----".into(),
                allow_cidrs: vec!["10.0.0.1/32".into()],
                revision: "r1".into(),
                running: true,
                pull_auth: "{\"auths\":{}}".into(),
            },
        );
        matches_go_struct(
            &go,
            "MachineStatus",
            &MachineStatus {
                state: STATE_RUNNING.into(),
                reason: REASON_NOT_READY.into(),
                restarts: 1,
                port: 31000,
                ready: true,
                cpus: 2,
                memory_mib: 2048,
                message: "up".into(),
                starting_ms: 1,
            },
        );
    }

    // TEST_SCENARIO: the states and reasons are the vocabulary the controller matches on. A value that differs by a character is not a compile error on either side — it is a controller that never recognises the state its runner is reporting, so the Agent sits in a condition nothing clears.
    #[test]
    fn the_states_and_reasons_are_the_ones_the_controller_matches_on() {
        let go = gosource::read("api.go");

        for (name, ours) in [
            ("StateAbsent", STATE_ABSENT),
            ("StateUnknown", STATE_UNKNOWN),
            ("StateCreating", STATE_CREATING),
            ("StateStarting", STATE_STARTING),
            ("StateRestarting", STATE_RESTARTING),
            ("StateRunning", STATE_RUNNING),
            ("StateStopping", STATE_STOPPING),
            ("StateStopped", STATE_STOPPED),
            ("ReasonNotReady", REASON_NOT_READY),
            ("ReasonOutOfCapacity", REASON_OUT_OF_CAPACITY),
            ("ReasonImageUnavailable", REASON_IMAGE_UNAVAILABLE),
            ("ReasonBootFailed", REASON_BOOT_FAILED),
            ("ReasonEgressChanged", REASON_EGRESS_CHANGED),
        ] {
            assert_eq!(
                gosource::const_value(&go, name).as_deref(),
                Some(ours),
                "{name} disagrees between api.go and api.rs"
            );
        }
    }

    // TEST_SCENARIO: the reader is worth having only if a struct it cannot find fails the comparison rather than passing it vacuously — an empty field list must be caught by the assertion above, not read as "nothing disagrees".
    #[test]
    fn a_struct_the_reader_cannot_find_yields_no_fields() {
        assert!(gosource::struct_fields("type Other struct {\n}", "MachineSpec").is_empty());
        assert!(gosource::struct_fields("", "MachineSpec").is_empty());
    }

    // TEST_SCENARIO: omitempty is the half of a tag a reader is most likely to get quietly wrong, because a tag it mis-splits still yields a plausible name. Both shapes api.go uses are pinned here.
    #[test]
    fn the_reader_tells_an_omitempty_tag_from_a_plain_one() {
        let go = "type S struct {\n\tA string `json:\"a\"`\n\tB string `json:\"b,omitempty\"`\n}";
        let fields = gosource::struct_fields(go, "S");
        assert_eq!(
            fields,
            vec![
                gosource::GoField {
                    json: "a".into(),
                    omitempty: false
                },
                gosource::GoField {
                    json: "b".into(),
                    omitempty: true
                },
            ]
        );
    }
}
