// UNIT_BOUNDARY_DESCRIPTION: the wire of the satellite file channel, as the platform answers it: one operation per POST body and one answer back. It is its own module because the two ends are built in different pull requests and read the same names, this mount as the client and the api-server as the server, so every name here is one the server has to accept. A body is JSON, file bytes are base64, and a path is always relative to its Satellite's root, which the empty string names, so nothing the mount sends can name a place outside the grant.
use base64::Engine;
use serde::Deserialize;

// UNIT_BOUNDARY_DESCRIPTION: the sizes that keep one operation inside what the platform accepts, each fixed by a different limit on the other side. A read carries at most 128 KiB, the api-server's own read cap; a write carries at most 1 MiB, which is what the kernel is told one write may be, and base64 of a mebibyte still fits the route's 1.5 MiB data field and its 2 MiB body, so a 100 MB copy is a hundred requests rather than eight hundred. A listing carries at most 256 entries, the api-server's window, so one directory of thousands is walked in several operations. Attributes report the write size as their block size, which is the unit the kernel then reads and writes a file of the mount in.
pub const READ_MAX: u32 = 128 << 10;
pub const WRITE_MAX: u32 = 1 << 20;
pub const ENTRIES_MAX: u32 = 256;
pub const BLOCK_SIZE: u32 = WRITE_MAX;

// UNIT_BOUNDARY_DESCRIPTION: one operation, as the api-server's route reads it: a discriminated union whose every field sits at the top of the document and no field is written that the operation does not name, because the route refuses an unknown key rather than dropping it. A path is relative to its Satellite's root, which the route will not carry as the empty string, so that root travels as ROOT_PATH; a write's bytes are base64 in `data`.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct Request(serde_json::Map<String, serde_json::Value>);

// UNIT_BOUNDARY_DESCRIPTION: how a Satellite's own root is named on the wire, which a path may not be empty to say. It is one constant because the worker that resolves it is built in another pull request: `.` is the root, and no other spelling of it is sent.
pub const ROOT_PATH: &str = ".";

impl Request {
    pub fn new(op: &'static str) -> Self {
        Self(serde_json::Map::from_iter([(
            String::from("op"),
            serde_json::Value::from(op),
        )]))
    }

    pub fn at(op: &'static str, path: &str) -> Self {
        let path = if path.is_empty() { ROOT_PATH } else { path };
        Self::new(op).with("path", serde_json::Value::from(path))
    }

    pub fn with(mut self, field: &str, value: serde_json::Value) -> Self {
        self.0.insert(field.to_string(), value);
        self
    }

