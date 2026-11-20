// UNIT_BOUNDARY_DESCRIPTION: the mount the Agent sees: one directory of granted files Satellites, and under each, that Satellite's tree as its worker walks it, one operation at a time through the platform. It enforces nothing — every rule of what may be read or written is the api-server's and the worker's, under the grant and the worker's --write — and its own work is what has to be answered without the platform: the listing of the grants, the attributes of each Satellite's own directory, and the refusal of a Satellite the platform has not counted online, so `ls -l /mnt/sat` answers while every machine behind it is quiet. Every callback's body runs inside catch_unwind: a panic in a thread of PID 1 would take the machine's init with it, and the caller in the kernel would wait for a reply that never comes.
use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use fuser::{
    AccessFlags, BsdFileFlags, FileAttr, FileHandle, FileType, Filesystem, FopenFlags, INodeNo,
    InitFlags, KernelConfig, LockOwner, OpenAccMode, OpenFlags, RenameFlags, ReplyAttr,
    ReplyCreate, ReplyData, ReplyDirectory, ReplyEmpty, ReplyEntry, ReplyOpen, ReplyStatfs,
    ReplyWrite, ReplyXattr, Request, TimeOrNow, WriteFlags,
};
use serde_json::json;

use super::inodes::{self, Node};
use super::wire::{self, Attrs, Failure, Request as Op};
use super::State;

#[cfg(test)]
macro_rules! trace {
    ($($t:tt)*) => {
        super::trace::add(format!($($t)*))
    };
}
#[cfg(not(test))]
macro_rules! trace {
    ($($t:tt)*) => {};
}

pub struct SatelliteFs {
    state: Arc<State>,
}

impl SatelliteFs {
    pub fn new(state: Arc<State>) -> Self {
        Self { state }
    }

