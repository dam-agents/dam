use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileExt, MetadataExt};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::api::SeedResult;

// UNIT_BOUNDARY_DESCRIPTION: the tar an agent's old home is carried in when the agent moves from the container backend to a machine. It holds the contents of the home, named relative to it and with the home itself as `.`, so platform-init can restore the tree as the agent store and give the store the home's own owner and mode. Every entry keeps its numeric owner, mode and mtime in whole seconds — no user names, because the uid inside the machine is the one the image already uses, and an owner map (see Options) rewrites the container's agent uid to the machine's — and symlinks are stored as symlinks, never followed, so a link out of the home is not a way to pack the rest of the volume. A file with several names is stored once and linked, and a sparse file is stored as its data and a map of its holes, so a seed is never larger than the home. Sockets, fifos and devices are skipped with a warning, as platform-init skips them when it seeds from an image: they are not state an agent carries across a boot. Extended attributes and ACLs are not carried. What only the container used is left out too (see container_only).
pub fn write_tar<W: Write>(source: &Path, into: W) -> io::Result<W> {
    write_seed(source, &Options::default(), into)
}

// UNIT_BOUNDARY_DESCRIPTION: what a seed is written with beyond the trees it holds: whose files change owner on the way, and the limits that keep the walk inside the copy Job's memory and stack whatever the home holds.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Options {
    pub owner: Option<OwnerMap>,
    pub limits: Limits,
}

// UNIT_BOUNDARY_DESCRIPTION: the container's agent uid and gid, each rewritten to one machine id on every entry. The container ran the agent as the install's agent uid and gid, 65532 for both by default, and a machine's harness runs as root, so a home carried with its owners unchanged is one root does not own: git refuses every repository in it as of dubious ownership, and ssh refuses a config another user owns. Every other owner is kept as it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OwnerMap {
    pub uid: u32,
    pub gid: u32,
    pub to: u32,
}

impl OwnerMap {
    fn apply(&self, header: &mut tar::Header) -> io::Result<()> {
        if header.uid()? == u64::from(self.uid) {
            header.set_uid(u64::from(self.to));
        }
        if header.gid()? == u64::from(self.gid) {
            header.set_gid(u64::from(self.to));
        }
        Ok(())
    }
}

// UNIT_BOUNDARY_DESCRIPTION: how deep, how many entries and how many bytes of file data a seed may hold. The walk keeps one open directory per level and, for each file with several names, the name it was stored under, so without a bound a deep or wide tree would exhaust the copy Job's descriptors or memory rather than fail. A seed that passes one fails with a message that names the limit, because that message becomes the migration's, and as QuotaExceeded, because a fresh attempt at the same home passes it again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub depth: usize,
    pub entries: u64,
    pub bytes: Option<u64>,
    pub linked_names: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            depth: 256,
            entries: 20_000_000,
            bytes: None,
            linked_names: 64 << 20,
        }
    }
}

