use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::api::SeedResult;

// UNIT_BOUNDARY_DESCRIPTION: the tar an agent's old home is carried in when the agent moves from the container backend to a machine. It holds the contents of the home, named relative to it and with the home itself as `.`, so platform-init can restore the tree as the agent store and give the store the home's own owner and mode. Every entry keeps its numeric owner, mode and mtime — no user names, because the uid inside the machine is the one the image already uses — and symlinks are stored as symlinks, never followed, so a link out of the home is not a way to pack the rest of the volume. A file with several names is stored once and linked, so a seed is never larger than the home. Sockets, fifos and devices are skipped with a warning, as platform-init skips them when it seeds from an image: they are not state an agent carries across a boot.
pub fn write_tar<W: Write>(source: &Path, into: W) -> io::Result<W> {
    let root = fs::symlink_metadata(source)?;
    if !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} is not a directory", source.display()),
        ));
    }
    let mut builder = tar::Builder::new(into);
    let mut linked = HashMap::new();
    append(&mut builder, source, Path::new("."), &root, &mut linked)?;
    builder.into_inner()
}

fn append<W: Write>(
    builder: &mut tar::Builder<W>,
    from: &Path,
    name: &Path,
    info: &fs::Metadata,
    linked: &mut HashMap<(u64, u64), PathBuf>,
) -> io::Result<()> {
    let kind = info.file_type();
    let mut header = tar::Header::new_gnu();
    header.set_metadata_in_mode(info, tar::HeaderMode::Complete);
    if kind.is_symlink() {
        builder.append_link(&mut header, name, fs::read_link(from)?)?;
    } else if kind.is_dir() {
        builder.append_data(&mut header, name, io::empty())?;
        let mut entries = fs::read_dir(from)?.collect::<io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let child = fs::symlink_metadata(entry.path())?;
            let named = if name == Path::new(".") {
                PathBuf::from(entry.file_name())
            } else {
                name.join(entry.file_name())
            };
            append(builder, &entry.path(), &named, &child, linked)?;
        }
    } else if kind.is_file() {
        let identity = (info.dev(), info.ino());
        if let Some(first) = linked.get(&identity).filter(|_| info.nlink() > 1) {
            header.set_entry_type(tar::EntryType::Link);
            header.set_size(0);
            builder.append_link(&mut header, name, first)?;
            return Ok(());
        }
        let mut file = Counted {
            inner: fs::File::open(from)?.take(info.len()),
            read: 0,
        };
        builder.append_data(&mut header, name, &mut file)?;
        // UNIT_BOUNDARY_DESCRIPTION: the header was written with the size the file had when it was listed. A file that shrank since then leaves the archive shorter than its header says, which corrupts every entry after it, so the whole seed is refused rather than sent.
        if file.read != info.len() {
            return Err(io::Error::other(format!(
                "{} changed while it was archived",
                from.display()
            )));
        }
        if info.nlink() > 1 {
            linked.insert(identity, name.to_path_buf());
        }
    } else {
        tracing::warn!(path = %from.display(), "not archiving an entry that is neither a file, a directory nor a symlink");
    }
    Ok(())
}

struct Counted<R> {
    inner: R,
    read: u64,
}

impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read += n as u64;
        Ok(n)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: counts and hashes every byte on its way to `inner`, which is how the uploader knows exactly what it sent without reading the seed a second time. The runner answers with the same two numbers for what it stored, and the two must agree.
pub struct Tally<W> {
    inner: W,
    hasher: Sha256,
    bytes: u64,
}

impl<W: Write> Tally<W> {
    pub fn new(inner: W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            bytes: 0,
        }
    }

    pub fn finish(mut self) -> io::Result<(W, SeedResult)> {
        self.inner.flush()?;
        let result = SeedResult {
            bytes: self.bytes,
            sha256: format!("{:x}", self.hasher.finalize()),
        };
        Ok((self.inner, result))
    }
}

impl<W: Write> Write for Tally<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.hasher.update(&buf[..n]);
        self.bytes += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

#[cfg(test)]
mod tests {
    // TEST_OVERVIEW: the seed is the only thing that carries an agent's home from its old volume to its machine, and platform-init restores exactly what it holds. What must survive is covered here on a real tree: the names relative to the home, owners, modes and times, symlinks as symlinks, empty directories, and one copy of a file with two names. The counts the uploader checks the runner's answer against are the bytes it produced.
    use super::*;
    use crate::testdir::TempDir;
    use std::os::unix::fs::PermissionsExt;

