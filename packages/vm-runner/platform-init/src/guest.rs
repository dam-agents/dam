// UNIT_BOUNDARY_DESCRIPTION: the whole contract between the runner and the inside of its machines. The runner writes the share at these paths, and platform-init, which is the machine's entrypoint, reads it and lays out the disk by them. Both link this one file, so the contract exists once. Nothing here is configurable: nothing about a machine's storage varies per agent, so there is no plan to write and none to parse. Nothing in the agent's home is ever read as instructions, and nothing there is ever run.
use std::path::{Path, PathBuf};

pub const SHARE_PATH: &str = "/platform";
pub const INIT_PATH: &str = "/platform/init";
pub const SHARE_CA_DIR: &str = "/platform/ca";

// UNIT_BOUNDARY_DESCRIPTION: platform-runc, the OCI runtime wrapper that gives every container started inside a machine the platform CA. The image's entrypoint points docker and k3s at this path, so it is part of the contract the runner writes the share by.
pub const RUNC_PATH: &str = "/platform/runc";

// UNIT_BOUNDARY_DESCRIPTION: the home an agent brings with it when it moves to this backend: a tar of its old volume, uploaded into the share while the machine is stopped and before it ever booted. platform-init seeds the agent store from it instead of from the image, on the one boot that finds no store.
pub const SHARE_SEED_FILE: &str = "/platform/seed.tar";

// UNIT_BOUNDARY_DESCRIPTION: the runner writes this file into the share once this machine has booted with its home on the disk, and never removes it. smolvm formats a storage disk it cannot mount, and a formatted disk looks exactly like a disk that was never seeded. Without this file platform-init would seed a fresh home on it and boot as if nothing was lost. With it, platform-init knows the home must already be there, and refuses to boot when it is not.
pub const SEEDED_PATH: &str = "/platform/seeded";

// UNIT_BOUNDARY_DESCRIPTION: the runner writes this file into the share while a runtime migration boots the machine: the SHA-256 and byte count of the seed the home must come from, as the controller sent them. The guest reads it and cannot write it, because the share is read-only. With it, platform-init seeds a missing home from that seed alone and never from the image, and boots an existing home only if the disk records that it came from that seed. The runner removes it once the controller stops expecting a seed.
pub const SEED_EXPECTED_PATH: &str = "/platform/seed-expected";

// UNIT_BOUNDARY_DESCRIPTION: the runner writes this file into the share before every boot: one line that names the image the boot runs. For an image tree on the runner's host it also holds the tree's inode and mtime, because a tree staged again under the same name is a new image. platform-init keeps the machine's root only while this line is the one it recorded for that root. A share without it, from a runner older than this file, names no image, and the root is then fresh.
pub const IMAGE_PATH: &str = "/platform/image";

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
pub const GUEST_CA_FILE: &str = "/etc/platform/ca/ca.crt";

// UNIT_BOUNDARY_DESCRIPTION: DISK_DEVICE_PATH is where smolvm attaches the storage disk, which is a property of the VMM and not a path anything should write to. platform-init moves it to DISK_PATH, whose name is not "workspace" — which in this platform means the directory inside an agent's HOME. smolvm also binds the whole disk at /storage; the root platform-init boots the image on leaves that bind behind, so the image reaches the disk only here and through HOME.
pub const DISK_DEVICE_PATH: &str = "/workspace";
pub const DISK_PATH: &str = "/mnt/platform";

// UNIT_BOUNDARY_DESCRIPTION: the one guest path a machine keeps. It is fixed rather than configured — the image bakes this home into its user and the controller sets it as HOME on both backends — which is what lets the whole storage model be a constant instead of a plan the runner has to write and the guest has to parse.
pub const AGENT_HOME: &str = "/home/agent";

// UNIT_BOUNDARY_DESCRIPTION: the disk's two namespaces. The agent's home is mirrored under AGENT_DIR and the platform's own per-machine state lives under SYSTEM_DIR, so an image whose home happens to contain a `log` directory cannot overwrite the boot log — which a flat layout could not prevent, because the disk root would hold both.
pub const AGENT_DIR: &str = "agent";
pub const SYSTEM_DIR: &str = "system";

// UNIT_BOUNDARY_DESCRIPTION: the system store that holds the upper and work layers of the root the image boots on. platform-init keeps the upper layer while the machine boots the same image, and empties it when the image changes or is unknown, so what the image writes outside HOME lasts as long as that image, and an old image's changes never lie over a new one. The work layer is overlayfs scratch and is emptied on every boot.
pub const ROOTFS_DIR: &str = "rootfs";

// UNIT_BOUNDARY_DESCRIPTION: the system store file that says which layout the disk is in: one decimal version on one line. Every disk carries one from its first boot, so a later layout change can upgrade a disk in place at boot, from the version it reads, instead of guessing from what the disk happens to hold. A disk from before the file existed is in the first layout, the only one there has been, and is marked as such on its next boot.
pub const LAYOUT_FILE: &str = "layout";
pub const LAYOUT_VERSION: u32 = 1;

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

    // TEST_SCENARIO: platform-runc reads the CA from the same guest path the controller puts in the agent's environment. A CA file named differently on this side is a wrapper that finds nothing and starts every container without the CA, silently.
    #[test]
    fn the_ca_file_is_the_one_the_controller_names() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../contract/guest.json");
        let fixture: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(path).unwrap_or_else(|e| panic!("reading {path}: {e}")),
        )
        .expect("the guest fixture is JSON");
        assert_eq!(fixture["caFile"], GUEST_CA_FILE);
        assert_eq!(
            Path::new(GUEST_CA_FILE).parent(),
            Some(Path::new(GUEST_CA_DIR))
        );
    }

    // TEST_SCENARIO: the share is mounted at SHARE_PATH, and the runner writes the init, the CA directory, the seed, the image record and platform-runc directly below it. A path that left the share would be one the runner never writes, and the guest would boot with no init, no CA, the image's home where the agent's own was meant to be, a root it cannot tell it may keep, or containers that never get the CA.
    #[test]
    fn the_share_paths_are_inside_the_share() {
        for path in [
            INIT_PATH,
            SHARE_CA_DIR,
            SHARE_SEED_FILE,
            SEEDED_PATH,
            SEED_EXPECTED_PATH,
            IMAGE_PATH,
            RUNC_PATH,
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
        assert_eq!(
            system_store(root, LAYOUT_FILE),
            Path::new("/mnt/platform/system/layout")
        );
    }
}
