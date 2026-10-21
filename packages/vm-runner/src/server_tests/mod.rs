// TEST_OVERVIEW: the runner's own tests, one file per subject. Support holds the fake runtime and the helpers every topic file uses; a new test goes in the file whose subject it covers.

use super::*;
use crate::api::{
    REASON_AWAITING_ALLOCATION, REASON_BOOT_FAILED, REASON_CACHE_UNREACHABLE, REASON_COPYING_DISK,
    REASON_HOME_FULL, REASON_IMAGE_UNAVAILABLE, REASON_OOM_KILLED, REASON_SECCOMP_KILLED,
    REASON_SEED_MISSING, REASON_STORAGE_FULL, STATE_ABSENT, STATE_CREATING, STATE_RESTARTING,
    STATE_RUNNING, STATE_STARTING, STATE_STOPPED, STATE_STOPPING, STATE_UNKNOWN,
};
use crate::cache::{archive_path, digest_path, staged_path, PARTIAL_PREFIX};
use crate::cacheapi;
use crate::forward::HEALTH_TIMEOUT;
use crate::imagecache::{CacheConfig, ImageCache, Images, HOLD_LEASE, REF_FRESH};
use crate::launch::{ImageLaunch, LAUNCH_FILE};
use crate::plan::{READY_GRACE, STALLED_RESTART, UNHEALTHY_RESTART};
use crate::state::RUNTIME_FILE;
use crate::storage::StorageUse;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

mod support;

mod admission;
mod boot;
mod credentials;
mod credits;
mod delete;
mod handoff;
mod images;
mod kills;
mod ports;
mod readiness;
mod records;
mod seeds;
mod sharing;
mod stalls;
mod status;
