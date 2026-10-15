#![allow(dead_code)]
use std::collections::HashMap;
use std::os::unix::fs::{FileTypeExt, MetadataExt};

use super::*;

// UNIT_BOUNDARY_DESCRIPTION: what copy_exact did, for the console line that closes a copy. Skipped entries are sockets, which a running process recreates, and attributes the destination's kernel refuses, such as POSIX ACLs on a guest kernel built without them.
#[derive(Debug, Default, PartialEq)]
pub struct Copied {
    pub entries: u64,
    pub bytes: u64,
    pub hard_links: u64,
    pub skipped: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: copies the tree at `from` into `to`, which must not exist yet, as one filesystem's files onto another's: owners, every mode bit, extended attributes (overlay whiteouts' and opaque directories' trusted.overlay.* among them, and a file capability, set after the chown that would clear it), access and modification times to the nanosecond, hard links as links, devices and fifos as nodes (an overlay whiteout is a character device 0:0), symlinks as they are and never followed, and zero blocks as holes. A directory gets its own attributes and times last, deepest first, since writing into it moves its time and a read-only one refuses entries. `skip` names paths, relative to `from`, that are not copied at all. Names are bytes, so a name that is not UTF-8 is copied as it is.
pub fn copy_exact(from: &Path, to: &Path, skip: &dyn Fn(&Path) -> bool) -> io::Result<Copied> {
    let mut copied = Copied::default();
    let mut links: HashMap<(u64, u64), PathBuf> = HashMap::new();
    let mut dirs: Vec<(PathBuf, PathBuf, fs::Metadata)> = Vec::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        let source = from.join(&relative);
        let target = to.join(&relative);
        let info = fs::symlink_metadata(&source)?;
        let kind = info.file_type();
        copied.entries += 1;
        if kind.is_dir() {
            DirBuilder::new().mode(0o700).create(&target)?;
            for entry in fs::read_dir(&source)? {
                let name = relative.join(entry?.file_name());
                if !skip(&name) {
                    pending.push(name);
                }
            }
            dirs.push((source, target, info));
            continue;
        }
        if kind.is_socket() {
            copied.skipped += 1;
            continue;
        }
        if !kind.is_symlink() && info.nlink() > 1 {
            if let Some(first) = links.get(&(info.dev(), info.ino())) {
                fs::hard_link(first, &target)?;
                copied.hard_links += 1;
                continue;
            }
            links.insert((info.dev(), info.ino()), target.clone());
        }
        if kind.is_symlink() {
            std::os::unix::fs::symlink(fs::read_link(&source)?, &target)?;
        } else if kind.is_file() {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&target)?;
            write_sparse(&mut File::open(&source)?, &mut file)?;
            copied.bytes += info.len();
        } else {
            let node = cstring(target.as_os_str())?;
            // SAFETY: `node` is a NUL-terminated path that outlives the call, and mknod(2) reads only it.
            let made =
                unsafe { libc::mknod(node.as_ptr(), info.mode(), info.rdev() as libc::dev_t) };
            succeeded(made == 0)?;
        }
        finish(&source, &target, &info, &mut copied)?;
    }
    while let Some((source, target, info)) = dirs.pop() {
        finish(&source, &target, &info, &mut copied)?;
    }
    Ok(copied)
}

