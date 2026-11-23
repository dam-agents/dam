// TEST_OVERVIEW: the Satellite mount is tested in two layers. The first is everything that can be decided without a kernel or a platform: the channel's JSON as the api-server must read it, the errno names as the FUSE errors they become, the inode table the kernel's numbers come from, the name and link rules that keep a path inside its grant, and the HTTP client against a hand-written platform that refuses, retries and answers through a proxy.
// TEST_OVERVIEW: the second is the mount itself, which needs /dev/fuse, root and a real mount, so it is #[ignore]d and run by hand: it mounts the filesystem over a fake platform holding a tree in memory, then runs `ls`, `cat`, `find`, `ln` and `mv` against it as the Agent would.
// TEST_OVERVIEW: run it in the lima VM `pinit-test`, which has /dev/fuse and fusermount3, from a writable copy of packages/vm-runner: `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUNNER="sudo -E" cargo test -p platform-init --locked -- --ignored satellite_fuse`.
// TEST_OVERVIEW: it skips itself with a line on stderr where /dev/fuse is missing or the caller is not root, so the CI lane that runs every ignored test as root does not fail on a host that cannot mount.
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;

use super::fs::cookie;
use super::inodes::{self, Node, Table};
use super::platform::{Client, GrantsError};
use super::wire::{self, Answer, Failure, Grant, Kind, Request as Op};
use super::{config_from_env, mount, Config, State};

// TEST_SCENARIO: the body of the channel is a strict union the api-server parses, so the mount's own spelling of each operation is asserted as a document: every field sits at the top, a read names its offset, its size and the device and inode of the handle, a write is base64, a rename names both ends and no path, a link names its target beside its path, and a Satellite's own root — which the route will not carry as the empty string — travels as `.`.
#[test]
fn an_operation_encodes_as_the_document_the_platform_reads() {
    let read = Op::at("read", "docs/a.txt")
        .with("offset", json!(4096))
        .with("size", json!(131072))
        .with("dev", json!(7))
        .with("ino", json!(42));
    assert_eq!(
        serde_json::to_value(&read).unwrap(),
        json!({"op": "read", "path": "docs/a.txt", "offset": 4096, "size": 131072, "dev": 7, "ino": 42})
    );
    let write = Op::at("write", "")
        .with("offset", json!(0))
        .with("dev", json!(7))
        .with("ino", json!(42))
        .data(b"hi");
    assert_eq!(
        serde_json::to_value(&write).unwrap(),
        json!({"op": "write", "path": ".", "offset": 0, "dev": 7, "ino": 42, "data": "aGk="}),
        "an empty path is the Satellite's own root, and bytes are base64"
    );
    let rename = Op::new("rename")
        .with("from", json!("a"))
        .with("to", json!("docs/b"));
    assert_eq!(
        serde_json::to_value(&rename).unwrap(),
        json!({"op": "rename", "from": "a", "to": "docs/b"})
    );
    let symlink = Op::at("symlink", "docs/link").with("target", json!("../a.txt"));
    assert_eq!(
        serde_json::to_value(&symlink).unwrap(),
        json!({"op": "symlink", "path": "docs/link", "target": "../a.txt"})
    );
    assert_eq!(
        serde_json::to_value(Op::at("statfs", "")).unwrap(),
        json!({"op": "statfs", "path": "."})
    );
}

// TEST_SCENARIO: the two sizes one operation may carry are each fixed by a limit on the platform's side, and getting either wrong is invisible until a copy is slow or a write is refused. A read stays inside the api-server's 128 KiB read cap; a write is one mebibyte, which the kernel is told is the largest write it may send, and base64 of it fits both the route's 1.5 MiB data field and its 2 MiB body — so a 100 MB copy is a hundred requests, not eight hundred. The block size the kernel reads and writes the mount in is the write size.
#[test]
fn an_operation_carries_what_the_platforms_limits_allow() {
    assert_eq!(wire::READ_MAX, 128 << 10, "the api-server's read cap");
    assert_eq!(wire::WRITE_MAX, 1 << 20);
    assert_eq!(wire::BLOCK_SIZE, wire::WRITE_MAX);

    let full = vec![0u8; wire::WRITE_MAX as usize];
    let op = Op::at("write", "big.bin")
        .with("offset", json!(0))
        .with("dev", json!(7))
        .with("ino", json!(42))
        .data(&full);
    let document = serde_json::to_value(&op).unwrap();
    let data = document["data"].as_str().unwrap_or_default().len();
    let body = serde_json::to_vec(&op).unwrap();
    assert_eq!(data, 1_398_104, "base64 of one mebibyte");
    assert!(data <= 1_572_864, "the route's data field is 1.5 MiB");
    assert!(
        body.len() <= 2 * 1024 * 1024,
        "the route's body cap is 2 MiB"
    );
}

