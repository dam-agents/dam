// UNIT_BOUNDARY_DESCRIPTION: the runner is a library with a thin binary over it, so the machine API can be exercised by tests that never spawn a process, and so the wire types are public surface rather than code the binary happens not to call yet. The guest contract belongs to platform-init and is re-exported here, so the share this runner writes and the entrypoint that reads it take their paths from one file.
pub mod api;
mod cache;
pub mod cacheapi;
mod capacity;
mod command;
mod console;
pub mod embedded;
mod fetch;
mod files;
mod forward;
pub mod http;
pub mod imagecache;
mod launch;
mod metrics;
mod plan;
pub mod preload;
pub mod runtime;
pub mod server;
mod share;
mod state;
pub mod templates;

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
