// UNIT_BOUNDARY_DESCRIPTION: sftp over the link, served from this machine's own files with no sftp-server in the image: OpenSSH's scp speaks sftp since 9.0, so this is what copies files in and out of a machine on any image. A relative path is the agent's home, as sftp-server resolves it from the home sshd starts it in. Every call runs on the blocking pool, since a read of a large file or a directory on a slow disk would otherwise stall the connection's other channels.
use std::collections::HashMap;
use std::fs;
use std::io;
use std::os::unix::fs::{FileExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use russh_sftp::protocol::{
    Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode, Version,
};

const READ_MAX: u32 = 256 << 10;
const NAMES_PER_REPLY: usize = 128;

enum Open {
    File(Arc<fs::File>),
    Dir(Option<Vec<File>>),
}

pub struct Files {
    home: PathBuf,
    open: HashMap<String, Open>,
    next: u64,
}

impl Files {
    pub fn new(home: PathBuf) -> Self {
        Self {
            home,
            open: HashMap::new(),
            next: 0,
        }
    }

    fn path(&self, path: &str) -> PathBuf {
        if path.is_empty() || path == "." {
            return self.home.clone();
        }
        let path = Path::new(path);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.home.join(path)
        }
    }

    fn keep(&mut self, open: Open) -> String {
        self.next += 1;
        let handle = self.next.to_string();
        self.open.insert(handle.clone(), open);
        handle
    }

    fn file(&self, handle: &str) -> Result<Arc<fs::File>, StatusCode> {
        match self.open.get(handle) {
            Some(Open::File(file)) => Ok(file.clone()),
            _ => Err(StatusCode::Failure),
        }
    }
}

fn status_of(e: io::Error) -> StatusCode {
    match e.kind() {
        io::ErrorKind::NotFound => StatusCode::NoSuchFile,
        io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
        _ => StatusCode::Failure,
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> Result<T, StatusCode> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| StatusCode::Failure)?
        .map_err(status_of)
}

fn ok(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".into(),
        language_tag: "en-US".into(),
    }
}

fn seconds(time: io::Result<std::time::SystemTime>) -> Option<u32> {
    let since = time.ok()?.duration_since(UNIX_EPOCH).ok()?;
    u32::try_from(since.as_secs()).ok()
}

fn attributes(metadata: &fs::Metadata) -> FileAttributes {
    FileAttributes {
        size: Some(metadata.len()),
        uid: Some(metadata.uid()),
        gid: Some(metadata.gid()),
        permissions: Some(metadata.mode()),
        atime: seconds(metadata.accessed()),
        mtime: seconds(metadata.modified()),
        ..FileAttributes::default()
    }
}

// UNIT_BOUNDARY_DESCRIPTION: applies what a SETSTAT names, in the order sftp-server applies it: size, mode, owner, then times. scp sets the mode and times of each file it copies.
fn apply(path: &Path, attrs: &FileAttributes) -> io::Result<()> {
    if let Some(size) = attrs.size {
        fs::OpenOptions::new()
            .write(true)
            .open(path)?
            .set_len(size)?;
    }
    if let Some(mode) = attrs.permissions {
        fs::set_permissions(path, fs::Permissions::from_mode(mode & 0o7777))?;
    }
    if attrs.uid.is_some() || attrs.gid.is_some() {
        std::os::unix::fs::chown(path, attrs.uid, attrs.gid)?;
    }
    if let (Some(atime), Some(mtime)) = (attrs.atime, attrs.mtime) {
        let at = |secs: u32| UNIX_EPOCH + Duration::from_secs(u64::from(secs));
        let times = fs::FileTimes::new()
            .set_accessed(at(atime))
            .set_modified(at(mtime));
        fs::File::options()
            .write(true)
            .open(path)
            .or_else(|_| fs::File::open(path))?
            .set_times(times)?;
    }
    Ok(())
}

fn listing(dir: &Path) -> io::Result<Vec<File>> {
    let mut files = Vec::new();
    for name in [".", ".."] {
        if let Ok(metadata) = fs::metadata(dir.join(name)) {
            files.push(File::new(name, attributes(&metadata)));
        }
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if let Ok(metadata) = entry.path().symlink_metadata() {
            files.push(File::new(
                entry.file_name().to_string_lossy(),
                attributes(&metadata),
            ));
        }
    }
    Ok(files)
}

