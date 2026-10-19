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
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(rename = "caCert", skip_serializing_if = "String::is_empty")]
    pub ca_cert: String,
    #[serde(rename = "allowCidrs", skip_serializing_if = "Vec::is_empty")]
    pub allow_cidrs: Vec<String>,
    // UNIT_BOUNDARY_DESCRIPTION: for a runner outside the cluster, the port on this host's loopback where the machine's paired gateway is forwarded. The guest reaches it at its own gateway address on the same port, and at nothing else: this port replaces allowCidrs, because allowing the gateway address would open every loopback port of the host, the other machines' published ports among them.
    #[serde(rename = "gatewayHostPort", skip_serializing_if = "is_zero")]
    pub gateway_host_port: u16,
    // UNIT_BOUNDARY_DESCRIPTION: the resolver smolvm relays every guest DNS query to, whatever address the guest sent it to: the paired gateway's own, which answers every name with the gateway's address and forwards nothing. Empty relays guest DNS nowhere, as for a runner outside the cluster, which cannot reach the gateway's resolver.
    #[serde(rename = "guestResolver", skip_serializing_if = "String::is_empty")]
    pub guest_resolver: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub revision: String,
    pub running: bool,
    // UNIT_BOUNDARY_DESCRIPTION: the docker configs this machine's image is fetched with, one per pull Secret a pod would list and tried in that order, as the kubelet does. They are credentials in transit: cleared before the spec is stored, and they never reach smolvm or the guest.
    #[serde(rename = "pullAuths", skip_serializing_if = "Vec::is_empty")]
    pub pull_auths: Vec<String>,
    // UNIT_BOUNDARY_DESCRIPTION: set while the controller is moving an Agent onto this machine from the container Backend. It is what lets a seed capability seed the machine at all: a machine never marked is never seeded by one, whatever it presents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migration: Option<Migration>,
    // UNIT_BOUNDARY_DESCRIPTION: the seed this machine's home must be restored from, as the migration's upload was answered: the controller sends it while a runtime migration boots the machine, and not after. With it the runner starts the machine only while its share holds exactly that seed, and platform-init seeds the home from that seed or not at all, never from the image. It says nothing about the machine's shape, so a change to it alone restarts nothing.
    #[serde(rename = "expectSeed", skip_serializing_if = "Option::is_none")]
    pub expect_seed: Option<SeedResult>,
    // UNIT_BOUNDARY_DESCRIPTION: asks for this machine alone to get the node's virtualization extensions, so its guest can run KVM itself. The runner grants it only when the install lets it nest and the node's KVM allows it; every other machine on the runner boots without them.
    #[serde(rename = "nestedVirtualization", skip_serializing_if = "is_zero")]
    pub nested_virtualization: bool,
}

// UNIT_BOUNDARY_DESCRIPTION: a runtime migration in progress on a machine. It carries nothing yet; its presence is the mark.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct Migration {}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct MachineStatus {
    pub state: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub reason: String,
    #[serde(skip_serializing_if = "is_zero")]
    pub restarts: i32,
    #[serde(skip_serializing_if = "is_zero")]
    pub port: i32,
    pub ready: bool,
    #[serde(skip_serializing_if = "is_zero")]
    pub cpus: i32,
    #[serde(rename = "memoryMiB", skip_serializing_if = "is_zero")]
    pub memory_mib: i32,
    // UNIT_BOUNDARY_DESCRIPTION: the host memory the running machine's VMM holds, as the prober last measured it. The guest hands freed memory back, so this is what the machine uses, and what the controller sizes the runner's memory request by. Zero while nothing has been measured, which the controller reads as the machine's full size.
    #[serde(rename = "usedMiB", skip_serializing_if = "is_zero")]
    pub used_mib: i32,
    // UNIT_BOUNDARY_DESCRIPTION: whether the running machine is within WARMUP of its boot, when admission counts it at least at the warm-up floor however little it was measured at; the controller counts it the same way. It is kept out of what moves the status version, as `used_mib` is.
    #[serde(skip_serializing_if = "is_zero")]
    pub warming: bool,
    // UNIT_BOUNDARY_DESCRIPTION: the disk the machine's last start asked for, in GiB; the disk itself never shrinks below a larger earlier one. A runner that reports it grows a disk at the machine's next start rather than restarting it, which is how the controller knows it may send a larger disk to a running machine. Zero before the first start, and from an older runner.
    #[serde(rename = "diskGiB", skip_serializing_if = "is_zero")]
    pub disk_gib: i32,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
    // UNIT_BOUNDARY_DESCRIPTION: changes whenever anything else in this status changes. A status read given `since` with this value waits until it changes, which is how the controller learns that a booting guest answered without polling for it.
    #[serde(skip_serializing_if = "is_zero")]
    pub version: u64,
    // UNIT_BOUNDARY_DESCRIPTION: the SHA-256 of the seed this machine's home was restored from, once a guest booted with that seed expected has answered. Empty for a home seeded from the image, and for one not yet known to be on the disk. The controller ends a runtime migration only when this is the seed it expects.
    #[serde(rename = "homeSeededFrom", skip_serializing_if = "String::is_empty")]
    pub home_seeded_from: String,
    // UNIT_BOUNDARY_DESCRIPTION: whether the machine boots with the node's virtualization extensions: its spec asks for them and this runner grants them. The controller puts it on the Agent, so an owner who asked sees whether they got it.
    #[serde(skip_serializing_if = "is_zero")]
    pub nested: bool,
}

