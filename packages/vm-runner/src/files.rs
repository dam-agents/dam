use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;

// UNIT_BOUNDARY_DESCRIPTION: how this runner writes a file another process will be judged by — a machine's spec, its published port, the CA a guest must trust, the entrypoint it execs. Two things `fs::write` does not do. It reports a write that failed late, which `fs::write` never does: it drops the handle, and a dropped handle discards whatever the close would have said, so the runner would call a truncated file written. `sync_all` is what reports it here rather than the close, because Rust's close returns nothing to check — and it is the stronger of the two, since it also waits for the bytes to reach the disk instead of only surfacing errors already known. And it states the mode rather than taking the process umask, so the file lands the same way whatever umask the runner was started with.
pub fn write(path: &Path, body: &[u8], mode: u32) -> io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(path)?;
    file.write_all(body)?;
    // UNIT_BOUNDARY_DESCRIPTION: the mode given to the open is masked by the umask, and a create does not change the mode of a file that already exists — so the mode is set on the open file as well as asked for.
    file.set_permissions(fs::Permissions::from_mode(mode))?;
    file.sync_all()
}

// UNIT_BOUNDARY_DESCRIPTION: a directory with the mode it is asked for. `mkdir(2)` masks its mode argument through the umask the process inherited, so a `DirBuilder::mode` is a request and not an instruction — under a tighter umask the guest is handed a CA directory it cannot traverse. platform-init states the same rule for the same reason when it reproduces an image's tree: the mode is set after the entry exists, never at creation.
pub fn create_dir(path: &Path, mode: u32) -> io::Result<()> {
    fs::DirBuilder::new().recursive(true).create(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // TEST_SCENARIO: that the mode is stated and not inherited. Asserting an ordinary 0644 proves nothing on a machine whose umask is the usual 022, because that is where an unstated mode lands anyway — so the writer is asked for one the umask cannot produce.
    #[test]
    fn a_file_gets_the_mode_it_is_given_and_not_the_umasks() {
        let dir = TempDir::new("mode");
        let path = dir.path().join("stated");

        write(&path, b"body", 0o600).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"body");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600,
            "the mode came from the umask, which would have made this 0644"
        );
    }

    // TEST_SCENARIO: a file written a second time is rewritten, not appended to, and gets the mode the second write asks for. A create leaves an existing file's mode alone, so a writer that only asked the open for a mode would keep the first one.
    #[test]
    fn a_rewrite_replaces_the_body_and_retightens_the_mode() {
        let dir = TempDir::new("rewrite");
        let path = dir.path().join("twice");

        write(&path, b"a much longer first body", 0o644).unwrap();
        write(&path, b"short", 0o600).unwrap();

        assert_eq!(
            fs::read(&path).unwrap(),
            b"short",
            "the first body was left behind the second"
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600,
            "the rewrite kept the first write's mode"
        );
    }

    // TEST_SCENARIO: that a directory's mode survives the umask. The mode asked for here is one the ordinary umask 022 does mask — 0777 becomes 0755 at creation — so this fails unless the mode is set after the directory exists. A mode the umask leaves alone, such as 0700, would pass either way and prove nothing; the first version of this test did exactly that.
    #[test]
    fn a_directory_gets_the_mode_it_is_given_and_not_the_umasks() {
        let dir = TempDir::new("dir-mode");
        let nested = dir.path().join("outer").join("inner");

        create_dir(&nested, 0o777).unwrap();

        assert_eq!(
            fs::metadata(&nested).unwrap().permissions().mode() & 0o777,
            0o777,
            "the mode was masked at creation, which umask 022 turns into 0755"
        );
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("vm-runner-files-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
