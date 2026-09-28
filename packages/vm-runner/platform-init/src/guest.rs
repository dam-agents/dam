// UNIT_BOUNDARY_DESCRIPTION: the whole contract between the runner and the inside of its machines. The runner writes the share at these paths, and platform-init, which is the machine's entrypoint, reads it and lays out the disk by them. Both link this one file, so the contract exists once. Nothing here is configurable: nothing about a machine's storage varies per agent, so there is no plan to write and none to parse. What a machine needs beyond that is made by the home's own boot hooks, which travel with the home rather than in the share.
use std::path::{Path, PathBuf};

pub const SHARE_PATH: &str = "/platform";
pub const INIT_PATH: &str = "/platform/init";
pub const SHARE_CA_DIR: &str = "/platform/ca";

// UNIT_BOUNDARY_DESCRIPTION: the home an agent brings with it when it moves to this backend: a tar of its old volume, uploaded into the share while the machine is stopped and before it ever booted. platform-init seeds the agent store from it instead of from the image, on the one boot that finds no store.
pub const SHARE_SEED_FILE: &str = "/platform/seed.tar";

// UNIT_BOUNDARY_DESCRIPTION: the runner writes this file into the share once this machine has booted with its home on the disk, and never removes it. smolvm formats a storage disk it cannot mount, and a formatted disk looks exactly like a disk that was never seeded. Without this file platform-init would seed a fresh home on it and boot as if nothing was lost. With it, platform-init knows the home must already be there, and refuses to boot when it is not.
pub const SEEDED_PATH: &str = "/platform/seeded";

// UNIT_BOUNDARY_DESCRIPTION: the runner writes this file into the share while a runtime migration boots the machine: the SHA-256 and byte count of the seed the home must come from, as the controller sent them. The guest reads it and cannot write it, because the share is read-only. With it, platform-init seeds a missing home from that seed alone and never from the image, and boots an existing home only if the disk records that it came from that seed. The runner removes it once the controller stops expecting a seed.
pub const SEED_EXPECTED_PATH: &str = "/platform/seed-expected";

// UNIT_BOUNDARY_DESCRIPTION: the system store file where platform-init records the SHA-256 of the seed it restored the home from. It is written before the restored home is renamed into place, so a home that exists and came from a seed always has it. A later boot that still expects a seed reads it to tell a home from that seed from any other.
pub const SEEDED_FROM_FILE: &str = "seeded-from";

// UNIT_BOUNDARY_DESCRIPTION: one seed as the share names it: a lowercase hex SHA-256 and a byte count, written as one line `SHA256 BYTES`. It is plain text rather than JSON so the guest's static binary parses it with nothing but std.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedDigest {
    pub sha256: String,
    pub bytes: u64,
}

impl SeedDigest {
    pub fn line(&self) -> String {
        format!("{} {}\n", self.sha256, self.bytes)
    }

    pub fn parse(text: &str) -> Option<Self> {
        let mut fields = text.split_whitespace();
        let sha256 = fields.next().filter(|sha| is_sha256(sha))?.to_string();
        let bytes = fields.next()?.parse().ok()?;
        fields.next().is_none().then_some(Self { sha256, bytes })
    }
}

pub fn is_sha256(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

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

// UNIT_BOUNDARY_DESCRIPTION: the home's boot hooks, relative to the home: platform-init runs what is here on every boot, because the root is fresh each time and anything an agent needs outside its home must be made again. It is platform-init's corner of `.platform`, which is otherwise agent-runtime's state. A runtime migration puts PERSISTED_PATHS_HOOK here, the hook that links each persisted path it moved into the home back from its old place.
pub const BOOT_HOOK_DIR: &str = ".platform/boot.d";
pub const PERSISTED_PATHS_HOOK: &str = "10-persisted-paths.sh";

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

    // TEST_SCENARIO: the share is mounted at SHARE_PATH, and the runner writes the init, the CA directory and the seed directly below it. A path that left the share would be one the runner never writes, and the guest would boot with no init, no CA, or the image's home where the agent's own was meant to be.
    #[test]
    fn the_share_paths_are_inside_the_share() {
        for path in [
            INIT_PATH,
            SHARE_CA_DIR,
            SHARE_SEED_FILE,
            SEEDED_PATH,
            SEED_EXPECTED_PATH,
        ] {
            let parent = Path::new(path).parent().expect("a share path has a parent");
            assert_eq!(
                parent,
                Path::new(SHARE_PATH),
                "{path} is not directly in the share"
            );
        }
    }

    // TEST_SCENARIO: the runner writes the expected seed and platform-init reads it, in two binaries. What one writes the other must read back exactly. Anything else — a digest that is not lowercase hex SHA-256, a missing field, an extra one — reads as no record at all, so the guest refuses the boot rather than guess which seed was meant.
    #[test]
    fn the_expected_seed_reads_back_what_the_runner_writes_and_nothing_else() {
        let seed = SeedDigest {
            sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".into(),
            bytes: 4,
        };
        assert_eq!(SeedDigest::parse(&seed.line()), Some(seed.clone()));
        for bad in [
            "",
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08 4",
            "abc 4",
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 -1",
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 4 5",
        ] {
            assert_eq!(SeedDigest::parse(bad), None, "{bad:?} was read");
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
