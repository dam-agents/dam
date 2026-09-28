// UNIT_BOUNDARY_DESCRIPTION: the whole contract between the runner and the inside of its machines. The runner writes the share at these paths, and platform-init, which is the machine's entrypoint, reads it and lays out the disk by them. Both link this one file, so the contract exists once. Nothing here is configurable: nothing about a machine's storage varies per agent, so there is no plan to write and none to parse. The one per-agent input is the list of paths a runtime migration moved below the home, which arrives in the machine's environment rather than in the share and names only views of the home.
use std::path::{Path, PathBuf};

pub const SHARE_PATH: &str = "/platform";
pub const INIT_PATH: &str = "/platform/init";
pub const SHARE_CA_DIR: &str = "/platform/ca";

// UNIT_BOUNDARY_DESCRIPTION: the home an agent brings with it when it moves to this backend: a tar of its old volume, uploaded into the share while the machine is stopped and before it ever booted. platform-init seeds the agent store from it instead of from the image, on the one boot that finds no store.
pub const SHARE_SEED_FILE: &str = "/platform/seed.tar";

// UNIT_BOUNDARY_DESCRIPTION: the runner writes this file into the share once this machine has booted with its home on the disk, and never removes it. smolvm formats a storage disk it cannot mount, and a formatted disk looks exactly like a disk that was never seeded. Without this file platform-init would seed a fresh home on it and boot as if nothing was lost. With it, platform-init knows the home must already be there, and refuses to boot when it is not.
pub const SEEDED_PATH: &str = "/platform/seeded";

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

// UNIT_BOUNDARY_DESCRIPTION: where a runtime migration puts an agent's persisted paths from outside the home: `/data` moves to `.persisted/data` below the home, where the disk keeps it, and the controller names each moved path in PERSISTED_PATHS_ENV, one per line, so platform-init binds the moved directory back at the path the agent's software knows. The storage model stays one disk holding one path; these are views of it, rebuilt on every boot from the Agent's own spec.
pub const PERSISTED_DIR: &str = ".persisted";
pub const PERSISTED_PATHS_ENV: &str = "PLATFORM_PERSISTED_PATHS";

// UNIT_BOUNDARY_DESCRIPTION: guest paths the platform itself lays out or the kernel owns. A persisted path at one of them, inside one, or above one would hide it, so none is bound, and the api-server refuses to move an Agent that persists one.
pub const UNMOVABLE_PATHS: &[&str] = &[
    "/proc",
    "/sys",
    "/dev",
    SHARE_PATH,
    DISK_PATH,
    DISK_DEVICE_PATH,
    "/storage",
    "/etc/platform",
    "/var/cache/platform",
];

// UNIT_BOUNDARY_DESCRIPTION: whether a persisted path from outside the home may be bound back in the guest: a plain absolute path, not the root, and neither at, inside nor above the home or any unmovable path.
pub fn movable(path: &Path) -> Result<(), String> {
    let mut parts = path.components();
    let plain = parts.next() == Some(std::path::Component::RootDir)
        && parts
            .clone()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
        && path.as_os_str() == path.components().collect::<PathBuf>().as_os_str();
    if !plain {
        return Err(format!("{} is not a plain absolute path", path.display()));
    }
    if path == Path::new("/") {
        return Err("/ is the whole guest".to_string());
    }
    for kept in std::iter::once(AGENT_HOME).chain(UNMOVABLE_PATHS.iter().copied()) {
        let kept = Path::new(kept);
        if path.starts_with(kept) || kept.starts_with(path) {
            return Err(format!(
                "{} would hide or sit inside {}",
                path.display(),
                kept.display()
            ));
        }
    }
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the directory below the home a moved path's data lives in.
pub fn persisted_at(home: &Path, path: &Path) -> PathBuf {
    home.join(PERSISTED_DIR)
        .join(path.strip_prefix("/").unwrap_or(path))
}

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
        assert_eq!(fixture["persistedDir"], PERSISTED_DIR);
        assert_eq!(fixture["persistedPathsEnv"], PERSISTED_PATHS_ENV);
        assert_eq!(
            fixture["unmovablePaths"],
            serde_json::json!(UNMOVABLE_PATHS),
            "the api-server refuses to move exactly the paths platform-init refuses to bind"
        );
    }

    // TEST_SCENARIO: a moved path is bound over the fresh root at boot, as root, from a list the Agent's spec produced. A path that is not plain, the root itself, or one at, inside or above the home or a path the platform lays out would hide what the guest needs, so each is refused; an ordinary path such as /data or /var/lib/app is bound, and its data lives at the same path below .persisted in the home.
    #[test]
    fn only_a_plain_path_away_from_the_platform_is_movable() {
        for bad in [
            "data",
            "/",
            "/data/../etc",
            "/data/./x",
            "/home",
            "/home/agent",
            "/home/agent/x",
            "/proc/1",
            "/etc",
            "/etc/platform/ca",
            "/var/cache",
            "/mnt",
            "/platform",
        ] {
            assert!(movable(Path::new(bad)).is_err(), "{bad} is movable");
        }
        for good in [
            "/data",
            "/var/lib/app",
            "/etc/app",
            "/opt/tool/state",
            "/home2",
        ] {
            assert!(movable(Path::new(good)).is_ok(), "{good} is not movable");
        }
        assert_eq!(
            persisted_at(Path::new(AGENT_HOME), Path::new("/var/lib/app")),
            Path::new("/home/agent/.persisted/var/lib/app")
        );
    }

    // TEST_SCENARIO: the share is mounted at SHARE_PATH, and the runner writes the init, the CA directory and the seed directly below it. A path that left the share would be one the runner never writes, and the guest would boot with no init, no CA, or the image's home where the agent's own was meant to be.
    #[test]
    fn the_share_paths_are_inside_the_share() {
        for path in [INIT_PATH, SHARE_CA_DIR, SHARE_SEED_FILE, SEEDED_PATH] {
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
