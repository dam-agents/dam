use std::path::Path;

// UNIT_BOUNDARY_DESCRIPTION: how full the owner's claim is: every machine disk, the runner's bookkeeping and, on a runner that caches its own images, the image cache. The disks are sparse, so they can add up to more than the claim holds, and a guest sees its own disk as free while the claim under it fills; once the claim has no block left, a guest's write into its disk fails, and its filesystem reports the loss. So the runner watches the claim itself. Used is what the filesystem has handed out, and usable is that plus what an unprivileged writer may still take, so the blocks kept back for root do not hide the point where the runner's writes start to fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageUse {
    pub used: u64,
    pub usable: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: past SHORT_PERCENT the runner sheds what it can fetch again — the image trees no machine holds, and the scratch every guest keeps — until use is back under SHORT_UNTIL_PERCENT. Past CRITICAL_PERCENT it takes no write that adds much: it creates no machine, grows no disk, fetches no image onto its own claim and takes no seed. A machine that already exists still starts and restarts, because a boot writes little and an owner whose agents are all asleep must be able to get into one to clean it up; only past START_LIMIT_PERCENT does the runner start or restart no machine. It never stops one.
pub const SHORT_PERCENT: u64 = 75;
pub const SHORT_UNTIL_PERCENT: u64 = 70;
pub const RESHED_STEP_PERCENT: u64 = 5;
pub const CRITICAL_PERCENT: u64 = 90;
pub const START_LIMIT_PERCENT: u64 = 97;
const WRITES_FAILING_PERCENT: u64 = 98;

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

    pub fn refuses_starts(&self) -> bool {
        self.percent() >= START_LIMIT_PERCENT
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the claim is short, given whether it was at the last look: it turns short at SHORT_PERCENT and stays short until SHORT_UNTIL_PERCENT, so use that sits on the threshold does not turn shedding on and off at every look.
    pub fn short(&self, was: bool) -> bool {
        let percent = self.percent();
        percent >= SHORT_PERCENT || (was && percent >= SHORT_UNTIL_PERCENT)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the bytes each of `machines` guests is asked to give back so the claim is back under SHORT_UNTIL_PERCENT, an even part of the whole; a guest frees only what it can, so this bounds a pass and is no promise.
    pub fn to_shed(&self, machines: usize) -> u64 {
        let target = u64::try_from(u128::from(self.usable) * u128::from(SHORT_UNTIL_PERCENT) / 100)
            .unwrap_or(u64::MAX);
        self.used.saturating_sub(target) / u64::try_from(machines.max(1)).unwrap_or(1)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what the owner is told when the runner refuses a machine for want of storage, word for word the api-server's storage-full message: what is refused at this level, that a sleeping VM agent can still be opened to clean up below START_LIMIT_PERCENT, and the ways to free space.
    pub fn refusal(&self) -> String {
        let percent = self.percent();
        let failing = if percent >= WRITES_FAILING_PERCENT {
            "Your running VM agents may be failing to write files now. "
        } else {
            ""
        };
        let starts = if self.refuses_starts() {
            "Sleeping VM agents can't be started until space is freed."
        } else {
            "Sleeping VM agents can still be started until storage is nearly full, so you can open one and ask it to clear its caches."
        };
        format!(
            "{failing}Your VM agents have used {} of {} GiB of their shared storage, so new VM agents can't be created and their disks can't grow. {starts} To free space, delete a VM agent you no longer need, open an agent and ask it to clear its caches, or request more storage.",
            gib(self.used),
            gib(self.usable)
        )
    }
}

fn gib(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / f64::from(1u32 << 30))
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

    // TEST_SCENARIO: the claim turns critical at 90%, refuses starts at 97% and turns short at 75%, and once short stays short down to 70%, so a claim whose use hovers on a threshold does not shed and stop shedding at every look. An empty claim reads as full rather than dividing by zero.
    #[test]
    fn the_thresholds_hold_and_shedding_has_hysteresis() {
        assert!(!at(89).critical() && at(90).critical());
        assert!(!at(96).refuses_starts() && at(97).refuses_starts());
        assert!(!at(74).short(false) && at(75).short(false));
        assert!(at(71).short(true) && !at(69).short(true) && !at(71).short(false));
        assert_eq!(StorageUse { used: 0, usable: 0 }.percent(), 100);
    }

    // TEST_SCENARIO: what the runner asks each guest to give back is its even part of what brings the claim back under 70%, and nothing once it is there; no machine at all reads as one.
    #[test]
    fn each_guest_is_asked_its_part_of_the_shortage() {
        assert_eq!(at(80).to_shed(2), 5);
        assert_eq!(at(80).to_shed(0), 10);
        assert_eq!(at(60).to_shed(3), 0);
    }

    // TEST_SCENARIO: the refusal is what the owner reads on the agent, so it says how much storage is used, whether a stopped agent can still be opened to clean up, and what to do; once writes may be failing it says that first.
    #[test]
    fn a_refusal_names_the_use_and_the_fixes() {
        let message = StorageUse {
            used: 93 << 30,
            usable: 100 << 30,
        }
        .refusal();
        assert!(message.contains("used 93.0 of 100.0 GiB"), "{message}");
        assert!(message.contains("delete a VM agent"), "{message}");
        assert!(message.contains("can still be started"), "{message}");
        let nearly_full = at(98).refusal();
        assert!(nearly_full.contains("can't be started"), "{nearly_full}");
        assert!(
            nearly_full.starts_with("Your running VM agents may be failing"),
            "{nearly_full}"
        );
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