    fn entries(tar: &[u8]) -> Vec<(String, tar::EntryType, tar::Header, Vec<u8>)> {
        let mut archive = tar::Archive::new(tar);
        archive
            .entries()
            .unwrap()
            .map(|entry| {
                let mut entry = entry.unwrap();
                let name = entry.path().unwrap().to_string_lossy().into_owned();
                let mut body = Vec::new();
                entry.read_to_end(&mut body).unwrap();
                (
                    name,
                    entry.header().entry_type(),
                    entry.header().clone(),
                    body,
                )
            })
            .collect()
    }

    // TEST_SCENARIO: a home with a private file, an empty directory and a symlink out of it. Every entry is named relative to the home, the home itself is `.` so its owner and mode travel too, the private file keeps 0600 and its owner and mtime, the empty directory is there, and the symlink is stored as the link it is rather than as whatever it points at.
    #[test]
    fn a_home_is_archived_as_the_tree_it_is() {
        let home = TempDir::new("seed-home");
        fs::write(home.path().join(".bashrc"), b"export A=1\n").unwrap();
        fs::set_permissions(
            home.path().join(".bashrc"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        fs::create_dir(home.path().join("empty")).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", home.path().join("out")).unwrap();
        let info = fs::metadata(home.path().join(".bashrc")).unwrap();

        let tar = write_tar(home.path(), Vec::new()).unwrap();
        let found = entries(&tar);

        let names: Vec<&str> = found.iter().map(|(name, ..)| name.as_str()).collect();
        assert_eq!(names, vec![".", ".bashrc", "empty", "out"]);
        let (_, kind, header, body) = &found[1];
        assert_eq!(*kind, tar::EntryType::Regular);
        assert_eq!(body, b"export A=1\n");
        assert_eq!(header.mode().unwrap() & 0o7777, 0o600);
        assert_eq!(header.uid().unwrap(), u64::from(info.uid()));
        assert_eq!(header.gid().unwrap(), u64::from(info.gid()));
        assert_eq!(header.mtime().unwrap(), info.mtime() as u64);
        assert_eq!(found[2].1, tar::EntryType::Directory);
        let (_, kind, header, _) = &found[3];
        assert_eq!(*kind, tar::EntryType::Symlink);
        assert_eq!(
            header.link_name().unwrap().unwrap(),
            Path::new("/etc/passwd"),
            "the symlink was followed"
        );
    }

    // TEST_SCENARIO: a file with two names in the home is stored once, and its second name as a link to the first, so the seed restores one file and is no larger than the home.
    #[test]
    fn a_file_with_two_names_is_stored_once() {
        let home = TempDir::new("seed-links");
        fs::write(home.path().join("a"), b"shared").unwrap();
        fs::hard_link(home.path().join("a"), home.path().join("b")).unwrap();

        let found = entries(&write_tar(home.path(), Vec::new()).unwrap());

        let (name, kind, header, _) = &found[2];
        assert_eq!(name, "b");
        assert_eq!(*kind, tar::EntryType::Link);
        assert_eq!(header.link_name().unwrap().unwrap(), Path::new("a"));
    }

    // TEST_SCENARIO: the uploader compares the runner's answer with what it sent, so its count and digest must be of exactly the bytes that left it.
    #[test]
    fn the_tally_is_of_the_bytes_written() {
        let home = TempDir::new("seed-tally");
        fs::write(home.path().join("file"), b"body").unwrap();

        let (tar, result) = write_tar(home.path(), Tally::new(Vec::new()))
            .unwrap()
            .finish()
            .unwrap();

        assert_eq!(result.bytes, tar.len() as u64);
        assert_eq!(result.sha256, format!("{:x}", Sha256::digest(&tar)));
    }

    // TEST_SCENARIO: a source that is not a directory is refused: the Job names the mount of the old volume, and archiving a file or a link in its place would seed the store with the wrong thing.
    #[test]
    fn only_a_directory_is_archived() {
        let dir = TempDir::new("seed-file");
        fs::write(dir.path().join("file"), b"x").unwrap();
        assert!(write_tar(&dir.path().join("file"), Vec::new()).is_err());
        assert!(write_tar(&dir.path().join("absent"), Vec::new()).is_err());
    }
}
