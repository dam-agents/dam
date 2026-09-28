use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::api::SeedResult;
use crate::guest;

// UNIT_BOUNDARY_DESCRIPTION: the tar an agent's old home is carried in when the agent moves from the container backend to a machine. It holds the contents of the home, named relative to it and with the home itself as `.`, so platform-init can restore the tree as the agent store and give the store the home's own owner and mode. Every entry keeps its numeric owner, mode and mtime — no user names, because the uid inside the machine is the one the image already uses — and symlinks are stored as symlinks, never followed, so a link out of the home is not a way to pack the rest of the volume. A file with several names is stored once and linked, so a seed is never larger than the home. Sockets, fifos and devices are skipped with a warning, as platform-init skips them when it seeds from an image: they are not state an agent carries across a boot.
pub fn write_tar<W: Write>(source: &Path, into: W) -> io::Result<W> {
    write_layout(source, &[], &[], into)
}

// UNIT_BOUNDARY_DESCRIPTION: another volume of the agent's, carried into the same seed at `at`, a path relative to the home. On the container backend each persisted mount is a volume of its own, and one mounted inside another hides whatever the outer volume holds at that path; the machine keeps a single tree, so each volume is placed where it now lives under the home.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Graft {
    pub at: PathBuf,
    pub source: PathBuf,
}

// UNIT_BOUNDARY_DESCRIPTION: a persisted path from outside the home that the migration moved to `at` below it. The machine's root is fresh on every boot, so the seed carries a boot hook that links `path` to its new place each time, and the agent's software finds its data where it always did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct Link {
    pub path: PathBuf,
    pub at: PathBuf,
}

// UNIT_BOUNDARY_DESCRIPTION: a seed that holds the home and, grafted into it, the agent's other volumes, and for moved paths the boot hook that links them back. The archive is still exactly the home as the machine will have it, so the reader that restores it needs no second format and every check it makes on a name still holds. What a graft covers is left out of the tree it is grafted into, because on the container that part was hidden under the other volume and the agent never saw it. Directories on the way to a graft, a link's place or the hook that no tree holds are added with the home's owner, so the agent's user can write to them; one that a tree holds as a file or a symlink fails the seed, since the entry could only land there by replacing it or by writing through a link. The hook belongs to root and is mode 0755: platform-init runs it as root, and only its owner or root can change it.
pub fn write_layout<W: Write>(
    home: &Path,
    grafts: &[Graft],
    links: &[Link],
    into: W,
) -> io::Result<W> {
    let root = directory(home)?;
    let mut sorted = grafts.to_vec();
    sorted.sort_by(|a, b| a.at.cmp(&b.at));
    for (i, graft) in sorted.iter().enumerate() {
        inside_home(&graft.at)?;
        if sorted[..i].iter().any(|g| g.at == graft.at) {
            return Err(invalid(format!("{} is grafted twice", graft.at.display())));
        }
        directory(&graft.source)?;
    }
    for link in links {
        inside_home(&link.at)?;
        plain_absolute(&link.path)?;
    }
    let skip: HashSet<PathBuf> = sorted.iter().map(|g| g.at.clone()).collect();
    let mut builder = tar::Builder::new(into);
    let mut linked = HashMap::new();
    let mut walk = Walk {
        skip: &skip,
        linked: &mut linked,
    };
    append(&mut builder, home, Path::new("."), &root, &mut walk)?;
    let mut dirs = Dirs {
        home,
        grafts: &sorted,
        root: &root,
        made: HashSet::new(),
    };
    for graft in &sorted {
        dirs.above(&mut builder, &graft.at)?;
        let info = fs::symlink_metadata(&graft.source)?;
        append(&mut builder, &graft.source, &graft.at, &info, &mut walk)?;
        dirs.made.insert(graft.at.clone());
    }
    if !links.is_empty() {
        for link in links {
            dirs.above(&mut builder, &link.at)?;
            dirs.ensure(&mut builder, &link.at, &link.at)?;
        }
        let hook = Path::new(guest::BOOT_HOOK_DIR).join(guest::PERSISTED_PATHS_HOOK);
        dirs.above(&mut builder, &hook)?;
        let script = persisted_paths_hook(links);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Regular);
        header.set_mode(0o755);
        header.set_uid(0);
        header.set_gid(0);
        header.set_mtime(root.mtime().max(0) as u64);
        header.set_size(script.len() as u64);
        builder.append_data(&mut header, &hook, script.as_bytes())?;
    }
    builder.into_inner()
}

