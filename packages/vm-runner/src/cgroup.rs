// UNIT_BOUNDARY_DESCRIPTION: the runner's own cgroup, read off the files that describe it: the memory the runner holds against the limit the kernel kills it by, and the CPU its guests' vCPUs use and the periods the limit held them back. One module for one directory, because these figures are read together and the pool is short of whichever runs out first.
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

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

// UNIT_BOUNDARY_DESCRIPTION: whether the runner's cgroup kills every process in it for one process's memory. `memory.oom.group` is a node's kubelet setting, not the install's: at 1, one machine's growth ends the runner and every machine of the owner rather than that machine alone, whatever the VMMs' OOM scores say. The kubelet sets it unless its singleProcessOOMKill is on, which is off by default. A cgroup that cannot be read says nothing.
pub fn oom_group(cgroup: &Path) -> Option<bool> {
    Some(read(cgroup, "memory.oom.group").ok()?.trim() == "1")
}

// UNIT_BOUNDARY_DESCRIPTION: how many processes of the runner's cgroup the kernel's OOM killer has killed since the cgroup was made, from `memory.events`' own oom_kill line. An operator's `kill -9`, and a container runtime's, leave that line alone, so it is what tells the kernel's kill from any other signal. A cgroup that cannot be read says nothing.
pub fn oom_kills(cgroup: &Path) -> Option<u64> {
    let events = read(cgroup, "memory.events").ok()?;
    let killed = events
        .lines()
        .find_map(|line| line.strip_prefix("oom_kill "))?
        .trim();
    killed.parse().ok()
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's own CPU, read off its cgroup. Every guest's vCPUs are threads of the runner, so one cgroup counts them all: the time they ran, the scheduler periods they ran in, and the periods the CPU limit throttled them in. Reaching the limit breaks nothing, it slows every guest of the owner at once, so throttled periods over periods is the figure that says a pool is short of CPU.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CpuStat {
    pub usage_usec: u64,
    pub nr_periods: u64,
    pub nr_throttled: u64,
}

pub fn stat(cgroup: &Path) -> anyhow::Result<CpuStat> {
    let text = read(cgroup, "cpu.stat")?;
    let field = |name: &str| -> anyhow::Result<u64> {
        let value = text
            .lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(' '))
            .with_context(|| format!("cpu.stat names no {name}"))?;
        Ok(value.trim().parse()?)
    };
    Ok(CpuStat {
        usage_usec: field("usage_usec")?,
        nr_periods: field("nr_periods")?,
        nr_throttled: field("nr_throttled")?,
    })
}

// UNIT_BOUNDARY_DESCRIPTION: the CPU limit in millicores, from `cpu.max`'s quota over its period; None where the cgroup sets no limit, which a cluster without in-place resize leaves the runner with.
pub fn limit_milli(cgroup: &Path) -> anyhow::Result<Option<u64>> {
    let text = read(cgroup, "cpu.max")?;
    let mut parts = text.split_whitespace();
    let quota = parts.next().context("cpu.max is empty")?;
    if quota == "max" {
        return Ok(None);
    }
    let period: u64 = parts.next().context("cpu.max names no period")?.parse()?;
    anyhow::ensure!(period > 0, "cpu.max names a zero period");
    Ok(Some(quota.parse::<u64>()? * 1000 / period))
}

// UNIT_BOUNDARY_DESCRIPTION: how far back the runner's CPU figures look. A guest's burst of a few seconds is not what the user should act on; a minute of being held back is.
pub const WINDOW: Duration = Duration::from_secs(60);

// UNIT_BOUNDARY_DESCRIPTION: the share of the last minute in which some of the runner's processes waited for a CPU, rounded to a whole percent, from the `some avg60` of the cgroup's cpu.pressure. Whether time a task spends held back by its cgroup's CPU limit counts as waiting here was not verified on the kernels the runner runs on, so the usage read reports the higher of this and the throttling, and a pool at its limit shows either way. No cpu.pressure, as on a kernel built without pressure stall information, gives None.
pub fn pressure_percent(cgroup: &Path) -> Option<u32> {
    let text = fs::read_to_string(cgroup.join("cpu.pressure")).ok()?;
    let avg60: f64 = text
        .lines()
        .find_map(|line| line.strip_prefix("some "))?
        .split_whitespace()
        .find_map(|field| field.strip_prefix("avg60="))?
        .parse()
        .ok()?;
    Some(avg60.round().clamp(0.0, 100.0) as u32)
}

// UNIT_BOUNDARY_DESCRIPTION: the readings of the last WINDOW, from which the runner's CPU use and how often its limit held it back are taken. A runner with fewer than two readings, or whose counters went backwards (a new cgroup), reports nothing yet.
#[derive(Default)]
pub struct Window {
    samples: VecDeque<(Instant, CpuStat)>,
}

