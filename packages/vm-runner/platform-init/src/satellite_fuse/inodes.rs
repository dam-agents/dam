// UNIT_BOUNDARY_DESCRIPTION: the numbers the kernel knows the mount by. The kernel names a file only by inode number, and the platform only by a Satellite and a path relative to its root, so this table is the one place the two meet: it hands out numbers that are never used twice within one mount, keeps one number for one path for as long as that path is known, and remembers the device and inode identity the platform gave each entry, which is what makes a read, a write or a truncate through a handle refuse as stale once the path names another file. Ceiling: the kernel's forget is ignored, so an entry lives until its grant is withdrawn and is freed only then, which is what lets a process keep a directory as its working directory across a machine going quiet and coming back. An entry costs about 200 bytes plus twice its Satellite's name and its path, once by number and once by path, each with its own string: measured at a walk of 27-byte paths with a three-letter Satellite, 100k entries held 35 MB and 1M held 423 MB of resident memory, and both are held until the grant goes away. The upgrade is a lookup count per inode and freeing it on forget.
use std::collections::HashMap;

use super::wire::Failure;

pub const ROOT: u64 = 1;

// UNIT_BOUNDARY_DESCRIPTION: one entry as the two sides name it. `satellite` is empty for the mount's own root and `path` is empty for a Satellite's root, so the mount root is one entry and each granted Satellite is the entry below it. `special` is the platform's word that this is a FIFO, a socket or a device rather than a file: the kernel is shown a regular file, because that is the one shape whose every open and read stays on the channel, and the mount has to remember the platform said otherwise to keep it there — a regular file of size zero would answer its own EOF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub satellite: String,
    pub path: String,
    pub dev: u64,
    pub ino: u64,
    pub generation: u64,
    pub special: bool,
}

pub struct Table {
    next_number: u64,
    next_handle: u64,
    by_number: HashMap<u64, Node>,
    by_path: HashMap<(String, String), u64>,
    handles: HashMap<u64, Node>,
}

impl Table {
    pub fn new() -> Self {
        let mut table = Self {
            next_number: ROOT + 1,
            next_handle: 1,
            by_number: HashMap::new(),
            by_path: HashMap::new(),
            handles: HashMap::new(),
        };
        let root = Node {
            satellite: String::new(),
            path: String::new(),
            dev: 0,
            ino: 0,
            generation: 0,
            special: false,
        };
        table.by_number.insert(ROOT, root.clone());
        table.by_path.insert((String::new(), String::new()), ROOT);
        table
    }

    pub fn get(&self, number: u64) -> Option<Node> {
        self.by_number.get(&number).cloned()
    }

    // UNIT_BOUNDARY_DESCRIPTION: the number a path has, or a new one, without changing the identity a lookup already recorded. A directory named by the kernel's `..` and a Satellite's own entry are placed this way: neither carries the platform's device and inode, and a zero identity written over one that was known would make every handle of it stale.
    pub fn place(&mut self, satellite: &str, path: &str) -> u64 {
        let key = (satellite.to_string(), path.to_string());
        if let Some(number) = self.by_path.get(&key) {
            return *number;
        }
        let number = self.next_number;
        self.next_number += 1;
        let node = Node {
            satellite: key.0.clone(),
            path: key.1.clone(),
            dev: 0,
            ino: 0,
            generation: 0,
            special: false,
        };
        self.by_number.insert(number, node);
        self.by_path.insert(key, number);
        number
    }

    // UNIT_BOUNDARY_DESCRIPTION: the number of a path the platform has just described, and the generation to report with it. A path that now names another device and inode keeps its number but moves to a new generation, which is the kernel's signal that what it cached about the entry is no longer what is there.
    pub fn intern(
        &mut self,
        satellite: &str,
        path: &str,
        dev: u64,
        ino: u64,
        special: bool,
    ) -> (u64, u64) {
        let number = self.place(satellite, path);
        let Some(node) = self.by_number.get_mut(&number) else {
            return (number, 0);
        };
        node.special = special;
        if node.dev != dev || node.ino != ino {
            if node.dev != 0 || node.ino != 0 {
                node.generation += 1;
            }
            node.dev = dev;
            node.ino = ino;
        }
        (number, node.generation)
    }

