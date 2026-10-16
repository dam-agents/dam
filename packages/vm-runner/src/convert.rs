use std::path::Path;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use smolvm::data::disk::AttachedDisk;
use smolvm::storage::STORAGE_DISK_FILENAME;

// UNIT_BOUNDARY_DESCRIPTION: a conversion's record, beside the machine's disks: the nonce the guest names when its copy is committed, and whether the runner swapped the disks. The record is the runner's, never the guest's, so a guest cannot make the runner swap a disk it did not fill.
const STATE_FILE: &str = "disk-conversion";
const NEXT_DISK: &str = "storage.next.raw";
// UNIT_BOUNDARY_DESCRIPTION: the share record that asks the guest to convert, holding the nonce, as platform-init reads it.
const SHARE_RECORD: &str = "convert";
pub const CAPABILITY_PREFIX: &str = "dam-disk-converted:";
// UNIT_BOUNDARY_DESCRIPTION: how many boots may try a conversion before the runner leaves the disk ext4 for good: a copy that keeps failing would otherwise make every start of the machine a long one.
const ATTEMPTS: u32 = 3;

// UNIT_BOUNDARY_DESCRIPTION: whether the machine's share asks its guest to convert, which is what a boot that has not answered yet may be busy doing for as long as the copy takes (see plan::CONVERTING_RESTART).
pub fn requested(share: &Path) -> bool {
    share.join(SHARE_RECORD).exists()
}

#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
struct Conversion {
    nonce: String,
    committed: bool,
    attempts: u32,
}

#[derive(Debug, PartialEq)]
enum Filesystem {
    Ext4,
    Btrfs,
    Other,
}

// UNIT_BOUNDARY_DESCRIPTION: which filesystem a disk holds, by its superblock's magic alone, as runtime::holds_filesystem reads it: two bytes are not a filesystem the host parses.
fn filesystem(disk: &Path) -> anyhow::Result<Filesystem> {
    use std::os::unix::fs::FileExt;
    let file = match std::fs::File::open(disk) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Filesystem::Other),
        Err(e) => return Err(e).with_context(|| format!("reading {}", disk.display())),
    };
    let at = |offset, magic: &[u8]| {
        let mut read = vec![0; magic.len()];
        file.read_exact_at(&mut read, offset).is_ok() && read == magic
    };
    Ok(if at(0x1_0040, b"_BHRfS_M") {
        Filesystem::Btrfs
    } else if at(1024 + 56, &[0x53, 0xEF]) {
        Filesystem::Ext4
    } else {
        Filesystem::Other
    })
}

fn read(vm_dir: &Path) -> Option<Conversion> {
    serde_json::from_slice(&std::fs::read(vm_dir.join(STATE_FILE)).ok()?).ok()
}

