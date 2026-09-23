// UNIT_BOUNDARY_DESCRIPTION: the whole contract between the runner and the inside of its machines. The runner writes the share at these paths, and platform-init, which is the machine's entrypoint, reads it and lays out the disk by them. Both link this one file, so the contract exists once. Nothing here is configurable: nothing about a machine's storage varies per agent, so there is no plan to write and none to parse.
use std::path::{Path, PathBuf};

pub const SHARE_PATH: &str = "/platform";
pub const INIT_PATH: &str = "/platform/init";
pub const SHARE_CA_DIR: &str = "/platform/ca";

// UNIT_BOUNDARY_DESCRIPTION: where the image expects the platform's MITM CA. The share carries it and platform-init binds it here, so an image's own trust setup is the same sequence on both backends.
pub const GUEST_CA_DIR: &str = "/etc/platform/ca";

// UNIT_BOUNDARY_DESCRIPTION: DISK_DEVICE_PATH is where smolvm attaches the storage disk, which is a property of the VMM and not a path anything should write to. platform-init moves it to DISK_PATH, whose name is not "workspace" — which in this platform means the directory inside an agent's HOME. smolvm also binds the whole disk at /storage; the fresh root platform-init boots the image on leaves that bind behind, so the image reaches the disk only here and through HOME.
pub const DISK_DEVICE_PATH: &str = "/workspace";
pub const DISK_PATH: &str = "/mnt/platform";

// UNIT_BOUNDARY_DESCRIPTION: the one guest path a machine keeps. It is fixed rather than configured — the image bakes this home into its user and the controller sets it as HOME on both backends — which is what lets the whole storage model be a constant instead of a plan the runner has to write and the guest has to parse.
pub const AGENT_HOME: &str = "/home/agent";

// UNIT_BOUNDARY_DESCRIPTION: the disk's two namespaces. The agent's home is mirrored under AGENT_DIR and the platform's own per-machine state lives under SYSTEM_DIR, so an image whose home happens to contain a `log` directory cannot overwrite the boot log — which a flat layout could not prevent, because the disk root would hold both.
pub const AGENT_DIR: &str = "agent";
pub const SYSTEM_DIR: &str = "system";

// UNIT_BOUNDARY_DESCRIPTION: the system store that holds the upper and work layers of the fresh root the image boots on. platform-init empties it on every boot, so nothing the image writes outside HOME outlives the boot that wrote it.
pub const ROOTFS_DIR: &str = "rootfs";

pub fn agent_store(root: &Path) -> PathBuf {
    root.join(AGENT_DIR)
}

pub fn system_store(root: &Path, name: &str) -> PathBuf {
    root.join(SYSTEM_DIR).join(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: the agent home is the one guest path the controller also names: it sets HOME to it in the agent's environment, and platform-init bind-mounts the disk there. The two are in different languages, so neither can import the other's constant. Both sides instead read the same fixture, and a rename on either side fails its own test rather than a machine that mounts a home nobody uses.
    #[test]
    fn the_agent_home_is_the_one_the_controller_sets() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../contract/guest.json");
        let fixture: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(path).unwrap_or_else(|e| panic!("reading {path}: {e}")),
        )
        .expect("the guest fixture is JSON");
        assert_eq!(fixture["agentHome"], AGENT_HOME);
    }

    // TEST_SCENARIO: the share is mounted at SHARE_PATH, and the runner writes the init and the CA directory directly below it. A path that left the share would be one the runner never writes, and the guest would boot with no init or no CA.
    #[test]
    fn the_share_paths_are_inside_the_share() {
        for path in [INIT_PATH, SHARE_CA_DIR] {
            let parent = Path::new(path).parent().expect("a share path has a parent");
            assert_eq!(
                parent,
                Path::new(SHARE_PATH),
                "{path} is not directly in the share"
            );
        }
    }

    #[test]
    fn the_disk_keeps_the_agent_and_the_platform_apart() {
        let root = Path::new(DISK_PATH);
        assert_eq!(agent_store(root), Path::new("/mnt/platform/agent"));
        assert_eq!(
            system_store(root, "log"),
            Path::new("/mnt/platform/system/log")
        );
        assert_eq!(
            system_store(root, ROOTFS_DIR),
            Path::new("/mnt/platform/system/rootfs")
        );
    }
}