// TEST_SCENARIO: an answer is read back with the names the api-server sends: a refused operation under HTTP 200 carries its errno and must not be mistaken for a result, a listing's entries carry their attributes beside their name, a read's bytes are base64, and a kind this mount does not know is still listed as a file rather than failing the whole directory.
#[test]
fn an_answer_is_read_as_the_platform_writes_it() {
    let refused: Answer = serde_json::from_str(r#"{"ok":false,"errno":"EROFS"}"#).unwrap();
    assert_eq!(refused.check(), Err(Failure::ReadOnly));
    assert_eq!(refused.attrs().unwrap_err(), Failure::ReadOnly);

    let listing: Answer = serde_json::from_str(
        r#"{"ok":true,"result":{"entries":[{"name":"a.txt","kind":"file","size":3,"mode":420,"dev":7,"ino":42,"mtimeMs":1000,"ctimeMs":2000,"atimeMs":3000}],"next":1}}"#,
    )
    .unwrap();
    let listing = listing.listing().unwrap();
    assert_eq!(listing.entries[0].name, "a.txt");
    assert_eq!(listing.entries[0].attrs.kind, Kind::File);
    assert_eq!(listing.entries[0].attrs.size, 3);
    assert_eq!(listing.entries[0].attrs.mode, 0o644);
    assert_eq!(
        listing.entries[0].attrs.modified(),
        std::time::UNIX_EPOCH + Duration::from_millis(1000)
    );

    let bytes: Answer = serde_json::from_str(r#"{"ok":true,"data":"aGVsbG8K"}"#).unwrap();
    assert_eq!(bytes.bytes().unwrap(), b"hello\n");

    let link: Answer =
        serde_json::from_str(r#"{"ok":true,"result":{"target":"../a.txt"}}"#).unwrap();
    assert_eq!(link.target().unwrap(), "../a.txt");

    let stat: Answer = serde_json::from_str(
        r#"{"ok":true,"result":{"bsize":4096,"blocks":10,"bfree":4,"bavail":3,"files":2,"ffree":1}}"#,
    )
    .unwrap();
    assert_eq!(stat.stat().unwrap().bavail, 3);

    let unknown: Answer =
        serde_json::from_str(r#"{"ok":true,"result":{"kind":"socket"}}"#).unwrap();
    assert_eq!(unknown.attrs().unwrap().kind, Kind::Other);
    assert_eq!(
        unknown.attrs().unwrap().kind.file_type(),
        fuser::FileType::RegularFile,
        "a special file is shown as a regular file, so every open of it reaches the worker"
    );

    // TEST_SCENARIO: the worker calls a symbolic link "link"; the mount must read that as a link, not as an unknown kind, or every link in the tree is shown as a regular file.
    let link: Answer =
        serde_json::from_str(r#"{"ok":true,"result":{"kind":"link","size":11,"mode":493}}"#)
            .unwrap();
    assert_eq!(link.attrs().unwrap().kind, Kind::Symlink);
    assert_eq!(
        link.attrs().unwrap().kind.file_type(),
        fuser::FileType::Symlink
    );
}

// TEST_SCENARIO: every errno the channel may answer with arrives at the Agent's command as the same error a local file would give, and a name the mount does not know is EIO rather than success: a rule the platform enforces may not be dropped on the way.
#[test]
fn an_errno_name_becomes_the_same_fuse_error() {
    use fuser::Errno;
    for (name, expected) in [
        ("ENOENT", Errno::ENOENT),
        ("EACCES", Errno::EACCES),
        ("EROFS", Errno::EROFS),
        ("EPERM", Errno::EPERM),
        ("ESTALE", Errno::ESTALE),
        ("EHOSTDOWN", Errno::EHOSTDOWN),
        ("EIO", Errno::EIO),
        ("ENOTDIR", Errno::ENOTDIR),
        ("EISDIR", Errno::EISDIR),
        ("EEXIST", Errno::EEXIST),
        ("ENOTEMPTY", Errno::ENOTEMPTY),
        ("ENOSPC", Errno::ENOSPC),
        ("EXDEV", Errno::EXDEV),
        ("ENOTSUP", Errno::ENOTSUP),
        ("EBUSY", Errno::EBUSY),
        ("EINVAL", Errno::EINVAL),
        ("ENAMETOOLONG", Errno::ENAMETOOLONG),
    ] {
        assert_eq!(Failure::named(Some(name)).errno(), expected, "{name}");
    }
    assert_eq!(Failure::named(Some("EWHATEVER")).errno(), Errno::EIO);
    assert_eq!(Failure::named(None).errno(), Errno::EIO);
}

// TEST_SCENARIO: an operation the api-server refuses before it reaches a worker answers with an HTTP status rather than an errno, and the three the channel names mean what the Agent has to be told: a revoked grant is EACCES, a Satellite the platform does not know is ENOENT, and a machine that is offline or draining is EHOSTDOWN. Everything else is EIO.
#[test]
fn an_http_status_becomes_the_failure_it_means() {
    assert_eq!(Failure::status(403), Failure::Access);
    assert_eq!(Failure::status(404), Failure::NotFound);
    assert_eq!(Failure::status(503), Failure::HostDown);
    assert_eq!(Failure::status(502), Failure::Io);
    assert_eq!(Failure::status(500), Failure::Io);
}

// TEST_SCENARIO: the kernel names a file only by inode number and the platform only by a path, so one path must keep one number for as long as it is known, a path that now names another file must move to a new generation so the kernel drops what it cached, and the mount's root is always 1.
#[test]
fn the_inode_table_keeps_one_number_for_one_path() {
    let mut table = Table::new();
    assert_eq!(inodes::ROOT, 1);
    assert_eq!(table.get(1).unwrap().path, "");
    let (first, generation) = table.intern("lab", "a.txt", 7, 42, false);
    assert_ne!(first, 1);
    assert_eq!(generation, 0);
    assert_eq!(table.intern("lab", "a.txt", 7, 42, false), (first, 0));
    let (other, _) = table.intern("lab", "b.txt", 7, 43, false);
    assert_ne!(other, first);
    let (elsewhere, _) = table.intern("ro", "a.txt", 8, 42, false);
    assert_ne!(
        elsewhere, first,
        "one path in each Satellite is its own file"
    );
    let (again, moved) = table.intern("lab", "a.txt", 7, 44, false);
    assert_eq!(again, first, "the path keeps its number");
    assert_eq!(moved, 1, "and the kernel hears that it is another file now");
    assert_eq!(table.get(first).unwrap().ino, 44);
    assert_eq!(
        table.place("lab", "a.txt"),
        first,
        "placing a directory does not change its identity"
    );
    assert_eq!(table.get(first).unwrap().ino, 44);
}

// TEST_SCENARIO: when a Satellite goes offline or its grant is withdrawn, every number of its tree is forgotten so the kernel can be told its cache is gone, no number is ever handed out twice — the kernel may still hold one in a dentry — and the handles of files under it are dropped with it.
#[test]
fn forgetting_a_satellite_drops_its_numbers_and_never_reuses_them() {
    let mut table = Table::new();
    let (a, _) = table.intern("lab", "a.txt", 7, 42, false);
    let (b, _) = table.intern("lab", "docs/b.txt", 7, 43, false);
    let (satellite, _) = table.intern("lab", "", 0, 0, false);
    let (other, _) = table.intern("ro", "a.txt", 8, 42, false);
    let handle = table.open(&table.get(a).unwrap());
    let mut forgotten = table.forget("lab");
    forgotten.sort_unstable();
    let mut expected = vec![a, b, satellite];
    expected.sort_unstable();
    assert_eq!(forgotten, expected);
    for number in [a, b, satellite] {
        assert!(table.get(number).is_none(), "{number} is still known");
    }
    assert_eq!(
        table.handle(handle),
        None,
        "a handle keeps a node of its own"
    );
    assert_eq!(table.get(other).unwrap().ino, 42);
    let (fresh, _) = table.intern("lab", "a.txt", 7, 42, false);
    assert!(
        fresh > other && fresh != a,
        "a number the kernel may still hold is not reused"
    );
}

// TEST_SCENARIO: the cookie one directory entry carries is the count of entries the kernel has already taken, so a listing that stops in the middle of a reply resumes exactly after the last entry it showed. A cookie that restarted inside every reply would ask for the same window for ever, which is a walk of any directory longer than one reply that never ends.
#[test]
fn a_listing_resumes_after_the_last_entry_it_showed() {
    assert_eq!((cookie(0, 0), cookie(0, 1), cookie(0, 2)), (1, 2, 3));
    assert_eq!((cookie(1, 0), cookie(1, 1)), (2, 3), "`.` was the first");
    assert_eq!(cookie(2, 0), 3, "`.` and `..` came first");
    assert_eq!(cookie(100, 0), 101);
    assert_eq!(
        cookie(100, 99),
        200,
        "the last entry of a reply names the offset of the next"
    );
    for offset in [0u64, 1, 2, 7, 100, 600] {
        for index in [0usize, 1, 99, 255] {
            assert!(cookie(offset, index) > offset, "{offset} {index}");
        }
    }
}

// TEST_SCENARIO: a rename never crosses a Satellite, because each is a tree on a machine of its own: `mv` between two of them must copy and delete, as it does between two devices, instead of asking one worker to move a file it does not have.
#[test]
fn a_rename_between_two_satellites_is_a_cross_device_move() {
    let node = |satellite: &str, path: &str| Node {
        satellite: satellite.to_string(),
        path: path.to_string(),
        dev: 0,
        ino: 0,
        generation: 0,
        special: false,
    };
    assert_eq!(
        inodes::rename_stays_put(&node("lab", ""), &node("lab", "docs")),
        Ok(())
    );
    assert_eq!(
        inodes::rename_stays_put(&node("lab", ""), &node("ro", "")),
        Err(Failure::CrossDevice)
    );
}

// TEST_SCENARIO: the mount names a file only by the path the platform knows it by, so a rename must move every number with the path — the file's, every directory's below it and every handle open on one — or a file that moved answers ENOENT and a directory that moved strands what it holds. A path that merely starts with the same letters is not below it, a replaced target's number is taken away, and a detached path gets a fresh number rather than the old file's identity.
#[test]
fn a_renamed_tree_takes_its_numbers_and_handles_with_it() {
    let mut table = Table::new();
    let (docs, _) = table.intern("lab", "docs", 7, 42, false);
    let (notes, _) = table.intern("lab", "docs/notes.md", 7, 43, false);
    let (lookalike, _) = table.intern("lab", "docsx", 7, 44, false);
    let (file, _) = table.intern("lab", "t", 7, 45, false);
    let handle = table.open(&table.get(notes).unwrap());

    table.detach("lab", "moved");
    table.rename("lab", "docs", "moved");
    assert_eq!(table.get(docs).unwrap().path, "moved");
    assert_eq!(table.get(notes).unwrap().path, "moved/notes.md");
    assert_eq!(
        table.place("lab", "moved"),
        docs,
        "the new path is the same file"
    );
    assert_eq!(table.place("lab", "moved/notes.md"), notes);
    assert_ne!(
        table.place("lab", "docs"),
        docs,
        "nothing is left at the old name"
    );
    assert_eq!(table.get(lookalike).unwrap().path, "docsx");
    assert_eq!(
        table.handle(handle).unwrap().path,
        "moved/notes.md",
        "an open handle follows the file it was opened on"
    );

    table.detach("lab", "moved");
    table.rename("lab", "t", "moved");
    assert_eq!(table.get(file).unwrap().path, "moved");
    assert!(table.get(docs).is_none(), "the target's own number is gone");

    table.detach("lab", "moved");
    assert!(table.get(file).is_none(), "a removed path keeps no number");
    let (fresh, _) = table.intern("lab", "moved", 7, 99, false);
    assert!(fresh > file, "a new file at that path is a new number");
}

// TEST_SCENARIO: a name the platform sends becomes a directory entry, so the names that cannot be one are refused before they reach the kernel: an empty name, `.` and `..`, a name holding a separator, and a name holding a NUL.
#[test]
fn only_a_plain_name_becomes_a_directory_entry() {
    for good in ["a.txt", "docs", ".hidden", "a b", "ünicode"] {
        assert!(wire::name_is_valid(good), "{good:?} was refused");
    }
    for bad in ["", ".", "..", "a/b", "a\0b", "/"] {
        assert!(!wire::name_is_valid(bad), "{bad:?} was accepted");
    }
}

// TEST_SCENARIO: a link's target must stay inside its Satellite, which is the worker's rule and the mount applies it before it asks: relative, zero or more leading `..` and then plain names, with no more `..` than the link's own directory lies below the root. The cases are the ones AC-7 and AC-8 name.
#[test]
fn a_link_target_has_to_stay_inside_its_satellite() {
    assert!(wire::target_stays_inside("a.txt", 0));
    assert!(wire::target_stays_inside("shared/a.txt", 0));
    assert!(wire::target_stays_inside("../a.txt", 1));
    assert!(
        wire::target_stays_inside("../../shared/a.txt", 2),
        "AC-8: docs/notes up to the root"
    );
    assert!(wire::target_stays_inside("..", 1));
    for (target, depth) in [
        ("", 0),
        ("/etc/passwd", 3),
        ("../../../a.txt", 2),
        ("..", 0),
        ("a/../b", 3),
        ("a//b", 3),
        ("./a", 3),
        ("a/", 3),
        ("a\0b", 1),
    ] {
        assert!(
            !wire::target_stays_inside(target, depth),
            "{target:?} at depth {depth} was accepted"
        );
    }
}

// TEST_SCENARIO: a new grant list takes two different things away, and the mount must not conflate them: a Satellite that went quiet loses the kernel's cache but keeps the numbers of its tree, so a shell whose working directory is inside it still has one when the machine answers again (AC-9, "nothing restarted"); a Satellite whose grant is gone loses everything, because what it named is not there to come back. A list that repeats the same state names nothing, so a machine that stays offline is not invalidated every 30 s.
#[test]
fn a_grant_list_that_takes_a_satellite_away_says_which_way() {
    let grant = |name: &str, online: bool| Grant {
        name: name.to_string(),
        writable: true,
        online,
    };
    let before = vec![
        grant("lab", true),
        grant("old", true),
        grant("quiet", false),
    ];
    let nothing = wire::withdrawn(&[], &before);
    assert!(nothing.quiet.is_empty() && nothing.gone.is_empty());
    let withdrawn = wire::withdrawn(&before, &[grant("lab", false), grant("quiet", false)]);
    assert_eq!(withdrawn.quiet, vec![String::from("lab")]);
    assert_eq!(withdrawn.gone, vec![String::from("old")]);
    let unchanged = wire::withdrawn(&before, &before);
    assert!(unchanged.quiet.is_empty() && unchanged.gone.is_empty());
    let back = wire::withdrawn(&[grant("lab", false)], &[grant("lab", true)]);
    assert!(back.quiet.is_empty() && back.gone.is_empty());
}

// TEST_SCENARIO: a successful answer that says the Agent holds nothing is the one answer that takes the whole mount away, and the live run saw it arrive for about 30 s while the Satellite was granted and online. So it is asked twice before anything is dropped: one empty answer followed by the real list leaves the mount as it was, two empty answers take it away, and an empty answer whose confirmation could not be read keeps the last good list — a platform that cannot be reached must not cost the Agent its tree.
#[test]
fn an_empty_grant_list_is_confirmed_before_it_takes_the_mount_away() {
    let state = |answers: Vec<Option<Vec<Grant>>>| {
        let answers = Arc::new(Mutex::new(answers));
        let served = answers.clone();
        let platform = Platform::start(move |_, _| {
            let next = {
                let mut held = served.lock().unwrap();
                if held.is_empty() {
                    None
                } else {
                    held.remove(0)
                }
            };
            match next {
                Some(grants) => {
                    let satellites: Vec<serde_json::Value> = grants
                        .iter()
                        .map(|held| {
                            json!({
                                "name": held.name,
                                "writable": held.writable,
                                "online": held.online,
                            })
                        })
                        .collect();
                    (200, json!({"satellites": satellites}).to_string())
                }
                None => (500, json!({"ok": false, "errno": "EIO"}).to_string()),
            }
        });
        let client = Client::new(platform.url(), None).unwrap();
        let state = State::new(
            Config {
                api_server: platform.url().to_string(),
                agent: String::from("agent-1"),
                proxy: None,
            },
            client,
        );
        state.set_grants(vec![grant("lab")]);
        state
    };

    let one_empty = state(vec![Some(Vec::new()), Some(vec![grant("lab")])]);
    assert_eq!(one_empty.poll_once(), super::Polled::Read);
    assert_eq!(
        one_empty.grants(),
        vec![grant("lab")],
        "one empty answer is not a revocation"
    );

    let two_empty = state(vec![Some(Vec::new()), Some(Vec::new())]);
    assert_eq!(two_empty.poll_once(), super::Polled::Read);
    assert!(
        two_empty.grants().is_empty(),
        "two empty answers take the mount away"
    );

    let unreadable = state(vec![Some(Vec::new()), None]);
    assert!(matches!(unreadable.poll_once(), super::Polled::Failed(_)));
    assert_eq!(
        unreadable.grants(),
        vec![grant("lab")],
        "a confirmation that could not be read keeps the last good list"
    );

    let revoked = state(vec![Some(vec![grant("other")])]);
    assert_eq!(revoked.poll_once(), super::Polled::Read);
    assert_eq!(
        revoked.grants(),
        vec![grant("other")],
        "a non-empty list that omits a Satellite takes it away at once"
    );
}

// TEST_SCENARIO: the mount starts only on a machine the controller gave the channel to. Its api-server and its Agent are the two settings a boot cannot invent, and a machine whose launch record lacks either — an older controller's — boots without a mount rather than asking the api-server on a path that names no Agent. The proxy is read from the launch environment and nowhere else.
#[test]
fn the_mount_starts_only_when_the_launch_names_a_platform_and_an_agent() {
    let env = |pairs: &[(&str, &str)]| -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    };
    assert!(config_from_env(&[]).is_none());
    assert!(config_from_env(&env(&[("API_SERVER_URL", "http://10.0.0.1:80")])).is_none());
    assert!(config_from_env(&env(&[("PLATFORM_AGENT_ID", "lab")])).is_none());
    assert!(config_from_env(&env(&[
        ("API_SERVER_URL", "http://10.0.0.1:80"),
        ("PLATFORM_AGENT_ID", ""),
    ]))
    .is_none());
    let config = config_from_env(&env(&[
        ("API_SERVER_URL", "http://10.0.0.1:80"),
        ("PLATFORM_AGENT_ID", "lab"),
        ("HTTP_PROXY", "http://10.96.42.42:10000"),
    ]))
    .unwrap();
    assert_eq!(config.api_server, "http://10.0.0.1:80");
    assert_eq!(config.agent, "lab");
    assert_eq!(config.proxy.as_deref(), Some("http://10.96.42.42:10000"));
}

// TEST_SCENARIO: the grant list is what the mount lists, so it is read strictly: a platform older than the channel answers 404 and is named as such rather than as a failure, a name the mount could not show as a directory is dropped before it can reach the kernel, and a Satellite granted twice is one directory.
#[test]
fn the_client_reads_the_grant_list_and_keeps_only_what_it_can_show() {
    let platform = Platform::start(|path, _| {
        assert!(
            path.ends_with("/api/agents/agent-1/satellite-files"),
            "{path}"
        );
        (
            200,
            json!({"satellites":[
                {"name":"lab","writable":true,"online":true},
                {"name":"ro","writable":false,"online":false},
                {"name":"../outside","writable":true,"online":true},
                {"name":"lab","writable":true,"online":true}
            ]})
            .to_string(),
        )
    });
    let client = Client::new(platform.url(), None).unwrap();
    assert_eq!(
        client.grants("agent-1", Duration::from_secs(5)).unwrap(),
        vec![
            Grant {
                name: String::from("lab"),
                writable: true,
                online: true
            },
            Grant {
                name: String::from("ro"),
                writable: false,
                online: false
            },
        ]
    );

    let older = Platform::start(|_, _| (404, String::new()));
    let client = Client::new(older.url(), None).unwrap();
    assert!(matches!(
        client.grants("agent-1", Duration::from_secs(5)),
        Err(GrantsError::NotServed)
    ));
}

// TEST_SCENARIO: a read-only operation the platform could not reach, or that a replica of a rolling deploy refused with 502 or 503, is sent again within its deadline, so an Agent's read does not fail for a deployment; a change is answered to its first attempt alone, because a second one could apply a write twice.
#[test]
fn a_read_is_sent_again_where_a_change_is_not() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let seen = attempts.clone();
    let platform = Platform::start(move |_, _| {
        if seen.fetch_add(1, Ordering::SeqCst) == 0 {
            return (502, String::new());
        }
        (
            200,
            json!({"ok":true,"result":{"kind":"file","size":0,"dev":7,"ino":42}}).to_string(),
        )
    });
    let client = Client::new(platform.url(), None).unwrap();
    assert!(
        client
            .op("agent-1", "lab", &Op::at("getattr", "a.txt"), true)
            .unwrap()
            .ok
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 2);

    let attempts = Arc::new(AtomicUsize::new(0));
    let seen = attempts.clone();
    let platform = Platform::start(move |_, _| {
        seen.fetch_add(1, Ordering::SeqCst);
        (503, String::new())
    });
    let client = Client::new(platform.url(), None).unwrap();
    assert_eq!(
        client
            .op("agent-1", "lab", &Op::at("unlink", "a.txt"), false)
            .unwrap_err(),
        Failure::HostDown
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}

// TEST_SCENARIO: the api-server names its refusal in the body whatever the status, and that errno is the answer: a revoked grant is 403 EACCES and a machine that went offline is 503 EHOSTDOWN, both final, so a read is not sent again and does not wait out a deadline the platform has already answered. A status with no errno in its body is what something in front of the route says, and only that is retried.
#[test]
fn a_refusal_named_in_the_body_is_the_answer_whatever_the_status() {
    for (status, errno, expected) in [
        (403u16, "EACCES", Failure::Access),
        (503, "EHOSTDOWN", Failure::HostDown),
        (400, "EINVAL", Failure::Invalid),
    ] {
        let attempts = Arc::new(AtomicUsize::new(0));
        let seen = attempts.clone();
        let platform = Platform::start(move |_, _| {
            seen.fetch_add(1, Ordering::SeqCst);
            (status, json!({"ok": false, "errno": errno}).to_string())
        });
        let client = Client::new(platform.url(), None).unwrap();
        assert_eq!(
            client
                .op("agent-1", "lab", &Op::at("getattr", "a.txt"), true)
                .unwrap_err(),
            expected
        );
        assert_eq!(
            attempts.load(Ordering::SeqCst),
            1,
            "{status} {errno} is the platform's answer"
        );
    }
    assert_eq!(Failure::status(400), Failure::Invalid);
    let not_found = Platform::start(|_, _| (404, json!({"error": "not found"}).to_string()));
    let client = Client::new(not_found.url(), None).unwrap();
    assert_eq!(
        client
            .op("agent-1", "lab", &Op::at("getattr", "a.txt"), false)
            .unwrap_err(),
        Failure::NotFound,
        "a status without an errno speaks for itself"
    );
}

// TEST_SCENARIO: an operation the platform refuses under HTTP 200 with an errno arrives as that error, which is how a read-only Satellite says EROFS when the Agent opens a file for writing: the mount relays the open instead of guessing from the grant, so a Satellite made writable a moment ago works at once.
#[test]
fn an_operation_the_platform_refuses_arrives_as_its_errno() {
    let platform = Platform::start(|path, body| {
        assert!(path.ends_with("/satellite-files/ro/op"), "{path}");
        assert_eq!(body["op"], json!("open"));
        assert_eq!(body["write"], json!(true));
        (200, json!({"ok":false,"errno":"EROFS"}).to_string())
    });
    let client = Client::new(platform.url(), None).unwrap();
    let answer = client
        .op(
            "agent-1",
            "ro",
            &Op::at("open", "a.txt")
                .with("write", json!(true))
                .with("dev", json!(7))
                .with("ino", json!(42)),
            false,
        )
        .unwrap();
    assert_eq!(answer.check(), Err(Failure::ReadOnly));
}

// TEST_SCENARIO: a proxy is where the machine reaches everything, and its address is an IP literal, so nothing here may resolve a name. The platform in this test is named by a host that does not resolve at all and reached through a hand-written proxy that answers for it: the request arrives at the proxy as an absolute URI naming that host, which is what the gateway is given and what a static binary must be able to send without getaddrinfo.
#[test]
fn the_platform_is_reached_through_the_named_proxy_by_its_absolute_uri() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let recorded = seen.clone();
    let platform = Platform::start(move |path, _| {
        recorded.lock().unwrap().push(path.to_string());
        (200, json!({"satellites":[]}).to_string())
    });
    let client = Client::new("http://unresolvable.invalid:80", Some(platform.url())).unwrap();
    assert_eq!(
        client.grants("agent-1", Duration::from_secs(5)).unwrap(),
        Vec::new()
    );
    assert_eq!(
        seen.lock().unwrap().as_slice(),
        ["http://unresolvable.invalid/api/agents/agent-1/satellite-files"]
    );
}

// TEST_SCENARIO: the mount itself, over the kernel, against a platform holding one tree in memory. It is the only test that can prove the mount exists: that `ls` lists the grants, that a read is the platform's bytes and costs one operation, that a walk asks about each directory (600 of them in one), that `touch`, `chmod` and `truncate` reach a file that was merely read, that a write and a rename are the machine's change, that a read-only Satellite refuses a write at open with EROFS, that a link out of the tree is refused and one inside it reads back, that a hard link is refused, that `mv` between two Satellites is EXDEV, that `mv -n` never replaces what it lands on, that a Satellite that goes offline answers EHOSTDOWN for a file the kernel had already cached while a shell's working directory inside it survives, that a revoked grant takes its entry away, and that the mount comes back by itself after it is unmounted.
#[ignore]
#[test]
fn the_mount_serves_the_granted_satellites_over_a_real_fuse_session() {
    if !Path::new("/dev/fuse").exists() {
        eprintln!("skipping the satellite mount test: this host has no /dev/fuse");
        return;
    }
    if unsafe { libc::geteuid() } != 0 {
        eprintln!("skipping the satellite mount test: it mounts, so it runs as root");
        return;
    }
    let tree = Arc::new(Tree::seeded());
    let platform = Tree::platform(tree.clone());
    let client = Client::new(platform.url(), None).unwrap();
    let state = Arc::new(State::new(
        Config {
            api_server: platform.url().to_string(),
            agent: String::from("agent-1"),
            proxy: None,
        },
        client,
    ));
    let grants = state
        .client
        .grants(&state.config.agent, Duration::from_secs(5))
        .unwrap();
    assert_eq!(grants.len(), 2);
    state.set_grants(grants);

    let dir = temp();
    let session = mount(&state, &dir).unwrap();
    let serving = state.clone();
    let mount_point = dir.clone();
    std::thread::spawn(move || super::serve(serving, mount_point, Some(session)));

    let mnt = dir.display().to_string();
    let shell = |command: String| -> (bool, String) {
        let output = Command::new("sh").arg("-c").arg(command).output();
        let output = output.expect("a shell");
        let mut text = String::from_utf8_lossy(&output.stdout).to_string();
        text.push_str(&String::from_utf8_lossy(&output.stderr));
        (output.status.success(), text)
    };

    let (ok, listed) = shell(format!("ls {mnt}"));
    assert!(ok, "ls {mnt}: {listed}");
    assert_eq!(listed.lines().collect::<Vec<_>>(), vec!["lab", "ro"]);
    // TEST_SCENARIO: two lookups of one directory are in flight at the same time. The fake platform holds an operation whose path begins `gate/` until a second one arrives, so this passes only if the kernel hands the mount both requests at once — which it does only when the mount asks for parallel directory operations.
    let first = mnt.clone();
    let second = mnt.clone();
    let (a, b) = std::thread::scope(|scope| {
        let a = scope.spawn(|| shell(format!("stat -c %s {first}/lab/gate/a.txt")));
        let b = scope.spawn(|| shell(format!("stat -c %s {second}/lab/gate/b.txt")));
        (a.join().expect("a stat"), b.join().expect("a stat"))
    });
    assert!(a.0, "stat gate/a.txt: {}", a.1);
    assert!(b.0, "stat gate/b.txt: {}", b.1);
    assert!(
        tree.joined(),
        "two lookups of one directory never arrived together"
    );

    // TEST_SCENARIO: one entry the platform can only call "other" must not fail the listing of its directory.
    let (ok, lab) = shell(format!("ls {mnt}/lab"));
    assert!(ok, "ls {mnt}/lab: {lab}");
    assert!(
        lab.lines().any(|line| line == "pipe"),
        "the other-kind entry is missing from the listing: {lab}"
    );

    let reads = tree.reads();
    let (ok, contents) = shell(format!("cat {mnt}/lab/a.txt"));
    assert!(ok, "cat: {contents}");
    assert_eq!(contents, "hello\n");
    assert_eq!(
        tree.reads() - reads,
        1,
        "a small file is one read operation, not a read and an empty one"
    );

    let (ok, found) = shell(format!("find {mnt}/lab -name '*.md'"));
    assert!(ok, "find: {found}");
    assert_eq!(found.trim(), format!("{mnt}/lab/docs/notes.md"));

    // TEST_SCENARIO: a listing carries its entries' attributes, so an entry it listed is never asked about again while the kernel's window holds: `ls -l` of a directory is one listing and nothing per entry, and reading a file it listed is the read alone.
    let (ok, _) = shell(format!("ls {mnt}/lab"));
    assert!(ok, "priming the parent listing");
    tree.trace();
    let (ok, detailed) = shell(format!("ls -l {mnt}/lab/docs"));
    assert!(ok, "ls -l: {detailed}");
    assert!(detailed.contains("notes.md"), "ls -l listed {detailed}");
    let listed = tree.trace();
    assert!(
        listed
            .iter()
            .any(|op| op.contains("op=\"readdir\"") && op.contains("path=\"docs\"")),
        "the listing of docs was not one operation: {listed:?}"
    );
    assert!(
        !listed.iter().any(|op| op.contains("docs/notes.md")),
        "an entry the listing carried was asked about again: {listed:?}"
    );

    // TEST_SCENARIO: and the read of that entry is the read alone, with no lookup and no getattr in front of it.
    tree.trace();
    let (ok, read) = shell(format!("cat {mnt}/lab/docs/notes.md"));
    assert!(ok, "cat the listed file: {read}");
    assert_eq!(read, "# notes\n");
    let reading = tree.trace();
    assert_eq!(
        reading
            .iter()
            .filter(|op| op.contains("docs/notes.md"))
            .count(),
        1,
        "reading a listed file is more than one operation: {reading:?}"
    );
    assert!(
        reading
            .iter()
            .filter(|op| op.contains("docs/notes.md"))
            .all(|op| op.contains("op=\"read\"")),
        "the read was preceded by another operation: {reading:?}"
    );

    let (ok, walked) = shell(format!("ls {mnt}/lab/many | wc -l"));
    assert!(ok, "listing 600 entries: {walked}");
    assert_eq!(walked.trim(), "600", "a directory longer than one reply");
    tree.trace();
    let (ok, walked) = shell(format!("find {mnt}/lab/many -type f | wc -l"));
    assert!(ok, "walking 600 entries: {walked}");
    assert_eq!(walked.trim(), "600");
    // TEST_SCENARIO: walking a directory larger than one reply asks for its listings and no per-entry lookup, which is the operation a plain readdir would cost 600 times.
    let walking = tree.trace();
    assert!(
        !walking
            .iter()
            .any(|op| op.contains("op=\"lookup\"") && op.contains("many/")),
        "an entry of the walk was looked up: {walking:?}"
    );

    let (ok, linked) = shell(format!("ln -s ../a.txt {mnt}/ro/out"));
    assert!(!ok, "a link was created on a read-only Satellite");
    assert!(
        linked.contains("Read-only file system"),
        "the refusal said {linked}"
    );

    let (ok, refused) = shell(format!("echo x > {mnt}/ro/a.txt"));
    assert!(!ok, "a write to a read-only Satellite landed");
    assert!(
        refused.contains("Read-only file system"),
        "the refusal said {refused}"
    );

    let (ok, written) = shell(format!("printf hi > {mnt}/lab/new.txt"));
    assert!(ok, "writing a file the Satellite allows: {written}");
    assert_eq!(
        tree.content("lab", "new.txt").as_deref(),
        Some("hi"),
        "the change reached the machine"
    );
    let (ok, read) = shell(format!("cat {mnt}/lab/new.txt"));
    assert!(ok, "cat after write: {read}");
    assert_eq!(read, "hi");

    let (ok, touched) = shell(format!(
        "touch {mnt}/lab/a.txt && chmod 600 {mnt}/lab/a.txt && truncate -s 0 {mnt}/lab/new.txt && \
         stat -c '%a %s' {mnt}/lab/a.txt && stat -c %s {mnt}/lab/new.txt"
    ));
    assert!(ok, "touch, chmod and truncate through the mount: {touched}");
    assert_eq!(touched.lines().next(), Some("600 6"));
    assert_eq!(touched.lines().nth(1), Some("0"));
    assert_eq!(tree.content("lab", "new.txt").as_deref(), Some(""));

    let before = tree.writes();
    let (ok, copied) = shell(format!(
        "dd if=/dev/zero of={mnt}/lab/big.bin bs=1M count=3 2>/dev/null && wc -c < {mnt}/lab/big.bin"
    ));
    assert!(ok, "a three-mebibyte copy: {copied}");
    assert_eq!(copied.trim(), "3145728");
    assert!(
        tree.writes() - before <= 4,
        "3 MiB of a copy took {} operations, so the kernel was told a write is small",
        tree.writes() - before
    );

    let (ok, moved) = shell(format!(
        "printf x > {mnt}/lab/t && mv {mnt}/lab/t {mnt}/lab/a2.txt && cat {mnt}/lab/a2.txt && echo && \
         mkdir {mnt}/lab/d1 && mv {mnt}/lab/d1 {mnt}/lab/d2 && stat -c %F {mnt}/lab/d2"
    ));
    assert!(ok, "a rename through the mount: {moved}");
    assert_eq!(moved.lines().next(), Some("x"), "the new name reads");
    assert_eq!(moved.lines().nth(1), Some("directory"));

    let (_, replaced) = shell(format!(
        "printf y > {mnt}/lab/b2.txt && mv -n {mnt}/lab/b2.txt {mnt}/lab/a2.txt; cat {mnt}/lab/a2.txt; echo; ls {mnt}/lab/b2.txt"
    ));
    assert_eq!(
        replaced.lines().next(),
        Some("x"),
        "mv -n replaced a file it was told to keep: {replaced}"
    );
    assert!(
        replaced.contains("b2.txt"),
        "mv -n dropped the source: {replaced}"
    );

    let (ok, linked) = shell(format!("ln -s ../../a.txt {mnt}/lab/docs/notes/link"));
    assert!(ok, "a link that stays inside the tree: {linked}");
    let (ok, target) = shell(format!("readlink {mnt}/lab/docs/notes/link"));
    assert!(ok, "readlink: {target}");
    assert_eq!(target.trim(), "../../a.txt");
    let (ok, links) = shell(format!("find {mnt}/lab -type l"));
    assert!(ok, "find -type l: {links}");
    assert!(
        links.lines().any(|line| line.ends_with("docs/notes/link"))
            && links.lines().any(|line| line.ends_with("lab/outside")),
        "a link the machine holds is not a link to find: {links}"
    );
    let (_, listed) = shell(format!("ls -l {mnt}/lab"));
    assert!(
        !listed.contains("Input/output error"),
        "a special file failed its listing: {listed}"
    );
    assert!(
        listed
            .lines()
            .any(|line| line.starts_with('-') && line.ends_with(" pipe")),
        "a special file is not shown as a regular file: {listed}"
    );
    assert!(
        listed
            .lines()
            .any(|line| line.starts_with('l') && line.ends_with(" outside")),
        "a link is not shown as a link: {listed}"
    );
    let (_, types) = shell(format!(
        "stat -c %F {mnt}/lab/pipe; stat -c %F {mnt}/lab/outside"
    ));
    assert_eq!(
        types.lines().take(2).collect::<Vec<_>>(),
        vec!["regular file", "symbolic link"],
        "a special file and a link must stat: {types}"
    );
    let (ok, denied) = shell(format!("cat {mnt}/lab/outside"));
    assert!(!ok, "a link out of the tree was followed: {denied}");
    assert!(
        denied.contains("Permission denied"),
        "the refusal said {denied}"
    );
    let (ok, pipes) = shell(format!("find {mnt}/lab -type p"));
    assert!(ok, "find -type p: {pipes}");
    assert!(
        pipes.trim().is_empty(),
        "a special file is a pipe to find: {pipes}"
    );
    let (ok, files) = shell(format!("find {mnt}/lab -maxdepth 1 -type f"));
    assert!(ok, "find -type f: {files}");
    assert!(
        files.lines().any(|line| line.ends_with("lab/pipe")) && !files.contains("outside"),
        "a special file is not a regular file to find, or a link is: {files}"
    );
    // UNIT_BOUNDARY_DESCRIPTION: a special file is a regular file to the kernel, so its open and its read are operations on the channel and not answers the mount gives: a local answer is a FIFO that `cat` exits on happily with nothing. What the tool prints is the kernel's to choose — a platform's EPERM reaches it as EPERM here, as Input/output error on the CI kernel (7.0.0-azure) for a special inode, and as EACCES for a symlink on that same kernel — so the failure is asserted and the platform's trace is the proof that the refusal came from it, not from the mount.
    let fifo = shell(format!("timeout 3 cat {mnt}/lab/fifo"));
    assert!(
        !fifo.0,
        "an open of a zero-size special file was answered without the platform: {fifo:?}"
    );
    let pipe = shell(format!("timeout 3 cat {mnt}/lab/pipe"));
    assert!(
        !pipe.0,
        "a read of a special file was answered without the platform: {pipe:?}"
    );
    eprintln!("cat of a zero-size special file: {fifo:?}, of one with a byte: {pipe:?}");
    let trace = tree.trace();
    for (op, path) in [("open", "fifo"), ("open", "pipe"), ("read", "pipe")] {
        assert!(
            trace.iter().any(|line| {
                line.contains(&format!("op=\"{op}\"")) && line.contains(&format!("path=\"{path}\""))
            }),
            "the {op} of {path} was answered locally: {trace:#?}"
        );
    }
    // UNIT_BOUNDARY_DESCRIPTION: the mount's own answer is what these two links are held to: the request must reach the server and be refused with EPERM. The errno the caller sees is read from a direct symlink(2), not from a tool's message, because a kernel may map a filesystem's error and the CI kernel (7.0.0-azure) reports EACCES for a symlink the server answered with EPERM. A caller errno other than EPERM is accepted only when the server trace proves the mount refused with EPERM, and the environment that did it is printed.
    let escaping = refused_symlink(&format!("{mnt}/lab/docs/notes/out"), "../../../etc/passwd");
    assert!(
        escaping.errno.is_some(),
        "a link whose `..` leave the root was created"
    );
    assert!(
        escaping
            .trace
            .iter()
            .any(|line| line.contains("REFUSED") && line.contains("EPERM")),
        "the mount did not refuse the escaping link with EPERM: {:#?}",
        escaping.trace
    );
    assert!(
        matches!(escaping.errno, Some(libc::EPERM) | Some(libc::EACCES)),
        "the caller saw errno {:?}, not a permission refusal",
        escaping.errno
    );
    if escaping.errno != Some(libc::EPERM) {
        eprintln!(
            "--- the server answered EPERM, the caller saw {:?} ---\n{}",
            escaping.errno,
            diagnostics(&mnt, &tree)
        );
    }
    let absolute = refused_symlink(&format!("{mnt}/lab/out"), "/etc/passwd");
    assert!(
        absolute.errno.is_some(),
        "a link out of the tree was created"
    );
    assert!(
        absolute
            .trace
            .iter()
            .any(|line| line.contains("REFUSED") && line.contains("EPERM")),
        "the mount did not refuse the absolute link with EPERM: {:#?}",
        absolute.trace
    );
    assert!(
        matches!(absolute.errno, Some(libc::EPERM) | Some(libc::EACCES)),
        "the caller saw errno {:?}, not a permission refusal",
        absolute.errno
    );
    if absolute.errno != Some(libc::EPERM) {
        eprintln!(
            "--- the server answered EPERM (absolute), the caller saw {:?} ---\n{}",
            absolute.errno,
            diagnostics(&mnt, &tree)
        );
    }
    let (ok, hard) = shell(format!("ln {mnt}/lab/a.txt {mnt}/lab/second"));
    assert!(!ok, "a hard link was created: {hard}");

    let (ok, moved) = shell(format!("mv {mnt}/lab/a.txt {mnt}/ro/a.txt"));
    assert!(!ok, "a rename crossed two Satellites");
    assert!(
        moved.contains("inter-device move"),
        "mv did not answer EXDEV, it said {moved}"
    );

    // TEST_SCENARIO: a shell whose working directory is inside the tree, across the machine going quiet and answering again: the numbers of that tree have to outlive the cache the platform's answer just dropped.
    let shell_in_tree = Command::new("sh")
        .arg("-c")
        .arg(format!(
            "cd {mnt}/lab || exit 1; cat a2.txt; echo; sleep 2; cat a2.txt 2>&1; echo; sleep 2; cat a2.txt 2>&1; echo; sleep 2; cat a2.txt 2>&1; echo"
        ))
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("a shell in the tree");
    std::thread::sleep(Duration::from_millis(1300));
    offline(&state);
    std::thread::sleep(Duration::from_millis(2000));
    online(&state);
    let output = shell_in_tree
        .wait_with_output()
        .expect("the shell in the tree");
    let lines: Vec<&str> = std::str::from_utf8(&output.stdout)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    assert_eq!(
        lines.first(),
        Some(&"x"),
        "a read before the machine went quiet"
    );
    assert!(
        lines
            .get(1)
            .is_some_and(|line| line.contains("Host is down")),
        "a cached read of a quiet machine said {lines:?}"
    );
    assert_eq!(
        lines.get(2),
        Some(&"x"),
        "the tree came back without the shell being restarted: {lines:?}"
    );

    state.set_grants(vec![Grant {
        name: String::from("ro"),
        writable: false,
        online: true,
    }]);
    let (ok, listed) = shell(format!("ls {mnt}"));
    assert!(ok, "ls after a grant was withdrawn: {listed}");
    assert_eq!(listed.lines().collect::<Vec<_>>(), vec!["ro"]);
    let (ok, gone) = shell(format!("cat {mnt}/lab/a2.txt"));
    assert!(!ok, "a revoked Satellite answered");
    assert!(
        gone.contains("No such file or directory"),
        "the refusal said {gone}"
    );

    super::unmount(&state).unwrap();
    let (_, away) = shell(format!("ls {mnt}"));
    assert!(
        !away.contains("ro"),
        "the mount answered after it was unmounted: {away}"
    );
    let started = std::time::Instant::now();
    let mut back = false;
    while started.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(250));
        let (ok, listed) = shell(format!("ls {mnt}"));
        if ok && listed.contains("ro") {
            back = true;
            break;
        }
    }
    assert!(
        back,
        "the mount did not come back within {:?}",
        started.elapsed()
    );
    assert!(
        started.elapsed() <= Duration::from_secs(7),
        "the mount took {:?} to come back",
        started.elapsed()
    );
    let (ok, listed) = shell(format!("ls {mnt}"));
    assert!(
        ok && listed.lines().eq(["ro"]),
        "the remount lists {listed}"
    );

    super::unmount(&state).unwrap();
    let _ = std::fs::remove_dir(&dir);
}

fn grant(name: &str) -> Grant {
    Grant {
        name: name.to_string(),
        writable: true,
        online: true,
    }
}

fn offline(state: &State) {
    let held: Vec<Grant> = state
        .grants()
        .into_iter()
        .map(|mut grant| {
            grant.online = false;
            grant
        })
        .collect();
    state.set_grants(held);
}

fn online(state: &State) {
    let held: Vec<Grant> = state
        .grants()
        .into_iter()
        .map(|mut grant| {
            grant.online = true;
            grant
        })
        .collect();
    state.set_grants(held);
}

struct Refused {
    errno: Option<i32>,
    trace: Vec<String>,
}

fn refused_symlink(path: &str, target: &str) -> Refused {
    let _ = super::trace::take();
    let result = std::os::unix::fs::symlink(target, path);
    Refused {
        errno: result.err().and_then(|err| err.raw_os_error()),
        trace: super::trace::take(),
    }
}

fn diagnostics(mnt: &str, tree: &Tree) -> String {
    let environment = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!(
            "id -a; uname -r; uname -m; grep -E 'Cap(Eff|Prm)' /proc/self/status; stat -c 'parent %a %u %g %F' {mnt}/lab/docs/notes"
        ))
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_string())
        .unwrap_or_default();
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo")
        .unwrap_or_default()
        .lines()
        .filter(|line| line.contains(mnt))
        .map(|line| format!("mountinfo {line}\n"))
        .collect::<String>();
    format!(
        "{mountinfo}environment: {environment}platform trace: {:#?}",
        tree.trace()
    )
}

