use std::collections::BTreeMap;
use std::fmt::Write;
use std::sync::Mutex;
use std::time::Duration;

use crate::api::{STATE_CREATING, STATE_RESTARTING, STATE_STARTING, STATE_STOPPING};

// UNIT_BOUNDARY_DESCRIPTION: what a runner measures about its own machines and its image cache, for the platform's collector to scrape, under the Go runner's names so one dashboard reads either. Every label value is a `&'static str` from a fixed set — an operation, an outcome, a failure reason, a cache result — and never a machine, an image or an owner: a machine id or an image reference would grow a series per agent, and the runner exists per owner, so either would be a person's identity in disguise. Written out by hand rather than through a metrics library, because the one already in the lock installs a process-wide recorder that would also export whatever smolvm records, under labels this file does not choose.
pub const NAMESPACE: &str = "platform_vm_runner";

const BOOT_BUCKETS: &[f64] = &[
    0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0, 120.0, 300.0, 600.0,
];
const FETCH_BUCKETS: &[f64] = &[1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0, 1200.0];

// UNIT_BOUNDARY_DESCRIPTION: an operation is named by what it does to the machine rather than by the state the machine reports while it runs, so a dashboard reads create, wake, restart and stop. Anything else is other, never its own label.
pub fn operation_label(op: &str) -> &'static str {
    match op {
        STATE_CREATING => "create",
        STATE_STARTING => "wake",
        STATE_RESTARTING => "restart",
        STATE_STOPPING => "stop",
        _ => "other",
    }
}

fn outcome(ok: bool) -> &'static str {
    if ok {
        "ok"
    } else {
        "failed"
    }
}

struct Histogram {
    buckets: &'static [f64],
    series: BTreeMap<Vec<&'static str>, (Vec<u64>, f64, u64)>,
}

impl Histogram {
    fn new(buckets: &'static [f64]) -> Self {
        Self {
            buckets,
            series: BTreeMap::new(),
        }
    }

    fn observe(&mut self, labels: Vec<&'static str>, took: Duration) {
        let seconds = took.as_secs_f64();
        let (counts, sum, count) = self
            .series
            .entry(labels)
            .or_insert_with(|| (vec![0; self.buckets.len()], 0.0, 0));
        for (bound, bucket) in self.buckets.iter().zip(counts.iter_mut()) {
            if seconds <= *bound {
                *bucket += 1;
            }
        }
        *sum += seconds;
        *count += 1;
    }
}

struct Families {
    operations: Histogram,
    starts: Histogram,
    ready: Histogram,
    fetches: Histogram,
    restarts: u64,
    failures: BTreeMap<(&'static str, &'static str), u64>,
    refusals: u64,
    lookups: BTreeMap<&'static str, u64>,
    evictions: u64,
    evicted_bytes: u64,
    cache_bytes: u64,
}

pub struct Metrics(Mutex<Families>);

