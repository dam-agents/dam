// UNIT_BOUNDARY_DESCRIPTION: the runner is a library with a thin binary over it, so the machine API can be exercised by tests that never spawn a process, and so the wire types are public surface rather than code the binary happens not to call yet. The guest contract belongs to platform-init and is re-exported here, so the share this runner writes and the entrypoint that reads it take their paths from one file.
pub mod api;
mod cache;
pub mod cacheapi;
mod capability;
mod capacity;
mod cgroup;
mod command;
pub mod console;
pub mod embedded;
mod fetch;
mod files;
pub mod forward;
pub mod http;
pub mod imagecache;
mod launch;
pub mod link;
mod metrics;
mod plan;
pub mod preload;
pub mod release;
pub mod runtime;
pub mod seed;
pub mod server;
mod share;
pub mod state;
pub mod storage;

pub use platform_init::guest;

#[cfg(test)]
mod testdir;

// UNIT_BOUNDARY_DESCRIPTION: a lock whose holder panicked is still taken. Every guarded value here is bookkeeping that a panicking worker leaves consistent, and refusing it would stop the whole runner over one machine.
fn locked<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

// UNIT_BOUNDARY_DESCRIPTION: the milliseconds since `started`, as the whole number a log field or a report carries.
fn elapsed_ms(started: std::time::Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

// UNIT_BOUNDARY_DESCRIPTION: one periodic task of the process: `work` on a blocking thread, at once and then every `period`, until `lifetime` fires. It serves the work no runner owns — a node service's preload pass, the runner binary's log trim and reaper, the token file's re-read — where `Server::every` serves the timers of one runner. A pass that panics is left to the next one rather than stopping the timer. The task comes back, so a caller that must outlive its last pass can wait for it.
pub fn every(
    period: std::time::Duration,
    lifetime: Option<tokio_util::sync::CancellationToken>,
    work: impl Fn() + Send + Sync + 'static,
) -> tokio::task::JoinHandle<()> {
    let work = std::sync::Arc::new(work);
    tokio::spawn(async move {
        loop {
            let pass = work.clone();
            let _ = tokio::task::spawn_blocking(move || pass()).await;
            let waited = tokio::time::sleep(period);
            match &lifetime {
                Some(lifetime) => tokio::select! {
                    _ = lifetime.cancelled() => return,
                    _ = waited => {}
                },
                None => waited.await,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    // TEST_SCENARIO: a periodic task runs its pass at once and again after each period, and the lifetime token stops it between passes rather than leaving it to run on.
    #[tokio::test]
    async fn a_periodic_task_runs_at_once_then_every_period_until_it_is_cancelled() {
        let passes = Arc::new(AtomicU32::new(0));
        let counted = passes.clone();
        let lifetime = tokio_util::sync::CancellationToken::new();
        let task = super::every(
            Duration::from_millis(10),
            Some(lifetime.clone()),
            move || {
                counted.fetch_add(1, Ordering::Relaxed);
            },
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        lifetime.cancel();
        let _ = task.await;
        let ran = passes.load(Ordering::Relaxed);
        assert!(ran >= 2, "ran {ran} times in a hundred milliseconds");
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(
            passes.load(Ordering::Relaxed),
            ran,
            "a cancelled task ran on"
        );
    }
}
