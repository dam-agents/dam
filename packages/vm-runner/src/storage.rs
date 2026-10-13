use std::path::Path;

// UNIT_BOUNDARY_DESCRIPTION: how full the owner's claim is: every machine disk, the runner's bookkeeping and, on a runner that caches its own images, the image cache. The disks are sparse, so they can add up to more than the claim holds, and a guest sees its own disk as free while the claim under it fills; once the claim has no block left, a guest's write into its disk fails, and its filesystem reports the loss. So the runner watches the claim itself. Used is what the filesystem has handed out, and usable is that plus what an unprivileged writer may still take, so the blocks kept back for root do not hide the point where the runner's writes start to fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageUse {
    pub used: u64,
    pub usable: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: past SHORT_PERCENT the runner sheds what it can fetch again — the image trees no machine holds, and the scratch every guest keeps — until use is back under SHORT_UNTIL_PERCENT. Past CRITICAL_PERCENT it creates, starts, restarts and grows no machine, and takes no seed, so what is left is for the machines already running; it never stops one.
pub const SHORT_PERCENT: u64 = 75;
pub const SHORT_UNTIL_PERCENT: u64 = 70;
pub const CRITICAL_PERCENT: u64 = 90;

impl StorageUse {
    pub fn percent(&self) -> u64 {
        if self.usable == 0 {
            return 100;
        }
        u64::try_from(u128::from(self.used) * 100 / u128::from(self.usable)).unwrap_or(100)
    }

    pub fn critical(&self) -> bool {
        self.percent() >= CRITICAL_PERCENT
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the claim is short, given whether it was at the last look: it turns short at SHORT_PERCENT and stays short until SHORT_UNTIL_PERCENT, so use that sits on the threshold does not turn shedding on and off at every look.
    pub fn short(&self, was: bool) -> bool {
        let percent = self.percent();
        percent >= SHORT_PERCENT || (was && percent >= SHORT_UNTIL_PERCENT)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what the owner is told when the runner refuses a machine for want of storage: how full the claim is, that nothing waits on it but freed space, and the ways to free it.
    pub fn refusal(&self) -> String {
        format!(
            "your agents' shared storage is {}% full ({} of {}): no agent can be created, started or have its disk grown until space is freed; delete an agent you no longer need, clear caches inside your agents, or ask an admin for more storage",
            self.percent(),
            gib(self.used),
            gib(self.usable)
        )
    }
}

fn gib(bytes: u64) -> String {
    format!("{:.1} GiB", bytes as f64 / f64::from(1u32 << 30))
}

// UNIT_BOUNDARY_DESCRIPTION: the use of the filesystem holding `dir`, or nothing when it cannot be asked. A provisioner that hands out a directory of the node's disk rather than a volume of its own reports the node's disk, so there the guard watches that disk instead of the claim's size.
pub fn measure(dir: &Path) -> Option<StorageUse> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: statvfs is plain old data, and all-zero bytes are a valid value of it.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `path` is NUL-terminated and lives for the call, and `stat` is a live, writable statvfs.
    let rc = unsafe { libc::statvfs(path.as_ptr(), &mut stat) };
    if rc != 0 {
        return None;
    }
    #[allow(clippy::unnecessary_cast)]
    let (blocks, free, available, size) = (
        stat.f_blocks as u64,
        stat.f_bfree as u64,
        stat.f_bavail as u64,
        stat.f_frsize as u64,
    );
    let used = blocks.saturating_sub(free).saturating_mul(size);
    Some(StorageUse {
        used,
        usable: used.saturating_add(available.saturating_mul(size)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(percent: u64) -> StorageUse {
        StorageUse {
            used: percent,
            usable: 100,
        }
    }

    // TEST_SCENARIO: the claim turns critical at 90% and short at 75%, and once short stays short down to 70%, so a claim whose use hovers on a threshold does not shed and stop shedding at every look. An empty claim reads as full rather than dividing by zero.
    #[test]
    fn the_thresholds_hold_and_shedding_has_hysteresis() {
        assert!(!at(89).critical() && at(90).critical());
        assert!(!at(74).short(false) && at(75).short(false));
        assert!(at(71).short(true) && !at(69).short(true) && !at(71).short(false));
        assert_eq!(StorageUse { used: 0, usable: 0 }.percent(), 100);
    }

    // TEST_SCENARIO: the refusal is what the owner reads on the agent, so it says how full the storage is and what to do about it.
    #[test]
    fn a_refusal_names_the_use_and_the_fixes() {
        let message = StorageUse {
            used: 93 << 30,
            usable: 100 << 30,
        }
        .refusal();
        assert!(
            message.contains("93% full (93.0 GiB of 100.0 GiB)"),
            "{message}"
        );
        assert!(message.contains("delete an agent"), "{message}");
    }

    // TEST_SCENARIO: a real filesystem measures as some use of a usable size no smaller than it, which is what every decision divides.
    #[test]
    fn a_directory_measures_its_filesystem() {
        let dir = crate::testdir::TempDir::new("storage");
        let use_ = measure(dir.path()).expect("statvfs answers for a directory");
        assert!(use_.usable >= use_.used && use_.usable > 0);
        assert_eq!(measure(&dir.path().join("missing")), None);
    }
}
