use std::fs;
use std::path::Path;
use std::time::Duration;

use anyhow::Context;

// UNIT_BOUNDARY_DESCRIPTION: the runner's own memory, read off its cgroup, against its limit. The prober measures each VMM only every STEADY_PROBE and the controller asks every runner only every half minute, while guests that grow together can take the pod over its limit in seconds, so the runner watches the one figure the kernel kills it by. That figure is the working set: what the cgroup charges less the file cache it can drop, the same figure the kubelet reads. The machine disks' page cache is charged here too, so the raw charge sits near the limit with nothing at risk.
pub const SAMPLE_EVERY: Duration = Duration::from_secs(1);

// UNIT_BOUNDARY_DESCRIPTION: how often a pressure that lasts is signalled again, so a controller whose reclaim did not free enough hears of it again rather than at its next periodic pass.
pub const SIGNAL_EVERY: Duration = Duration::from_secs(10);

// UNIT_BOUNDARY_DESCRIPTION: pressure starts at ON_PERCENT of the limit and ends below OFF_PERCENT, so a working set that hovers at one figure does not signal at every sample. ON_PERCENT leaves about a twentieth of the pool for the seconds the machines the controller stops take to stop.
const ON_PERCENT: i64 = 95;
const OFF_PERCENT: i64 = 90;

pub fn pressured(working_set_mib: i64, limit_mib: i64, was: bool) -> bool {
    if limit_mib <= 0 {
        return false;
    }
    let percent = if was { OFF_PERCENT } else { ON_PERCENT };
    working_set_mib * 100 >= limit_mib * percent
}

pub fn working_set_mib(cgroup: &Path) -> anyhow::Result<i64> {
    let current: i64 = read(cgroup, "memory.current")?.trim().parse()?;
    let stat = read(cgroup, "memory.stat")?;
    let inactive_file: i64 = stat
        .lines()
        .find_map(|line| line.strip_prefix("inactive_file "))
        .context("memory.stat names no inactive_file")?
        .trim()
        .parse()?;
    Ok((current - inactive_file).max(0) >> 20)
}

// UNIT_BOUNDARY_DESCRIPTION: the memory limit the kernel holds the runner to, from the cgroup's memory.max. The controller resizes the runner pod's limit in place when the owner's pool changes, and the limit the runner was started with does not follow, so admission and pressure read this one. A cgroup with no limit, or none to read, gives None.
pub fn limit_mib(cgroup: &Path) -> Option<i64> {
    let max = read(cgroup, "memory.max").ok()?;
    let bytes: i64 = max.trim().parse().ok()?;
    Some(bytes >> 20)
}

fn read(cgroup: &Path, file: &str) -> anyhow::Result<String> {
    let path = cgroup.join(file);
    fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir;

    // TEST_SCENARIO: pressure has two thresholds, so a working set between them keeps whatever state it was in; a single threshold would signal at every sample of a working set that hovers there.
    #[test]
    fn pressure_starts_at_ninety_five_percent_and_ends_below_ninety() {
        assert!(!pressured(940, 1000, false));
        assert!(pressured(950, 1000, false));
        assert!(pressured(920, 1000, true));
        assert!(pressured(900, 1000, true));
        assert!(!pressured(899, 1000, true));
        assert!(!pressured(5000, 0, false));
    }

    // TEST_SCENARIO: the machine disks' page cache is charged to the runner's cgroup, so the raw charge alone would read as pressure while the kernel can still drop all of it.
    #[test]
    fn the_working_set_leaves_out_the_file_cache_the_kernel_can_drop() {
        let dir = TempDir::new("pressure");
        fs::write(
            dir.path().join("memory.current"),
            format!("{}\n", 3u64 << 30),
        )
        .unwrap();
        fs::write(
            dir.path().join("memory.stat"),
            format!(
                "anon 1\nactive_file 2\ninactive_file {}\nslab 3\n",
                1u64 << 30
            ),
        )
        .unwrap();
        assert_eq!(working_set_mib(dir.path()).unwrap(), 2048);
        assert!(working_set_mib(&dir.path().join("absent")).is_err());
    }

    // TEST_SCENARIO: a cgroup with no limit writes `max` in memory.max, and a host without the file has no cgroup to read; neither may read as a limit of zero, which admission takes as no limit at all.
    #[test]
    fn the_limit_is_the_cgroups_memory_max_when_it_has_one() {
        let dir = TempDir::new("pressure-limit");
        fs::write(dir.path().join("memory.max"), format!("{}\n", 12u64 << 30)).unwrap();
        assert_eq!(limit_mib(dir.path()), Some(12288));
        fs::write(dir.path().join("memory.max"), "max\n").unwrap();
        assert_eq!(limit_mib(dir.path()), None);
        assert_eq!(limit_mib(&dir.path().join("absent")), None);
    }
}