// UNIT_BOUNDARY_DESCRIPTION: gives `target` the owner, mode, extended attributes and times of `source`, in the order the kernel needs: the chown first, since it clears the setuid and setgid bits and a file capability, then the mode, then the attributes, and the times last, since every other change moves the change time and some move the modification time. A symlink has no mode of its own, and only some attributes.
fn finish(
    source: &Path,
    target: &Path,
    info: &fs::Metadata,
    copied: &mut Copied,
) -> io::Result<()> {
    std::os::unix::fs::lchown(target, Some(info.uid()), Some(info.gid()))?;
    if !info.file_type().is_symlink() {
        fs::set_permissions(target, fs::Permissions::from_mode(info.mode() & 0o7777))?;
    }
    for name in xattr_names(source)? {
        let value = xattr_get(source, &name)?;
        if let Err(e) = xattr_set(target, &name, &value) {
            if matches!(e.raw_os_error(), Some(libc::EOPNOTSUPP | libc::EPERM)) {
                copied.skipped += 1;
            } else {
                return Err(e);
            }
        }
    }
    let times = [
        libc::timespec {
            tv_sec: info.atime(),
            tv_nsec: info.atime_nsec(),
        },
        libc::timespec {
            tv_sec: info.mtime(),
            tv_nsec: info.mtime_nsec(),
        },
    ];
    let path = cstring(target.as_os_str())?;
    // SAFETY: `path` is a NUL-terminated path and `times` two live timespecs, both outliving the call.
    let set = unsafe {
        libc::utimensat(
            libc::AT_FDCWD,
            path.as_ptr(),
            times.as_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    succeeded(set == 0)
}

fn xattr_names(path: &Path) -> io::Result<Vec<CString>> {
    let path = cstring(path.as_os_str())?;
    let mut buffer = vec![0u8; 4096];
    loop {
        // SAFETY: `buffer` is writable for its length, and `path` a NUL-terminated path; both outlive the call.
        let n =
            unsafe { libc::llistxattr(path.as_ptr(), buffer.as_mut_ptr().cast(), buffer.len()) };
        if n >= 0 {
            buffer.truncate(n as usize);
            break;
        }
        let e = io::Error::last_os_error();
        match e.raw_os_error() {
            Some(libc::ERANGE) => buffer.resize(buffer.len() * 4, 0),
            Some(libc::ENOTSUP) => return Ok(Vec::new()),
            _ => return Err(e),
        }
    }
    Ok(buffer
        .split(|b| *b == 0)
        .filter(|name| !name.is_empty())
        .filter_map(|name| CString::new(name).ok())
        .collect())
}

fn xattr_get(path: &Path, name: &CString) -> io::Result<Vec<u8>> {
    let path = cstring(path.as_os_str())?;
    let mut buffer = vec![0u8; 4096];
    loop {
        // SAFETY: `buffer` is writable for its length, and `path` and `name` NUL-terminated; all outlive the call.
        let n = unsafe {
            libc::lgetxattr(
                path.as_ptr(),
                name.as_ptr(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
            )
        };
        if n >= 0 {
            buffer.truncate(n as usize);
            return Ok(buffer);
        }
        let e = io::Error::last_os_error();
        if e.raw_os_error() != Some(libc::ERANGE) {
            return Err(e);
        }
        buffer.resize(buffer.len() * 4, 0);
    }
}

fn xattr_set(path: &Path, name: &CString, value: &[u8]) -> io::Result<()> {
    let path = cstring(path.as_os_str())?;
    // SAFETY: `path` and `name` are NUL-terminated and `value` readable for its length; all outlive the call.
    let set = unsafe {
        libc::lsetxattr(
            path.as_ptr(),
            name.as_ptr(),
            value.as_ptr().cast(),
            value.len(),
            0,
        )
    };
    succeeded(set == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::ffi::OsStrExt;

    // TEST_SCENARIO: a home and a kept root copied from one filesystem to another are the same tree: every entry with its owner, mode, nanosecond times and extended attributes, a hard link still one inode, an overlay whiteout still a 0:0 device, a fifo, a symlink not followed, a file capability kept although the chown would clear it, a name that is not UTF-8, a read-only directory with its entries, and a sparse file that keeps its holes. Skipped paths are not copied. The copy goes from the test's temporary directory onto a loop-mounted btrfs, as a conversion goes from ext4 onto btrfs. Needs root and mkfs.btrfs, for the mount, the owners, devices and trusted.* attributes: `sudo -E cargo test -p platform-init -- --ignored copies_a_tree`.
    #[test]
    #[ignore = "needs root"]
    fn copies_a_tree_exactly() {
        let dir = std::env::temp_dir().join(format!("platform-init-copy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let from = dir.join("from");
        let run = |program: &str, args: &[&std::ffi::OsStr]| {
            let out = std::process::Command::new(program)
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{program}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        };
        let image = dir.join("btrfs.raw");
        mkdir_all(&dir).unwrap();
        File::create(&image).unwrap().set_len(256 << 20).unwrap();
        run(
            "mkfs.btrfs",
            &["-q".as_ref(), "-M".as_ref(), image.as_os_str()],
        );
        let mount = dir.join("btrfs");
        mkdir_all(&mount).unwrap();
        run(
            "mount",
            &[
                "-o".as_ref(),
                "loop".as_ref(),
                image.as_os_str(),
                mount.as_os_str(),
            ],
        );
        let to = mount.join("to");
        mkdir_all(&from.join("ro")).unwrap();
        mkdir_all(&from.join("skipped")).unwrap();
        fs::write(from.join("ro/file"), b"inside a read-only dir").unwrap();
        fs::write(from.join("file"), b"data").unwrap();
        fs::hard_link(from.join("file"), from.join("link")).unwrap();
        std::os::unix::fs::symlink("/nowhere", from.join("dangling")).unwrap();
        let odd = from.join(std::ffi::OsStr::from_bytes(b"name-\xff"));
        fs::write(&odd, b"odd").unwrap();
        let sparse = File::create(from.join("sparse")).unwrap();
        sparse.set_len(64 << 20).unwrap();
        use std::os::unix::fs::FileExt;
        sparse.write_at(b"end", (64 << 20) - 3).unwrap();
        let mknod = |name: &str, mode: libc::mode_t| {
            let path = cstring(from.join(name).as_os_str()).unwrap();
            // SAFETY: a NUL-terminated path that outlives the call.
            assert_eq!(unsafe { libc::mknod(path.as_ptr(), mode, 0) }, 0);
        };
        mknod("whiteout", libc::S_IFCHR);
        mknod("fifo", libc::S_IFIFO | 0o640);
        xattr_set(
            &from.join("ro"),
            &CString::new("trusted.overlay.opaque").unwrap(),
            b"y",
        )
        .unwrap();
        xattr_set(
            &from.join("file"),
            &CString::new("user.note").unwrap(),
            b"kept",
        )
        .unwrap();
        std::os::unix::fs::lchown(from.join("file"), Some(1000), Some(1000)).unwrap();
        fs::set_permissions(from.join("file"), fs::Permissions::from_mode(0o4755)).unwrap();
        let cap = [0u8, 0, 0, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        xattr_set(
            &from.join("file"),
            &CString::new("security.capability").unwrap(),
            &cap,
        )
        .unwrap();
        fs::set_permissions(from.join("ro"), fs::Permissions::from_mode(0o555)).unwrap();

        let copied = copy_exact(&from, &to, &|name| name == Path::new("skipped")).unwrap();

        assert!(!to.join("skipped").exists());
        assert_eq!(copied.hard_links, 1);
        for name in [
            "", "ro", "ro/file", "file", "dangling", "whiteout", "fifo", "sparse",
        ] {
            let (a, b) = (
                fs::symlink_metadata(from.join(name)).unwrap(),
                fs::symlink_metadata(to.join(name)).unwrap(),
            );
            assert_eq!(
                (a.mode(), a.uid(), a.gid(), a.rdev()),
                (b.mode(), b.uid(), b.gid(), b.rdev()),
                "{name}"
            );
            assert_eq!(
                (a.mtime(), a.mtime_nsec()),
                (b.mtime(), b.mtime_nsec()),
                "{name}"
            );
        }
        assert_eq!(
            fs::metadata(to.join("file")).unwrap().ino(),
            fs::metadata(to.join("link")).unwrap().ino()
        );
        assert_eq!(
            fs::read_link(to.join("dangling")).unwrap(),
            Path::new("/nowhere")
        );
        assert_eq!(
            fs::read(to.join(std::ffi::OsStr::from_bytes(b"name-\xff"))).unwrap(),
            b"odd"
        );
        assert_eq!(
            fs::read(to.join("ro/file")).unwrap(),
            b"inside a read-only dir"
        );
        assert_eq!(
            xattr_get(
                &to.join("ro"),
                &CString::new("trusted.overlay.opaque").unwrap()
            )
            .unwrap(),
            b"y"
        );
        assert_eq!(
            xattr_get(&to.join("file"), &CString::new("user.note").unwrap()).unwrap(),
            b"kept"
        );
        assert_eq!(
            xattr_get(
                &to.join("file"),
                &CString::new("security.capability").unwrap()
            )
            .unwrap(),
            cap
        );
        let sparse = fs::metadata(to.join("sparse")).unwrap();
        assert_eq!(sparse.len(), 64 << 20);
        assert!(sparse.blocks() * 512 < 1 << 20, "the holes stay holes");
        fs::set_permissions(from.join("ro"), fs::Permissions::from_mode(0o755)).unwrap();
        run("umount", &[mount.as_os_str()]);
        fs::remove_dir_all(&dir).unwrap();
    }
}