pub fn write_seed<W: Write>(home: &Path, options: &Options, into: W) -> io::Result<W> {
    let root = directory(home)?;
    let mut builder = tar::Builder::new(into);
    let mut walk = Walk {
        options,
        linked: HashMap::new(),
        linked_names: 0,
        entries: 0,
        bytes: 0,
    };
    walk.tree(&mut builder, home, Path::new("."), &root)?;
    builder.into_inner()
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

// UNIT_BOUNDARY_DESCRIPTION: what only the container used, which the seed leaves out. The runtime's env file holds what the platform last pushed into the container, credentials included, and the platform pushes it again when the machine's runtime first says hello, so carrying it would only keep stale credentials on the disk. The container's entrypoint swaps `~/.cache` for a link to the pod's local /tmp, which a machine empties on every boot; left out, the link gives way to a real directory in the home, so a machine keeps its caches.
const RUNTIME_ENV: &str = ".platform/runtime-env.json";
const CONTAINER_CACHE: &str = ".cache";
const CONTAINER_CACHE_TARGET: &str = "/tmp/agent-cache";

// UNIT_BOUNDARY_DESCRIPTION: the runtime's state file, carried without its record of the last desired state it applied. That record holds only beside the env file the seed leaves out, so a machine that kept it would tell the platform at its first hello that nothing is missing, and an agent image whose runtime predates that check would start its harness with no provider. The runs of events already handled stay, so none runs twice. A file too large or not the object the runtime writes is left out, and the runtime starts it afresh.
const RUNTIME_STATE: &str = ".platform/runtime-state.json";
const RUNTIME_STATE_MAX: u64 = 1 << 20;

fn runtime_state_without_cursor(from: &Path) -> Option<Vec<u8>> {
    if fs::metadata(from).ok()?.len() > RUNTIME_STATE_MAX {
        return None;
    }
    let mut state: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&fs::read(from).ok()?).ok()?;
    state.insert("lastAppliedVersion".into(), 0.into());
    state.insert("lastAppliedHash".into(), serde_json::Value::Null);
    serde_json::to_vec(&state).ok()
}

fn container_only(name: &Path, from: &Path, info: &fs::Metadata) -> bool {
    if name == Path::new(RUNTIME_ENV) {
        return true;
    }
    name == Path::new(CONTAINER_CACHE)
        && info.file_type().is_symlink()
        && fs::read_link(from).is_ok_and(|target| {
            target
                .components()
                .eq(Path::new(CONTAINER_CACHE_TARGET).components())
        })
}

struct Walk<'a> {
    options: &'a Options,
    linked: HashMap<(u64, u64), Linked>,
    linked_names: usize,
    entries: u64,
    bytes: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: the first name a file with several names was stored under, and how many of its other names the walk has not met yet. Once it has met them all the name is dropped, so memory holds only the links still open.
struct Linked {
    name: PathBuf,
    left: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: what one remembered name costs against Limits::linked_names beyond its own bytes: the map's share of the entry.
const LINKED_OVERHEAD: usize = 64;

impl Walk<'_> {
    // UNIT_BOUNDARY_DESCRIPTION: archives one tree, each directory before what it holds. The walk is a loop over a stack of open directories rather than a recursion, and reads each directory as a stream rather than listing it first, so neither the stack nor the heap grows with the shape of the home beyond Limits. Entries come in the order the filesystem lists them.
    fn tree<W: Write>(
        &mut self,
        builder: &mut tar::Builder<W>,
        from: &Path,
        name: &Path,
        info: &fs::Metadata,
    ) -> io::Result<()> {
        self.entry(builder, from, name, info)?;
        if !info.is_dir() {
            return Ok(());
        }
        let mut open = vec![(fs::read_dir(from)?, name.to_path_buf())];
        while let Some((listing, dir)) = open.last_mut() {
            let Some(next) = listing.next() else {
                open.pop();
                continue;
            };
            let next = next?;
            let named = if dir.as_path() == Path::new(".") {
                PathBuf::from(next.file_name())
            } else {
                dir.join(next.file_name())
            };
            let path = next.path();
            let child = fs::symlink_metadata(&path)?;
            if container_only(&named, &path, &child) {
                tracing::info!(path = %named.display(), "leaving out what only the container used");
                continue;
            }
            self.entry(builder, &path, &named, &child)?;
            if child.is_dir() {
                let depth = self.options.limits.depth;
                if open.len() >= depth {
                    return Err(io::Error::new(
                        io::ErrorKind::QuotaExceeded,
                        format!(
                            "the home is more than {depth} directories deep, deeper than a seed may go; the walk stopped at {}",
                            named.display()
                        ),
                    ));
                }
                open.push((fs::read_dir(&path)?, named));
            }
        }
        Ok(())
    }