impl russh_sftp::server::Handler for Files {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(
        &mut self,
        _version: u32,
        _extensions: HashMap<String, String>,
    ) -> Result<Version, Self::Error> {
        Ok(Version::new())
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        let path = self.path(&filename);
        let mode = attrs.permissions.map_or(0o666, |mode| mode & 0o7777);
        let file = blocking(move || {
            use std::os::unix::fs::OpenOptionsExt;
            let mut options = fs::OpenOptions::from(pflags);
            options.mode(mode).open(path)
        })
        .await?;
        let handle = self.keep(Open::File(Arc::new(file)));
        Ok(Handle { id, handle })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.open.remove(&handle);
        Ok(ok(id))
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
        let file = self.file(&handle)?;
        let data = blocking(move || {
            let mut data = vec![0; len.min(READ_MAX) as usize];
            let read = file.read_at(&mut data, offset)?;
            data.truncate(read);
            Ok(data)
        })
        .await?;
        if data.is_empty() {
            return Err(StatusCode::Eof);
        }
        Ok(Data { id, data })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, Self::Error> {
        let file = self.file(&handle)?;
        blocking(move || file.write_all_at(&data, offset)).await?;
        Ok(ok(id))
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let path = self.path(&path);
        let metadata = blocking(move || fs::symlink_metadata(path)).await?;
        Ok(Attrs {
            id,
            attrs: attributes(&metadata),
        })
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, Self::Error> {
        let file = self.file(&handle)?;
        let metadata = blocking(move || file.metadata()).await?;
        Ok(Attrs {
            id,
            attrs: attributes(&metadata),
        })
    }

    async fn setstat(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        let path = self.path(&path);
        blocking(move || apply(&path, &attrs)).await?;
        Ok(ok(id))
    }

    async fn fsetstat(
        &mut self,
        id: u32,
        handle: String,
        attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        let file = self.file(&handle)?;
        blocking(move || {
            if let Some(size) = attrs.size {
                file.set_len(size)?;
            }
            if let Some(mode) = attrs.permissions {
                file.set_permissions(fs::Permissions::from_mode(mode & 0o7777))?;
            }
            if attrs.uid.is_some() || attrs.gid.is_some() {
                std::os::unix::fs::fchown(file.as_ref(), attrs.uid, attrs.gid)?;
            }
            if let (Some(atime), Some(mtime)) = (attrs.atime, attrs.mtime) {
                let at = |secs: u32| UNIX_EPOCH + Duration::from_secs(u64::from(secs));
                file.set_times(
                    fs::FileTimes::new()
                        .set_accessed(at(atime))
                        .set_modified(at(mtime)),
                )?;
            }
            Ok(())
        })
        .await?;
        Ok(ok(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        let path = self.path(&path);
        let files = blocking(move || listing(&path)).await?;
        let handle = self.keep(Open::Dir(Some(files)));
        Ok(Handle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let Some(Open::Dir(listing)) = self.open.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        let Some(files) = listing.as_mut().filter(|files| !files.is_empty()) else {
            *listing = None;
            return Err(StatusCode::Eof);
        };
        let rest = files.split_off(files.len().min(NAMES_PER_REPLY));
        let batch = std::mem::replace(files, rest);
        Ok(Name { id, files: batch })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        let path = self.path(&filename);
        blocking(move || fs::remove_file(path)).await?;
        Ok(ok(id))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        let path = self.path(&path);
        let mode = attrs.permissions.map_or(0o777, |mode| mode & 0o7777);
        blocking(move || {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new().mode(mode).create(path)
        })
        .await?;
        Ok(ok(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        let path = self.path(&path);
        blocking(move || fs::remove_dir(path)).await?;
        Ok(ok(id))
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let path = self.path(&path);
        let resolved = blocking(move || Ok(fs::canonicalize(&path).unwrap_or(path))).await?;
        Ok(Name {
            id,
            files: vec![File::dummy(resolved.to_string_lossy())],
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let path = self.path(&path);
        let metadata = blocking(move || fs::metadata(path)).await?;
        Ok(Attrs {
            id,
            attrs: attributes(&metadata),
        })
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, Self::Error> {
        let (from, to) = (self.path(&oldpath), self.path(&newpath));
        blocking(move || fs::rename(from, to)).await?;
        Ok(ok(id))
    }

    async fn readlink(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let path = self.path(&path);
        let target = blocking(move || fs::read_link(path)).await?;
        Ok(Name {
            id,
            files: vec![File::dummy(target.to_string_lossy())],
        })
    }

    // UNIT_BOUNDARY_DESCRIPTION: OpenSSH sends SYMLINK's two paths in the opposite order to the draft it follows, target first, and every OpenSSH sftp-server reads them that way; the dialer is OpenSSH, so the first is the target and the second the link.
    async fn symlink(
        &mut self,
        id: u32,
        target: String,
        link: String,
    ) -> Result<Status, Self::Error> {
        let link = self.path(&link);
        blocking(move || std::os::unix::fs::symlink(target, link)).await?;
        Ok(ok(id))
    }
}
