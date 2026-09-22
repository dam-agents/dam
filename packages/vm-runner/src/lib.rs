// UNIT_BOUNDARY_DESCRIPTION: the runner is a library with a thin binary over it, so the machine API can be exercised by tests that never spawn a process, and so the guest contract and the wire types are public surface rather than code the binary happens not to call yet.
pub mod api;
pub mod cache;
pub mod capacity;
pub mod command;
pub mod embedded;
pub mod fetch;
pub mod files;
pub mod forward;
pub mod guest;
pub mod http;
pub mod imagecache;
pub mod launch;
pub mod plan;
pub mod preload;
pub mod runtime;
pub mod server;
pub mod share;
pub mod state;
pub mod templates;

#[cfg(test)]
mod gosource;
