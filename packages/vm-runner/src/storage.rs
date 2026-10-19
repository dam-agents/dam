use std::path::Path;

// UNIT_BOUNDARY_DESCRIPTION: how full the owner's claim is: every machine disk, the runner's bookkeeping and, on a runner that caches its own images, the image cache. The disks are sparse, so they can add up to more than the claim holds, and a guest sees its own disk as free while the claim under it fills; once the claim has no block left, a guest's write into its disk fails, and its filesystem reports the loss. So the runner watches the claim itself. Used is what the filesystem has handed out, and usable is that plus what an unprivileged writer may still take, so the blocks kept back for root do not hide the point where the runner's writes start to fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageUse {
    pub used: u64,
    pub usable: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: the claim's three levels. Past SHORT_PERCENT the runner asks every guest to shed the scratch it keeps until use is SHED_STEP_PERCENT back under it. Past CRITICAL_PERCENT it takes no write that adds much: it creates no machine, grows no disk and takes no seed. A machine that already exists still starts and restarts, because a boot writes little and an owner whose agents are all asleep must be able to get into one to clean it up. FULL_PERCENT is the emergency: running guests may write into the claim only up to it (guest::STORAGE_ROOM_PATH), so their writes fail inside the guest past it, and the runner starts or restarts no machine. The last FULL_PERCENT short of the whole claim holds what guests write between two looks and the floor every guest keeps. The runner never stops a machine.