// UNIT_BOUNDARY_DESCRIPTION: the directories a seed entry needs above it, added where no tree holds them. `made` remembers what is already in the archive, so a directory shared by several entries is added once.
struct Dirs<'a> {
    home: &'a Path,
    grafts: &'a [Graft],
    root: &'a fs::Metadata,
    made: HashSet<PathBuf>,
}

impl Dirs<'_> {
    fn above<W: Write>(&mut self, builder: &mut tar::Builder<W>, entry: &Path) -> io::Result<()> {
        let mut ancestors: Vec<&Path> = entry
            .ancestors()
            .skip(1)
            .filter(|a| !a.as_os_str().is_empty())
            .collect();
        ancestors.reverse();
        for dir in ancestors {
            self.ensure(builder, dir, entry)?;
        }
        Ok(())
    }

    fn ensure<W: Write>(
        &mut self,
        builder: &mut tar::Builder<W>,
        dir: &Path,
        entry: &Path,
    ) -> io::Result<()> {
        if self.made.contains(dir) {
            return Ok(());
        }
        let (tree, below) = holder(self.home, self.grafts, dir);
        match fs::symlink_metadata(tree.join(below)) {
            Ok(info) if info.is_dir() => {}
            Ok(_) => {
                return Err(invalid(format!(
                    "{} is not a directory in the volume that holds it, so {} cannot be put there",
                    dir.display(),
                    entry.display()
                )))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let mut header = tar::Header::new_gnu();
                header.set_metadata_in_mode(self.root, tar::HeaderMode::Complete);
                header.set_mode(0o755);
                builder.append_data(&mut header, dir, io::empty())?;
            }
            Err(e) => return Err(e),
        }
        self.made.insert(dir.to_path_buf());
        Ok(())
    }
}

fn inside_home(at: &Path) -> io::Result<()> {
    if at.as_os_str().is_empty() || !at.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(invalid(format!(
            "{} is not a path inside the home",
            at.display()
        )));
    }
    Ok(())
}

fn plain_absolute(path: &Path) -> io::Result<()> {
    let mut parts = path.components();
    let plain = parts.next() == Some(Component::RootDir)
        && parts.clone().next().is_some()
        && parts.all(|c| matches!(c, Component::Normal(_)))
        && path.as_os_str() == path.components().collect::<PathBuf>().as_os_str();
    if !plain {
        return Err(invalid(format!(
            "{} is not a plain absolute path",
            path.display()
        )));
    }
    Ok(())
}

