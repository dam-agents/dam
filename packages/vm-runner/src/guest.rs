// UNIT_BOUNDARY_DESCRIPTION: the whole contract between this runner and the inside of its machines, and the Rust half of a pair. The Go half is packages/controller/pkg/vmrunner/guest.go, which platform-init reads as the machine's entrypoint; platform-init runs inside the guest and stays Go, so the constants exist twice and the test below is what keeps the two copies one contract. Nothing here is configurable: nothing about a machine's storage varies per agent, so there is no plan to write and none to parse.

pub const SHARE_PATH: &str = "/platform";
pub const INIT_PATH: &str = "/platform/init";
pub const SHARE_CA_DIR: &str = "/platform/ca";

// UNIT_BOUNDARY_DESCRIPTION: where the image expects the platform's MITM CA. The share carries it and platform-init binds it here, so an image's own trust setup is the same sequence on both backends.
pub const GUEST_CA_DIR: &str = "/etc/platform/ca";

// UNIT_BOUNDARY_DESCRIPTION: DiskDevicePath is where smolvm attaches the storage disk, which is a property of the VMM and not a path anything should write to. platform-init moves it to DiskPath, so the disk is reachable by exactly one name, and that name is not "workspace" — which in this platform means the directory inside an agent's HOME.
pub const DISK_DEVICE_PATH: &str = "/workspace";
pub const DISK_PATH: &str = "/mnt/platform";

// UNIT_BOUNDARY_DESCRIPTION: the one guest path a machine keeps. It is fixed rather than configured — the image bakes this home into its user and the controller sets it as HOME on both backends — which is what lets the whole storage model be a constant instead of a plan the runner has to write and the guest has to parse.
pub const AGENT_HOME: &str = "/home/agent";

// UNIT_BOUNDARY_DESCRIPTION: the disk's two namespaces. The agent's home is mirrored under AgentDir and the platform's own per-machine state lives under SystemDir, so an image whose home happens to contain a `log` directory cannot overwrite the boot log — which a flat layout could not prevent, because the disk root would hold both.
pub const AGENT_DIR: &str = "agent";
pub const SYSTEM_DIR: &str = "system";

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: the guest contract is written twice, once here and once in Go, because platform-init runs inside the machine and this runner runs outside it. Two copies of a contract drift, and this one drifts silently: a runner writing the share at one path and an entrypoint reading it at another produces a machine that boots, finds no init, and comes up with no agent in it. So the Go file is read as the source of truth and every constant is matched against it — a rename on either side fails here rather than in a guest nobody is watching.
    #[test]
    fn the_go_half_of_the_guest_contract_says_the_same_thing() {
        let go = std::fs::read_to_string("../controller/pkg/vmrunner/guest.go")
            .expect("the Go half of the guest contract is next door");

        for (name, value) in [
            ("SharePath", SHARE_PATH),
            ("ShareCADir", SHARE_CA_DIR),
            ("GuestCADir", GUEST_CA_DIR),
            ("DiskDevicePath", DISK_DEVICE_PATH),
            ("DiskPath", DISK_PATH),
            ("AgentHome", AGENT_HOME),
            ("AgentDir", AGENT_DIR),
            ("SystemDir", SYSTEM_DIR),
        ] {
            assert!(
                go_const(&go, name).as_deref() == Some(value),
                "{name} is {:?} in guest.go and {value:?} here",
                go_const(&go, name)
            );
        }

        // InitPath is written as a concatenation in Go, so it is checked as one.
        assert!(
            go.contains(r#"InitPath    = SharePath + "/init""#)
                || go.contains(r#"InitPath   = SharePath + "/init""#),
            "guest.go no longer derives InitPath from SharePath + \"/init\""
        );
        assert_eq!(INIT_PATH, format!("{SHARE_PATH}/init"));
    }

    // UNIT_BOUNDARY_DESCRIPTION: reads one `Name = "value"` from a Go const block. Deliberately not a Go parser: it has to fail when the shape it expects is gone, because a constant it cannot find is exactly the drift it exists to catch.
    fn go_const(source: &str, name: &str) -> Option<String> {
        source.lines().find_map(|line| {
            let (left, right) = line.split_once('=')?;
            if left.trim() != name {
                return None;
            }
            let quoted = right.trim();
            quoted
                .strip_prefix('"')
                .and_then(|rest| rest.strip_suffix('"'))
                .map(str::to_string)
        })
    }
}