pub const SHORT_PERCENT: u64 = 75;
pub const CRITICAL_PERCENT: u64 = 90;
pub const FULL_PERCENT: u64 = 95;
// UNIT_BOUNDARY_DESCRIPTION: how far the claim must fall back under SHORT_PERCENT before it stops being short, and how far it must fill past the last request before the runner asks the guests again. Use that sits on a level then does not turn shedding on and off, nor have every guest delete its scratch again, at every look.
pub const SHED_STEP_PERCENT: u64 = 5;

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

    pub fn full(&self) -> bool {
        self.percent() >= FULL_PERCENT
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether the claim is short, given whether it was at the last look: it turns short at SHORT_PERCENT and stays short until SHED_STEP_PERCENT under it.
    pub fn short(&self, was: bool) -> bool {
        let percent = self.percent();
        percent >= SHORT_PERCENT || (was && percent >= SHORT_PERCENT - SHED_STEP_PERCENT)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the bytes each of `machines` running guests is asked to give back so the claim is SHED_STEP_PERCENT back under SHORT_PERCENT, an even part of the whole; a guest frees only what it can, so this bounds a pass and is no promise.
    pub fn to_shed(&self, machines: usize) -> u64 {
        let target = u64::try_from(
            u128::from(self.usable) * u128::from(SHORT_PERCENT - SHED_STEP_PERCENT) / 100,
        )
        .unwrap_or(u64::MAX);
        self.used.saturating_sub(target) / u64::try_from(machines.max(1)).unwrap_or(1)
    }

    // UNIT_BOUNDARY_DESCRIPTION: why a seed upload that has written `seed` bytes onto this claim stops, or nothing while it may go on. The seed stays on the claim until the move finishes, and the guest's first boot restores as much again onto its disk on the same claim, so the move needs about twice the home: the upload stops once the claim, with the restore still to come, would pass CRITICAL_PERCENT, the level up to which the owner's other agents are protected.
    pub fn seed_refusal(&self, seed: u64) -> Option<String> {
        let after = u128::from(self.used) + u128::from(seed);
        (after * 100 >= u128::from(self.usable) * u128::from(CRITICAL_PERCENT)).then(|| {
            format!(
                "This agent's home does not fit on its new runtime: moving it needs about twice the home's size on your VM agents' shared storage, one copy while it moves and one on its new disk. The home is more than {} GiB, and the storage has {} of {} GiB free, so the move stopped before it filled the storage your other VM agents use. To free space, delete a VM agent you no longer need or files from this agent's home, or request more storage.",
                gib(seed),
                gib(self.usable.saturating_sub(self.used)),
                gib(self.usable)
            )
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: whether `bytes` more still leave the claim under CRITICAL_PERCENT, the level up to which the owner's other agents are protected, as a seed upload is held to.
    pub fn takes(&self, bytes: u64) -> bool {
        (u128::from(self.used) + u128::from(bytes)) * 100
            < u128::from(self.usable) * u128::from(CRITICAL_PERCENT)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the bytes each of `running` guests may still add to the claim before it reaches FULL_PERCENT, an even part of what is left. The guests share the claim and write at once, so a grant of the whole room to each could add up past it; a grant of a part is renewed at every look, so one guest that writes alone still reaches the level within a few looks. No running guest reads as one.
    pub fn guest_room(&self, running: usize) -> u64 {
        let limit = u64::try_from(u128::from(self.usable) * u128::from(FULL_PERCENT) / 100)
            .unwrap_or(u64::MAX);
        limit.saturating_sub(self.used) / u64::try_from(running.max(1)).unwrap_or(1)
    }

    // UNIT_BOUNDARY_DESCRIPTION: what the owner is told when the runner refuses a machine for want of storage, word for word the api-server's storage-full message: what is refused at this level, that a sleeping VM agent can still be opened to clean up below FULL_PERCENT, that running ones may be failing to write from it, and the ways to free space.
    pub fn refusal(&self) -> String {
        let (failing, starts) = if self.full() {
            (
                "Your running VM agents may be failing to write files now. ",
                "Sleeping VM agents can't be started until space is freed.",
            )
        } else {
            (
                "",
                "Sleeping VM agents can still be started until storage is nearly full, so you can open one and ask it to clear its caches.",
            )
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

    // TEST_SCENARIO: the claim turns critical at 90%, full at 95% and short at 75%, and once short stays short down to 70%, so a claim whose use hovers on a threshold does not shed and stop shedding at every look. An empty claim reads as full rather than dividing by zero.
    #[test]
    fn the_thresholds_hold_and_shedding_has_hysteresis() {
        assert!(!at(89).critical() && at(90).critical());
        assert!(!at(94).full() && at(95).full());
        assert!(!at(74).short(false) && at(75).short(false));
        assert!(at(71).short(true) && !at(69).short(true) && !at(71).short(false));
        assert_eq!(StorageUse { used: 0, usable: 0 }.percent(), 100);
    }

    // TEST_SCENARIO: a seed is restored onto the same claim it is stored on, so an upload stops once what it wrote, counted twice, would take the claim to the critical level, and says how much the move needs and how much is free.
    #[test]
    fn a_seed_stops_before_its_restore_would_fill_the_claim() {
        let claim = StorageUse {
            used: 50 << 30,
            usable: 100 << 30,
        };
        assert_eq!(claim.seed_refusal(39 << 30), None);
        let refusal = claim.seed_refusal(40 << 30).expect("90% after the restore");
        assert!(refusal.contains("twice the home's size"), "{refusal}");
        assert!(refusal.contains("more than 40.0 GiB"), "{refusal}");
        assert!(refusal.contains("50.0 of 100.0 GiB free"), "{refusal}");
    }

    // TEST_SCENARIO: each running guest may add its even part of what is left below 95%, and nothing once the claim is full.
    #[test]
    fn each_running_guest_may_add_its_part_of_the_room() {
        assert_eq!(at(55).guest_room(2), 20);
        assert_eq!(at(55).guest_room(0), 40);
        assert_eq!(at(95).guest_room(1), 0);
    }

    // TEST_SCENARIO: what the runner asks each guest to give back is its even part of what brings the claim back under 70%, and nothing once it is there; no machine at all reads as one.
    #[test]
    fn each_guest_is_asked_its_part_of_the_shortage() {
        assert_eq!(at(80).to_shed(2), 5);
        assert_eq!(at(80).to_shed(0), 10);
        assert_eq!(at(60).to_shed(3), 0);
    }

    // TEST_SCENARIO: the refusal is what the owner reads on the agent, so it says how much storage is used, whether a stopped agent can still be opened to clean up, and what to do; once the claim is full, starts are refused and writes may be failing, which it says first.
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
        assert!(!message.contains("failing"), "{message}");
        let nearly_full = at(95).refusal();
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