    fn entry<W: Write>(
        &mut self,
        builder: &mut tar::Builder<W>,
        from: &Path,
        name: &Path,
        info: &fs::Metadata,
    ) -> io::Result<()> {
        self.entries += 1;
        let most = self.options.limits.entries;
        if self.entries > most {
            return Err(io::Error::new(io::ErrorKind::QuotaExceeded, format!(
                "the home holds more than {most} entries, more than a seed may carry; the walk stopped at {}",
                name.display()
            )));
        }
        let kind = info.file_type();
        let mut header = tar::Header::new_gnu();
        header.set_metadata_in_mode(info, tar::HeaderMode::Complete);
        if let Some(owner) = self.options.owner {
            owner.apply(&mut header)?;
        }
        if kind.is_symlink() {
            builder.append_link(&mut header, name, fs::read_link(from)?)?;
        } else if kind.is_dir() {
            builder.append_data(&mut header, name, io::empty())?;
        } else if kind.is_file() && name == Path::new(RUNTIME_STATE) {
            match runtime_state_without_cursor(from) {
                Some(state) => {
                    header.set_size(state.len() as u64);
                    builder.append_data(&mut header, name, state.as_slice())?;
                }
                None => {
                    tracing::warn!(path = %name.display(), "leaving out a runtime state the walk could not read")
                }
            }
        } else if kind.is_file() {
            self.file(builder, header, from, name, info)?;
        } else {
            tracing::warn!(path = %from.display(), "not archiving an entry that is neither a file, a directory nor a symlink");
        }
        Ok(())
    }

    fn file<W: Write>(
        &mut self,
        builder: &mut tar::Builder<W>,
        mut header: tar::Header,
        from: &Path,
        name: &Path,
        info: &fs::Metadata,
    ) -> io::Result<()> {
        let identity = (info.dev(), info.ino());
        if info.nlink() > 1 {
            if let Some(first) = self.linked.get_mut(&identity) {
                header.set_entry_type(tar::EntryType::Link);
                header.set_size(0);
                builder.append_link(&mut header, name, &first.name)?;
                first.left = first.left.saturating_sub(1);
                if first.left == 0 {
                    if let Some(done) = self.linked.remove(&identity) {
                        self.linked_names -= done.name.as_os_str().len() + LINKED_OVERHEAD;
                    }
                }
                return Ok(());
            }
        }
        let file = fs::File::open(from)?;
        let sparse = data_regions(&file, info).map_err(|e| {
            io::Error::new(
                e.kind(),
                format!("finding the holes in {}: {e}", from.display()),
            )
        })?;
        let regions = sparse.clone().unwrap_or_else(|| vec![(0, info.len())]);
        let stored: u64 = regions.iter().map(|(_, len)| len).sum();
        self.count(stored, name)?;
        let extensions = match &sparse {
            Some(regions) => sparse_header(&mut header, regions, stored, info.len()),
            None => Vec::new(),
        };
        let mut body = Counted {
            inner: Regions {
                file: &file,
                regions: &regions,
                at: 0,
                done: 0,
            },
            read: 0,
        };
        builder.append_data(
            &mut header,
            name,
            io::Cursor::new(extensions).chain(&mut body),
        )?;
        // UNIT_BOUNDARY_DESCRIPTION: the header was written with the size the file had when it was listed. A file that shrank since then leaves the archive shorter than its header says, which corrupts every entry after it, so the whole seed is refused rather than sent.
        if body.read != stored {
            return Err(io::Error::other(format!(
                "{} changed while it was archived",
                from.display()
            )));
        }
        if info.nlink() > 1 {
            self.linked_names += name.as_os_str().len() + LINKED_OVERHEAD;
            let most = self.options.limits.linked_names;
            if self.linked_names > most {
                return Err(io::Error::new(io::ErrorKind::QuotaExceeded, format!(
                    "the home has more files with several names than a seed can keep track of (more than {most} bytes of their names); the walk stopped at {}",
                    name.display()
                )));
            }
            self.linked.insert(
                identity,
                Linked {
                    name: name.to_path_buf(),
                    left: info.nlink() - 1,
                },
            );
        }
        Ok(())
    }

