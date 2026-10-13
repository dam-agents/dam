use std::fs;
use std::path::Path;

use anyhow::Context;

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

fn read(cgroup: &Path, file: &str) -> anyhow::Result<String> {
    let path = cgroup.join(file);
    fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir;

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
}
