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

        for (name, ours) in [
            ("SharePath", SHARE_PATH),
            ("InitPath", INIT_PATH),
            ("ShareCADir", SHARE_CA_DIR),
            ("GuestCADir", GUEST_CA_DIR),
            ("DiskDevicePath", DISK_DEVICE_PATH),
            ("DiskPath", DISK_PATH),
            ("AgentHome", AGENT_HOME),
            ("AgentDir", AGENT_DIR),
            ("SystemDir", SYSTEM_DIR),
        ] {
            let theirs = go_const(&go, name);
            assert_eq!(
                theirs.as_deref(),
                Some(ours),
                "{name} disagrees between guest.go and guest.rs"
            );
        }
    }

    // TEST_SCENARIO: the reader above is only worth having if a constant it cannot find fails the test rather than passing it. A Go file it cannot parse, or a name that is no longer there, must read as None and take the comparison down with it — the alternative is a guard that goes quiet exactly when the shape it depends on changes.
    #[test]
    fn a_constant_the_reader_cannot_find_is_not_silently_agreed_with() {
        assert_eq!(
            go_const("SharePath = \"/platform\"", "SharePath").as_deref(),
            Some("/platform")
        );
        assert_eq!(
            go_const("InitPath = SharePath + \"/init\"", "InitPath").as_deref(),
            Some("/platform/init")
        );
        assert_eq!(go_const("SharePath = \"/platform\"", "AgentHome"), None);
        assert_eq!(go_const("AgentHome = someCall()", "AgentHome"), None);
        assert_eq!(go_const("InitPath = Unknown + \"/init\"", "InitPath"), None);
    }

    // UNIT_BOUNDARY_DESCRIPTION: reads one constant from a Go const block, in the two shapes guest.go uses: a quoted literal, and SharePath joined to a quoted suffix. Deliberately not a Go parser — anything it does not recognise is None, which fails the comparison above, because a reader that guessed at an unfamiliar shape would agree with a file it had not understood.
    fn go_const(source: &str, name: &str) -> Option<String> {
        let value = source.lines().find_map(|line| {
            let (left, right) = line.split_once('=')?;
            (left.trim() == name).then(|| right.trim().to_string())
        })?;
        if let Some(suffix) = value.strip_prefix("SharePath + ") {
            return Some(format!("{SHARE_PATH}{}", unquote(suffix)?));
        }
        unquote(&value).map(str::to_string)
    }

    fn unquote(value: &str) -> Option<&str> {
        value.strip_prefix('"')?.strip_suffix('"')
    }
}