impl Window {
    pub fn push(&mut self, at: Instant, stat: CpuStat) {
        if self
            .samples
            .back()
            .is_some_and(|(_, last)| stat.usage_usec < last.usage_usec)
        {
            self.samples.clear();
        }
        self.samples.push_back((at, stat));
        while self
            .samples
            .front()
            .is_some_and(|(first, _)| at.duration_since(*first) > WINDOW)
        {
            self.samples.pop_front();
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the average milli-CPUs used over the window, and the percentage of active periods in which the limit held the runner back.
    pub fn figures(&self) -> Option<(u64, u32)> {
        let ((from, first), (to, last)) = (self.samples.front()?, self.samples.back()?);
        let elapsed = to.duration_since(*from).as_micros() as u64;
        if elapsed == 0 {
            return None;
        }
        let used_milli = (last.usage_usec - first.usage_usec) * 1000 / elapsed;
        let periods = last.nr_periods.saturating_sub(first.nr_periods);
        let throttled = last.nr_throttled.saturating_sub(first.nr_throttled);
        let percent = (throttled * 100).checked_div(periods).unwrap_or(0) as u32;
        Some((used_milli, percent))
    }
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

    // TEST_SCENARIO: whether the runner's cgroup kills the whole pod for one machine's memory decides whether a machine's growth takes its owner's every other machine down with it, so the two values the kernel writes are read apart, and a cgroup with no figure reads as nothing rather than as the safe answer.
    #[test]
    fn the_cgroup_says_whether_one_process_takes_it_all_down() {
        let dir = TempDir::new("pressure-group");
        fs::write(dir.path().join("memory.oom.group"), "0\n").unwrap();
        assert_eq!(oom_group(dir.path()), Some(false));
        fs::write(dir.path().join("memory.oom.group"), "1\n").unwrap();
        assert_eq!(oom_group(dir.path()), Some(true));
        assert_eq!(oom_group(&dir.path().join("absent")), None);
    }

    // TEST_SCENARIO: whether the kernel's OOM killer took a process of the runner's cgroup is read from the line an operator's `kill -9` never moves, so a machine killed by hand is never reported as one the kernel took for memory; a cgroup with no counter reads as nothing rather than as none.
    #[test]
    fn the_cgroup_counts_the_kills_its_oom_killer_made() {
        let dir = TempDir::new("pressure-oom-kills");
        fs::write(
            dir.path().join("memory.events"),
            "low 0\nhigh 0\nmax 4\noom 2\noom_kill 2\noom_group_kill 0\n",
        )
        .unwrap();
        assert_eq!(oom_kills(dir.path()), Some(2));
        fs::write(dir.path().join("memory.events"), "low 0\nhigh 0\n").unwrap();
        assert_eq!(oom_kills(dir.path()), None);
        assert_eq!(oom_kills(&dir.path().join("absent")), None);
    }

    // TEST_SCENARIO: cpu.stat carries more fields than the three the runner reads, some sharing a prefix with them (`nr_throttled` and `nr_bursts` beside `nr_periods`), so each is matched by its whole name.
    #[test]
    fn the_stat_reads_the_runners_cpu_time_and_its_throttled_periods() {
        let dir = TempDir::new("cpu");
        fs::write(
            dir.path().join("cpu.stat"),
            "usage_usec 5000000\nuser_usec 4000000\nsystem_usec 1000000\nnr_periods 100\nnr_throttled 25\nthrottled_usec 900\nnr_bursts 0\n",
        )
        .unwrap();
        assert_eq!(
            stat(dir.path()).unwrap(),
            CpuStat {
                usage_usec: 5_000_000,
                nr_periods: 100,
                nr_throttled: 25
            }
        );
        assert!(stat(&dir.path().join("absent")).is_err());
    }

    // TEST_SCENARIO: a limit is a quota per period, so 250 ms in every 100 ms is two and a half CPUs; `max` is no limit at all rather than a number.
    #[test]
    fn the_limit_is_the_quota_over_the_period_and_max_is_none() {
        let dir = TempDir::new("cpu");
        fs::write(dir.path().join("cpu.max"), "250000 100000\n").unwrap();
        assert_eq!(limit_milli(dir.path()).unwrap(), Some(2500));
        fs::write(dir.path().join("cpu.max"), "max 100000\n").unwrap();
        assert_eq!(limit_milli(dir.path()).unwrap(), None);
    }

    // TEST_SCENARIO: no cpu.pressure, as on a kernel without pressure stall information, is no pressure at all rather than zero.
    #[test]
    fn the_pressure_is_some_avg60_rounded() {
        let dir = TempDir::new("cpu-pressure");
        fs::write(
            dir.path().join("cpu.pressure"),
            "some avg10=80.00 avg60=37.62 avg300=5.00 total=123\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
        )
        .unwrap();
        assert_eq!(pressure_percent(dir.path()), Some(38));
        assert_eq!(pressure_percent(&dir.path().join("absent")), None);
    }

    // TEST_SCENARIO: the figures are deltas over the window: a runner that used two CPUs for ten seconds and was held back in a quarter of its periods says so, a reading older than the window drops out, and counters that start over begin a new window instead of reading as a negative use.
    #[test]
    fn the_window_gives_use_and_throttling_over_its_span() {
        let start = Instant::now();
        let at = |s: u64| start + Duration::from_secs(s);
        let stat = |usage_usec, nr_periods, nr_throttled| CpuStat {
            usage_usec,
            nr_periods,
            nr_throttled,
        };
        let mut window = Window::default();
        assert_eq!(window.figures(), None);
        window.push(at(0), stat(0, 0, 0));
        window.push(at(10), stat(20_000_000, 100, 25));
        assert_eq!(window.figures(), Some((2000, 25)));
        window.push(at(70), stat(20_000_000, 100, 25));
        window.push(at(75), stat(20_000_000, 100, 25));
        assert_eq!(window.figures(), Some((0, 0)));
        window.push(at(76), stat(10, 1, 0));
        assert_eq!(window.figures(), None);
    }
}
