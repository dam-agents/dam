// UNIT_BOUNDARY_DESCRIPTION: the storage guard's decisions, apart from the file and the disk it sizes (boot::guard_pool), so they build and are tested on every host the runner builds on and not only in a Linux guest: how large the guard file is to be at each look, when it moves, and what it settles at when the disk holds less than statvfs reports.
pub const POOL_GUARD_FLOOR: u64 = 256 << 20;
pub const POOL_GUARD_STEP: u64 = 16 << 20;

// UNIT_BOUNDARY_DESCRIPTION: what the guard knows between two looks: the latest grant, as its id and bytes and what the guest had written when it came, and, once the guest is held below the floor, what it had written then. The floor is one allowance per shortage and not per look: it counts down from that point across every grant too small to hold it, and is given again only once a grant arrives that holds it, which means the claim has room again. So a guest past its grant adds at most the floor in all, however many grants of nothing the runner renews. A guest that used it up gets room back once the claim has room, or with the fresh floor of its next boot, which is how its user gets in to free its own files. `ceiling` is the largest guard the disk took when it refused a larger one, and what the guest had written then: what the disk holds beyond the guest's use, which the guard counts on, less what the guest wrote since, until the guest frees more than POOL_GUARD_STEP, so a refused size is not asked again at every look. `keep` is the room the last look left the guest, and `short` whether a refusal was warned of since the last move that fit whole.
#[derive(Default)]
pub struct PoolGuard {
    grant: Option<(String, u64, u64)>,
    floor_from: Option<u64>,
    ceiling: Option<(u64, u64)>,
    pub keep: u64,
    short: bool,
}

impl PoolGuard {
    // UNIT_BOUNDARY_DESCRIPTION: takes one look's grant, and returns how large the guard file is to be, given the guest could still write `avail` bytes without it and has written `used` bytes of its own. No grant holds nothing back.
    pub fn size(&mut self, grant: Option<(String, u64)>, avail: u64, used: u64) -> u64 {
        match grant {
            None => {
                *self = PoolGuard::default();
                return 0;
            }
            Some((id, bytes)) if self.grant.as_ref().is_none_or(|(held, ..)| *held != id) => {
                if bytes >= POOL_GUARD_FLOOR {
                    self.floor_from = None;
                }
                self.grant = Some((id, bytes, used));
            }
            Some(_) => {}
        }
        let Some((_, bytes, used_at)) = self.grant else {
            return 0;
        };
        let left = bytes.saturating_sub(used.saturating_sub(used_at));
        if left < POOL_GUARD_FLOOR && self.floor_from.is_none() {
            self.floor_from = Some(used);
        }
        let floor = self.floor_from.map_or(POOL_GUARD_FLOOR, |from| {
            POOL_GUARD_FLOOR.saturating_sub(used.saturating_sub(from))
        });
        self.keep = left.max(floor);
        avail.saturating_sub(self.keep)
    }

    // UNIT_BOUNDARY_DESCRIPTION: grows the guard from `held` toward `want` through `fits`, which resizes the file to the given size and says whether the disk took it: a preallocation takes all of it or nothing. When `want` does not fit, the disk holds less than statvfs reported, so it bisects between the two until within POOL_GUARD_STEP, for the largest guard that fits, about 14 preallocations on a 200 GiB disk; which is what the guest could write without one. A coarser ceiling would hand its gap back to the guest at every look, past its grant. That is the ceiling until the guest frees room (guard_look), and the guard settles at it less the room the guest is to keep, in one more resize. Returns the size the guard settled at and whether this refusal starts a shortage, the one time it is worth a warning.
    pub fn grow(
        &mut self,
        held: u64,
        want: u64,
        used: u64,
        mut fits: impl FnMut(u64) -> bool,
    ) -> (u64, bool) {
        if fits(want) {
            self.short = false;
            return (want, false);
        }
        let (mut low, mut high) = (held, want);
        while high - low > POOL_GUARD_STEP {
            let mid = low + (high - low) / 2;
            if fits(mid) {
                low = mid;
            } else {
                high = mid;
            }
        }
        self.ceiling = Some((low, used));
        let settle = low.saturating_sub(self.keep);
        (
            if fits(settle) { settle } else { low },
            !std::mem::replace(&mut self.short, true),
        )
    }
}

pub fn read_grant(text: &str) -> Option<(String, u64)> {
    let mut words = text.split_whitespace();
    let id = words.next()?.to_string();
    Some((id, words.next()?.parse().ok()?))
}

