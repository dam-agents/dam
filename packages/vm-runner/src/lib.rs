// UNIT_BOUNDARY_DESCRIPTION: the runner is a library with a thin binary over it, so the machine API can be exercised by tests that never spawn a process, and so the wire types are public surface rather than code the binary happens not to call yet. The guest contract belongs to platform-init and is re-exported here, so the share this runner writes and the entrypoint that reads it take their paths from one file.
pub mod api;
pub mod cache;
pub mod cacheapi;
pub mod capacity;
pub mod command;
pub mod console;
pub mod embedded;
pub mod fetch;
pub mod files;
pub mod forward;
pub mod http;
pub mod imagecache;
pub mod launch;
pub mod metrics;
pub mod plan;
pub mod preload;
pub mod runtime;
pub mod server;
pub mod share;
pub mod state;
pub mod templates;

pub use platform_init::guest;
