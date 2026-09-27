use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

// UNIT_BOUNDARY_DESCRIPTION: how this runner writes a file another process will be judged by — a machine's spec, its published port, the CA a guest must trust, the entrypoint it execs. Three things `fs::write` does not do. The file is replaced whole: the body goes to a new file beside it, which is renamed over the old one, so a runner killed mid-write leaves the old file or the new one and never a truncated one — a spec cut short reads back as no spec, and the next start would boot the machine from an image and size it never had. It reports a write that failed late, which `fs::write` never does: it drops the handle, and a dropped handle discards whatever the close would have said. `sync_all` is what reports it here rather than the close, because Rust's close returns nothing to check, and the directory is synced after the rename, so the new name is on the disk too. And it states the mode rather than taking the process umask, so the file lands the same way whatever umask the runner was started with.
pub fn write(path: &Path, body: &[u8], mode: u32) -> io::Result<()> {
    let dir = match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir,
        _ => Path::new("."),
    };
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "a file needs a name"))?;
    let staged = unique_sibling(dir, &name.to_string_lossy(), mode)?;
    let written = (|| {
        let mut file = fs::OpenOptions::new().write(true).open(&staged)?;
        file.write_all(body)?;
        // UNIT_BOUNDARY_DESCRIPTION: the mode given to the open is masked by the umask, so it is set on the open file as well as asked for.
        file.set_permissions(fs::Permissions::from_mode(mode))?;
        file.sync_all()?;
        fs::rename(&staged, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&staged);
    }
    written?;
    fs::File::open(dir)?.sync_all()
}

// UNIT_BOUNDARY_DESCRIPTION: a new, empty file beside `name` that nothing else has, dot-prefixed so nothing that lists the directory takes it for the file it will replace.
fn unique_sibling(dir: &Path, name: &str, mode: u32) -> io::Result<PathBuf> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    for _ in 0..100 {
        let path = dir.join(format!(
            ".{name}.{}-{}.tmp",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(&path)
        {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        format!("no free name beside {name} in {}", dir.display()),
    ))
}

// UNIT_BOUNDARY_DESCRIPTION: a directory with the mode it is asked for. `mkdir(2)` masks its mode argument through the umask the process inherited, so a `DirBuilder::mode` is a request and not an instruction — under a tighter umask the guest is handed a CA directory it cannot traverse. platform-init states the same rule for the same reason when it reproduces an image's tree: the mode is set after the entry exists, never at creation.
pub fn create_dir(path: &Path, mode: u32) -> io::Result<()> {
    fs::DirBuilder::new().recursive(true).create(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

// UNIT_BOUNDARY_DESCRIPTION: makes a directory under `parent` that no other caller has, named `prefix` then this process's id, the clock's nanoseconds and a counter, and creates it with `mode` as mkdir(2) takes it. The pid can repeat across restarts of a container, so a name already taken is retried rather than reused: a scratch tree or a credential directory must never be one something else left behind.
pub fn create_unique_dir(parent: &Path, prefix: &str, mode: u32) -> io::Result<PathBuf> {
    use std::os::unix::fs::DirBuilderExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    for _ in 0..100 {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or_default();
        let path = parent.join(format!(
            "{prefix}{}-{nanos:x}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        match fs::DirBuilder::new().mode(mode).create(&path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        format!("no free {prefix} directory in {}", parent.display()),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TempDir;

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

    // TEST_SCENARIO: a runner killed while it writes a spec must leave the old spec or the new one, never a spec cut short. So a write never touches the old file's bytes: it replaces the file with a new one. A second name linked to the old file still reads the old body, which a write in place would have truncated, and no staging file is left beside it.
    #[test]
    fn a_rewrite_replaces_the_file_and_never_writes_into_the_old_one() {
        let dir = TempDir::new("atomic");
        let path = dir.path().join("spec.json");
        write(&path, b"the old spec", 0o600).unwrap();
        let old = dir.path().join("old-link");
        fs::hard_link(&path, &old).unwrap();

        write(&path, b"new", 0o600).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert_eq!(
            fs::read(&old).unwrap(),
            b"the old spec",
            "the old file was written into in place"
        );
        let mut left: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["old-link", "spec.json"]);
    }

    // TEST_SCENARIO: that a directory's mode survives the umask. The mode asked for here is one the ordinary umask 022 does mask — 0777 becomes 0755 at creation — so this fails unless the mode is set after the directory exists. A mode the umask leaves alone, such as 0700, would pass either way and prove nothing.
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

    // TEST_SCENARIO: a scratch tree and a credential directory must each be a directory nobody else has. Two calls with one prefix get two directories, and each is created with the mode asked for.
    #[test]
    fn every_unique_directory_is_a_new_one() {
        let dir = TempDir::new("unique");
        let first = create_unique_dir(dir.path(), ".unpack-", 0o700).unwrap();
        let second = create_unique_dir(dir.path(), ".unpack-", 0o700).unwrap();
        assert_ne!(first, second);
        for made in [&first, &second] {
            assert!(made
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".unpack-"));
            assert_eq!(
                fs::metadata(made).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }
}
