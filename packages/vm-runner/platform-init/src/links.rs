// UNIT_BOUNDARY_DESCRIPTION: puts each persisted path a runtime migration moved below HOME back at its old place, on every boot, before the image's entrypoint. The guest's root is fresh each boot, so /data has to be made again each time, and it points at HOME/.persisted/data, where its data lives. The plan comes from the share, which the runner writes and the guest cannot, and platform-init does all of the work itself: nothing in the home is run and no shell is needed, so an image with no shell works too. The home is the agent's to write and the root is the image's, so every step is taken below an open directory and never follows a symlink: a link the agent planted in its home, or one the image ships on the way to a moved path, is refused rather than followed.
use std::ffi::{CString, OsStr, OsString};
use std::fs;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

use crate::guest;

// UNIT_BOUNDARY_DESCRIPTION: guest paths the platform lays out or the kernel owns, beside HOME. A moved path at one of them, inside one or above one would replace it at boot. The api-server refuses to move such a path, and this list is the same one, so a plan that got past it anyway is refused here too rather than acted on as root.
const LAID_OUT: [&str; 9] = [
    "/proc",
    "/sys",
    "/dev",
    guest::SHARE_PATH,
    guest::DISK_PATH,
    guest::DISK_DEVICE_PATH,
    "/storage",
    "/etc/platform",
    "/var/cache/platform",
];

