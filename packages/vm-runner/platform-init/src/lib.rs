// UNIT_BOUNDARY_DESCRIPTION: platform-init as a library, so its file work is tested without a guest and so the runner links the guest contract from the same file platform-init reads it from. The boot itself mounts and execs, which only a Linux guest can do, so it is built for Linux alone; the contract is plain constants and builds everywhere the runner does.
pub mod guest;
pub mod runc;

#[cfg(target_os = "linux")]
pub mod boot;
