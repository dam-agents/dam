use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

// UNIT_BOUNDARY_DESCRIPTION: a fresh directory for one test, removed when the test ends. Tests run in parallel threads of one process, so the name carries the process id and a counter as well as the test's own label, and no two tests ever share one.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new(name: &str) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "vm-runner-{}-{}-{name}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a script another process execs, created by a child process so this one never holds a descriptor on the inode that is executed. Linux fails an exec with ETXTBSY while any process holds the file open for writing, and a fork on another test thread copies such a descriptor into a child that keeps it until it execs, so the body goes to a staged name nothing execs and `cp` writes the script itself.
pub(crate) fn exec_script(path: &Path, body: &str) {
    let staged = path.with_file_name(format!(".{}", path.file_name().unwrap().to_string_lossy()));
    fs::write(&staged, body).unwrap();
    let copied = std::process::Command::new("cp")
        .arg(&staged)
        .arg(path)
        .status()
        .unwrap();
    assert!(copied.success(), "cp {staged:?} into {path:?}: {copied}");
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    fs::remove_file(&staged).unwrap();
}