// UNIT_BOUNDARY_DESCRIPTION: what the owner's machines use of the runner, as the usage read answers it: the claim every disk sits on, the memory the runner hands out and how much of it admission counts as committed, and each machine's own share. The api-server reads it to show a user their pools and to refuse a new agent once storage is critically full; it names machine ids and sizes only, so a read-only capability is enough to fetch it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct RunnerUsage {
    pub storage: StorageUsage,
    pub memory: MemoryUsage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<CpuUsage>,
    pub machines: Vec<MachineUsage>,
    // UNIT_BOUNDARY_DESCRIPTION: whether each machine above lists the memory figures a status reports for a running machine, which the controller's memory pass reads instead of a status read each. A runner older than those figures leaves this out, and the controller then reads each machine's status, so a controller newer than its runners still counts a warming machine at its warm-up floor and a machine still running at its old size at that size.
    #[serde(rename = "machineFigures", skip_serializing_if = "is_zero")]
    pub machine_figures: bool,
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's CPU over the last minute, off its cgroup: the limit the kernel holds it to (zero for none), what its machines used on average, the percentage of active scheduler periods in which that limit held them back, and the CPU pressure: the share of the last minute in which its agents waited for a CPU, by the cgroup's pressure stall information or by that throttling, whichever is higher. The pressure is absent when the cgroup has no cpu.pressure, and the whole figure when the runner has no cgroup, or neither a CPU limit nor a pressure to read.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct CpuUsage {
    #[serde(rename = "limitMilli")]
    pub limit_milli: u64,
    #[serde(rename = "usedMilli")]
    pub used_milli: u64,
    #[serde(rename = "throttledPercent")]
    pub throttled_percent: u32,
    #[serde(rename = "pressurePercent", skip_serializing_if = "Option::is_none")]
    pub pressure_percent: Option<u32>,
}

// UNIT_BOUNDARY_DESCRIPTION: the claim's use as the storage guard measures it; both zero when it could not be measured. Beside each machine's disk, the part of that use an owner did not write themselves, so a user whose storage is short is told what fills it: the seeds runtime migrations uploaded that nothing removed yet. Image trees are on the node's disk, not the claim. What is left is the runner's bookkeeping, its logs and the filesystem's own overhead.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct StorageUsage {
    #[serde(rename = "usedBytes")]
    pub used_bytes: u64,
    #[serde(rename = "usableBytes")]
    pub usable_bytes: u64,
    #[serde(rename = "seedBytes", skip_serializing_if = "is_zero")]
    pub seed_bytes: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: the memory limit the runner admits against and what admission counts as committed on it, in MiB. A limit of zero is a runner told nothing about its memory.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct MemoryUsage {
    #[serde(rename = "limitMiB")]
    pub limit_mib: i32,
    #[serde(rename = "committedMiB")]
    pub committed_mib: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct MachineUsage {
    pub id: String,
    pub state: String,
    // UNIT_BOUNDARY_DESCRIPTION: the memory figures a status reports for a running machine, sent under the `machineFigures` mark on the read. The measured use is kept out of the status version, so a figure that moves at every probe wakes nothing.
    pub cpus: i32,
    #[serde(rename = "memoryMiB", skip_serializing_if = "is_zero")]
    pub memory_mib: i32,
    #[serde(rename = "usedMiB", skip_serializing_if = "is_zero")]
    pub used_mib: i32,
    pub warming: bool,
    #[serde(rename = "diskGiB", skip_serializing_if = "is_zero")]
    pub disk_gib: i32,
    #[serde(rename = "diskUsedBytes", skip_serializing_if = "is_zero")]
    pub disk_used_bytes: u64,
    #[serde(rename = "cpuMilli", skip_serializing_if = "is_zero")]
    pub cpu_milli: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a seed upload: how many bytes the runner stored and their SHA-256, in lowercase hex. The uploader counts and hashes what it sent the same way, so a seed cut short or changed on the way is caught before the machine boots from it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct SeedResult {
    pub bytes: u64,
    pub sha256: String,
}

// UNIT_BOUNDARY_DESCRIPTION: which runner release the pod runs, as its loader last wrote it: the release running, the one the controller asked for, and, when the two differ, why the loader holds on to the one running. The controller reads it to tell a hand-off that will come by itself from one that never can, which only a new pod settles.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct RunnerRelease {
    pub running: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub target: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub held: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
}

// UNIT_BOUNDARY_DESCRIPTION: the release the controller names for the pod's loader to run: the runner image reference the stager staged it under.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct RunnerReleaseName {
    pub release: String,
}

