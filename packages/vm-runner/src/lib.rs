// UNIT_BOUNDARY_DESCRIPTION: the runner is a library with a thin binary over it, so the machine API can be exercised by tests that never spawn a process, and so the guest contract and the wire types are public surface rather than code the binary happens not to call yet.
pub mod api;
pub mod guest;