    fn node(&self, number: u64) -> Result<Node, Failure> {
        self.state.inodes().get(number).ok_or(Failure::Stale)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the entry a read, a write or a truncate acts on: the handle the kernel got from open, which carries the device and inode the file had then, or the inode number alone when the kernel sends no handle.
    fn node_of(&self, number: u64, handle: u64) -> Result<Node, Failure> {
        let held = self.state.inodes().handle(handle);
        match held {
            Some(node) => Ok(node),
            None => self.node(number),
        }
    }

    fn granted(&self, satellite: &str) -> Result<(), Failure> {
        if satellite.is_empty() || self.state.grant(satellite).is_some() {
            Ok(())
        } else {
            Err(Failure::NotFound)
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: the gate every relayed operation passes. A Satellite the platform counted offline or draining is answered EHOSTDOWN here, without waiting for the platform to refuse it, which is what makes a machine that went quiet say so at once instead of after a deadline; the grant is read again on every operation, so one whose grant was withdrawn answers ENOENT from the operation already in flight.
    fn online(&self, satellite: &str) -> Result<(), Failure> {
        self.granted(satellite)?;
        let online = satellite.is_empty()
            || self
                .state
                .grant(satellite)
                .is_some_and(|grant| grant.online);
        if online {
            Ok(())
        } else {
            Err(Failure::HostDown)
        }
    }

    fn relay(&self, node: &Node, op: Op, read_only: bool) -> Result<wire::Answer, Failure> {
        if node.satellite.is_empty() {
            return Err(Failure::NotPermitted);
        }
        self.online(&node.satellite)?;
        self.state
            .client
            .op(&self.state.config.agent, &node.satellite, &op, read_only)
    }

    fn intern(&self, satellite: &str, path: &str, attrs: &Attrs) -> (u64, u64) {
        self.state.inodes().intern(
            satellite,
            path,
            attrs.dev,
            attrs.ino,
            attrs.kind == wire::Kind::Other,
        )
    }

    fn remove(&self, parent: INodeNo, name: &OsStr, op: &'static str, reply: ReplyEmpty) {
        let found = caught(op, || {
            let parent = self.node(parent.0)?;
            let path = child(&parent, shown(name)?);
            self.relay(&parent, Op::at(op, &path), false)?.check()?;
            self.state.inodes().detach(&parent.satellite, &path);
            Ok(())
        });
        match found {
            Ok(()) => reply.ok(),
            Err(failure) => reply.error(failure.errno()),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one directory's entries as one call of the kernel may be given them: what the mount answers alone (`.` and `..`, and the grants, which are the mount's own listing) and, under a Satellite, the one operation that fetches the rest of that directory. The kernel's offset is the count of entries it has taken, so `.` and `..` are the first two of them and the platform's page starts at the offset less those two.
type Shown = Vec<(u64, FileType, String)>;

// UNIT_BOUNDARY_DESCRIPTION: the cookie one entry carries: the number of entries already handed to the kernel before it. A cookie that stayed inside the reply — restarting at three on the second one — would ask the kernel for the same window forever, which is a walk of a directory of more than a reply's worth of entries that never ends.
pub(super) fn cookie(offset: u64, index: usize) -> u64 {
    offset + index as u64 + 1
}

fn entries(fs: &SatelliteFs, node: &Node, offset: u64) -> Result<Shown, Failure> {
    let mut shown = Vec::new();
    if offset == 0 {
        let number = fs.state.inodes().place(&node.satellite, &node.path);
        shown.push((number, FileType::Directory, String::from(".")));
    }
    if offset <= 1 {
        let parent = match node.path.rsplit_once('/') {
            Some((parent, _)) => fs.state.inodes().place(&node.satellite, parent),
            None => inodes::ROOT,
        };
        shown.push((parent, FileType::Directory, String::from("..")));
    }
    let from = offset.saturating_sub(2);
    if node.satellite.is_empty() {
        for grant in fs.state.grants().iter().skip(from as usize) {
            let number = fs.state.inodes().place(&grant.name, "");
            shown.push((number, FileType::Directory, grant.name.clone()));
        }
        return Ok(shown);
    }
    fs.online(&node.satellite)?;
    let answer = fs.relay(
        node,
        Op::at("readdir", &node.path)
            .with("offset", json!(from))
            .with("limit", json!(wire::ENTRIES_MAX)),
        true,
    )?;
    for listed in answer.listing()?.entries {
        if !wire::name_is_valid(&listed.name) {
            continue;
        }
        let path = child(node, &listed.name);
        let (number, _) = fs.intern(&node.satellite, &path, &listed.attrs);
        shown.push((number, listed.attrs.kind.file_type(), listed.name));
    }
    Ok(shown)
}

fn child(node: &Node, name: &str) -> String {
    if node.path.is_empty() {
        name.to_string()
    } else {
        format!("{}/{name}", node.path)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: how deep a path lies below its Satellite's root, as the link rule counts it: a file in the root's own directory is zero below, one under `docs/notes` is two.
fn depth(path: &str) -> usize {
    if path.is_empty() {
        0
    } else {
        path.matches('/').count() + 1
    }
}

fn parent_path(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

fn millis(time: TimeOrNow) -> u64 {
    let at = match time {
        TimeOrNow::Now => SystemTime::now(),
        TimeOrNow::SpecificTime(at) => at,
    };
    at.duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
}

// UNIT_BOUNDARY_DESCRIPTION: an entry as the kernel is given it. Its owner is the process that asked, not the machine's root, so a harness running as a user an image made owns what it reads, and `git` does not refuse the tree as another user's; the permission bits lose setuid, setgid and sticky, which the mount does not present even though it is mounted nosuid. The block size is the channel's, so a copy of a large file is read and written in the mount's own units.
fn attr_of(number: u64, attrs: &Attrs, req: &Request) -> FileAttr {
    let directories = attrs.kind == wire::Kind::Dir;
    FileAttr {
        ino: INodeNo(number),
        size: attrs.size,
        blocks: attrs.size.div_ceil(512),
        atime: attrs.accessed(),
        mtime: attrs.modified(),
        ctime: attrs.changed(),
        crtime: UNIX_EPOCH,
        kind: attrs.kind.file_type(),
        perm: (attrs.mode & 0o777) as u16,
        nlink: if directories { 2 } else { 1 },
        uid: req.uid(),
        gid: req.gid(),
        rdev: 0,
        blksize: wire::BLOCK_SIZE,
        flags: 0,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: an entry the mount knows of without asking the platform: the mount's root and each Satellite's own directory, whose size and times are not a machine's to report, and an entry just created, of which the platform has told the mount nothing but that it did create it. Its inode number is the mount's own until the next lookup of that path records the platform's device and inode.
fn local_attr(number: u64, kind: FileType, size: u64, perm: u16, req: &Request) -> FileAttr {
    let now = SystemTime::now();
    FileAttr {
        ino: INodeNo(number),
        size,
        blocks: size.div_ceil(512),
        atime: now,
        mtime: now,
        ctime: now,
        crtime: UNIX_EPOCH,
        kind,
        perm,
        nlink: if kind == FileType::Directory { 2 } else { 1 },
        uid: req.uid(),
        gid: req.gid(),
        rdev: 0,
        blksize: wire::BLOCK_SIZE,
        flags: 0,
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a name the kernel asks for, as a directory entry may have it. A name that is not UTF-8 cannot travel on the channel at all, and one holding a separator would name two paths, so both are refused before the platform hears of them.
fn shown(name: &OsStr) -> Result<&str, Failure> {
    let name = std::str::from_utf8(name.as_bytes()).map_err(|_| Failure::Invalid)?;
    if wire::name_is_valid(name) {
        Ok(name)
    } else {
        Err(Failure::Invalid)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one callback body, and the errno it answers with if it panicked: EIO, which the Agent's command sees and can repeat, rather than a machine whose init died.
fn caught<T>(what: &str, body: impl FnOnce() -> Result<T, Failure>) -> Result<T, Failure> {
    super::guarded(what, body).unwrap_or(Err(Failure::Io))
}

impl Filesystem for SatelliteFs {
    fn init(&mut self, _req: &Request, config: &mut KernelConfig) -> std::io::Result<()> {
        let _ = config.set_max_write(wire::WRITE_MAX);
        let _ = config.add_capabilities(InitFlags::FUSE_AUTO_INVAL_DATA);
        Ok(())
    }

    fn lookup(&self, req: &Request, parent: INodeNo, name: &OsStr, reply: ReplyEntry) {
        let found = caught("lookup", || {
            let node = self.node(parent.0)?;
            let name = shown(name)?;
            if node.satellite.is_empty() {
                self.granted(name)?;
                let number = self.state.inodes().place(name, "");
                return Ok((local_attr(number, FileType::Directory, 4096, 0o755, req), 0));
            }
            let path = child(&node, name);
            let answer = self.relay(&node, Op::at("lookup", &path), true)?;
            let attrs = answer.attrs()?;
            let (number, generation) = self.intern(&node.satellite, &path, &attrs);
            Ok((attr_of(number, &attrs, req), generation))
        });
        match found {
            Ok((attr, generation)) => {
                reply.entry(&super::TTL, &attr, fuser::Generation(generation))
            }
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn getattr(&self, req: &Request, ino: INodeNo, _fh: Option<FileHandle>, reply: ReplyAttr) {
        let found = caught("getattr", || {
            let node = self.node(ino.0)?;
            if node.satellite.is_empty() {
                return Ok(local_attr(ino.0, FileType::Directory, 4096, 0o755, req));
            }
            if node.path.is_empty() {
                self.granted(&node.satellite)?;
                return Ok(local_attr(ino.0, FileType::Directory, 4096, 0o755, req));
            }
            let answer = self.relay(&node, Op::at("getattr", &node.path), true)?;
            let attrs = answer.attrs()?;
            let (number, _) = self.intern(&node.satellite, &node.path, &attrs);
            Ok(attr_of(number, &attrs, req))
        });
        match found {
            Ok(attr) => reply.attr(&super::TTL, &attr),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn setattr(
        &self,
        req: &Request,
        ino: INodeNo,
        mode: Option<u32>,
        uid: Option<u32>,
        gid: Option<u32>,
        size: Option<u64>,
        atime: Option<TimeOrNow>,
        mtime: Option<TimeOrNow>,
        _ctime: Option<SystemTime>,
        fh: Option<FileHandle>,
        _crtime: Option<SystemTime>,
        _chgtime: Option<SystemTime>,
        _bkuptime: Option<SystemTime>,
        _flags: Option<BsdFileFlags>,
        reply: ReplyAttr,
    ) {
        let found = caught("setattr", || {
            let node = self.node_of(ino.0, fh.map_or(0, |handle| handle.0))?;
            if uid.is_some_and(|uid| uid != req.uid()) || gid.is_some_and(|gid| gid != req.gid()) {
                return Err(Failure::NotPermitted);
            }
            // UNIT_BOUNDARY_DESCRIPTION: an entry the mount made itself, a directory just created, carries no device and inode until a lookup names them, and the channel refuses a change without them, so the identity is asked for first: `chmod` right after `mkdir` would otherwise be a 400.

            let node = if node.ino == 0 {
                let attrs = self
                    .relay(&node, Op::at("getattr", &node.path), true)?
                    .attrs()?;
                self.intern(&node.satellite, &node.path, &attrs);
                Node {
                    dev: attrs.dev,
                    ino: attrs.ino,
                    special: attrs.kind == wire::Kind::Other,
                    ..node
                }
            } else {
                node
            };
            let mut attrs = None;
            if let Some(size) = size {
                let answer = self.relay(
                    &node,
                    Op::at("truncate", &node.path)
                        .with("size", json!(size))
                        .with("dev", json!(node.dev))
                        .with("ino", json!(node.ino)),
                    false,
                )?;
                attrs = Some(answer.attrs()?);
            }
            if mode.is_some() || atime.is_some() || mtime.is_some() {
                let mut op = Op::at("setattr", &node.path)
                    .with("dev", json!(node.dev))
                    .with("ino", json!(node.ino));
                if let Some(mode) = mode {
                    op = op.with("mode", json!(mode & 0o777));
                }
                if let Some(atime) = atime {
                    op = op.with("atimeMs", json!(millis(atime)));
                }
                if let Some(mtime) = mtime {
                    op = op.with("mtimeMs", json!(millis(mtime)));
                }
                let answer = self.relay(&node, op, false)?;
                attrs = Some(answer.attrs()?);
            }
            let attrs = match attrs {
                Some(attrs) => attrs,
                None => self
                    .relay(&node, Op::at("getattr", &node.path), true)?
                    .attrs()?,
            };
            let (number, _) = self.intern(&node.satellite, &node.path, &attrs);
            Ok(attr_of(number, &attrs, req))
        });
        match found {
            Ok(attr) => reply.attr(&super::TTL, &attr),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn readlink(&self, _req: &Request, ino: INodeNo, reply: ReplyData) {
        let found = caught("readlink", || {
            let node = self.node(ino.0)?;
            let answer = self.relay(&node, Op::at("readlink", &node.path), true)?;
            let target = answer.target()?;
            if !wire::target_stays_inside(&target, depth(parent_path(&node.path))) {
                return Err(Failure::Access);
            }
            Ok(target)
        });
        match found {
            Ok(target) => reply.data(target.as_bytes()),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn open(&self, _req: &Request, ino: INodeNo, flags: OpenFlags, reply: ReplyOpen) {
        let found = caught("open", || {
            let node = self.node(ino.0)?;
            if node.path.is_empty() {
                return Err(Failure::IsDir);
            }
            if flags.acc_mode() == OpenAccMode::O_RDONLY {
                // UNIT_BOUNDARY_DESCRIPTION: a read open of a regular file is answered here, which is what keeps a walk of the tree off the channel; one of a special file is relayed instead, because the platform is the side that refuses its contents, and a local answer would report a FIFO as a readable, empty file that `cat` exits on happily.
                if !node.special {
                    return Ok((
                        self.state.inodes().open(&node),
                        FopenFlags::FOPEN_KEEP_CACHE,
                    ));
                }
                self.relay(
                    &node,
                    Op::at("open", &node.path)
                        .with("write", json!(false))
                        .with("dev", json!(node.dev))
                        .with("ino", json!(node.ino)),
                    true,
                )?
                .check()?;
                return Ok((self.state.inodes().open(&node), FopenFlags::empty()));
            }
            self.relay(
                &node,
                Op::at("open", &node.path)
                    .with("write", json!(true))
                    .with("dev", json!(node.dev))
                    .with("ino", json!(node.ino)),
                false,
            )?
            .check()?;
            Ok((self.state.inodes().open(&node), FopenFlags::empty()))
        });
        match found {
            Ok((handle, fopen)) => reply.opened(FileHandle(handle), fopen),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn read(
        &self,
        _req: &Request,
        ino: INodeNo,
        fh: FileHandle,
        offset: u64,
        size: u32,
        _flags: OpenFlags,
        _lock_owner: Option<LockOwner>,
        reply: ReplyData,
    ) {
        let found = caught("read", || {
            let node = self.node_of(ino.0, fh.0)?;
            let mut bytes = Vec::new();
            loop {
                let asked = size as usize - bytes.len();
                // UNIT_BOUNDARY_DESCRIPTION: a regular file's read that the kernel asks nothing of is its end, answered here; a special file is asked for once even then, because the mount may not decide that a FIFO has no contents to refuse — the platform is the side that says EPERM, and it can only say it to a request.
                let probe = node.special && bytes.is_empty();
                if asked == 0 && !probe {
                    break;
                }
                let want = asked.clamp(1, wire::READ_MAX as usize);
                let answer = self.relay(
                    &node,
                    Op::at("read", &node.path)
                        .with("offset", json!(offset + bytes.len() as u64))
                        .with("size", json!(want))
                        .with("dev", json!(node.dev))
                        .with("ino", json!(node.ino)),
                    true,
                )?;
                let chunk = answer.bytes()?;
                let short = chunk.len() < want;
                bytes.extend_from_slice(&chunk);
                if short {
                    break;
                }
            }
            Ok(bytes)
        });
        match found {
            Ok(bytes) => reply.data(&bytes),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn write(
        &self,
        _req: &Request,
        ino: INodeNo,
        fh: FileHandle,
        offset: u64,
        data: &[u8],
        _write_flags: WriteFlags,
        _flags: OpenFlags,
        _lock_owner: Option<LockOwner>,
        reply: ReplyWrite,
    ) {
        let found = caught("write", || {
            let node = self.node_of(ino.0, fh.0)?;
            for (index, chunk) in data.chunks(wire::WRITE_MAX as usize).enumerate() {
                let at = offset + (index * wire::WRITE_MAX as usize) as u64;
                self.relay(
                    &node,
                    Op::at("write", &node.path)
                        .with("offset", json!(at))
                        .with("dev", json!(node.dev))
                        .with("ino", json!(node.ino))
                        .data(chunk),
                    false,
                )?
                .check()?;
            }
            Ok(data.len() as u32)
        });
        match found {
            Ok(written) => reply.written(written),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn flush(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _fh: FileHandle,
        _lock_owner: LockOwner,
        reply: ReplyEmpty,
    ) {
        reply.ok();
    }

    fn fsync(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _fh: FileHandle,
        _datasync: bool,
        reply: ReplyEmpty,
    ) {
        reply.ok();
    }

    fn release(
        &self,
        _req: &Request,
        _ino: INodeNo,
        fh: FileHandle,
        _flags: OpenFlags,
        _lock_owner: Option<LockOwner>,
        _flush: bool,
        reply: ReplyEmpty,
    ) {
        self.state.inodes().close(fh.0);
        reply.ok();
    }

    fn opendir(&self, _req: &Request, _ino: INodeNo, _flags: OpenFlags, reply: ReplyOpen) {
        reply.opened(FileHandle(0), FopenFlags::empty());
    }

    fn readdir(
        &self,
        _req: &Request,
        ino: INodeNo,
        _fh: FileHandle,
        offset: u64,
        mut reply: ReplyDirectory,
    ) {
        let planned = caught("readdir", || {
            let node = self.node(ino.0)?;
            entries(self, &node, offset)
        });
        let shown = match planned {
            Ok(planned) => planned,
            Err(failure) => return reply.error(failure.errno()),
        };
        for (index, (number, kind, name)) in shown.into_iter().enumerate() {
            if reply.add(INodeNo(number), cookie(offset, index), kind, &name) {
                break;
            }
        }
        reply.ok();
    }

    fn releasedir(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _fh: FileHandle,
        _flags: OpenFlags,
        reply: ReplyEmpty,
    ) {
        reply.ok();
    }

    fn statfs(&self, _req: &Request, ino: INodeNo, reply: ReplyStatfs) {
        let found = caught("statfs", || {
            let node = self.node(ino.0)?;
            if node.satellite.is_empty() {
                return Ok(None);
            }
            let answer = self.relay(&node, Op::at("statfs", &node.path), true)?;
            Ok(Some(answer.stat()?))
        });
        match found {
            Ok(Some(stat)) => reply.statfs(
                stat.blocks,
                stat.bfree,
                stat.bavail,
                stat.files,
                stat.ffree,
                stat.bsize,
                255,
                stat.bsize,
            ),
            Ok(None) => reply.statfs(MOUNT_BLOCKS, MOUNT_FREE, MOUNT_FREE, 0, 0, 4096, 255, 4096),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn access(&self, _req: &Request, _ino: INodeNo, _mask: AccessFlags, reply: ReplyEmpty) {
        reply.ok();
    }

    fn create(
        &self,
        req: &Request,
        parent: INodeNo,
        name: &OsStr,
        mode: u32,
        _umask: u32,
        flags: i32,
        reply: ReplyCreate,
    ) {
        let found = caught("create", || {
            let parent = self.node(parent.0)?;
            let name = shown(name)?;
            let path = child(&parent, name);
            let exclusive = flags & libc::O_EXCL != 0;
            let answer = self.relay(
                &parent,
                Op::at("create", &path)
                    .with("mode", json!(mode & 0o777))
                    .with("exclusive", json!(exclusive)),
                false,
            )?;
            let attrs = answer.attrs()?;
            let (number, generation) = self.intern(&parent.satellite, &path, &attrs);
            let created = Node {
                satellite: parent.satellite.clone(),
                path,
                dev: attrs.dev,
                ino: attrs.ino,
                generation,
                special: attrs.kind == wire::Kind::Other,
            };
            let handle = self.state.inodes().open(&created);
            Ok((attr_of(number, &attrs, req), generation, handle))
        });
        match found {
            Ok((attr, generation, handle)) => reply.created(
                &super::TTL,
                &attr,
                fuser::Generation(generation),
                FileHandle(handle),
                FopenFlags::empty(),
            ),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn mkdir(
        &self,
        req: &Request,
        parent: INodeNo,
        name: &OsStr,
        mode: u32,
        _umask: u32,
        reply: ReplyEntry,
    ) {
        let found = caught("mkdir", || {
            let parent = self.node(parent.0)?;
            let path = child(&parent, shown(name)?);
            let answer = self.relay(
                &parent,
                Op::at("mkdir", &path).with("mode", json!(mode & 0o777)),
                false,
            )?;
            answer.check()?;
            match answer.attrs() {
                Ok(attrs) => {
                    let (number, generation) = self.intern(&parent.satellite, &path, &attrs);
                    Ok((attr_of(number, &attrs, req), generation))
                }
                Err(_) => {
                    let number = self.state.inodes().place(&parent.satellite, &path);
                    Ok((
                        local_attr(
                            number,
                            FileType::Directory,
                            4096,
                            (mode & 0o777) as u16,
                            req,
                        ),
                        0,
                    ))
                }
            }
        });
        match found {
            Ok((attr, generation)) => {
                reply.entry(&super::TTL, &attr, fuser::Generation(generation))
            }
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn rmdir(&self, _req: &Request, parent: INodeNo, name: &OsStr, reply: ReplyEmpty) {
        self.remove(parent, name, "rmdir", reply);
    }

    fn unlink(&self, _req: &Request, parent: INodeNo, name: &OsStr, reply: ReplyEmpty) {
        self.remove(parent, name, "unlink", reply);
    }

    fn symlink(
        &self,
        req: &Request,
        parent: INodeNo,
        link_name: &OsStr,
        target: &Path,
        reply: ReplyEntry,
    ) {
        trace!(
            "symlink CALLED parent_ino={} link_name={:?} target={:?}",
            parent.0,
            link_name,
            target
        );
        let found = caught("symlink", || {
            let parent = self.node(parent.0)?;
            // UNIT_BOUNDARY_DESCRIPTION: a read-only grant refuses a link with EROFS before the target is even looked at, which is what every other change on such a Satellite answers: `ln -s` must not report a rule about the target when the reason is that nothing under this Satellite may be written at all.
            if self
                .state
                .grant(&parent.satellite)
                .is_some_and(|grant| !grant.writable)
            {
                return Err(Failure::ReadOnly);
            }
            trace!(
                "symlink parent satellite={:?} path={:?} depth={}",
                parent.satellite,
                parent.path,
                depth(&parent.path)
            );
            let name = shown(link_name)?;
            let target = target.to_str().ok_or(Failure::NotPermitted)?;
            if !wire::target_stays_inside(target, depth(&parent.path)) {
                trace!("symlink REFUSED target={target:?} -> EPERM");
                return Err(Failure::NotPermitted);
            }
            let path = child(&parent, name);
            trace!("symlink RELAYING path={path:?} target={target:?}");
            let answer = self.relay(
                &parent,
                Op::at("symlink", &path).with("target", json!(target)),
                false,
            )?;
            answer.check()?;
            match answer.attrs() {
                Ok(attrs) => {
                    let (number, generation) = self.intern(&parent.satellite, &path, &attrs);
                    Ok((attr_of(number, &attrs, req), generation))
                }
                Err(_) => {
                    let number = self.state.inodes().place(&parent.satellite, &path);
                    Ok((
                        local_attr(number, FileType::Symlink, target.len() as u64, 0o777, req),
                        0,
                    ))
                }
            }
        });
        match found {
            Ok((attr, generation)) => {
                trace!("symlink REPLY ok");
                reply.entry(&super::TTL, &attr, fuser::Generation(generation))
            }
            Err(failure) => {
                trace!("symlink REPLY errno={:?}", failure.errno());
                reply.error(failure.errno())
            }
        }
    }

    fn rename(
        &self,
        _req: &Request,
        parent: INodeNo,
        name: &OsStr,
        newparent: INodeNo,
        newname: &OsStr,
        flags: RenameFlags,
        reply: ReplyEmpty,
    ) {
        // UNIT_BOUNDARY_DESCRIPTION: a rename that must not replace what it lands on, one that exchanges two names, and a whiteout are all answered as unimplemented rather than as a plain rename: `mv -n`, `mv -i` and `--backup` ask for the first, and a platform that overwrote anyway would destroy a file the Agent was told it would keep. The tools fall back to their own check and their own copy, which is correct rather than fast.
        if !flags.is_empty() {
            return reply.error(Failure::Unsupported.errno());
        }
        let found = caught("rename", || {
            let parent = self.node(parent.0)?;
            let newparent = self.node(newparent.0)?;
            inodes::rename_stays_put(&parent, &newparent)?;
            let from = child(&parent, shown(name)?);
            let to = child(&newparent, shown(newname)?);
            self.relay(
                &parent,
                Op::new("rename")
                    .with("from", json!(from))
                    .with("to", json!(to)),
                false,
            )?
            .check()?;
            let mut inodes = self.state.inodes();
            inodes.detach(&parent.satellite, &to);
            inodes.rename(&parent.satellite, &from, &to);
            Ok(())
        });
        match found {
            Ok(()) => reply.ok(),
            Err(failure) => reply.error(failure.errno()),
        }
    }

    fn mknod(
        &self,
        _req: &Request,
        _parent: INodeNo,
        _name: &OsStr,
        _mode: u32,
        _umask: u32,
        _rdev: u32,
        reply: ReplyEntry,
    ) {
        reply.error(Failure::NotPermitted.errno());
    }

    fn link(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _newparent: INodeNo,
        _newname: &OsStr,
        reply: ReplyEntry,
    ) {
        reply.error(Failure::NotPermitted.errno());
    }

    fn setxattr(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _name: &OsStr,
        _value: &[u8],
        _flags: i32,
        _position: u32,
        reply: ReplyEmpty,
    ) {
        reply.error(Failure::Unsupported.errno());
    }

    fn getxattr(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _name: &OsStr,
        _size: u32,
        reply: ReplyXattr,
    ) {
        reply.error(Failure::Unsupported.errno());
    }

    fn listxattr(&self, _req: &Request, _ino: INodeNo, _size: u32, reply: ReplyXattr) {
        reply.error(Failure::Unsupported.errno());
    }

    fn removexattr(&self, _req: &Request, _ino: INodeNo, _name: &OsStr, reply: ReplyEmpty) {
        reply.error(Failure::Unsupported.errno());
    }

    fn fallocate(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _fh: FileHandle,
        _offset: u64,
        _length: u64,
        _mode: i32,
        reply: ReplyEmpty,
    ) {
        reply.error(Failure::Unsupported.errno());
    }
}

// UNIT_BOUNDARY_DESCRIPTION: what the mount's own root reports as its size. Its entries live on as many machines as the Agent holds Satellites on, so its free space is no one machine's: `df /mnt/sat` names one plausible filesystem rather than no space at all, which would read as a full disk and stop a copy before it began. Everything under a Satellite reports that machine's own space, which the platform relays.
const MOUNT_BLOCKS: u64 = 1 << 26;
const MOUNT_FREE: u64 = 1 << 25;