    // UNIT_BOUNDARY_DESCRIPTION: the numbers a Satellite's tree holds, without forgetting them: what the kernel must be told to drop when the Satellite goes quiet, which is not the same as the Satellite going away. A process whose working directory is inside the tree keeps its walk across an offline machine, so its numbers outlive the cache that answered it.
    pub fn numbers(&self, satellite: &str) -> Vec<u64> {
        self.by_number
            .iter()
            .filter(|(_, node)| node.satellite == satellite)
            .map(|(number, _)| *number)
            .collect()
    }

    // UNIT_BOUNDARY_DESCRIPTION: one path detached, and with it the number that named it, which is what an unlink, an rmdir and a rename that replaces a target each take away. The number is dropped rather than kept for a path that is gone: the kernel may still hold it in a direction of its own, and a number that came back as another file would answer for both, while the honest answer for a file that is no longer there is a stale handle.
    pub fn detach(&mut self, satellite: &str, path: &str) {
        if let Some(number) = self
            .by_path
            .remove(&(satellite.to_string(), path.to_string()))
        {
            self.by_number.remove(&number);
        }
        self.handles
            .retain(|_, node| !(node.satellite == satellite && node.path == path));
    }

    // UNIT_BOUNDARY_DESCRIPTION: a path that moved, and with it every path below it and every handle open on one: the platform names a file by its path, so a number left pointing at where the file was would answer ENOENT for a file that exists, and a directory that moved would strand everything it holds. The caller re-keys only after the platform agreed to the move, and detaches the path it replaced first.
    pub fn rename(&mut self, satellite: &str, from: &str, to: &str) {
        let moved: Vec<(u64, String, String)> = self
            .by_number
            .iter()
            .filter(|(_, node)| node.satellite == satellite)
            .filter_map(|(number, node)| {
                let rest = node.path.strip_prefix(from)?;
                if node.path.is_empty() || (!rest.is_empty() && !rest.starts_with('/')) {
                    return None;
                }
                Some((*number, node.path.clone(), format!("{to}{rest}")))
            })
            .collect();
        for (number, was, now) in moved {
            self.by_path.remove(&(satellite.to_string(), was.clone()));
            self.by_path
                .insert((satellite.to_string(), now.clone()), number);
            if let Some(node) = self.by_number.get_mut(&number) {
                node.path.clone_from(&now);
            }
            for handle in self.handles.values_mut() {
                if handle.satellite == satellite && handle.path == was {
                    handle.path.clone_from(&now);
                }
            }
        }
    }

    // UNIT_BOUNDARY_DESCRIPTION: every number a Satellite's tree holds, forgotten, for the kernel to be told that what it cached of them is gone. The numbers themselves are never handed out again: the kernel may still hold one in a dentry of its own, and a number that came back as another file would answer for both.
    pub fn forget(&mut self, satellite: &str) -> Vec<u64> {
        let mut numbers = Vec::new();
        self.by_number.retain(|number, node| {
            let forget = node.satellite == satellite;
            if forget {
                numbers.push(*number);
            }
            !forget
        });
        self.by_path.retain(|(name, _), _| name != satellite);
        self.handles.retain(|_, node| node.satellite != satellite);
        numbers
    }

    pub fn open(&mut self, node: &Node) -> u64 {
        let handle = self.next_handle;
        self.next_handle += 1;
        self.handles.insert(handle, node.clone());
        handle
    }

    pub fn handle(&self, handle: u64) -> Option<Node> {
        self.handles.get(&handle).cloned()
    }

    pub fn close(&mut self, handle: u64) {
        self.handles.remove(&handle);
    }
}

// UNIT_BOUNDARY_DESCRIPTION: a rename never crosses a Satellite, because each is a directory tree on a machine of its own. The platform answers EXDEV for one that would, and the mount decides it here as well, so `mv` between two Satellites copies and then deletes from the first operation on, as it does between two devices.
pub fn rename_stays_put(parent: &Node, newparent: &Node) -> Result<(), Failure> {
    if parent.satellite == newparent.satellite {
        Ok(())
    } else {
        Err(Failure::CrossDevice)
    }
}