    fn count(&mut self, bytes: u64, name: &Path) -> io::Result<()> {
        self.bytes = self.bytes.saturating_add(bytes);
        match self.options.limits.bytes {
            Some(most) if self.bytes > most => Err(io::Error::new(io::ErrorKind::QuotaExceeded, format!(
                "the home holds more than {most} bytes of file data, more than the seed may carry; the walk stopped at {}",
                name.display()
            ))),
            _ => Ok(()),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the tar's 512-byte block. The reader refuses a sparse region that does not start on one, so region edges are rounded out to it.
const TAR_BLOCK: u64 = 512;

// UNIT_BOUNDARY_DESCRIPTION: holes smaller than this are stored as the zeros they read as, so a file with many small holes is stored with a few zeros rather than a map as long as its data.
const HOLE_MIN: u64 = 64 << 10;

// UNIT_BOUNDARY_DESCRIPTION: the most regions one sparse file may be stored in. The map is held in memory while the file is archived, so it is bounded like the rest of the walk.
const MAX_REGIONS: usize = 1 << 20;

// UNIT_BOUNDARY_DESCRIPTION: where a sparse file keeps its data, as offset and length pairs ending at its size, or None for a file with no holes. Only a file with fewer blocks than its size can have one, so a dense file costs no extra call. The last pair is a zero-length one at the size when the file ends in a hole, because that is how the format records the size.
fn data_regions(file: &fs::File, info: &fs::Metadata) -> io::Result<Option<Vec<(u64, u64)>>> {
    let size = info.len();
    if size == 0 || info.blocks().saturating_mul(TAR_BLOCK) >= size {
        return Ok(None);
    }
    let mut regions: Vec<(u64, u64)> = Vec::new();
    let mut at = 0;
    while at < size {
        let Some(start) = seek(file, at, libc::SEEK_DATA)? else {
            break;
        };
        let end = seek(file, start, libc::SEEK_HOLE)?
            .unwrap_or(size)
            .min(size);
        if end <= start {
            break;
        }
        let from = start - start % TAR_BLOCK;
        let to = end.div_ceil(TAR_BLOCK).saturating_mul(TAR_BLOCK).min(size);
        match regions.last_mut() {
            Some((offset, len)) if *offset + *len + HOLE_MIN >= from => {
                *len = to.max(*offset + *len) - *offset;
            }
            _ => regions.push((from, to - from)),
        }
        if regions.len() > MAX_REGIONS {
            return Err(io::Error::other(format!(
                "it has more than {MAX_REGIONS} separate regions of data"
            )));
        }
        at = end;
    }
    if regions
        .last()
        .is_none_or(|(offset, len)| offset + len < size)
    {
        regions.push((size, 0));
    }
    Ok(Some(regions))
}

fn seek(file: &fs::File, offset: u64, whence: libc::c_int) -> io::Result<Option<u64>> {
    let offset = libc::off_t::try_from(offset).map_err(io::Error::other)?;
    // SAFETY: lseek(2) reads no memory, and the descriptor belongs to the file this function borrows, so it stays open for the call.
    let at = unsafe { libc::lseek(file.as_raw_fd(), offset, whence) };
    if at < 0 {
        let e = io::Error::last_os_error();
        return match e.raw_os_error() {
            Some(libc::ENXIO) => Ok(None),
            _ => Err(e),
        };
    }
    Ok(u64::try_from(at).ok())
}

// UNIT_BOUNDARY_DESCRIPTION: turns a file's header into GNU's sparse form and answers with the extension blocks that must follow it. The header's size becomes the bytes stored, its real size the file's own; the first regions go in the header and the rest in extension blocks right after it, which is where platform-init's tar reader looks for them.
fn sparse_header(
    header: &mut tar::Header,
    regions: &[(u64, u64)],
    stored: u64,
    size: u64,
) -> Vec<u8> {
    header.set_entry_type(tar::EntryType::GNUSparse);
    header.set_size(stored);
    let mut rest = regions;
    if let Some(gnu) = header.as_gnu_mut() {
        gnu.set_real_size(size);
        let (first, others) = regions.split_at(regions.len().min(gnu.sparse.len()));
        for (slot, &(offset, len)) in gnu.sparse.iter_mut().zip(first) {
            slot.set_offset(offset);
            slot.set_length(len);
        }
        gnu.set_is_extended(!others.is_empty());
        rest = others;
    }
    let per_block = tar::GnuExtSparseHeader::new().sparse.len();
    let mut blocks = Vec::new();
    let mut chunks = rest.chunks(per_block).peekable();
    while let Some(chunk) = chunks.next() {
        let mut block = tar::GnuExtSparseHeader::new();
        for (slot, &(offset, len)) in block.sparse.iter_mut().zip(chunk) {
            slot.set_offset(offset);
            slot.set_length(len);
        }
        block.set_is_extended(chunks.peek().is_some());
        blocks.extend_from_slice(block.as_bytes());
    }
    blocks
}

// UNIT_BOUNDARY_DESCRIPTION: a file's regions read in order, by offset rather than through the file's position. A read that finds the file shorter than a region ends the stream early, which the caller's count turns into a refused seed.
struct Regions<'a> {
    file: &'a fs::File,
    regions: &'a [(u64, u64)],
    at: usize,
    done: u64,
}

impl Read for Regions<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        while let Some(&(offset, len)) = self.regions.get(self.at) {
            if self.done >= len {
                self.at += 1;
                self.done = 0;
                continue;
            }
            let want = buf
                .len()
                .min(usize::try_from(len - self.done).unwrap_or(usize::MAX));
            let n = self.file.read_at(&mut buf[..want], offset + self.done)?;
            self.done += n as u64;
            return Ok(n);
        }
        Ok(0)
    }
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

