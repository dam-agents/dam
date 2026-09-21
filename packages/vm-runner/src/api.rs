use serde::{Deserialize, Serialize};

// UNIT_BOUNDARY_DESCRIPTION: what an image says a machine should run, which a tree of its files does not carry. Read from the image when it is unpacked and kept beside the tree, because smolvm handed a bare rootfs launches nothing and waits for an exec that never comes.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ImageLaunch {
    pub entrypoint: Vec<String>,
    pub cmd: Vec<String>,
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
