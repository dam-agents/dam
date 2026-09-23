use serde::{Deserialize, Serialize};

// UNIT_BOUNDARY_DESCRIPTION: the wire half of the machine API. The controller speaks it from Go, and the two meet as JSON and never as types, so every rename here is a wire break — which is why the field names are spelled out rather than derived from the Rust ones. What both sides must write and read is held in the JSON documents under contract/, which this crate's tests and the controller's tests both round-trip, so neither side reads the other's source.
// UNIT_BOUNDARY_DESCRIPTION: a field the JSON leaves out reads as its zero value, as Go's decoder reads it. Without that, a body the controller's client sends naming only what changed — a stop that names nothing but `running` — is refused here as malformed.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
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
    // UNIT_BOUNDARY_DESCRIPTION: the docker configs this machine's image is fetched with, one per pull Secret a pod would list and tried in that order, as the kubelet does. They are credentials in transit: cleared before the spec is stored, and they never reach smolvm or the guest.
    #[serde(rename = "pullAuths", default, skip_serializing_if = "Vec::is_empty")]
    pub pull_auths: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
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

// UNIT_BOUNDARY_DESCRIPTION: a machine's state inside the runner. It is turned into one of the strings above only where a status leaves the runner, because those strings are what the controller matches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Absent,
    Unknown,
    Creating,
    Starting,
    Restarting,
    Running,
    Stopping,
    Stopped,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Absent => STATE_ABSENT,
            State::Unknown => STATE_UNKNOWN,
            State::Creating => STATE_CREATING,
            State::Starting => STATE_STARTING,
            State::Restarting => STATE_RESTARTING,
            State::Running => STATE_RUNNING,
            State::Stopping => STATE_STOPPING,
            State::Stopped => STATE_STOPPED,
        }
    }
}

impl std::fmt::Display for State {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

pub const REASON_NOT_READY: &str = "MachineNotReady";
pub const REASON_OUT_OF_CAPACITY: &str = "MachineOutOfCapacity";
pub const REASON_IMAGE_UNAVAILABLE: &str = "MachineImageUnavailable";
pub const REASON_BOOT_FAILED: &str = "MachineBootFailed";
pub const REASON_EGRESS_CHANGED: &str = "MachineEgressChanged";

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use serde_json::Value;

    fn fixture(name: &str) -> Value {
        let path = format!("{}/contract/{name}", env!("CARGO_MANIFEST_DIR"));
        let body = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {path}: {e}"));
        serde_json::from_str(&body).unwrap_or_else(|e| panic!("{path} is not JSON: {e}"))
    }

    // UNIT_BOUNDARY_DESCRIPTION: holds one wire type to its two fixtures, as serde writes and reads it rather than as the attributes read. `filled` sets every field, and the struct literal that builds it names every field, so a field added here fails to compile until the test gives it a value — and then fails until the fixture holds it too. Reading the full fixture back and writing it again catches the other direction: a field the fixture holds and this type does not know is dropped on the way in and missing on the way out. The zero fixture is exactly the fields written when every value is zero, which is where a skip condition that differs from the controller's omitempty shows.
    fn matches_the_contract<T: Serialize + DeserializeOwned + Default>(name: &str, filled: &T) {
        let full = fixture(&format!("{name}.json"));
        let zero = fixture(&format!("{name}.zero.json"));
        let written = |value: &T| serde_json::to_value(value).expect("the wire types serialize");
        let read = |value: &Value| -> T {
            serde_json::from_value(value.clone())
                .unwrap_or_else(|e| panic!("{name}: the fixture does not decode: {e}"))
        };

        assert_eq!(
            written(filled),
            full,
            "{name}: a value with every field set does not write the full fixture"
        );
        assert_eq!(
            written(&read(&full)),
            full,
            "{name}: the full fixture does not survive being read and written again"
        );
        assert_eq!(
            written(&T::default()),
            zero,
            "{name}: the zero value does not write the zero fixture"
        );
        assert_eq!(
            written(&read(&zero)),
            zero,
            "{name}: the zero fixture does not survive being read and written again"
        );
    }

    // TEST_SCENARIO: these types are one half of a contract whose other half is the controller, in Go, and the two processes meet as JSON and never as types — so nothing but a test can tell them apart. A renamed field, a dropped one, or an omitempty that only one side applies does not fail a build: it fails at runtime, between a controller and a runner, as a value that silently reads as its zero. The fixtures are what both sides are held to; the controller's tests round-trip the same files.
    #[test]
    fn the_wire_types_write_and_read_what_the_contract_says() {
        matches_the_contract(
            "machine-spec",
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
                pull_auths: vec!["{\"auths\":{}}".into()],
            },
        );
        matches_the_contract(
            "machine-status",
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

    // TEST_SCENARIO: Go's decoder reads a field the JSON leaves out as its zero value, so a body naming only what changed is what the controller's client sends. It must decode here to the same zeroes, rather than be refused as malformed.
    #[test]
    fn a_field_the_json_leaves_out_reads_as_zero_as_it_does_in_go() {
        let stop: MachineSpec = serde_json::from_str(r#"{"running":false}"#).unwrap();
        assert!(!stop.running && stop.image.is_empty() && stop.cpus == 0 && stop.env.is_empty());
        let status: MachineStatus = serde_json::from_str(r#"{"state":"running"}"#).unwrap();
        assert!(!status.ready && status.port == 0);
    }

    // TEST_SCENARIO: the states and reasons are the vocabulary the controller matches on. A value that differs by a character is not a compile error on either side — it is a controller that never recognises the state its runner is reporting, so the Agent sits in a condition nothing clears.
    #[test]
    fn the_states_and_reasons_are_the_ones_the_controller_matches_on() {
        let vocabulary = fixture("vocabulary.json");
        assert_eq!(
            vocabulary["states"],
            serde_json::json!([
                STATE_ABSENT,
                STATE_UNKNOWN,
                STATE_CREATING,
                STATE_STARTING,
                STATE_RESTARTING,
                STATE_RUNNING,
                STATE_STOPPING,
                STATE_STOPPED,
            ])
        );
        assert_eq!(
            vocabulary["reasons"],
            serde_json::json!([
                REASON_NOT_READY,
                REASON_OUT_OF_CAPACITY,
                REASON_IMAGE_UNAVAILABLE,
                REASON_BOOT_FAILED,
                REASON_EGRESS_CHANGED,
            ])
        );
    }
}