    type Found = (String, tar::EntryType, tar::Header, Vec<u8>);

    fn sorted_names(found: &[Found]) -> Vec<&str> {
        let mut names: Vec<&str> = found.iter().map(|(name, ..)| name.as_str()).collect();
        names.sort_unstable();
        names
    }

    fn named<'a>(found: &'a [Found], name: &str) -> &'a Found {
        found
            .iter()
            .find(|(n, ..)| n == name)
            .unwrap_or_else(|| panic!("{name} missing from {:?}", sorted_names(found)))
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

        assert_eq!(found[0].0, ".");
        assert_eq!(sorted_names(&found), vec![".", ".bashrc", "empty", "out"]);
        let (_, kind, header, body) = named(&found, ".bashrc");
        assert_eq!(*kind, tar::EntryType::Regular);
        assert_eq!(body, b"export A=1\n");
        assert_eq!(header.mode().unwrap() & 0o7777, 0o600);
        assert_eq!(header.uid().unwrap(), u64::from(info.uid()));
        assert_eq!(header.gid().unwrap(), u64::from(info.gid()));
        assert_eq!(header.mtime().unwrap(), info.mtime() as u64);
        assert_eq!(named(&found, "empty").1, tar::EntryType::Directory);
        let (_, kind, header, _) = named(&found, "out");
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

        let (first, _, _, body) = &found[1];
        assert_eq!(body, b"shared");
        let (second, kind, header, _) = &found[2];
        assert_eq!(*kind, tar::EntryType::Link);
        assert_ne!(first, second);
        assert_eq!(
            header.link_name().unwrap().unwrap(),
            Path::new(first.as_str())
        );
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

    fn seed_with(home: &Path, options: &Options) -> io::Result<Vec<u8>> {
        write_seed(home, options, Vec::new())
    }

    // TEST_SCENARIO: the container's agent owned the whole home, and a machine's harness runs as root, so a migration maps that one id to root as a uid and as a gid, on the home itself and on everything in it. An entry that belongs to anyone else keeps its owner.
    #[test]
    fn a_migration_gives_the_containers_agent_files_to_the_machines_user() {
        let home = TempDir::new("seed-owner");
        fs::write(home.path().join("repo"), b"x").unwrap();
        fs::write(home.path().join("theirs"), b"y").unwrap();
        let mine = fs::metadata(home.path().join("repo")).unwrap();
        let foreign = mine.uid().wrapping_add(1);
        let other_owner =
            std::os::unix::fs::chown(home.path().join("theirs"), Some(foreign), Some(foreign))
                .is_ok();
        let options = Options {
            owner: Some(OwnerMap {
                uid: mine.uid(),
                gid: mine.gid(),
                to: 4242,
            }),
            ..Options::default()
        };

        let found = entries(&seed_with(home.path(), &options).unwrap());

        for name in [".", "repo"] {
            let header = &named(&found, name).2;
            assert_eq!(header.uid().unwrap(), 4242, "{name}");
            assert_eq!(header.gid().unwrap(), 4242, "{name}");
        }
        if other_owner {
            let header = &named(&found, "theirs").2;
            assert_eq!(header.uid().unwrap(), u64::from(foreign));
            assert_eq!(header.gid().unwrap(), u64::from(foreign));
        }
    }

    // TEST_SCENARIO: a sparse file is stored as its data and a map of its holes, so a 64 MiB file that holds a few bytes costs the seed a few blocks rather than 64 MiB, and one with no data at all costs none. A file with more regions than the header has room for carries the rest in extension blocks. What the archive reads back is the file byte for byte, holes as zeros, at its full size.
    #[test]
    fn a_sparse_file_is_stored_as_its_data_and_its_holes() {
        let home = TempDir::new("seed-sparse");
        let size = 64 << 20;
        let empty = home.path().join("empty");
        fs::File::create(&empty).unwrap().set_len(size).unwrap();
        let holes = home.path().join("holes");
        let file = fs::File::create(&holes).unwrap();
        file.set_len(size).unwrap();
        let mut expected = vec![0u8; size as usize];
        for i in 0..6u64 {
            let at = i * (8 << 20) + 4096;
            file.write_all_at(b"data", at).unwrap();
            expected[at as usize..at as usize + 4].copy_from_slice(b"data");
        }
        drop(file);
        if fs::metadata(&holes).unwrap().blocks() * 512 >= size {
            return;
        }

        let tar = seed_with(home.path(), &Options::default()).unwrap();
        assert!(tar.len() < 1 << 20, "the seed is {} bytes", tar.len());
        let found = entries(&tar);

        let (_, kind, header, body) = named(&found, "empty");
        assert_eq!(*kind, tar::EntryType::GNUSparse);
        assert_eq!(header.entry_size().unwrap(), 0);
        assert_eq!(header.size().unwrap(), size);
        assert_eq!(body.len() as u64, size);
        assert!(body.iter().all(|b| *b == 0));
        let (_, kind, header, body) = named(&found, "holes");
        assert_eq!(*kind, tar::EntryType::GNUSparse);
        assert!(header.as_gnu().unwrap().is_extended());
        assert!(body == &expected, "the file did not read back as it was");
    }

    // TEST_SCENARIO: each bound the walk keeps fails the seed with a message that names it, rather than running the copy Job out of memory, descriptors or stack: a tree deeper than the depth limit, more entries than the entry limit, more file data than the byte limit, and more names of files with several names than the walk may remember.
    #[test]
    fn a_home_past_a_limit_fails_the_seed_with_a_message_that_names_it() {
        let home = TempDir::new("seed-limits");
        fs::create_dir_all(home.path().join("a/b/c")).unwrap();
        fs::write(home.path().join("a/file"), b"0123456789").unwrap();
        fs::hard_link(home.path().join("a/file"), home.path().join("a/other")).unwrap();
        let limited = |limits: Limits| Options {
            limits,
            ..Options::default()
        };
        for (limits, says) in [
            (
                Limits {
                    depth: 2,
                    ..Limits::default()
                },
                "the home is more than 2 directories deep",
            ),
            (
                Limits {
                    entries: 3,
                    ..Limits::default()
                },
                "more than 3 entries",
            ),
            (
                Limits {
                    bytes: Some(5),
                    ..Limits::default()
                },
                "more than 5 bytes of file data",
            ),
            (
                Limits {
                    linked_names: 8,
                    ..Limits::default()
                },
                "several names",
            ),
        ] {
            let err = seed_with(home.path(), &limited(limits)).unwrap_err();
            assert!(err.to_string().contains(says), "{limits:?}: {err}");
            assert_eq!(
                err.kind(),
                io::ErrorKind::QuotaExceeded,
                "{limits:?}: vm-seed tells a limit from a transient failure by its kind"
            );
        }
        assert!(seed_with(home.path(), &Options::default()).is_ok());
    }

    // TEST_SCENARIO: a migrated machine whose runtime kept the container's applied-state cursor would be pushed nothing at its first hello and start its harness with no provider, so the seed carries the runtime's state with the cursor cleared and its event runs kept, and leaves out a state file it cannot read.
    #[test]
    fn the_runtime_state_is_carried_without_its_cursor() {
        let carried = |state: &[u8]| {
            let home = TempDir::new("seed-runtime-state");
            fs::create_dir(home.path().join(".platform")).unwrap();
            fs::write(home.path().join(RUNTIME_STATE), state).unwrap();
            let found = entries(&write_tar(home.path(), Vec::new()).unwrap());
            found
                .iter()
                .find(|(name, ..)| name == RUNTIME_STATE)
                .map(|(.., body)| serde_json::from_slice::<serde_json::Value>(body).unwrap())
        };
        assert_eq!(
            carried(
                br#"{"lastAppliedVersion":7,"lastAppliedHash":"abc","eventRuns":{"sched-1":100}}"#
            ),
            Some(
                serde_json::json!({"lastAppliedVersion":0,"lastAppliedHash":null,"eventRuns":{"sched-1":100}})
            )
        );
        assert_eq!(carried(b"not json"), None);
    }

    // TEST_SCENARIO: what only the container used stays behind: the runtime's env file, which the platform pushes again, and the container's `~/.cache` link to its pod-local /tmp, which a machine would empty on every boot. The rest of `.platform`, a `.cache` that is a directory, and a `.cache` link the agent pointed somewhere else are the agent's own and are carried.
    #[test]
    fn what_only_the_container_used_is_left_out() {
        let with_cache = |name: &str, cache: &dyn Fn(&Path)| {
            let home = TempDir::new(name);
            fs::create_dir(home.path().join(".platform")).unwrap();
            fs::write(home.path().join(".platform/runtime-env.json"), b"{}").unwrap();
            fs::write(home.path().join(".platform/run-results.json"), b"{}").unwrap();
            cache(&home.path().join(".cache"));
            sorted_names(&entries(&write_tar(home.path(), Vec::new()).unwrap()))
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        };
        let kept = [".", ".platform", ".platform/run-results.json"];

        let names = with_cache("seed-cache-link", &|at| {
            std::os::unix::fs::symlink("/tmp/agent-cache", at).unwrap()
        });
        assert_eq!(names, kept);
        let names = with_cache("seed-cache-slash", &|at| {
            std::os::unix::fs::symlink("/tmp/agent-cache/", at).unwrap()
        });
        assert_eq!(names, kept);
        let names = with_cache("seed-cache-dir", &|at| fs::create_dir(at).unwrap());
        assert_eq!(
            names,
            [".", ".cache", ".platform", ".platform/run-results.json"]
        );
        let names = with_cache("seed-cache-elsewhere", &|at| {
            std::os::unix::fs::symlink("/somewhere", at).unwrap()
        });
        assert_eq!(
            names,
            [".", ".cache", ".platform", ".platform/run-results.json"]
        );
    }
}