impl Default for Metrics {
    fn default() -> Self {
        Self(Mutex::new(Families {
            operations: Histogram::new(BOOT_BUCKETS),
            starts: Histogram::new(BOOT_BUCKETS),
            ready: Histogram::new(BOOT_BUCKETS),
            fetches: Histogram::new(FETCH_BUCKETS),
            restarts: 0,
            failures: BTreeMap::new(),
            refusals: 0,
            lookups: BTreeMap::new(),
            evictions: 0,
            evicted_bytes: 0,
            cache_bytes: 0,
        }))
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the gauges read from the runner as it is at the moment of the scrape rather than recorded as it goes. `committed_mib` is None when the runner could not count it, which is reported as NaN, as the Go runner does, rather than as a number nobody committed.
pub struct Gauges {
    pub budget_bytes: i64,
    pub limit_mib: i32,
    pub reserve_mib: i32,
    pub committed_mib: Option<i64>,
}

impl Metrics {
    fn families(&self) -> std::sync::MutexGuard<'_, Families> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn operation(&self, op: &str, took: Duration, ok: bool) {
        self.families()
            .operations
            .observe(vec![operation_label(op), outcome(ok)], took);
    }

    pub fn start(&self, op: &str, took: Duration, ok: bool) {
        self.families()
            .starts
            .observe(vec![operation_label(op), outcome(ok)], took);
    }

    pub fn became_ready(&self, op: &str, took: Duration) {
        self.families()
            .ready
            .observe(vec![operation_label(op)], took);
    }

    pub fn unhealthy_restart(&self) {
        self.families().restarts += 1;
    }

    pub fn failed(&self, op: &str, reason: &'static str) {
        *self
            .families()
            .failures
            .entry((operation_label(op), reason))
            .or_default() += 1;
    }

    pub fn refused(&self) {
        self.families().refusals += 1;
    }

    pub fn lookup(&self, hit: bool) {
        *self
            .families()
            .lookups
            .entry(if hit { "hit" } else { "miss" })
            .or_default() += 1;
    }

    pub fn fetched(&self, took: Duration, ok: bool) {
        self.families().fetches.observe(vec![outcome(ok)], took);
    }

    pub fn evicted(&self, bytes: u64) {
        let mut families = self.families();
        families.evictions += 1;
        families.evicted_bytes += bytes;
    }

    pub fn cache_size(&self, bytes: u64) {
        self.families().cache_bytes = bytes;
    }

    // UNIT_BOUNDARY_DESCRIPTION: the Prometheus text exposition of everything above.
    pub fn render(&self, gauges: &Gauges) -> String {
        let f = self.families();
        let mut out = String::new();
        histogram(
            &mut out,
            "machine_operation_duration_seconds",
            "Wall time of a machine operation the controller asked for, from the moment it runs to its end, image fetch included.",
            &["op", "outcome"],
            &f.operations,
        );
        histogram(
            &mut out,
            "machine_start_duration_seconds",
            "Wall time of the runtime's own start call, the part of a create, wake or restart that boots the VMM.",
            &["op", "outcome"],
            &f.starts,
        );
        histogram(
            &mut out,
            "machine_ready_seconds",
            "Time from asking a machine to start to the first health check its guest answered.",
            &["op"],
            &f.ready,
        );
        counter(
            &mut out,
            "machine_unhealthy_restarts_total",
            "Machines restarted because a guest that had answered stopped answering.",
            f.restarts,
        );
        header(
            &mut out,
            "machine_operation_failures_total",
            "Machine operations that failed, by the reason the Agent is told.",
            "counter",
        );
        for ((op, reason), n) in &f.failures {
            sample(
                &mut out,
                "machine_operation_failures_total",
                &[("op", op), ("reason", reason)],
                *n as f64,
            );
        }
        counter(
            &mut out,
            "machine_admission_refusals_total",
            "Requests to start a machine refused because its memory did not fit what the runner has left; an Agent parked on this is asked for again, and each refusal counts.",
            f.refusals,
        );
        header(
            &mut out,
            "image_cache_lookups_total",
            "Machine creates by whether the image cache already held a bootable tree of their image.",
            "counter",
        );
        for (result, n) in &f.lookups {
            sample(
                &mut out,
                "image_cache_lookups_total",
                &[("result", result)],
                *n as f64,
            );
        }
        histogram(
            &mut out,
            "image_fetch_duration_seconds",
            "Wall time of fetching and unpacking an image into the cache.",
            &["outcome"],
            &f.fetches,
        );
        counter(
            &mut out,
            "image_cache_evictions_total",
            "Cached images removed to stay inside the budget.",
            f.evictions,
        );
        counter(
            &mut out,
            "image_cache_evicted_bytes_total",
            "Bytes freed by evicting cached images.",
            f.evicted_bytes,
        );
        gauge(
            &mut out,
            "image_cache_bytes",
            "Bytes the cached images occupied after the last eviction pass.",
            f.cache_bytes as f64,
        );
        gauge(
            &mut out,
            "image_cache_budget_bytes",
            "Bytes the cached images may occupy.",
            gauges.budget_bytes as f64,
        );
        gauge(
            &mut out,
            "memory_limit_mib",
            "Memory the runner may commit to machines, before its own reserve.",
            f64::from(gauges.limit_mib),
        );
        gauge(
            &mut out,
            "memory_reserve_mib",
            "Memory the runner keeps for itself when admitting a machine.",
            f64::from(gauges.reserve_mib),
        );
        gauge(
            &mut out,
            "memory_committed_mib",
            "Memory committed to running machines and to machines being started, as admission counts it.",
            gauges.committed_mib.map_or(f64::NAN, |mib| mib as f64),
        );
        out
    }
}

fn header(out: &mut String, name: &str, help: &str, kind: &str) {
    let _ = writeln!(out, "# HELP {NAMESPACE}_{name} {help}");
    let _ = writeln!(out, "# TYPE {NAMESPACE}_{name} {kind}");
}

fn sample(out: &mut String, name: &str, labels: &[(&str, &str)], value: f64) {
    let _ = write!(out, "{NAMESPACE}_{name}");
    if !labels.is_empty() {
        let pairs: Vec<String> = labels.iter().map(|(k, v)| format!("{k}=\"{v}\"")).collect();
        let _ = write!(out, "{{{}}}", pairs.join(","));
    }
    let _ = writeln!(out, " {}", number(value));
}

fn number(value: f64) -> String {
    if value.is_nan() {
        "NaN".into()
    } else if value == f64::INFINITY {
        "+Inf".into()
    } else {
        format!("{value}")
    }
}

fn counter(out: &mut String, name: &str, help: &str, value: u64) {
    header(out, name, help, "counter");
    sample(out, name, &[], value as f64);
}

fn gauge(out: &mut String, name: &str, help: &str, value: f64) {
    header(out, name, help, "gauge");
    sample(out, name, &[], value);
}

fn histogram(out: &mut String, name: &str, help: &str, keys: &[&str], h: &Histogram) {
    header(out, name, help, "histogram");
    for (values, (counts, sum, count)) in &h.series {
        let labels: Vec<(&str, &str)> = keys.iter().copied().zip(values.iter().copied()).collect();
        for (bound, n) in h.buckets.iter().zip(counts) {
            let le = number(*bound);
            let mut with_le = labels.clone();
            with_le.push(("le", &le));
            sample(out, &format!("{name}_bucket"), &with_le, *n as f64);
        }
        let mut inf = labels.clone();
        inf.push(("le", "+Inf"));
        sample(out, &format!("{name}_bucket"), &inf, *count as f64);
        sample(out, &format!("{name}_sum"), &labels, *sum);
        sample(out, &format!("{name}_count"), &labels, *count as f64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gosource;

    fn names(text: &str) -> std::collections::BTreeSet<String> {
        text.lines()
            .filter_map(|line| line.strip_prefix("# TYPE "))
            .map(|rest| rest.split(' ').next().unwrap().to_string())
            .collect()
    }

    // TEST_SCENARIO: the platform's dashboards and alerts are written against the Go runner's series. Every one it defines is exposed here under the same name, with the same help, label names and buckets, and nothing it does not define — so a roll from one runner to the other moves no panel. Go's own process and runtime collectors have no counterpart in a Rust process and are the one difference.
    #[test]
    fn every_series_is_the_go_runners() {
        let go = gosource::read("metrics.go");
        assert!(
            go.lines()
                .any(|l| l == format!("const metricsNamespace = \"{NAMESPACE}\"")),
            "the Go runner names its series under another namespace"
        );
        let theirs: std::collections::BTreeSet<String> = go
            .lines()
            .filter_map(|line| line.split_once("Name: \"")?.1.split_once('"'))
            .map(|(name, _)| format!("{NAMESPACE}_{name}"))
            .collect();
        let metrics = Metrics::default();
        let text = metrics.render(&Gauges {
            budget_bytes: 1,
            limit_mib: 2,
            reserve_mib: 3,
            committed_mib: None,
        });
        assert_eq!(names(&text), theirs);
        for line in text.lines().filter_map(|l| l.strip_prefix("# HELP ")) {
            let (_, help) = line.split_once(' ').unwrap();
            assert!(
                go.contains(&format!("Help: \"{help}\""))
                    || go.contains(&format!("Help:    \"{help}\"")),
                "the Go runner explains this series differently: {help}"
            );
        }
        for (buckets, ours) in [
            ("bootBuckets", BOOT_BUCKETS),
            ("fetchBuckets", FETCH_BUCKETS),
        ] {
            let line = go
                .lines()
                .find(|l| l.starts_with(&format!("var {buckets} = []float64{{")))
                .unwrap_or_else(|| panic!("metrics.go no longer declares {buckets}"));
            let theirs: Vec<f64> = line
                .split_once('{')
                .unwrap()
                .1
                .trim_end_matches('}')
                .split(',')
                .map(|n| n.trim().parse().unwrap())
                .collect();
            assert_eq!(theirs, ours, "{buckets}");
        }
        for (label, keys) in [
            ("[]string{\"op\", \"outcome\"}", 2),
            ("[]string{\"op\"}", 1),
            ("[]string{\"op\", \"reason\"}", 1),
            ("[]string{\"result\"}", 1),
            ("[]string{\"outcome\"}", 1),
        ] {
            assert_eq!(go.matches(label).count(), keys, "{label}");
        }
    }

    // TEST_SCENARIO: a histogram is exposed as Prometheus reads one — cumulative buckets up to +Inf, a sum and a count — per label set, and a failed count is labelled by the operation and the reason the Agent was told, so a scrape can alert on boot failures without knowing any machine's name.
    #[test]
    fn a_scrape_reads_what_the_runner_recorded() {
        let metrics = Metrics::default();
        metrics.operation(STATE_CREATING, Duration::from_millis(1500), true);
        metrics.operation(STATE_CREATING, Duration::from_secs(700), true);
        metrics.failed(STATE_STARTING, "MachineBootFailed");
        metrics.lookup(false);
        let text = metrics.render(&Gauges {
            budget_bytes: 10,
            limit_mib: 4096,
            reserve_mib: 512,
            committed_mib: Some(2048),
        });
        for line in [
            "platform_vm_runner_machine_operation_duration_seconds_bucket{op=\"create\",outcome=\"ok\",le=\"1\"} 0",
            "platform_vm_runner_machine_operation_duration_seconds_bucket{op=\"create\",outcome=\"ok\",le=\"2\"} 1",
            "platform_vm_runner_machine_operation_duration_seconds_bucket{op=\"create\",outcome=\"ok\",le=\"600\"} 1",
            "platform_vm_runner_machine_operation_duration_seconds_bucket{op=\"create\",outcome=\"ok\",le=\"+Inf\"} 2",
            "platform_vm_runner_machine_operation_duration_seconds_sum{op=\"create\",outcome=\"ok\"} 701.5",
            "platform_vm_runner_machine_operation_duration_seconds_count{op=\"create\",outcome=\"ok\"} 2",
            "platform_vm_runner_machine_operation_failures_total{op=\"wake\",reason=\"MachineBootFailed\"} 1",
            "platform_vm_runner_image_cache_lookups_total{result=\"miss\"} 1",
            "platform_vm_runner_memory_committed_mib 2048",
        ] {
            assert!(text.lines().any(|l| l == line), "missing {line}\n{text}");
        }
    }
}