    pub fn data(self, data: &[u8]) -> Self {
        self.with(
            "data",
            serde_json::Value::from(base64::engine::general_purpose::STANDARD.encode(data)),
        )
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one answer, whichever operation asked: a platform that could not do what was asked says why in a FUSE errno, which the mount passes on unchanged, and `ok:false` is how a refused write arrives under HTTP 200, so every caller checks it before reading `result`. `result` holds what the operation returns, as attributes, a listing, a link's target or a filesystem's statistics, and `data` holds the bytes of a read.
#[derive(Debug, Deserialize)]
pub struct Answer {
    pub ok: bool,
    #[serde(default)]
    pub errno: Option<String>,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub data: Option<String>,
}

impl Answer {
    pub fn check(&self) -> Result<(), Failure> {
        if self.ok {
            Ok(())
        } else {
            Err(Failure::named(self.errno.as_deref()))
        }
    }

    fn result<T: serde::de::DeserializeOwned>(&self) -> Result<T, Failure> {
        self.check()?;
        let value = self.result.clone().unwrap_or(serde_json::Value::Null);
        serde_json::from_value(value).map_err(|_| Failure::Io)
    }

    pub fn attrs(&self) -> Result<Attrs, Failure> {
        self.result()
    }

    pub fn listing(&self) -> Result<Listing, Failure> {
        self.result()
    }

    pub fn target(&self) -> Result<String, Failure> {
        let target: Target = self.result()?;
        Ok(target.target)
    }

    pub fn stat(&self) -> Result<Stat, Failure> {
        self.result()
    }

    pub fn bytes(&self) -> Result<Vec<u8>, Failure> {
        self.check()?;
        let data = self.data.as_deref().unwrap_or_default();
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| Failure::Io)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one file's attributes as the platform reports them: its kind, size, permission bits, the platform's own device and inode identity, and its three times in milliseconds since the epoch, which is what JavaScript's Date carries. A link's target is not among them: the mount asks readlink for it, so the one place a target is checked is the one place it is shown.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attrs {
    pub kind: Kind,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub mode: u32,
    #[serde(default)]
    pub dev: u64,
    #[serde(default)]
    pub ino: u64,
    #[serde(default)]
    pub mtime_ms: Option<f64>,
    #[serde(default)]
    pub ctime_ms: Option<f64>,
    #[serde(default)]
    pub atime_ms: Option<f64>,
}

impl Attrs {
    // UNIT_BOUNDARY_DESCRIPTION: a file's times. A worker that reports only the modification time answers for all three, which is what a filesystem without ctime or atime does: a stale stamp costs a cache that expires sooner or later than it should, and an attribute the mount reported as the epoch would make every file look older than the kernel's own caches expect.
    pub fn modified(&self) -> std::time::SystemTime {
        self.mtime_ms.map_or(std::time::UNIX_EPOCH, time)
    }

    pub fn changed(&self) -> std::time::SystemTime {
        self.ctime_ms
            .or(self.mtime_ms)
            .map_or(std::time::UNIX_EPOCH, time)
    }

    pub fn accessed(&self) -> std::time::SystemTime {
        self.atime_ms
            .or(self.mtime_ms)
            .map_or(std::time::UNIX_EPOCH, time)
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a millisecond count as a time. A platform that reports no time, zero or a negative one, and a value that is not a number at all, all read as the epoch rather than as an error: a wrong stamp on a file is a cache that expires sooner or later than it should, not a file that cannot be read.
fn time(milliseconds: f64) -> std::time::SystemTime {
    std::time::UNIX_EPOCH + std::time::Duration::from_millis(milliseconds.max(0.0) as u64)
}

// UNIT_BOUNDARY_DESCRIPTION: what a path names, as the platform names it, and the file type the kernel is shown. The platform calls a symbolic link `link`, so that is its name on the wire, and a link is presented as one: `find -type l` and `ls -l` see what the machine holds, and only the target is withheld from a link that leaves the root. A kind the mount does not know — a FIFO, a socket or a device — is presented as a regular file, which is the one shape that keeps every open and read of it on the channel: listed and stat-able, and refused by the worker with EPERM when its contents are asked for, where a pipe would let the guest's own kernel answer the open and block until a writer came. The cost is that `find -type f` counts it, since the channel has no way to say "special" and a mount may not behave differently from what it showed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Dir,
    #[serde(rename = "link")]
    Symlink,
    #[serde(other)]
    Other,
}

impl Kind {
    pub fn file_type(self) -> fuser::FileType {
        match self {
            Self::File => fuser::FileType::RegularFile,
            Self::Dir => fuser::FileType::Directory,
            Self::Symlink => fuser::FileType::Symlink,
            Self::Other => fuser::FileType::RegularFile,
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one directory's page of entries. The page's `next` is not read: the offset this mount resumes at is the number of entries it has already shown, counted here as they go to the kernel, because a reply that fills before the page does leaves no per-entry cursor to carry back. A worker must therefore count positions, with `next` = offset + entries.len(), which is the one shape a mount can resume with.
#[derive(Debug, Deserialize)]
pub struct Listing {
    #[serde(default)]
    pub entries: Vec<Listed>,
}

#[derive(Debug, Deserialize)]
pub struct Listed {
    pub name: String,
    #[serde(flatten)]
    pub attrs: Attrs,
}

#[derive(Debug, Deserialize)]
struct Target {
    target: String,
}

#[derive(Debug, Deserialize)]
pub struct Stat {
    #[serde(default)]
    pub bsize: u32,
    #[serde(default)]
    pub blocks: u64,
    #[serde(default)]
    pub bfree: u64,
    #[serde(default)]
    pub bavail: u64,
    #[serde(default)]
    pub files: u64,
    #[serde(default)]
    pub ffree: u64,
}

// UNIT_BOUNDARY_DESCRIPTION: everything this mount can be told, as the FUSE error it becomes. The set is the one the channel answers with, so a refusal the platform states arrives at the Agent's command as the same errno a local file would give; a name outside the set reads as EIO, since a rule the platform enforces may not be dropped on the way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    NotFound,
    Access,
    ReadOnly,
    NotPermitted,
    Stale,
    HostDown,
    Io,
    NotDir,
    IsDir,
    Exists,
    NotEmpty,
    NoSpace,
    CrossDevice,
    Unsupported,
    Busy,
    Invalid,
    TooLong,
}

impl Failure {
    pub fn named(errno: Option<&str>) -> Self {
        match errno {
            Some("ENOENT") => Self::NotFound,
            Some("EACCES") => Self::Access,
            Some("EROFS") => Self::ReadOnly,
            Some("EPERM") => Self::NotPermitted,
            Some("ESTALE") => Self::Stale,
            Some("EHOSTDOWN") => Self::HostDown,
            Some("ENOTDIR") => Self::NotDir,
            Some("EISDIR") => Self::IsDir,
            Some("EEXIST") => Self::Exists,
            Some("ENOTEMPTY") => Self::NotEmpty,
            Some("ENOSPC") => Self::NoSpace,
            Some("EXDEV") => Self::CrossDevice,
            Some("ENOTSUP") => Self::Unsupported,
            Some("EBUSY") => Self::Busy,
            Some("EINVAL") => Self::Invalid,
            Some("ENAMETOOLONG") => Self::TooLong,
            _ => Self::Io,
        }
    }

    pub fn status(code: u16) -> Self {
        match code {
            400 => Self::Invalid,
            403 => Self::Access,
            404 => Self::NotFound,
            503 => Self::HostDown,
            _ => Self::Io,
        }
    }

    pub fn errno(self) -> fuser::Errno {
        use fuser::Errno;
        match self {
            Self::NotFound => Errno::ENOENT,
            Self::Access => Errno::EACCES,
            Self::ReadOnly => Errno::EROFS,
            Self::NotPermitted => Errno::EPERM,
            Self::Stale => Errno::ESTALE,
            Self::HostDown => Errno::EHOSTDOWN,
            Self::Io => Errno::EIO,
            Self::NotDir => Errno::ENOTDIR,
            Self::IsDir => Errno::EISDIR,
            Self::Exists => Errno::EEXIST,
            Self::NotEmpty => Errno::ENOTEMPTY,
            Self::NoSpace => Errno::ENOSPC,
            Self::CrossDevice => Errno::EXDEV,
            Self::Unsupported => Errno::ENOTSUP,
            Self::Busy => Errno::EBUSY,
            Self::Invalid => Errno::EINVAL,
            Self::TooLong => Errno::ENAMETOOLONG,
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the errno a refused request names in its body, whatever its status: the api-server answers 403 EACCES, 503 EHOSTDOWN, 400 EINVAL and 200 EROFS, so the errno is read from the document before the status is looked at, and the status only speaks for a refusal that came from something in front of the route.
#[derive(Debug, Deserialize)]
pub struct Refusal {
    #[serde(default)]
    pub errno: Option<String>,
}

// UNIT_BOUNDARY_DESCRIPTION: one Satellite as the platform grants it: its name, whether its worker was started with --write, and whether the platform counted it online. The name is a directory name in the mount, so a name the mount could not show is dropped where the list is read, before it can reach the kernel.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Grant {
    pub name: String,
    #[serde(default)]
    pub writable: bool,
    #[serde(default)]
    pub online: bool,
}

#[derive(Debug, Deserialize)]
pub struct GrantList {
    #[serde(default)]
    pub satellites: Vec<Grant>,
}

// UNIT_BOUNDARY_DESCRIPTION: the one name a directory entry may have. It is checked on every name the platform sends and on every name the kernel asks for, because a name is what the two sides disagree about most easily: `..` in a listing would leave the Satellite's tree inside the kernel's own dentry cache, and a `/` in a name would make one operation name two paths.
pub fn name_is_valid(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\0'])
}

// UNIT_BOUNDARY_DESCRIPTION: whether a symbolic link's target stays inside its Satellite. The rule is the worker's, and the mount answers with it before the platform is asked: a relative target of zero or more leading `..` and then plain names, with no more `..` than the link's own directory lies below the root, so the link resolves inside the tree even through other links of the same shape. `depth` is the link's directory below its Satellite's root, which the root itself is zero below. A target anywhere else is refused, so the mount never makes or shows a way out of the grant.
pub fn target_stays_inside(target: &str, depth: usize) -> bool {
    if target.is_empty() {
        return false;
    }
    let mut climbing = true;
    let mut up = 0;
    for part in target.split('/') {
        if part.is_empty() || part == "." || part.contains('\0') {
            return false;
        }
        if part == ".." {
            if !climbing {
                return false;
            }
            up += 1;
            if up > depth {
                return false;
            }
        } else {
            climbing = false;
        }
    }
    true
}

// UNIT_BOUNDARY_DESCRIPTION: what a new grant list takes away, as the two things it can mean. A Satellite that was online and no longer is has gone quiet: the kernel must drop what it cached of it, because a file it answers from its page cache would otherwise keep the bytes it read before the machine went quiet, but the mount keeps the numbers of its tree, since a process whose working directory is inside it must still have one when the machine answers again. A Satellite whose grant is gone is forgotten whole: what it names is not there to come back. A list that repeats an offline Satellite names nothing, and one that comes back needs nothing, because nothing of it was left cached.
pub struct Withdrawn {
    pub quiet: Vec<String>,
    pub gone: Vec<String>,
}

pub fn withdrawn(before: &[Grant], after: &[Grant]) -> Withdrawn {
    let mut withdrawn = Withdrawn {
        quiet: Vec::new(),
        gone: Vec::new(),
    };
    for old in before {
        match after.iter().find(|new| new.name == old.name) {
            None => withdrawn.gone.push(old.name.clone()),
            Some(new) if old.online && !new.online => withdrawn.quiet.push(old.name.clone()),
            Some(_) => {}
        }
    }
    withdrawn
}