// UNIT_BOUNDARY_DESCRIPTION: how close the runner's own memory is to its limit, as its cgroup last read: the working set the kernel kills the runner by, and whether that is past the pressure threshold. `version` moves when pressure starts or ends, and again while it lasts, so the controller can wait on it and reclaim at once. A runner with no cgroup to read never moves it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct RunnerPressure {
    #[serde(skip_serializing_if = "is_zero")]
    pub version: u64,
    pub pressured: bool,
    #[serde(rename = "limitMiB", skip_serializing_if = "is_zero")]
    pub limit_mib: i32,
    #[serde(rename = "workingSetMiB", skip_serializing_if = "is_zero")]
    pub working_set_mib: i32,
}
// UNIT_BOUNDARY_DESCRIPTION: why a loader holds on to the release it runs. Not yet staged passes once the node's stager has copied the release. The other three never pass in this pod: a release built for another pod — one whose runner does not load against this pod's libc — runs only in a new pod; one that declares another reboot key than this pod's release reboots the pod, which is what reboots its machines; and one that exited right after it took over is not tried again until the controller names another. `runtime` keeps its wire name from when it also meant another VM runtime.
pub const HELD_UNSTAGED: &str = "unstaged";
pub const HELD_RUNTIME: &str = "runtime";
pub const HELD_REBOOT: &str = "reboot";
pub const HELD_FAILED: &str = "failed";

// UNIT_BOUNDARY_DESCRIPTION: vm-seed's exit code for a copy that a fresh attempt cannot change — a home past a walk limit, or larger than the machine's disk — so the controller fails the migration at once instead of spending its attempts on it.
pub const SEED_EXIT_PERMANENT: u8 = 3;

fn is_zero<T: Default + PartialEq>(n: &T) -> bool {
    *n == T::default()
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
pub const REASON_SEED_MISSING: &str = "MachineSeedMissing";
pub const REASON_STORAGE_FULL: &str = "MachineStorageFull";
pub const REASON_HOME_FULL: &str = "MachineHomeFull";
// UNIT_BOUNDARY_DESCRIPTION: a boot that copies a disk before its guest first answers — a migration seed's restore — and is still at it. It is no failure: the runner holds the boot up to plan::COPYING_RESTART, so the controller counts no start failure and no idle time against it.
pub const REASON_COPYING_DISK: &str = "MachineCopyingDisk";

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
                gateway_host_port: 30100,
                guest_resolver: "10.0.0.1".into(),
                revision: "r1".into(),
                running: true,
                pull_auths: vec!["{\"auths\":{}}".into()],
                migration: Some(Migration {}),
                expect_seed: Some(SeedResult {
                    bytes: 1234,
                    sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
                        .into(),
                }),
                nested_virtualization: true,
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
                used_mib: 640,
                warming: true,
                disk_gib: 20,
                message: "up".into(),
                version: 1,
                home_seeded_from:
                    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
                nested: true,
            },
        );
        matches_the_contract(
            "runner-release",
            &RunnerRelease {
                running: "quay.io/x/vm-runner@sha256:1".into(),
                target: "quay.io/x/vm-runner@sha256:2".into(),
                held: HELD_RUNTIME.into(),
                message: "built against another runtime".into(),
            },
        );
        matches_the_contract(
            "runner-release-name",
            &RunnerReleaseName {
                release: "quay.io/x/vm-runner@sha256:2".into(),
            },
        );
        matches_the_contract(
            "runner-usage",
            &RunnerUsage {
                storage: StorageUsage {
                    used_bytes: 32212254720,
                    usable_bytes: 107374182400,
                    seed_bytes: 2147483648,
                },
                memory: MemoryUsage {
                    limit_mib: 12288,
                    committed_mib: 3072,
                },
                machines: vec![MachineUsage {
                    id: "agent-a".into(),
                    state: STATE_RUNNING.into(),
                    cpus: 2,
                    memory_mib: 2048,
                    used_mib: 640,
                    warming: true,
                    disk_gib: 100,
                    disk_used_bytes: 8589934592,
                    cpu_milli: 350,
                }],
                cpu: Some(CpuUsage {
                    limit_milli: 9000,
                    used_milli: 1200,
                    throttled_percent: 4,
                    pressure_percent: Some(12),
                }),
                machine_figures: true,
            },
        );
        matches_the_contract(
            "runner-pressure",
            &RunnerPressure {
                version: 7,
                pressured: true,
                limit_mib: 12288,
                working_set_mib: 11800,
            },
        );
        matches_the_contract(
            "seed-result",
            &SeedResult {
                bytes: 1234,
                sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
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
                REASON_SEED_MISSING,
                REASON_STORAGE_FULL,
                REASON_HOME_FULL,
                REASON_COPYING_DISK,
            ])
        );
        assert_eq!(vocabulary["seedExitPermanent"], SEED_EXIT_PERMANENT);
        assert_eq!(
            vocabulary["releaseHolds"],
            serde_json::json!([HELD_UNSTAGED, HELD_RUNTIME, HELD_REBOOT, HELD_FAILED])
        );
    }
}