fn temp() -> PathBuf {
    let output = Command::new("mktemp")
        .arg("-d")
        .arg("-t")
        .arg("satellite-mount.XXXXXX")
        .output()
        .expect("mktemp");
    assert!(
        output.status.success(),
        "mktemp: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    PathBuf::from(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// UNIT_BOUNDARY_DESCRIPTION: a platform hand-written over a TCP socket, which is what the client's tests need: it answers each request with what the test says and lives as long as the test process does. One request per connection with `Connection: close`, so no state has to be kept between requests and the test's handler is the whole of the platform's behaviour.
struct Platform {
    url: String,
}

impl Platform {
    fn start(
        handler: impl Fn(&str, &serde_json::Value) -> (u16, String) + Clone + Send + 'static,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a listener");
        let url = format!("http://{}", listener.local_addr().expect("an address"));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                // UNIT_BOUNDARY_DESCRIPTION: one thread per connection, as a real platform serves: a fake that answered one at a time could not show whether the mount had two requests in flight at once.
                let handler = handler.clone();
                std::thread::spawn(move || answer(stream, &handler));
            }
        });
        Self { url }
    }

    fn url(&self) -> &str {
        &self.url
    }
}

fn answer(mut stream: TcpStream, handler: &impl Fn(&str, &serde_json::Value) -> (u16, String)) {
    let mut reader = BufReader::new(stream.try_clone().expect("a copy of the socket"));
    let mut request = String::new();
    if reader.read_line(&mut request).is_err() {
        return;
    }
    let target = request.split_whitespace().nth(1).unwrap_or("/").to_string();
    let mut length = 0;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
            break;
        }
        if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
            length = value.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0; length];
    let _ = reader.read_exact(&mut body);
    let document: serde_json::Value =
        serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    let (status, text) = handler(&target, &document);
    let response = format!(
        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
        text.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

// UNIT_BOUNDARY_DESCRIPTION: the platform the mount test talks to: two Satellites of a tree each, `lab` writable and `ro` read-only, held in memory and answered operation by operation with the rules the real worker enforces for the few it is asked. It is a fake, so it proves nothing about the worker; it proves that the mount asks the right questions and shows the answers.
struct Tree {
    nodes: Mutex<BTreeMap<(&'static str, String), InMemory>>,
    next_ino: AtomicUsize,
    reads: AtomicUsize,
    writes: AtomicUsize,
    trace: Mutex<Vec<String>>,
    gate: Mutex<Gate>,
    gate_cv: std::sync::Condvar,
}

// UNIT_BOUNDARY_DESCRIPTION: the hold that proves two requests were in flight at the same moment. An operation whose path begins `gate/` waits here until `expected` of them have arrived, or three seconds pass: a mount that answers one request at a time never gets the second one in, so the wait times out and the caller reads `joined` as false.
struct Gate {
    expected: usize,
    arrived: usize,
    joined: bool,
}

struct InMemory {
    kind: &'static str,
    data: Vec<u8>,
    target: String,
    mode: u32,
    ino: u64,
}

impl Tree {
    fn seeded() -> Self {
        let tree = Self {
            nodes: Mutex::new(BTreeMap::new()),
            next_ino: AtomicUsize::new(2),
            reads: AtomicUsize::new(0),
            writes: AtomicUsize::new(0),
            trace: Mutex::new(Vec::new()),
            gate: Mutex::new(Gate {
                expected: 2,
                arrived: 0,
                joined: false,
            }),
            gate_cv: std::sync::Condvar::new(),
        };
        for satellite in ["lab", "ro"] {
            for directory in ["", "docs", "docs/notes", "gate"] {
                tree.add(satellite, directory, "dir", String::new(), 0o755);
            }
            for (path, contents) in [
                ("a.txt", "hello\n"),
                ("docs/notes.md", "# notes\n"),
                ("gate/a.txt", "gate a\n"),
                ("gate/b.txt", "gate b\n"),
            ] {
                tree.add(satellite, path, "file", contents.to_string(), 0o644);
            }
        }
        // UNIT_BOUNDARY_DESCRIPTION: a FIFO, a socket or a device the machine holds: the platform can describe it only as "other", and one of them must not fail the listing of its directory.
        // UNIT_BOUNDARY_DESCRIPTION: two special files, one of each shape the platform answers: `fifo` has nothing to hand over and is refused when it is opened, `pipe` claims a byte and is refused when that byte is read.
        tree.add("lab", "fifo", "other", String::new(), 0o644);
        tree.add("lab", "pipe", "other", String::from("z"), 0o644);
        tree.add_link("lab", "outside", "/etc/passwd");
        tree.add("lab", "many", "dir", String::new(), 0o755);
        for number in 0..600 {
            tree.add(
                "lab",
                &format!("many/f{number:04}"),
                "file",
                String::from("x\n"),
                0o644,
            );
        }
        tree
    }

    fn add(
        &self,
        satellite: &'static str,
        path: &str,
        kind: &'static str,
        data: String,
        mode: u32,
    ) {
        let ino = self.next_ino.fetch_add(1, Ordering::SeqCst) as u64;
        self.nodes.lock().unwrap().insert(
            (satellite, path.to_string()),
            InMemory {
                kind,
                data: data.into_bytes(),
                target: String::new(),
                mode,
                ino,
            },
        );
    }

    fn add_link(&self, satellite: &'static str, path: &str, target: &str) {
        let ino = self.next_ino.fetch_add(1, Ordering::SeqCst) as u64;
        self.nodes.lock().unwrap().insert(
            (satellite, path.to_string()),
            InMemory {
                kind: "link",
                data: Vec::new(),
                target: target.to_string(),
                mode: 0o777,
                ino,
            },
        );
    }

    fn reads(&self) -> usize {
        self.reads.load(Ordering::SeqCst)
    }

    fn platform(tree: Arc<Tree>) -> Platform {
        Platform::start(move |path, body| tree.answer(path, body))
    }

    fn writes(&self) -> usize {
        self.writes.load(Ordering::SeqCst)
    }

    fn content(&self, satellite: &str, path: &str) -> Option<String> {
        let nodes = self.nodes.lock().unwrap();
        let node = nodes.get(&(satellite_id(satellite), path.to_string()))?;
        String::from_utf8(node.data.clone()).ok()
    }

    fn answer(&self, target: &str, body: &serde_json::Value) -> (u16, String) {
        let rest = target
            .split_once("/api/agents/")
            .map(|(_, rest)| rest)
            .unwrap_or_default();
        if rest.ends_with("/satellite-files") {
            return (
                200,
                json!({"satellites":[
                    {"name":"lab","writable":true,"online":true},
                    {"name":"ro","writable":false,"online":true}
                ]})
                .to_string(),
            );
        }
        let Some((_, rest)) = rest.split_once("/satellite-files/") else {
            return (404, String::new());
        };
        let Some((satellite, rest)) = rest.split_once('/') else {
            return (404, String::new());
        };
        if rest != "op" || !matches!(satellite, "lab" | "ro") {
            return (404, String::new());
        }
        self.hold(body["path"].as_str().unwrap_or_default());
        (200, self.operate(satellite_id(satellite), body).to_string())
    }

    fn joined(&self) -> bool {
        self.gate
            .lock()
            .unwrap_or_else(|held| held.into_inner())
            .joined
    }

    // UNIT_BOUNDARY_DESCRIPTION: holds an operation that names `gate/` until another one arrives, so the caller learns whether two were ever in flight together.
    fn hold(&self, path: &str) {
        if !path.starts_with("gate/") {
            return;
        }
        let mut gate = self.gate.lock().unwrap_or_else(|held| held.into_inner());
        gate.arrived += 1;
        if gate.arrived >= gate.expected {
            gate.joined = true;
            self.gate_cv.notify_all();
            return;
        }
        let (held, _) = self
            .gate_cv
            .wait_timeout(gate, std::time::Duration::from_secs(3))
            .unwrap_or_else(|held| held.into_inner());
        gate = held;
        drop(gate);
    }

    fn trace(&self) -> Vec<String> {
        std::mem::take(&mut *self.trace.lock().unwrap_or_else(|held| held.into_inner()))
    }

    fn operate(&self, satellite: &'static str, body: &serde_json::Value) -> serde_json::Value {
        let answer = self.operate_inner(satellite, body);
        self.trace
            .lock()
            .unwrap_or_else(|held| held.into_inner())
            .push(format!(
                "platform op={:?} path={:?} target={:?} -> {}",
                body["op"].as_str().unwrap_or_default(),
                body["path"].as_str().unwrap_or_default(),
                body["target"].as_str().unwrap_or_default(),
                answer
            ));
        answer
    }

    fn operate_inner(
        &self,
        satellite: &'static str,
        body: &serde_json::Value,
    ) -> serde_json::Value {
        let op = body["op"].as_str().unwrap_or_default();
        let path = body["path"].as_str().unwrap_or_default();
        let path = if path == wire::ROOT_PATH { "" } else { path };
        let mut nodes = self.nodes.lock().unwrap();
        let key = (satellite, path.to_string());
        let writable = satellite == "lab";
        let attributes = |nodes: &BTreeMap<(&'static str, String), InMemory>, path: &str| {
            let node = nodes.get(&(satellite, path.to_string()))?;
            Some(json!({
                "kind": node.kind,
                "size": node.data.len(),
                "mode": node.mode,
                "dev": 7,
                "ino": node.ino,
                "mtimeMs": 1000,
                "ctimeMs": 1000,
                "atimeMs": 1000,
            }))
        };
        let error = |errno: &str| json!({"ok": false, "errno": errno});
        let read_only = |errno: &str| {
            if writable {
                None
            } else {
                Some(error(errno))
            }
        };
        match op {
            "lookup" | "getattr" => match attributes(&nodes, path) {
                Some(attrs) => json!({"ok": true, "result": attrs}),
                None => error("ENOENT"),
            },
            "readdir" => {
                if attributes(&nodes, path).is_none() {
                    return error("ENOENT");
                }
                let offset = body["offset"].as_u64().unwrap_or(0) as usize;
                let names: Vec<String> = nodes
                    .keys()
                    .filter(|(of, child)| *of == satellite && !child.is_empty())
                    .filter(|(_, child)| parent_of(child) == path)
                    .map(|(_, child)| child.rsplit('/').next().unwrap_or_default().to_string())
                    .collect();
                let entries: Vec<serde_json::Value> = names
                    .iter()
                    .skip(offset)
                    .take(256)
                    .filter_map(|name| {
                        let child = if path.is_empty() {
                            name.clone()
                        } else {
                            format!("{path}/{name}")
                        };
                        let mut attrs = attributes(&nodes, &child)?;
                        attrs["name"] = json!(name);
                        Some(attrs)
                    })
                    .collect();
                json!({"ok": true, "result": {"entries": entries, "next": offset + entries.len()}})
            }
            "read" => {
                self.reads.fetch_add(1, Ordering::SeqCst);
                if nodes.get(&key).is_some_and(|node| node.kind == "other") {
                    return error("EPERM");
                }
                let Some(node) = nodes.get(&key) else {
                    return error("ENOENT");
                };
                let offset = body["offset"].as_u64().unwrap_or(0) as usize;
                let size = body["size"].as_u64().unwrap_or(0) as usize;
                let from = offset.min(node.data.len());
                let to = (offset + size).min(node.data.len());
                json!({"ok": true, "data": base64(&node.data[from..to])})
            }
            "readlink" => match nodes.get(&key) {
                Some(node) => json!({"ok": true, "result": {"target": node.target}}),
                None => error("ENOENT"),
            },
            "open" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                let nothing_to_read = nodes.get(&key).is_some_and(|node| {
                    node.kind == "other"
                        && node.data.is_empty()
                        && !body["write"].as_bool().unwrap_or(false)
                });
                if nothing_to_read {
                    return error("EPERM");
                }
                match attributes(&nodes, path) {
                    Some(attrs) => json!({"ok": true, "result": attrs}),
                    None => error("ENOENT"),
                }
            }
            "create" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                if body["exclusive"].as_bool().unwrap_or(false) && nodes.contains_key(&key) {
                    return error("EEXIST");
                }
                let ino = self.next_ino.fetch_add(1, Ordering::SeqCst) as u64;
                nodes.insert(
                    key.clone(),
                    InMemory {
                        kind: "file",
                        data: Vec::new(),
                        target: String::new(),
                        mode: body["mode"].as_u64().unwrap_or(0o644) as u32,
                        ino,
                    },
                );
                match attributes(&nodes, path) {
                    Some(attrs) => json!({"ok": true, "result": attrs}),
                    None => error("EIO"),
                }
            }
            "write" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                self.writes.fetch_add(1, Ordering::SeqCst);
                let data = base64_decode(body["data"].as_str().unwrap_or_default());
                let offset = body["offset"].as_u64().unwrap_or(0) as usize;
                let Some(node) = nodes.get_mut(&key) else {
                    return error("ENOENT");
                };
                if node.data.len() < offset + data.len() {
                    node.data.resize(offset + data.len(), 0);
                }
                node.data[offset..offset + data.len()].copy_from_slice(&data);
                match attributes(&nodes, path) {
                    Some(attrs) => json!({"ok": true, "result": attrs}),
                    None => error("EIO"),
                }
            }
            "truncate" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                let size = body["size"].as_u64().unwrap_or(0) as usize;
                let Some(node) = nodes.get_mut(&key) else {
                    return error("ENOENT");
                };
                node.data.resize(size, 0);
                match attributes(&nodes, path) {
                    Some(attrs) => json!({"ok": true, "result": attrs}),
                    None => error("EIO"),
                }
            }
            "setattr" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                if let Some(mode) = body["mode"].as_u64() {
                    if let Some(node) = nodes.get_mut(&key) {
                        node.mode = mode as u32;
                    }
                }
                match attributes(&nodes, path) {
                    Some(attrs) => json!({"ok": true, "result": attrs}),
                    None => error("ENOENT"),
                }
            }
            "mkdir" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                if nodes.contains_key(&key) {
                    return error("EEXIST");
                }
                let ino = self.next_ino.fetch_add(1, Ordering::SeqCst) as u64;
                nodes.insert(
                    key.clone(),
                    InMemory {
                        kind: "dir",
                        data: Vec::new(),
                        target: String::new(),
                        mode: body["mode"].as_u64().unwrap_or(0o755) as u32,
                        ino,
                    },
                );
                json!({"ok": true})
            }
            "rmdir" | "unlink" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                match nodes.remove(&key) {
                    Some(_) => json!({"ok": true}),
                    None => error("ENOENT"),
                }
            }
            "symlink" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                let target = body["target"].as_str().unwrap_or_default();
                if target.starts_with('/') {
                    return error("EPERM");
                }
                let ino = self.next_ino.fetch_add(1, Ordering::SeqCst) as u64;
                nodes.insert(
                    key.clone(),
                    InMemory {
                        kind: "link",
                        data: Vec::new(),
                        target: target.to_string(),
                        mode: 0o777,
                        ino,
                    },
                );
                match attributes(&nodes, path) {
                    Some(attrs) => json!({"ok": true, "result": attrs}),
                    None => error("EIO"),
                }
            }
            "rename" => {
                if let Some(refused) = read_only("EROFS") {
                    return refused;
                }
                let from = body["from"].as_str().unwrap_or_default();
                let to = body["to"].as_str().unwrap_or_default();
                let Some(node) = nodes.remove(&(satellite, from.to_string())) else {
                    return error("ENOENT");
                };
                nodes.insert((satellite, to.to_string()), node);
                json!({"ok": true})
            }
            "statfs" => {
                json!({"ok": true, "result": {"bsize": 4096, "blocks": 1000, "bfree": 500, "bavail": 500, "files": 10, "ffree": 5}})
            }
            other => {
                eprintln!("the fake platform does not know {other}");
                error("ENOTSUP")
            }
        }
    }
}

fn satellite_id(name: &str) -> &'static str {
    if name == "lab" {
        "lab"
    } else {
        "ro"
    }
}

fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

fn base64(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap_or_default()
}