fn write(vm_dir: &Path, conversion: &Conversion) -> anyhow::Result<()> {
    crate::files::write(
        &vm_dir.join(STATE_FILE),
        &serde_json::to_vec(conversion)?,
        0o600,
    )?;
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: settles a conversion before a boot, and returns the disk to attach for this boot's copy, if any. A committed conversion whose exchange a crash cut short is finished, told apart by the magic of what storage.raw holds; one that finished is cleaned up, its old ext4 disk deleted, since the btrfs disk has booted and answered since. An ext4 disk, with the switch on and attempts left, gets a fresh btrfs disk made by `format` (the template's, with a UUID of its own) unless one is there, and the share asks the guest to copy into it. Anything else clears the share's request, so a guest never converts on a stale one.
pub fn before_start(
    vm_dir: &Path,
    share: Option<&Path>,
    enabled: bool,
    fits: impl FnOnce(u64) -> bool,
    format: impl FnOnce(&Path) -> anyhow::Result<()>,
) -> anyhow::Result<Option<AttachedDisk>> {
    let storage = vm_dir.join(STORAGE_DISK_FILENAME);
    let next = vm_dir.join(NEXT_DISK);
    let request = share.map(|share| share.join(SHARE_RECORD));
    let clear = || {
        if let Some(request) = &request {
            let _ = std::fs::remove_file(request);
        }
    };
    let state = read(vm_dir);
    if let Some(conversion) = state.as_ref().filter(|c| c.committed) {
        if filesystem(&storage)? == Filesystem::Ext4 && filesystem(&next)? == Filesystem::Btrfs {
            exchange(&storage, &next)?;
        }
        tracing::info!(nonce = %conversion.nonce, "the storage disk was converted to btrfs; deleting the old ext4 disk");
        let _ = std::fs::remove_file(&next);
        let _ = std::fs::remove_file(next.with_extension("formatted"));
        let _ = std::fs::remove_file(vm_dir.join(STATE_FILE));
        clear();
        return Ok(None);
    }
    let Some(request) = request
        .clone()
        .filter(|_| enabled && filesystem(&storage).is_ok_and(|fs| fs == Filesystem::Ext4))
    else {
        clear();
        return Ok(None);
    };
    let mut conversion = state.unwrap_or_default();
    if conversion.attempts >= ATTEMPTS {
        clear();
        return Ok(None);
    }
    if let Some(other) = converting_beside(vm_dir) {
        tracing::info!(other = %other.display(), "another machine of this runner is converting its disk; this one converts at a later start");
        clear();
        return Ok(None);
    }
    let need = allocated(&storage) / 10 * 11 + (1 << 30);
    if !fits(need) {
        tracing::warn!(need, "the owner's storage has no room for a btrfs copy of this disk beside it; it boots its ext4 disk and converts at a later start");
        clear();
        return Ok(None);
    }
    if conversion.nonce.is_empty() {
        conversion.nonce = nonce();
    }
    conversion.attempts += 1;
    write(vm_dir, &conversion)?;
    if filesystem(&next)? != Filesystem::Btrfs {
        let _ = std::fs::remove_file(&next);
        format(&next).context("making the btrfs disk to convert into")?;
    }
    crate::files::write(
        &request,
        format!("{}\n", conversion.nonce).as_bytes(),
        0o644,
    )?;
    tracing::info!(
        attempt = conversion.attempts,
        "converting the storage disk to btrfs at this boot"
    );
    Ok(Some(AttachedDisk {
        path: next,
        read_only: false,
    }))
}

// UNIT_BOUNDARY_DESCRIPTION: at a boot's first answer, swaps the disks when the guest says its copy is committed, by naming this conversion's nonce among its capabilities (`supports` asks it). The swap is one rename of both files, recorded as committed first, so a crash on either side of it is finished by before_start. The running VMM keeps both files open by descriptor, so the guest is not disturbed. Returns whether the disks were swapped, so the caller detaches the old disk from the machine's record.
pub fn after_ready(
    vm_dir: &Path,
    supports: impl FnOnce(&str) -> anyhow::Result<bool>,
) -> anyhow::Result<bool> {
    let Some(mut conversion) = read(vm_dir).filter(|c| !c.committed && !c.nonce.is_empty()) else {
        return Ok(false);
    };
    let named = format!("{CAPABILITY_PREFIX}{}", conversion.nonce);
    if !supports(&named)? {
        return Ok(false);
    }
    conversion.committed = true;
    write(vm_dir, &conversion)?;
    exchange(&vm_dir.join(STORAGE_DISK_FILENAME), &vm_dir.join(NEXT_DISK))?;
    tracing::info!(nonce = %conversion.nonce, "the guest converted its storage disk to btrfs; it boots from it from now on");
    Ok(true)
}

// UNIT_BOUNDARY_DESCRIPTION: what a disk takes on the claim, by its allocated blocks: the disk is sparse, and its copy takes about as much, so it is the room a conversion needs beside the old disk until the old disk is deleted.
fn allocated(disk: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(disk).map_or(0, |info| info.blocks() * 512)
}

// UNIT_BOUNDARY_DESCRIPTION: a machine of this runner, a sibling of `vm_dir`, whose conversion is attached but not swapped yet. One conversion at a time keeps the claim's peak at one home's copy, however many ext4 machines start at once.
fn converting_beside(vm_dir: &Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(vm_dir.parent()?)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|dir| dir != vm_dir)
        .find(|dir| read(dir).is_some_and(|c| !c.committed && c.attempts < ATTEMPTS))
}

