use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

// UNIT_BOUNDARY_DESCRIPTION: how far back the runner's CPU figures look. A guest's burst of a few seconds is not what the user should act on; a minute of being held back is.
pub const WINDOW: Duration = Duration::from_secs(60);

// UNIT_BOUNDARY_DESCRIPTION: one reading of the runner's cgroup cpu.stat: the CPU time its processes used, the scheduler periods in which any of them ran, and the periods in which the CPU limit held them back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stat {
    pub usage_usec: u64,
    pub nr_periods: u64,
    pub nr_throttled: u64,
}

pub fn stat(cgroup: &Path) -> Option<Stat> {
    let text = fs::read_to_string(cgroup.join("cpu.stat")).ok()?;
    let field = |name: &str| -> Option<u64> {
        text.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(' '))?
            .trim()
            .parse()
            .ok()
    };
    Some(Stat {
        usage_usec: field("usage_usec")?,
        nr_periods: field("nr_periods").unwrap_or(0),
        nr_throttled: field("nr_throttled").unwrap_or(0),
    })
}

// UNIT_BOUNDARY_DESCRIPTION: the CPU limit the kernel holds the runner to, in milli-CPUs, from the cgroup's cpu.max. The controller resizes it in place as machines start and stop. No limit, or none to read, gives None.
pub fn limit_milli(cgroup: &Path) -> Option<u64> {
    let text = fs::read_to_string(cgroup.join("cpu.max")).ok()?;
    let mut words = text.split_whitespace();
    let quota: u64 = words.next()?.parse().ok()?;
    let period: u64 = words.next()?.parse().ok()?;
    (period > 0).then(|| quota * 1000 / period)
}

// UNIT_BOUNDARY_DESCRIPTION: the readings of the last WINDOW, from which the runner's CPU use and how often its limit held it back are taken. A runner with fewer than two readings, or whose counters went backwards (a new cgroup), reports nothing yet.
#[derive(Default)]
pub struct Window {
    samples: VecDeque<(Instant, Stat)>,
}

impl Window {
    pub fn push(&mut self, at: Instant, stat: Stat) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir;

    // TEST_SCENARIO: cpu.stat lists more counters than the runner reads, and a cgroup that never had a limit has no throttling counters at all; both must still read.
    #[test]
    fn cpu_stat_and_cpu_max_read_off_the_cgroup() {
        let dir = TempDir::new("cpu");
        fs::write(
            dir.path().join("cpu.stat"),
            "usage_usec 5000\nuser_usec 3000\nsystem_usec 2000\nnr_periods 40\nnr_throttled 10\nthrottled_usec 99\n",
        )
        .unwrap();
        assert_eq!(
            stat(dir.path()),
            Some(Stat {
                usage_usec: 5000,
                nr_periods: 40,
                nr_throttled: 10
            })
        );
        fs::write(dir.path().join("cpu.max"), "250000 100000\n").unwrap();
        assert_eq!(limit_milli(dir.path()), Some(2500));
        fs::write(dir.path().join("cpu.max"), "max 100000\n").unwrap();
        assert_eq!(limit_milli(dir.path()), None);
        assert_eq!(stat(&dir.path().join("absent")), None);
    }

    // TEST_SCENARIO: the figures are deltas over the window: a runner that used two CPUs for ten seconds and was held back in a quarter of its periods says so, a reading older than the window drops out, and counters that start over begin a new window instead of reading as a negative use.
    #[test]
    fn the_window_gives_use_and_throttling_over_its_span() {
        let start = Instant::now();
        let at = |s: u64| start + Duration::from_secs(s);
        let mut window = Window::default();
        assert_eq!(window.figures(), None);
        window.push(
            at(0),
            Stat {
                usage_usec: 0,
                nr_periods: 0,
                nr_throttled: 0,
            },
        );
        window.push(
            at(10),
            Stat {
                usage_usec: 20_000_000,
                nr_periods: 100,
                nr_throttled: 25,
            },
        );
        assert_eq!(window.figures(), Some((2000, 25)));
        window.push(
            at(70),
            Stat {
                usage_usec: 20_000_000,
                nr_periods: 100,
                nr_throttled: 25,
            },
        );
        window.push(
            at(75),
            Stat {
                usage_usec: 20_000_000,
                nr_periods: 100,
                nr_throttled: 25,
            },
        );
        assert_eq!(window.figures(), Some((0, 0)));
        window.push(
            at(76),
            Stat {
                usage_usec: 10,
                nr_periods: 1,
                nr_throttled: 0,
            },
        );
        assert_eq!(window.figures(), None);
    }
}