// UNIT_BOUNDARY_DESCRIPTION: the boot hook for moved paths. It runs on every boot, so it must be safe to run again: a link that already points into the home is left alone, and an empty directory or a dangling link at the old path — what a fresh root most likely holds there, if anything — is replaced. Anything else there is the image's, so it is logged and left, and so is a link the hook could not make; one path that cannot be linked never stops the others. Each path is quoted for the shell, whatever it holds.
pub fn persisted_paths_hook(links: &[Link]) -> String {
    let mut script = String::from(concat!(
        "#!/bin/sh\n",
        "link() {\n",
        "  path=\"$1\"; target=\"$HOME/$2\"\n",
        "  if [ -L \"$path\" ]; then\n",
        "    [ \"$(readlink \"$path\")\" = \"$target\" ] && return 0\n",
        "    if [ -e \"$path\" ]; then echo \"persisted-paths: not linking $path: it is a link to something else\" >&2; return 0; fi\n",
        "    rm -f \"$path\" || return 0\n",
        "  elif [ -d \"$path\" ]; then\n",
        "    rmdir \"$path\" 2>/dev/null || { echo \"persisted-paths: not linking $path: it is a directory that is not empty\" >&2; return 0; }\n",
        "  elif [ -e \"$path\" ]; then\n",
        "    echo \"persisted-paths: not linking $path: something else is there\" >&2; return 0\n",
        "  fi\n",
        "  mkdir -p \"$(dirname \"$path\")\" && ln -s \"$target\" \"$path\" || echo \"persisted-paths: linking $path failed\" >&2\n",
        "}\n",
    ));
    for link in links {
        script.push_str(&format!(
            "link {} {}\n",
            shell_quote(&link.path),
            shell_quote(&link.at)
        ));
    }
    script
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

// UNIT_BOUNDARY_DESCRIPTION: which tree holds `dir`, a path relative to the home, and where in that tree it is: the deepest graft at or above it, else the home itself.
fn holder<'a>(home: &'a Path, grafts: &'a [Graft], dir: &'a Path) -> (&'a Path, &'a Path) {
    grafts
        .iter()
        .filter(|g| dir.starts_with(&g.at))
        .max_by_key(|g| g.at.components().count())
        .map_or((home, dir), |g| {
            (g.source.as_path(), dir.strip_prefix(&g.at).unwrap_or(dir))
        })
}

fn directory(path: &Path) -> io::Result<fs::Metadata> {
    let info = fs::symlink_metadata(path)?;
    if !info.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} is not a directory", path.display()),
        ));
    }
    Ok(info)
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

struct Walk<'a> {
    skip: &'a HashSet<PathBuf>,
    linked: &'a mut HashMap<(u64, u64), PathBuf>,
}