fn nonce() -> String {
    let mut bytes = [0u8; 16];
    let _ = std::fs::File::open("/dev/urandom")
        .and_then(|mut random| std::io::Read::read_exact(&mut random, &mut bytes));
    hex::encode(bytes)
}

fn exchange(a: &Path, b: &Path) -> anyhow::Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let path = |p: &Path| {
        std::ffi::CString::new(p.as_os_str().as_bytes()).context("a disk path holds a NUL")
    };
    let (ca, cb) = (path(a)?, path(b)?);
    #[cfg(target_os = "linux")]
    // SAFETY: both paths are NUL-terminated and outlive the call; AT_FDCWD resolves them as rename(2) would.
    let rc = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            ca.as_ptr(),
            libc::AT_FDCWD,
            cb.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    #[cfg(target_os = "macos")]
    // SAFETY: both paths are NUL-terminated and outlive the call.
    let rc = unsafe { libc::renamex_np(ca.as_ptr(), cb.as_ptr(), libc::RENAME_SWAP) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error())
            .with_context(|| format!("swapping {} and {}", a.display(), b.display()));
    }
    let dir = a.parent().unwrap_or(Path::new("."));
    std::fs::File::open(dir)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir as TestDir;

    fn disk(path: &Path, fs: Filesystem) {
        use std::os::unix::fs::FileExt;
        let file = std::fs::File::create(path).unwrap();
        file.set_len(1 << 20).unwrap();
        match fs {
            Filesystem::Ext4 => file.write_all_at(&[0x53, 0xEF], 1024 + 56).unwrap(),
            Filesystem::Btrfs => file.write_all_at(b"_BHRfS_M", 0x1_0040).unwrap(),
            Filesystem::Other => {}
        }
    }

    // TEST_OVERVIEW: the runner's half of converting an ext4 storage disk to btrfs is a small state machine over files: what to attach and ask for before a boot, when the guest's word lets it swap the disks, and how a crash at any step is finished from what the files hold. The guest's copy itself is platform-init's and is covered there.

    // TEST_SCENARIO: an ext4 disk with the switch on boots with a fresh btrfs disk attached and the share asking for the copy; the guest names the nonce, the runner swaps the disks, and the next boot deletes the old ext4 disk and asks for nothing.
    #[test]
    fn a_conversion_attaches_swaps_and_cleans_up() {
        let dir = TestDir::new("convert");
        let (vm, share) = (dir.path().join("vm"), dir.path().join("share"));
        std::fs::create_dir_all(&vm).unwrap();
        std::fs::create_dir_all(&share).unwrap();
        disk(&vm.join(STORAGE_DISK_FILENAME), Filesystem::Ext4);

        let attached = before_start(
            &vm,
            Some(&share),
            true,
            |_| true,
            |next| {
                disk(next, Filesystem::Btrfs);
                std::fs::write(next.with_extension("formatted"), "1").unwrap();
                Ok(())
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(attached.path, vm.join(NEXT_DISK));
        assert!(!attached.read_only);
        let nonce = std::fs::read_to_string(share.join(SHARE_RECORD))
            .unwrap()
            .trim()
            .to_string();
        assert_eq!(nonce.len(), 32);

        assert!(
            !after_ready(&vm, |_| Ok(false)).unwrap(),
            "no swap without the guest's word"
        );
        let expected = format!("{CAPABILITY_PREFIX}{nonce}");
        assert!(after_ready(&vm, |asked| Ok(asked == expected)).unwrap());
        assert_eq!(
            filesystem(&vm.join(STORAGE_DISK_FILENAME)).unwrap(),
            Filesystem::Btrfs
        );
        assert_eq!(filesystem(&vm.join(NEXT_DISK)).unwrap(), Filesystem::Ext4);

        assert_eq!(
            before_start(&vm, Some(&share), true, |_| true, |_| panic!("no new disk")).unwrap(),
            None
        );
        assert!(!vm.join(NEXT_DISK).exists() && !vm.join(STATE_FILE).exists());
        assert!(!vm.join(NEXT_DISK).with_extension("formatted").exists());
        assert!(!share.join(SHARE_RECORD).exists());
    }

    // TEST_SCENARIO: a crash between recording the commit and the swap leaves storage.raw ext4; the next start finishes the swap from the disks' magic, so the machine boots its btrfs copy and never loses it.
    #[test]
    fn a_swap_cut_short_is_finished_at_the_next_start() {
        let dir = TestDir::new("convert-crash");
        let vm = dir.path().to_path_buf();
        disk(&vm.join(STORAGE_DISK_FILENAME), Filesystem::Ext4);
        disk(&vm.join(NEXT_DISK), Filesystem::Btrfs);
        write(
            &vm,
            &Conversion {
                nonce: "n".into(),
                committed: true,
                attempts: 1,
            },
        )
        .unwrap();

        assert_eq!(
            before_start(&vm, None, true, |_| true, |_| panic!("no new disk")).unwrap(),
            None
        );
        assert_eq!(
            filesystem(&vm.join(STORAGE_DISK_FILENAME)).unwrap(),
            Filesystem::Btrfs
        );
        assert!(!vm.join(NEXT_DISK).exists());
    }

    // TEST_SCENARIO: with the switch off, or on a btrfs disk, nothing is attached and a stale request in the share is removed; after the last attempt failed, the disk stays ext4 and boots as it is.
    #[test]
    fn nothing_converts_without_the_switch_or_after_the_last_attempt() {
        let dir = TestDir::new("convert-off");
        let (vm, share) = (dir.path().join("vm"), dir.path().join("share"));
        std::fs::create_dir_all(&vm).unwrap();
        std::fs::create_dir_all(&share).unwrap();
        disk(&vm.join(STORAGE_DISK_FILENAME), Filesystem::Ext4);
        std::fs::write(share.join(SHARE_RECORD), "stale\n").unwrap();
        assert_eq!(
            before_start(&vm, Some(&share), false, |_| true, |_| panic!()).unwrap(),
            None
        );
        assert!(!share.join(SHARE_RECORD).exists());

        for _ in 0..ATTEMPTS {
            assert!(before_start(
                &vm,
                Some(&share),
                true,
                |_| true,
                |next| {
                    disk(next, Filesystem::Btrfs);
                    Ok(())
                }
            )
            .unwrap()
            .is_some());
        }
        assert_eq!(
            before_start(&vm, Some(&share), true, |_| true, |_| panic!()).unwrap(),
            None
        );
        assert!(!share.join(SHARE_RECORD).exists());
    }

    // TEST_SCENARIO: a conversion needs a copy of the home beside the old disk until the old one is deleted, so it waits while the owner's storage has no room for that copy, or while another machine of the runner is converting; the machine then boots its ext4 disk, and converts at a later start.
    #[test]
    fn a_conversion_waits_for_room_and_for_the_runner_s_other_conversion() {
        let dir = TestDir::new("convert-room");
        let (vm, other, share) = (
            dir.path().join("vm"),
            dir.path().join("other"),
            dir.path().join("share"),
        );
        for d in [&vm, &other, &share] {
            std::fs::create_dir_all(d).unwrap();
        }
        disk(&vm.join(STORAGE_DISK_FILENAME), Filesystem::Ext4);
        let mut asked = 0;
        assert_eq!(
            before_start(
                &vm,
                Some(&share),
                true,
                |need| {
                    asked = need;
                    false
                },
                |_| panic!()
            )
            .unwrap(),
            None
        );
        assert!(asked >= 1 << 30, "the need covers the copy and a margin");
        assert!(!share.join(SHARE_RECORD).exists());

        write(
            &other,
            &Conversion {
                nonce: "o".into(),
                committed: false,
                attempts: 1,
            },
        )
        .unwrap();
        assert_eq!(
            before_start(&vm, Some(&share), true, |_| true, |_| panic!()).unwrap(),
            None
        );
        write(
            &other,
            &Conversion {
                nonce: "o".into(),
                committed: true,
                attempts: 1,
            },
        )
        .unwrap();
        assert!(before_start(
            &vm,
            Some(&share),
            true,
            |_| true,
            |next| {
                disk(next, Filesystem::Btrfs);
                Ok(())
            }
        )
        .unwrap()
        .is_some());
    }
}