// UNIT_BOUNDARY_DESCRIPTION: how much the agent may still write before its writes fail: what a grant leaves it, no more than the disk itself has free, or, with no grant to hold it back, the disk's own free space. An eviction does not move it, since what an eviction frees is the guard's to take again while the claim under the disk stays full, so a mark on it does not flicker with every pass.
pub fn guest_room(keep: u64, granted: bool, avail: u64) -> u64 {
    if granted {
        keep.min(avail)
    } else {
        avail
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the bytes of the guard's blocks that count as the guest's free space when eviction reads the disk: the room the last look left the guest, which is its own room held back rather than used, and no more than the blocks the guard really holds, so a guard whose file lags its size never counts room the disk does not have.
pub fn credited(held: u64, keep: u64) -> u64 {
    keep.min(held)
}

// UNIT_BOUNDARY_DESCRIPTION: what the agent's room means for its writes, as one of three marks: nothing it writes lands below HOME_FULL_BYTES, its writes are held back below POOL_GUARD_FLOOR, and above that it writes as it likes. The gap between the two levels is the hysteresis: a home hovering on one of them is not marked again at every look.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Room {
    Full,
    Held,
    Room,
}

pub fn room_of(room: u64) -> Room {
    if room < crate::guest::HOME_FULL_BYTES {
        Room::Full
    } else if room < POOL_GUARD_FLOOR {
        Room::Held
    } else {
        Room::Room
    }
}

// UNIT_BOUNDARY_DESCRIPTION: one look of the guard: what the guard file is to be resized to, or None to leave it. `used` and `avail` are what statvfs reports, the guard's own blocks included, `held` is what those blocks are now, and `disk` is the filesystem's size. On btrfs `avail` is an estimate that counts unallocated device space and does not drop by a preallocated file's full size, so `avail + held` can pass the whole disk; the guard counts on no more free than the disk holds beyond the guest's use, nor than the disk last took, and leaves the guest its room out of that. It keeps no margin of its own beyond that: one taken off the guest's free space would be given back at every look, so a guest held at nothing could still write without end. btrfs keeps its global reserve out of what a preallocation can take, and what else it needs for metadata the refused preallocation finds (PoolGuard::grow). It moves only by more than POOL_GUARD_STEP, or to nothing, and only once `backed_off`, a commit interval after its last move, so a look that statvfs answers from before that move does not move it again.
pub fn guard_look(
    state: &mut PoolGuard,
    grant: Option<(String, u64)>,
    used: u64,
    avail: u64,
    held: u64,
    disk: u64,
    backed_off: bool,
) -> Option<u64> {
    let mine = used.saturating_sub(held);
    if state
        .ceiling
        .is_some_and(|(_, at)| mine.saturating_add(POOL_GUARD_STEP) < at)
    {
        state.ceiling = None;
    }
    let fits = state.ceiling.map_or(u64::MAX, |(fitted, at)| {
        fitted.saturating_sub(mine.saturating_sub(at))
    });
    let room = disk.saturating_sub(mine).min(fits);
    let want = state.size(grant, avail.saturating_add(held).min(room), mine);
    (backed_off && (want.abs_diff(held) > POOL_GUARD_STEP || (want == 0 && held > 0)))
        .then_some(want)
}

#[cfg(test)]
mod tests {
    // TEST_OVERVIEW: the storage guard holds a guest to the room the runner grants it on the owner's claim. It must leave the guest what is left of its grant and at most the floor past it, move once under btrfs's commit lag, never ask for more than the disk holds, and settle at what the disk takes when that is less than statvfs reports, without asking again and warning at every look.
    use super::*;

    const GIB: u64 = 1 << 30;

    // TEST_SCENARIO: a guest that has run out of room is marked full on the console and marked again only when its room changes, and the room it is judged by is what it may really write: a grant's leftovers, no more than the disk has free, and the disk's own free space when no grant holds it back. Eviction counts the guard's blocks as the guest's free space only up to the room the last look left it, so a guest at its grant reads its disk as full: counting the guard's blocks in full is what kept the disk reading as free while every write failed.
    #[test]
    fn a_guest_at_its_grant_is_marked_full() {
        const MIB: u64 = 1 << 20;
        assert_eq!(guest_room(4 << 30, true, 8 << 30), 4 << 30);
        assert_eq!(guest_room(4 << 30, true, MIB), MIB);
        assert_eq!(guest_room(0, false, 1 << 30), 1 << 30);
        assert_eq!(credited(512 * MIB, 512 * MIB), 512 * MIB);
        assert_eq!(credited(0, 8 * MIB), 0);
        assert_eq!(credited(512 * MIB, 0), 0);
        assert_eq!(room_of(0), Room::Full);
        assert_eq!(room_of(crate::guest::HOME_FULL_BYTES - 1), Room::Full);
        assert_eq!(room_of(crate::guest::HOME_FULL_BYTES), Room::Held);
        assert_eq!(room_of(POOL_GUARD_FLOOR), Room::Room);
    }

    // TEST_SCENARIO: the guard file leaves the guest what is left of its grant: the grant less what the guest wrote since it came, never less than the floor, and nothing held back without a grant or when the disk has less free than the grant anyway. A new grant counts from what the guest had written when it came.
    #[test]
    fn the_storage_guard_leaves_the_guest_its_grant() {
        let grant = |id: &str, bytes| Some((id.to_string(), bytes));
        assert_eq!(PoolGuard::default().size(None, 90 * GIB, 5 * GIB), 0);
        let mut guard = PoolGuard::default();
        assert_eq!(
            guard.size(grant("1", 10 * GIB), 90 * GIB, 5 * GIB),
            80 * GIB
        );
        assert_eq!(
            guard.size(grant("1", 10 * GIB), 86 * GIB, 9 * GIB),
            80 * GIB
        );
        assert_eq!(
            guard.size(grant("2", 10 * GIB), 86 * GIB, 9 * GIB),
            76 * GIB
        );
        assert_eq!(guard.size(grant("3", 10 * GIB), 8 * GIB, 9 * GIB), 0);
        assert_eq!(read_grant("7 1024\n"), Some(("7".into(), 1024)));
        assert_eq!(read_grant("7"), None);
        assert_eq!(read_grant(""), None);
    }

    // TEST_SCENARIO: a guest that writes without pause past a grant of nothing, which the runner renews at every look while the claim stays full, may add the floor once and then nothing more: the floor counts down across the renewed grants rather than coming back with each, which would let one writer fill the claim a floor at a time. A grant with room gives the floor back.
    #[test]
    fn a_writer_past_its_grant_adds_at_most_the_floor_across_looks() {
        let (disk, start) = (100u64 << 30, 10u64 << 30);
        let mut guard = PoolGuard::default();
        let mut used = start;
        for tick in 0..400u64 {
            let room = Some(((tick / 15).to_string(), 0));
            let want = guard.size(room, disk - used, used);
            used += (disk - used).saturating_sub(want).min(100 << 20);
        }
        assert!(
            used - start <= POOL_GUARD_FLOOR,
            "wrote {} bytes past a grant of nothing",
            used - start
        );
        let want = guard.size(Some(("room".into(), 1 << 30)), disk - used, used);
        assert_eq!(disk - used - want, 1 << 30);
    }

    // TEST_SCENARIO: btrfs reports a resize of the guard in statvfs only at its next commit, so a look between the two counts the guard's blocks once from the file and not at all from statvfs, and once moved on that, the guard climbed and fell with every commit (0, 136, 272, 0 GB on one guest under a steady grant). Synced before and after it moves and backed off for a commit after, it moves once and stays; without either it keeps moving under the same lag.
    #[test]
    fn the_storage_guard_settles_when_statvfs_lags_a_commit() {
        let (disk, data, commit) = (300 * GIB, 25 * GIB, 15u64);
        let run = |synced: bool| {
            let mut state = PoolGuard::default();
            let (mut held, mut seen, mut moves, mut moved_at) = (0u64, 0u64, 0, None::<u64>);
            for tick in 0..120u64 {
                if tick % commit == 0 {
                    seen = held;
                }
                let backed_off = !synced || moved_at.is_none_or(|at| tick - at >= commit);
                let look = |state: &mut PoolGuard, seen: u64| {
                    let grant = Some(("1".to_string(), 161 * GIB));
                    guard_look(
                        state,
                        grant,
                        data + seen,
                        disk - data - seen,
                        held,
                        disk,
                        backed_off,
                    )
                };
                let Some(mut want) = look(&mut state, seen) else {
                    continue;
                };
                if synced {
                    seen = held;
                    let Some(again) = look(&mut state, seen) else {
                        continue;
                    };
                    want = again;
                }
                held = want.min(disk - data);
                if synced {
                    seen = held;
                }
                (moves, moved_at) = (moves + 1, Some(tick));
            }
            (held, moves)
        };
        assert_eq!(run(true), (disk - data - 161 * GIB, 1));
        let (_, moves) = run(false);
        assert!(moves > 1, "the unsynced guard moved only {moves} times");
    }

    // TEST_SCENARIO: on a 100 GiB btrfs disk a guest's statvfs reported free space that, with the guard's own blocks added, passed the whole disk, and the guard asked for 104 to 165 GB at every look, each refused. The guard counts on no more than the disk holds beyond the guest's own use, and leaves the guest its grant out of that.
    #[test]
    fn the_storage_guard_never_asks_for_more_than_the_disk() {
        let (disk, mine, held) = (100 * GIB, 20 * GIB, 40 * GIB);
        let mut state = PoolGuard::default();
        let want = guard_look(
            &mut state,
            Some(("1".into(), 10 * GIB)),
            mine + held,
            70 * GIB,
            held,
            disk,
            true,
        );
        assert_eq!(want, Some(disk - mine - 10 * GIB));
    }

    // TEST_SCENARIO: a guest that writes everything the guard leaves it, past a grant of nothing, on a disk whose statvfs reports far more free than the disk holds, adds at most the floor in all: the clamp to the disk leaves it no room of its own that comes back at every look.
    #[test]
    fn a_clamped_guard_holds_a_writer_past_its_grant() {
        let (disk, start) = (100 * GIB, 20 * GIB);
        let (mut state, mut mine, mut held) = (PoolGuard::default(), start, 0u64);
        for tick in 0..200u64 {
            let room = Some((tick.to_string(), 0));
            if let Some(want) = guard_look(&mut state, room, mine + held, disk, held, disk, true) {
                held = want;
            }
            mine += (disk - mine).saturating_sub(held).min(GIB);
        }
        assert!(
            mine - start <= POOL_GUARD_FLOOR + POOL_GUARD_STEP,
            "wrote {} bytes past a grant of nothing",
            mine - start
        );
    }

    // TEST_SCENARIO: when the disk takes less than the guard asks for, which btrfs's estimate of free space makes common, the guard finds the largest size that fits, to within POOL_GUARD_STEP, in a bounded number of preallocations, settles at that less the guest's grant so the guest keeps its room, warns once for the shortage, and asks no more at later looks. Once the guest frees room it asks again.
    #[test]
    fn a_refused_guard_settles_at_what_fits_and_warns_once() {
        let (disk, grant) = (100 * GIB, 10 * GIB);
        let fits_below = |mine: u64| disk - mine - 35 * GIB;
        let mut mine = 20 * GIB;
        let (mut state, mut held, mut warnings) = (PoolGuard::default(), 0u64, 0);
        let mut tries = vec![];
        for tick in 0..40u64 {
            if tick == 30 {
                assert_eq!(warnings, 1);
                assert_eq!(tries.len(), 1, "moves: {tries:?}");
                mine -= GIB;
            }
            let look = guard_look(
                &mut state,
                Some(("1".into(), grant)),
                mine + held,
                disk - mine - held,
                held,
                disk,
                true,
            );
            let Some(want) = look else {
                continue;
            };
            let mut n = 0;
            let (sized, warn) = state.grow(held, want, mine, |size| {
                n += 1;
                size <= fits_below(mine)
            });
            tries.push(n);
            held = sized;
            warnings += usize::from(warn);
            let free = fits_below(mine) - held;
            assert!(
                free >= grant && free - grant <= POOL_GUARD_STEP,
                "the guest keeps {free} bytes"
            );
        }
        assert_eq!(tries.len(), 2, "moves: {tries:?}");
        assert!(tries.iter().all(|&n| n <= 20), "tries: {tries:?}");
    }

    // TEST_SCENARIO: a guest that writes everything the guard leaves it, past a grant of nothing, on a disk that takes less than statvfs reports, adds at most the floor and one step in all: the ceiling the refused preallocation finds is within POOL_GUARD_STEP of what fits, so no gap below it comes back to the guest at each look.
    #[test]
    fn a_refused_guard_holds_a_writer_past_its_grant() {
        let (disk, start, hidden) = (100 * GIB, 20 * GIB, 30 * GIB);
        let (mut state, mut mine, mut held) = (PoolGuard::default(), start, 0u64);
        for tick in 0..200u64 {
            let room = Some((tick.to_string(), 0));
            if let Some(want) = guard_look(&mut state, room, mine + held, disk, held, disk, true) {
                let fits = disk - hidden - mine;
                held = if want > held {
                    state.grow(held, want, mine, |size| size <= fits).0
                } else {
                    want
                };
            }
            mine += (disk - hidden - mine).saturating_sub(held).min(GIB);
        }
        assert!(
            mine - start <= POOL_GUARD_FLOOR + 2 * POOL_GUARD_STEP,
            "wrote {} bytes past a grant of nothing",
            mine - start
        );
    }
}