// UNIT_BOUNDARY_DESCRIPTION: the plan as the share holds it, one path per line. A share with no plan is a machine nothing was moved into.
pub fn read_plan(file: &Path) -> io::Result<Vec<PathBuf>> {
    match fs::read(file) {
        Ok(body) => Ok(body
            .split(|b| *b == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| PathBuf::from(OsStr::from_bytes(line)))
            .collect()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: what was done at one moved path. A link is what the path normally becomes, so `ls -l` shows where the data lives. Where the image ships content at the path, the data is mounted over it instead, hiding the image's copy as the container's volume did; replacing it would lose what the image put there, and leaving it would have the agent write to the fresh root and lose it at the next stop. A path below another moved path is reached through that one's link or mount and is not touched.
#[derive(Debug, PartialEq, Eq)]
pub enum Placed {
    Linked,
    AlreadyLinked,
    MountedOver,
    AlreadyMounted,
    ThroughParent(PathBuf),
}

impl std::fmt::Display for Placed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Placed::Linked => f.write_str("linked into the home"),
            Placed::AlreadyLinked => f.write_str("already linked into the home"),
            Placed::MountedOver => f.write_str(
                "the image ships content there, so the home's copy is mounted over it and the image's is hidden",
            ),
            Placed::AlreadyMounted => f.write_str("the home's copy is already mounted there"),
            Placed::ThroughParent(parent) => {
                write!(f, "reached through {}", parent.display())
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one moved path and what was done at it, or why nothing could be.
pub type Outcome = (PathBuf, Result<Placed, String>);

// UNIT_BOUNDARY_DESCRIPTION: mounts the first directory over the second. Passed in, because a mount needs a guest and everything else here is ordinary file work the tests cover.
pub type MountOver<'a> = dyn FnMut(&OwnedFd, &OwnedFd) -> io::Result<()> + 'a;

// UNIT_BOUNDARY_DESCRIPTION: applies the whole plan below `root`, which is `/` in a guest. Every path gets its own outcome and one that fails does not stop the others, so the console names every path that could not be placed. Parents go before children, and a directory in the home that a moved path needs is made with the home's owner, so the agent's user can write to it.
pub fn apply(
    root: &Path,
    home: &Path,
    plan: &[PathBuf],
    mount_over: &mut MountOver<'_>,
) -> Vec<Outcome> {
    let mut sorted = plan.to_vec();
    sorted.sort();
    sorted.dedup();
    let home_fd = open_path(root, home);
    sorted
        .iter()
        .map(|path| {
            let outcome = match &home_fd {
                Ok((fd, owner)) => place(root, home, fd, *owner, &sorted, path),
                Err(why) => Err(why.clone()),
            };
            let outcome = match outcome {
                Ok(Step::Mount { data, image }) => mount_over(&data, &image)
                    .map(|()| Placed::MountedOver)
                    .map_err(|e| format!("mounting the home's copy over the image's: {e}")),
                Ok(Step::Done(placed)) => Ok(placed),
                Err(why) => Err(why),
            };
            (path.clone(), outcome)
        })
        .collect()
}

enum Step {
    Done(Placed),
    Mount { data: OwnedFd, image: OwnedFd },
}

fn open_path(root: &Path, home: &Path) -> Result<(OwnedFd, (u32, u32)), String> {
    let mut fd = open_root(root).map_err(|e| format!("opening {}: {e}", root.display()))?;
    for part in normal_parts(home) {
        fd = step(&fd, part, None)
            .map_err(|e| format!("reaching the home at {}: {e}", home.display()))?;
    }
    let info = fs::File::from(
        fd.try_clone()
            .map_err(|e| format!("reading the home's owner: {e}"))?,
    )
    .metadata()
    .map_err(|e| format!("reading the home's owner: {e}"))?;
    Ok((fd, (info.uid(), info.gid())))
}

fn place(
    root: &Path,
    home: &Path,
    home_fd: &OwnedFd,
    owner: (u32, u32),
    plan: &[PathBuf],
    path: &Path,
) -> Result<Step, String> {
    if let Some(why) = refusal(path, home) {
        return Err(format!("not a path this machine can put back: {why}"));
    }
    let data = data_dir(home_fd, owner, path)?;
    if let Some(parent) = plan
        .iter()
        .find(|p| p.as_path() != path && path.starts_with(p))
    {
        return Ok(Step::Done(Placed::ThroughParent(parent.clone())));
    }
    let link = home.join(guest::PERSISTED_DIR).join(relative(path));
    let root_fd = open_root(root).map_err(|e| format!("opening {}: {e}", root.display()))?;
    let parts: Vec<&OsStr> = normal_parts(path).collect();
    let (name, above) = parts
        .split_last()
        .ok_or_else(|| String::from("it names the root"))?;
    let mut parent = root_fd;
    let mut reached = PathBuf::from("/");
    for part in above {
        reached.push(part);
        parent = step(&parent, part, Some((None, 0o755))).map_err(|e| {
            format!(
                "{} on the way to it is not a directory of the image ({e}); a link there is not followed",
                reached.display()
            )
        })?;
    }
    at_place(&parent, name, &link, data)
}

fn at_place(parent: &OwnedFd, name: &OsStr, link: &Path, data: OwnedFd) -> Result<Step, String> {
    let found = match lstat_at(parent, name) {
        Ok(found) => found,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            symlink_at(link, parent, name).map_err(|e| format!("making the link: {e}"))?;
            return Ok(Step::Done(Placed::Linked));
        }
        Err(e) => return Err(format!("reading what the image has there: {e}")),
    };
    match found.st_mode & libc::S_IFMT {
        libc::S_IFLNK => {
            let current = readlink_at(parent, name)
                .map_err(|e| format!("reading the image's link there: {e}"))?;
            if current == link.as_os_str() {
                return Ok(Step::Done(Placed::AlreadyLinked));
            }
            if !dangles(parent, name) {
                return Err(format!(
                    "the image has a link there to {}, which is left as it is",
                    Path::new(&current).display()
                ));
            }
            unlink_at(parent, name, 0).map_err(|e| format!("removing a dangling link: {e}"))?;
            symlink_at(link, parent, name).map_err(|e| format!("making the link: {e}"))?;
            Ok(Step::Done(Placed::Linked))
        }
        libc::S_IFDIR => {
            let image = open_below(parent, name, dir_flags())
                .map_err(|e| format!("opening the image's directory there: {e}"))?;
            if let (Some(image_id), Some(data_id)) = (identity(&image), identity(&data)) {
                if image_id == data_id {
                    return Ok(Step::Done(Placed::AlreadyMounted));
                }
            }
            if !is_empty(&image).map_err(|e| format!("listing the image's directory: {e}"))? {
                return Ok(Step::Mount { data, image });
            }
            drop(image);
            unlink_at(parent, name, libc::AT_REMOVEDIR)
                .map_err(|e| format!("removing the image's empty directory: {e}"))?;
            symlink_at(link, parent, name).map_err(|e| format!("making the link: {e}"))?;
            Ok(Step::Done(Placed::Linked))
        }
        _ => Err(String::from(
            "the image has a file there that is neither a directory nor a link, which is left as it is",
        )),
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the directory in the home that a moved path's data lives in, made when it is missing — a moved path the container never made a volume for starts empty, as it would have in a fresh pod. Each step is a real directory of the home or the path is refused: a symlink the agent put at `.persisted` or below would otherwise send the link, or a mount made as root, wherever it points.
fn data_dir(home_fd: &OwnedFd, owner: (u32, u32), path: &Path) -> Result<OwnedFd, String> {
    let mut fd = home_fd
        .try_clone()
        .map_err(|e| format!("reopening the home: {e}"))?;
    let mut reached = PathBuf::from(guest::PERSISTED_DIR);
    fd = step(
        &fd,
        OsStr::new(guest::PERSISTED_DIR),
        Some((Some(owner), 0o755)),
    )
    .map_err(|e| in_home(&reached, &e))?;
    for part in normal_parts(path) {
        reached.push(part);
        fd = step(&fd, part, Some((Some(owner), 0o755))).map_err(|e| in_home(&reached, &e))?;
    }
    Ok(fd)
}

fn in_home(reached: &Path, e: &io::Error) -> String {
    format!(
        "HOME/{} is not a directory of the home ({e}); a link there is not followed",
        reached.display()
    )
}

// UNIT_BOUNDARY_DESCRIPTION: why a path cannot be put back, or none. The same rule the api-server applies before it moves a path: a plain absolute path, not the root, and neither inside nor above HOME or anything the platform lays out.
fn refusal(path: &Path, home: &Path) -> Option<String> {
    let bytes = path.as_os_str().as_bytes();
    let plain = bytes.first() == Some(&b'/')
        && bytes.len() > 1
        && bytes[1..]
            .split(|b| *b == b'/')
            .all(|part| !part.is_empty() && part != b"." && part != b"..");
    if !plain {
        return Some(String::from("it is not a plain absolute path"));
    }
    let home = home.to_string_lossy();
    for kept in std::iter::once(home.as_ref()).chain(LAID_OUT) {
        let kept = Path::new(kept);
        if path.starts_with(kept) || kept.starts_with(path) {
            return Some(format!(
                "it would hide or sit inside {}, which the platform lays out itself",
                kept.display()
            ));
        }
    }
    None
}

fn normal_parts(path: &Path) -> impl Iterator<Item = &OsStr> {
    path.components().filter_map(|c| match c {
        Component::Normal(part) => Some(part),
        _ => None,
    })
}

fn relative(path: &Path) -> PathBuf {
    normal_parts(path).collect()
}

fn dir_flags() -> libc::c_int {
    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC
}

fn open_root(root: &Path) -> io::Result<OwnedFd> {
    let root = cstring(root.as_os_str())?;
    // SAFETY: open(2) reads the NUL-terminated path, which outlives the call; the descriptor it returns is owned by nobody else.
    let fd = unsafe { libc::open(root.as_ptr(), dir_flags()) };
    owned(fd)
}

// UNIT_BOUNDARY_DESCRIPTION: opens the directory `name` below `at` without following a symlink there. With `create`, a missing one is made first, with the owner and mode given; a directory made by anything but this boot is taken as it is.
fn step(
    at: &OwnedFd,
    name: &OsStr,
    create: Option<(Option<(u32, u32)>, libc::mode_t)>,
) -> io::Result<OwnedFd> {
    match open_below(at, name, dir_flags()) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            let Some((owner, mode)) = create else {
                return Err(e);
            };
            let c_name = cstring(name)?;
            // SAFETY: mkdirat(2) reads the NUL-terminated name, which outlives the call.
            let made = unsafe { libc::mkdirat(at.as_raw_fd(), c_name.as_ptr(), mode) };
            if made < 0 {
                let e = io::Error::last_os_error();
                if e.kind() != io::ErrorKind::AlreadyExists {
                    return Err(e);
                }
                return open_below(at, name, dir_flags());
            }
            let fd = open_below(at, name, dir_flags())?;
            // SAFETY: fchmod(2) reads no memory; fd is an open descriptor this function owns.
            succeeded(unsafe { libc::fchmod(fd.as_raw_fd(), mode) })?;
            if let Some((uid, gid)) = owner {
                // SAFETY: fchown(2) reads no memory; fd is an open descriptor this function owns.
                succeeded(unsafe { libc::fchown(fd.as_raw_fd(), uid, gid) })?;
            }
            Ok(fd)
        }
        other => other,
    }
}

fn open_below(at: &OwnedFd, name: &OsStr, flags: libc::c_int) -> io::Result<OwnedFd> {
    let name = cstring(name)?;
    // SAFETY: openat(2) reads the NUL-terminated name, which outlives the call; the descriptor it returns is owned by nobody else.
    let fd = unsafe { libc::openat(at.as_raw_fd(), name.as_ptr(), flags | libc::O_NOFOLLOW) };
    owned(fd)
}

fn lstat_at(at: &OwnedFd, name: &OsStr) -> io::Result<libc::stat> {
    stat_at(at, name, libc::AT_SYMLINK_NOFOLLOW)
}

fn stat_at(at: &OwnedFd, name: &OsStr, flags: libc::c_int) -> io::Result<libc::stat> {
    let name = cstring(name)?;
    let mut info = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: fstatat(2) reads the NUL-terminated name and writes one stat into `info`, both of which outlive the call.
    let rc = unsafe { libc::fstatat(at.as_raw_fd(), name.as_ptr(), info.as_mut_ptr(), flags) };
    succeeded(rc)?;
    // SAFETY: fstatat returned 0, so it filled `info`.
    Ok(unsafe { info.assume_init() })
}

// UNIT_BOUNDARY_DESCRIPTION: whether the image's link at `name` leads nowhere. Resolving it is only a stat: nothing is opened or written through it.
fn dangles(at: &OwnedFd, name: &OsStr) -> bool {
    match stat_at(at, name, 0) {
        Ok(_) => false,
        Err(e) => matches!(
            e.raw_os_error(),
            Some(libc::ENOENT | libc::ELOOP | libc::ENOTDIR)
        ),
    }
}

fn readlink_at(at: &OwnedFd, name: &OsStr) -> io::Result<OsString> {
    let name = cstring(name)?;
    let mut buf = vec![0u8; libc::PATH_MAX as usize];
    // SAFETY: readlinkat(2) reads the NUL-terminated name and writes at most buf.len() bytes into buf, both of which outlive the call.
    let n = unsafe {
        libc::readlinkat(
            at.as_raw_fd(),
            name.as_ptr(),
            buf.as_mut_ptr().cast(),
            buf.len(),
        )
    };
    if n < 0 {
        return Err(io::Error::last_os_error());
    }
    buf.truncate(n as usize);
    Ok(OsString::from_vec(buf))
}

fn symlink_at(target: &Path, at: &OwnedFd, name: &OsStr) -> io::Result<()> {
    let target = cstring(target.as_os_str())?;
    let name = cstring(name)?;
    // SAFETY: symlinkat(2) reads the two NUL-terminated strings, which outlive the call.
    succeeded(unsafe { libc::symlinkat(target.as_ptr(), at.as_raw_fd(), name.as_ptr()) })
}

fn unlink_at(at: &OwnedFd, name: &OsStr, flags: libc::c_int) -> io::Result<()> {
    let name = cstring(name)?;
    // SAFETY: unlinkat(2) reads the NUL-terminated name, which outlives the call.
    succeeded(unsafe { libc::unlinkat(at.as_raw_fd(), name.as_ptr(), flags) })
}

fn identity(fd: &OwnedFd) -> Option<(u64, u64)> {
    let mut info = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: fstat(2) writes one stat into `info`, which outlives the call; fd is open.
    if unsafe { libc::fstat(fd.as_raw_fd(), info.as_mut_ptr()) } < 0 {
        return None;
    }
    // SAFETY: fstat returned 0, so it filled `info`.
    let info = unsafe { info.assume_init() };
    Some((info.st_dev, info.st_ino))
}

fn is_empty(dir: &OwnedFd) -> io::Result<bool> {
    Ok(fs::read_dir(fd_path(dir.as_raw_fd()))?.next().is_none())
}

pub fn fd_path(fd: RawFd) -> PathBuf {
    Path::new("/proc/self/fd").join(fd.to_string())
}

fn owned(fd: libc::c_int) -> io::Result<OwnedFd> {
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: fd was just returned by the kernel and is not owned elsewhere.
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn succeeded(rc: libc::c_int) -> io::Result<()> {
    if rc < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn cstring(value: &OsStr) -> io::Result<CString> {
    CString::new(value.as_bytes()).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))
}

#[cfg(test)]
mod tests {
    // TEST_OVERVIEW: the links plan puts each moved persisted path back on every boot, as root, over a root the image ships and into a home the agent writes. What must hold is covered on real trees, with a stand-in for the mount: an absent path, a dangling link and an empty directory become a link into the home; a directory the image ships content in has the home's copy mounted over it; a correct link is left alone, so a second run changes nothing; a child path is reached through its parent; and no symlink, planted in the home or shipped in the image, is ever followed.
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Guest {
        dir: PathBuf,
    }

    const HOME: &str = "/home/agent";

    impl Guest {
        fn new(name: &str) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir().join(format!(
                "platform-init-links-{name}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(dir.join("home/agent")).unwrap();
            Guest { dir }
        }

        fn at(&self, path: &str) -> PathBuf {
            self.dir.join(path.trim_start_matches('/'))
        }

        fn apply(&self, plan: &[&str]) -> (Vec<Outcome>, Vec<PathBuf>) {
            let mut mounted = Vec::new();
            let plan: Vec<PathBuf> = plan.iter().map(PathBuf::from).collect();
            let outcomes = apply(
                &self.dir,
                Path::new(HOME),
                &plan,
                &mut |data: &OwnedFd, image: &OwnedFd| {
                    mounted.push(fs::read_link(fd_path(data.as_raw_fd()))?);
                    mounted.push(fs::read_link(fd_path(image.as_raw_fd()))?);
                    Ok(())
                },
            );
            (outcomes, mounted)
        }
    }

    impl Drop for Guest {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn outcome<'a>(outcomes: &'a [Outcome], path: &str) -> &'a Result<Placed, String> {
        &outcomes
            .iter()
            .find(|(p, _)| p == Path::new(path))
            .unwrap_or_else(|| panic!("no outcome for {path}"))
            .1
    }

    // TEST_SCENARIO: what a fresh root most likely holds at a moved path — nothing, an empty directory the image made, or a link left dangling — becomes a link to the same path below HOME/.persisted, and the directory it points at is made with the home's owner even when no volume was ever carried for it. The plan runs on every boot, so a second run over the same tree finds each link correct and changes nothing.
    #[test]
    fn an_absent_path_an_empty_directory_and_a_dangling_link_become_links_every_boot() {
        let guest = Guest::new("links");
        fs::create_dir_all(guest.at("/srv/empty")).unwrap();
        std::os::unix::fs::symlink("/nowhere", guest.at("/dangling")).unwrap();
        let plan = ["/data", "/var/lib/app", "/srv/empty", "/dangling"];

        for boot in 0..2 {
            let (outcomes, mounted) = guest.apply(&plan);
            for path in plan {
                let expected = if boot == 0 {
                    Placed::Linked
                } else {
                    Placed::AlreadyLinked
                };
                assert_eq!(
                    outcome(&outcomes, path),
                    &Ok(expected),
                    "{path} on boot {boot}"
                );
                assert_eq!(
                    fs::read_link(guest.at(path)).unwrap(),
                    Path::new(HOME).join(".persisted").join(&path[1..]),
                    "{path}"
                );
                assert!(guest.at(&format!("{HOME}/.persisted{path}")).is_dir());
            }
            assert!(mounted.is_empty());
        }
        let home_owner = fs::metadata(guest.at(HOME)).unwrap().uid();
        assert_eq!(
            fs::metadata(guest.at("/home/agent/.persisted/var/lib"))
                .unwrap()
                .uid(),
            home_owner
        );
    }

    // TEST_SCENARIO: a link that already points where it should — the image shipped it, or the root was not replaced — is left exactly as it is.
    #[test]
    fn a_correct_link_is_left_alone() {
        let guest = Guest::new("correct");
        std::os::unix::fs::symlink("/home/agent/.persisted/data", guest.at("/data")).unwrap();
        let (outcomes, _) = guest.apply(&["/data"]);
        assert_eq!(outcome(&outcomes, "/data"), &Ok(Placed::AlreadyLinked));
        assert_eq!(
            fs::read_link(guest.at("/data")).unwrap(),
            Path::new("/home/agent/.persisted/data")
        );
    }

    // TEST_SCENARIO: an image that ships content at a moved path keeps it, hidden: the home's copy is mounted over the image's directory, as the container's volume was, rather than the agent working on the image's copy and losing its writes at every stop. Nothing of the image's is removed.
    #[test]
    fn a_directory_the_image_ships_content_in_gets_the_homes_copy_mounted_over_it() {
        let guest = Guest::new("shadow");
        fs::create_dir_all(guest.at("/data")).unwrap();
        fs::write(guest.at("/data/from-the-image"), b"x").unwrap();

        let (outcomes, mounted) = guest.apply(&["/data"]);

        assert_eq!(outcome(&outcomes, "/data"), &Ok(Placed::MountedOver));
        assert_eq!(
            mounted,
            vec![
                fs::canonicalize(guest.at("/home/agent/.persisted/data")).unwrap(),
                fs::canonicalize(guest.at("/data")).unwrap()
            ]
        );
        assert!(guest.at("/data/from-the-image").is_file());
    }

    // TEST_SCENARIO: a moved path inside another — /data and /data/sub — is reached through its parent's link, so only the parent is linked. Linking the child too wrote a link inside the parent's own data pointing at itself, and every read through it failed. The child's directory is still made below its parent's, so it exists as it did on the container.
    #[test]
    fn a_nested_path_is_reached_through_its_parent() {
        let guest = Guest::new("nested");
        let (outcomes, _) = guest.apply(&["/data/sub", "/data"]);

        assert_eq!(outcome(&outcomes, "/data"), &Ok(Placed::Linked));
        assert_eq!(
            outcome(&outcomes, "/data/sub"),
            &Ok(Placed::ThroughParent(PathBuf::from("/data")))
        );
        let sub = guest.at("/home/agent/.persisted/data/sub");
        assert!(
            fs::symlink_metadata(&sub).unwrap().is_dir(),
            "sub is not a real directory"
        );
        assert_eq!(
            outcomes[0].0,
            PathBuf::from("/data"),
            "the parent went first"
        );
    }

    // TEST_SCENARIO: the home is the agent's, so a symlink it planted where a moved path's data lives — here aimed at /etc — must not be followed: following it would put a root-made link or mount wherever the agent pointed. The path is refused, and nothing is created or linked through it.
    #[test]
    fn a_symlink_planted_in_the_home_is_not_followed() {
        let guest = Guest::new("planted");
        fs::create_dir_all(guest.at("/etc")).unwrap();
        fs::create_dir_all(guest.at("/home/agent/.persisted")).unwrap();
        std::os::unix::fs::symlink(guest.at("/etc"), guest.at("/home/agent/.persisted/data"))
            .unwrap();

        let (outcomes, mounted) = guest.apply(&["/data", "/srv/app"]);

        assert!(outcome(&outcomes, "/data").is_err());
        assert!(
            fs::symlink_metadata(guest.at("/data")).is_err(),
            "/data was linked anyway"
        );
        assert!(guest.at("/home/agent/.persisted/srv/app").is_dir());
        assert!(mounted.is_empty());
        assert_eq!(fs::read_dir(guest.at("/etc")).unwrap().count(), 0);

        fs::remove_dir_all(guest.at("/home/agent/.persisted")).unwrap();
        std::os::unix::fs::symlink(guest.at("/etc"), guest.at("/home/agent/.persisted")).unwrap();
        let (outcomes, _) = guest.apply(&["/srv/other"]);
        assert!(outcome(&outcomes, "/srv/other").is_err());
        assert_eq!(fs::read_dir(guest.at("/etc")).unwrap().count(), 0);
    }

    // TEST_SCENARIO: a link the image ships on the way to a moved path, or at it when it leads somewhere real, is the image's and is not followed or replaced; the path is refused, and so is a file the image ships there.
    #[test]
    fn what_the_image_ships_is_not_followed_or_replaced() {
        let guest = Guest::new("image-links");
        fs::create_dir_all(guest.at("/elsewhere")).unwrap();
        std::os::unix::fs::symlink(guest.at("/elsewhere"), guest.at("/var")).unwrap();
        std::os::unix::fs::symlink(guest.at("/elsewhere"), guest.at("/live")).unwrap();
        fs::write(guest.at("/file"), b"x").unwrap();

        let (outcomes, _) = guest.apply(&["/var/lib/app", "/live", "/file"]);

        for path in ["/var/lib/app", "/live", "/file"] {
            assert!(outcome(&outcomes, path).is_err(), "{path}");
        }
        assert_eq!(fs::read_dir(guest.at("/elsewhere")).unwrap().count(), 0);
        assert_eq!(
            fs::read_link(guest.at("/live")).unwrap(),
            guest.at("/elsewhere")
        );
    }

    // TEST_SCENARIO: a plan that names the root, HOME or anything the platform lays out, or a path that is not plain, is refused path by path rather than acted on as root, whatever let it into the plan.
    #[test]
    fn paths_the_platform_lays_out_are_refused() {
        let guest = Guest::new("refused");
        let refused = [
            "/",
            "/home",
            "/home/agent/work",
            "/etc",
            "/etc/platform/ca",
            "/proc/self",
            "/platform",
            "/mnt",
            "relative",
            "/a/../b",
            "/a//b",
            "/a/",
        ];
        let (outcomes, _) = guest.apply(&refused);
        for (path, outcome) in &outcomes {
            assert!(outcome.is_err(), "{} was placed", path.display());
        }
        assert!(!guest.at("/home/agent/.persisted").exists());
    }

    // TEST_SCENARIO: a home an older migration seeded may still carry `.platform/boot.d` with an executable hook in it. The platform runs nothing from the home, so putting the paths back never runs it, and leaves it as it is.
    #[test]
    fn a_leftover_boot_hook_directory_is_ignored() {
        use std::os::unix::fs::PermissionsExt;
        let guest = Guest::new("boot-d");
        let hooks = guest.at("/home/agent/.platform/boot.d");
        fs::create_dir_all(&hooks).unwrap();
        let marker = guest.at("/ran");
        let hook = hooks.join("10-persisted-paths.sh");
        fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();

        let (outcomes, _) = guest.apply(&["/data"]);

        assert_eq!(outcome(&outcomes, "/data"), &Ok(Placed::Linked));
        assert!(!marker.exists(), "a hook from the home was run");
        assert!(hook.is_file());
    }

    // TEST_SCENARIO: the plan is read from the share one path per line; a share with no plan is a machine nothing was moved into.
    #[test]
    fn the_plan_is_one_path_per_line() {
        let guest = Guest::new("plan");
        let file = guest.at("/links");
        assert!(read_plan(&file).unwrap().is_empty());
        fs::write(&file, b"/data\n/var/lib/app\n").unwrap();
        assert_eq!(
            read_plan(&file).unwrap(),
            vec![PathBuf::from("/data"), PathBuf::from("/var/lib/app")]
        );
    }
}