fn append<W: Write>(
    builder: &mut tar::Builder<W>,
    from: &Path,
    name: &Path,
    info: &fs::Metadata,
    walk: &mut Walk<'_>,
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
            if walk.skip.contains(&named) {
                continue;
            }
            append(builder, &entry.path(), &named, &child, walk)?;
        }
    } else if kind.is_file() {
        let identity = (info.dev(), info.ino());
        if let Some(first) = walk.linked.get(&identity).filter(|_| info.nlink() > 1) {
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
            walk.linked.insert(identity, name.to_path_buf());
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

    fn graft(at: &str, source: &Path) -> Graft {
        Graft {
            at: PathBuf::from(at),
            source: source.to_path_buf(),
        }
    }

    // TEST_SCENARIO: a volume that was mounted outside the home is carried into the seed below the home. The directory on the way to it, which no volume holds, is added with the home's owner and an ordinary mode, so the agent's user can write there; the volume's own root keeps its mode; and its files arrive under the new name.
    #[test]
    fn a_volume_outside_the_home_is_grafted_below_it() {
        let home = TempDir::new("layout-home");
        let data = TempDir::new("layout-data");
        fs::write(home.path().join(".bashrc"), b"a").unwrap();
        fs::write(data.path().join("db"), b"rows").unwrap();
        fs::set_permissions(data.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let owner = fs::metadata(home.path()).unwrap();

        let found = entries(
            &write_layout(
                home.path(),
                &[graft(".persisted/data", data.path())],
                &[],
                Vec::new(),
            )
            .unwrap(),
        );

        let names: Vec<&str> = found.iter().map(|(name, ..)| name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                ".",
                ".bashrc",
                ".persisted",
                ".persisted/data",
                ".persisted/data/db"
            ]
        );
        let (_, kind, header, _) = &found[2];
        assert_eq!(*kind, tar::EntryType::Directory);
        assert_eq!(header.mode().unwrap() & 0o7777, 0o755);
        assert_eq!(header.uid().unwrap(), u64::from(owner.uid()));
        assert_eq!(found[3].2.mode().unwrap() & 0o7777, 0o700);
        assert_eq!(found[4].3, b"rows");
    }

    // TEST_SCENARIO: a volume that was mounted inside the home hid whatever the home's own volume held at that path, so the agent never saw it. The seed carries the mounted volume there and leaves the hidden files out, rather than merging two trees the agent never saw together. A second volume inside the first is left out of the first in the same way.
    #[test]
    fn a_grafted_volume_replaces_what_it_hid() {
        let home = TempDir::new("layout-nested-home");
        let cache = TempDir::new("layout-cache");
        let deeper = TempDir::new("layout-deeper");
        fs::create_dir(home.path().join("cache")).unwrap();
        fs::write(home.path().join("cache").join("hidden"), b"old").unwrap();
        fs::write(cache.path().join("fresh"), b"new").unwrap();
        fs::create_dir(cache.path().join("sub")).unwrap();
        fs::write(cache.path().join("sub").join("hidden"), b"old").unwrap();
        fs::write(deeper.path().join("inner"), b"x").unwrap();

        let found = entries(
            &write_layout(
                home.path(),
                &[
                    graft("cache/sub", deeper.path()),
                    graft("cache", cache.path()),
                ],
                &[],
                Vec::new(),
            )
            .unwrap(),
        );

        let names: Vec<&str> = found.iter().map(|(name, ..)| name.as_str()).collect();
        assert_eq!(
            names,
            vec![".", "cache", "cache/fresh", "cache/sub", "cache/sub/inner"]
        );
    }

    // TEST_SCENARIO: a graft only lands on a directory. One below a file or a symlink of the home would have to replace it or write through the link, and one whose place is not a plain path inside the home, or that is named twice, is a Job built wrong. Each fails the seed rather than sending a tree the restore would refuse half-way.
    #[test]
    fn a_graft_that_cannot_land_fails_the_seed() {
        let home = TempDir::new("layout-refused");
        let data = TempDir::new("layout-refused-data");
        fs::write(home.path().join(".persisted"), b"a file").unwrap();
        std::os::unix::fs::symlink("/etc", home.path().join("link")).unwrap();
        for grafts in [
            vec![graft(".persisted/data", data.path())],
            vec![graft("link/data", data.path())],
            vec![graft("../data", data.path())],
            vec![graft("/data", data.path())],
            vec![graft("", data.path())],
            vec![graft("a", data.path()), graft("a", data.path())],
            vec![graft("a", &data.path().join("absent"))],
        ] {
            assert!(
                write_layout(home.path(), &grafts, &[], Vec::new()).is_err(),
                "{grafts:?} was archived"
            );
        }
    }

    fn link(path: &str, at: &str) -> Link {
        Link {
            path: PathBuf::from(path),
            at: PathBuf::from(at),
        }
    }

    // TEST_SCENARIO: a migration that moved paths from outside the home carries the hook that links them back, in the home's boot hook directory, as a root-owned 0755 file, since platform-init runs it as root on every boot. The directory a moved path now lives in is there even when no volume was ever made for it, so the link does not dangle, and the hook names every moved path.
    #[test]
    fn a_seed_with_moved_paths_carries_their_boot_hook() {
        let home = TempDir::new("layout-hook");
        let data = TempDir::new("layout-hook-data");
        let found = entries(
            &write_layout(
                home.path(),
                &[graft(".persisted/data", data.path())],
                &[
                    link("/data", ".persisted/data"),
                    link("/var/lib/app", ".persisted/var/lib/app"),
                ],
                Vec::new(),
            )
            .unwrap(),
        );

        let names: Vec<&str> = found.iter().map(|(name, ..)| name.as_str()).collect();
        for dir in [".persisted/var/lib/app", ".platform", ".platform/boot.d"] {
            let i = names
                .iter()
                .position(|n| n == &dir)
                .unwrap_or_else(|| panic!("{dir} missing from {names:?}"));
            assert_eq!(found[i].1, tar::EntryType::Directory);
        }
        let (_, kind, header, body) = found
            .iter()
            .find(|(name, ..)| name == ".platform/boot.d/10-persisted-paths.sh")
            .expect("the hook is in the seed");
        assert_eq!(*kind, tar::EntryType::Regular);
        assert_eq!(header.mode().unwrap() & 0o7777, 0o755);
        assert_eq!(header.uid().unwrap(), 0);
        let script = String::from_utf8(body.clone()).unwrap();
        assert!(
            script.contains("link '/data' '.persisted/data'"),
            "{script}"
        );
        assert!(
            script.contains("link '/var/lib/app' '.persisted/var/lib/app'"),
            "{script}"
        );
    }

    // TEST_SCENARIO: a seed without moved paths carries no hook, and a moved path that is not a plain absolute path, or whose place is not inside the home, fails the seed rather than writing a hook that links somewhere else.
    #[test]
    fn a_seed_links_only_plain_paths_into_the_home() {
        let home = TempDir::new("layout-nohook");
        let found = entries(&write_layout(home.path(), &[], &[], Vec::new()).unwrap());
        assert!(!found.iter().any(|(name, ..)| name.starts_with(".platform")));
        for bad in [
            link("data", ".persisted/data"),
            link("/", ".persisted"),
            link("/a/../etc", ".persisted/a"),
            link("/data", "../data"),
            link("/data", "/data"),
        ] {
            assert!(
                write_layout(home.path(), &[], std::slice::from_ref(&bad), Vec::new()).is_err(),
                "{bad:?}"
            );
        }
    }

    fn run_hook(script: &str, home: &Path) {
        let path = home.join("hook.sh");
        fs::write(&path, script).unwrap();
        let status = std::process::Command::new("/bin/sh")
            .arg(&path)
            .env("HOME", home)
            .status()
            .unwrap();
        assert!(status.success());
    }

    // TEST_SCENARIO: the hook runs on every boot, over a root that is fresh each time or, after a restart the runner did not see, the same one, so running it again must change nothing. It links an absent path, replaces an empty directory and a dangling link, leaves a correct link as it is, and leaves a non-empty directory, a file and a link to something else alone, since those are the image's; and it quotes a path with a quote in it.
    #[test]
    fn the_persisted_paths_hook_is_safe_to_run_on_every_boot() {
        let home = TempDir::new("hook-home");
        let root = TempDir::new("hook-root");
        let at = |name: &str| root.path().join(name);
        fs::create_dir(at("empty")).unwrap();
        std::os::unix::fs::symlink(at("nowhere"), at("dangling")).unwrap();
        fs::create_dir(at("full")).unwrap();
        fs::write(at("full").join("kept"), b"x").unwrap();
        fs::write(at("file"), b"x").unwrap();
        std::os::unix::fs::symlink(home.path(), at("foreign")).unwrap();
        let names = [
            "absent/deeper",
            "empty",
            "dangling",
            "full",
            "file",
            "foreign",
            "it's",
        ];
        let links: Vec<Link> = names
            .iter()
            .map(|n| Link {
                path: at(n),
                at: PathBuf::from(format!(".persisted/{n}")),
            })
            .collect();
        let script = persisted_paths_hook(&links);

        for _ in 0..2 {
            run_hook(&script, home.path());
            for linked in ["absent/deeper", "empty", "dangling", "it's"] {
                assert_eq!(
                    fs::read_link(at(linked)).unwrap(),
                    home.path().join(format!(".persisted/{linked}")),
                    "{linked}"
                );
            }
            assert!(at("full").join("kept").exists());
            assert!(fs::symlink_metadata(at("file")).unwrap().is_file());
            assert_eq!(fs::read_link(at("foreign")).unwrap(), home.path());
        }
    }
}
