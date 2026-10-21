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

    // UNIT_BOUNDARY_DESCRIPTION: the grant generation the guard's accounting is based on, which is the one it last took up and not the one the runner last published: the two differ for as long as it takes the guard's own look to read the file. `size` is what sets it, so a generation reported here has had its room counted from the bytes the guest had written when the guard read it.
    pub fn applied(&self) -> Option<&str> {
        self.grant.as_ref().map(|(id, ..)| id.as_str())
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

// UNIT_BOUNDARY_DESCRIPTION: what the agent's room means for its writes, as one of three marks: nothing it writes lands below HOME_FULL_BYTES, its writes are held back below POOL_GUARD_FLOOR, and above that it writes as it likes. A mark that gets worse is made at once; one that gets better holds until the room passes its level by ROOM_BAND. Without that band a room hovering on a level — an agent that fills and frees around one, a guard that moves by a step — alternates its mark at every look, and each look is a console line.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Room {
    Full,
    Held,
    Room,
}

impl Room {
    // UNIT_BOUNDARY_DESCRIPTION: the line a mark puts on the guest's console, which is the only way the runner hears it (vm-runner's console::room_full reads the words back): each of the three carries its own word, so the marks that say the writes are not failing are heard as well as the one that says they are.
    pub fn line(self, room: u64) -> String {
        match self {
            Room::Full => format!(
                "{}: this agent may write nothing more until space is freed",
                crate::guest::GUEST_FULL
            ),
            Room::Held => format!(
                "{}: this agent may write {room} more bytes before its writes fail with no space left",
                crate::guest::GUEST_NEARLY_FULL
            ),
            Room::Room => format!(
                "{}: this agent's writes are no longer held back",
                crate::guest::GUEST_ROOM
            ),
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: the levels a pass evicts on, in percent of the disk: a disk with less than EVICT_BELOW_PERCENT free gets one pass, and the pass goes on until EVICT_UNTIL_PERCENT is free or nothing is left that EVICT_AGES allows. They are read on a guest no grant holds back: a grant makes the filesystem's own share useless (see eviction_pass), since the guard keeps it only as large as the grant leaves it.
pub const EVICT_BELOW_PERCENT: u64 = 10;
pub const EVICT_UNTIL_PERCENT: u64 = 20;
pub const EVICT_AGES: [u64; 4] = [7 * 86_400, 86_400, 3_600, 600];
// UNIT_BOUNDARY_DESCRIPTION: the age a pass on the owner's claim, or on a grant the agent used up, spares: the claim is mostly the agents' homes, which no eviction touches, so one that stays short would otherwise give every agent's /tmp a ten-minute life with nothing gained, and an agent at its grant would lose work a turn is still reading.
pub const CLAIM_EVICT_AGE: u64 = 3_600;

// UNIT_BOUNDARY_DESCRIPTION: the runner's request that this machine give back scratch because the owner's claim is short, read from guest::STORAGE_SHORT_PATH: an id that changes with every new request, and the bytes asked of this machine. A mark from an older runner is empty, and is one request with no byte bound.
#[derive(Debug, PartialEq)]
pub struct ClaimRequest {
    pub id: String,
    pub bytes: Option<u64>,
}

pub fn parse_claim_request(text: &str) -> ClaimRequest {
    let text = text.trim();
    ClaimRequest {
        id: text.to_string(),
        bytes: text
            .split_whitespace()
            .nth(1)
            .and_then(|bytes| bytes.parse().ok()),
    }
}

pub fn disk_short(free: Option<u64>, percent: u64) -> bool {
    free.is_some_and(|free| free < percent)
}

// UNIT_BOUNDARY_DESCRIPTION: what one pass is for: the disk itself short of room, which a guest no grant holds back reads from the filesystem's share; the owner's claim short, on the runner's request; or a grant the agent has used up, which only its room tells.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EvictionKind {
    Disk,
    Claim,
    Grant,
}

#[derive(Debug, PartialEq)]
pub struct EvictionPass {
    pub kind: EvictionKind,
    pub youngest: u64,
    pub bytes: Option<u64>,
}

impl EvictionPass {
    // UNIT_BOUNDARY_DESCRIPTION: whether the pass goes on to the next entry: while the disk is short, until EVICT_UNTIL_PERCENT is free; for a claim request, until the bytes asked for are freed; and for a grant used up, through every entry the age allows, since a room that only a new grant can give back cannot be read from here.
    pub fn continues(&self, free: Option<u64>, freed: u64) -> bool {
        match self.kind {
            EvictionKind::Disk => disk_short(free, EVICT_UNTIL_PERCENT),
            EvictionKind::Claim | EvictionKind::Grant => {
                self.bytes.is_none_or(|bytes| freed < bytes)
            }
        }
    }
}

// UNIT_BOUNDARY_DESCRIPTION: whether a look evicts, and how. A guest a grant holds back is not judged by the disk: its disk is the owner's whole claim, so a healthy grant is a small share of it — 4.5 GiB of 100 GiB with ten agents on a half-used pool — and a pass on that share would give every agent's scratch a ten-minute life for no shortage at all. Nor is it judged by the filesystem's free blocks when it is out of room, since btrfs reports room it does not have: its room is what the guard leaves it (POOL_GUARD_KEEP), and a pass is run once that is down to the floor, which is the agent's last allowance and the point at which its writes fail. That pass spares CLAIM_EVICT_AGE like the claim's, because the agent's own disk is the one thing it must not lose work from, and it is run at most once per that age (`swept_at`): an agent held at its floor by its own home's files has no room whatever it evicts, so a pass at every look would delete its scratch entry by entry as each crossed the hour, and one pass per shortage would never clear a burst younger than the age it spares, which keeps the agent at its floor for good. A disk whose room cannot be read is left alone unless a request or a grant asks for a pass.
pub fn eviction_pass(
    granted: bool,
    room: u64,
    free: Option<u64>,
    request: Option<&ClaimRequest>,
    served: Option<&str>,
    swept_at: Option<u64>,
    now: u64,
) -> Option<EvictionPass> {
    if !granted && disk_short(free, EVICT_BELOW_PERCENT) {
        return Some(EvictionPass {
            kind: EvictionKind::Disk,
            youngest: EVICT_AGES[EVICT_AGES.len() - 1],
            bytes: None,
        });
    }
    if let Some(request) = request.filter(|request| served != Some(request.id.as_str())) {
        return Some(EvictionPass {
            kind: EvictionKind::Claim,
            youngest: CLAIM_EVICT_AGE,
            bytes: request.bytes,
        });
    }
    let swept = swept_at.is_some_and(|at| now.saturating_sub(at) < CLAIM_EVICT_AGE);
    (granted && room < POOL_GUARD_FLOOR && !swept).then_some(EvictionPass {
        kind: EvictionKind::Grant,
        youngest: CLAIM_EVICT_AGE,
        bytes: None,
    })
}

// UNIT_BOUNDARY_DESCRIPTION: how far past its level the room must rise before a mark gets better: four of the guard's steps, so the guard moving a step at a time never flips one mark back and forth, and no more than a quarter of the floor, so the band stays below the next level up.
const ROOM_BAND: u64 = 4 * POOL_GUARD_STEP;

pub fn room_of(room: u64, was: Option<Room>) -> Room {
    let full = crate::guest::HOME_FULL_BYTES;
    if room < full || (was == Some(Room::Full) && room < full + ROOM_BAND) {
        Room::Full
    } else if room < POOL_GUARD_FLOOR
        || (was == Some(Room::Held) && room < POOL_GUARD_FLOOR + ROOM_BAND)
    {
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
        assert_eq!(room_of(0, None), Room::Full);
        assert_eq!(room_of(crate::guest::HOME_FULL_BYTES - 1, None), Room::Full);
        assert_eq!(room_of(crate::guest::HOME_FULL_BYTES, None), Room::Held);
        assert_eq!(room_of(POOL_GUARD_FLOOR, None), Room::Room);
        assert!(
            Room::Full.line(0).contains(crate::guest::GUEST_FULL),
            "a mark that carries no word leaves the last one the runner heard standing"
        );
        assert!(Room::Held.line(1).contains(crate::guest::GUEST_NEARLY_FULL));
        assert!(Room::Room.line(1).contains(crate::guest::GUEST_ROOM));
        assert!(!Room::Held.line(1).contains(crate::guest::GUEST_FULL));
        assert!(!Room::Room.line(1).contains(crate::guest::GUEST_FULL));
    }

    // TEST_SCENARIO: a guest's own disk that is short is evicted on every look down to the last EVICT_AGES step, until it has room; a disk whose room cannot be read is left alone, since an unreadable disk is no proof of a shortage.
    #[test]
    fn a_short_disk_is_evicted_until_it_has_room() {
        let pass = eviction_pass(false, 0, Some(5), None, None, None, 0).unwrap();
        assert_eq!((pass.kind, pass.youngest), (EvictionKind::Disk, 600));
        assert!(pass.continues(Some(15), 1 << 40) && !pass.continues(Some(20), 0));
        assert_eq!(eviction_pass(false, 0, Some(50), None, None, None, 0), None);
        assert_eq!(eviction_pass(false, 0, None, None, None, None, 0), None);
    }

    // TEST_SCENARIO: a grant is an even part of the claim, so a healthy one is a small share of a disk sized at the whole claim — 4.5 GiB of 100 GiB with ten agents on a half-used pool — and that share alone reads as a disk in trouble on every look. Eviction is decided on the room the guard leaves, not on the share: nothing is evicted on while the grant still has room, and a grant that is spent evicts one pass of what the agent has not touched for CLAIM_EVICT_AGE, which is the agent's last allowance and not a disk shortage.
    #[test]
    fn a_healthy_grant_is_not_a_short_disk() {
        let grant = 4_608 << 20;
        let share = Some(9);
        assert_eq!(eviction_pass(true, grant, share, None, None, None, 0), None);
        assert_eq!(
            eviction_pass(true, POOL_GUARD_FLOOR, share, None, None, None, 0),
            None
        );
        let spent = eviction_pass(true, POOL_GUARD_FLOOR - 1, share, None, None, None, 0).unwrap();
        assert_eq!(
            (spent.kind, spent.youngest),
            (EvictionKind::Grant, CLAIM_EVICT_AGE)
        );
        assert!(spent.continues(share, 0) && spent.continues(share, u64::MAX));
    }

    // TEST_SCENARIO: btrfs's free space is an estimate that passes what the disk holds, so a guard at the disk's real end leaves the filesystem reporting room it cannot give, and the guest's room is nothing while the share reads as plenty. The guard marks that guest full, and the pass that gives it room back has to run on the room: judged by the share, nothing would ever be evicted and the agent would stay stuck.
    #[test]
    fn a_spent_grant_evicts_while_the_filesystem_still_reports_room() {
        let gig = 1u64 << 30;
        let optimistic = 8 * gig;
        let mut guard = PoolGuard::default();
        let grant = Some(("g1".to_string(), 4 * gig));

        assert_eq!(
            guard.size(grant.clone(), optimistic, 0),
            optimistic - 4 * gig
        );
        assert_eq!(guest_room(guard.keep, true, optimistic), 4 * gig);
        assert_eq!(
            guard.size(grant.clone(), optimistic, 4 * gig),
            optimistic - POOL_GUARD_FLOOR
        );
        assert_eq!(guest_room(guard.keep, true, optimistic), POOL_GUARD_FLOOR);
        guard.size(grant, optimistic, 4 * gig + POOL_GUARD_FLOOR);

        let room = guest_room(guard.keep, true, optimistic);
        assert_eq!(room, 0);
        assert_eq!(room_of(room, None), Room::Full);
        let pass = eviction_pass(true, room, Some(80), None, None, None, 0).unwrap();
        assert_eq!(
            (pass.kind, pass.youngest),
            (EvictionKind::Grant, CLAIM_EVICT_AGE)
        );
    }

    // TEST_SCENARIO: the owner's claim is mostly the agents' homes, which eviction never touches, so a claim that stays short must not give every agent's /tmp a ten-minute life. A request from the runner is served once, by a pass that keeps whatever was used in the last hour and stops at the bytes asked; only a new request, which the runner sends when the claim fills further, brings another pass. An older runner's empty mark is one unbounded request. A request is served before a spent grant's pass, so the bytes the runner asked for are what is freed first.
    #[test]
    fn a_short_claim_is_served_once_per_request_and_spares_recent_work() {
        let request = parse_claim_request("17 1000\n");
        assert_eq!(request.bytes, Some(1000));
        let pass = eviction_pass(false, 0, Some(50), Some(&request), None, None, 0).unwrap();
        assert_eq!(
            (pass.kind, pass.youngest),
            (EvictionKind::Claim, CLAIM_EVICT_AGE)
        );
        assert!(pass.continues(Some(50), 999) && !pass.continues(Some(50), 1000));
        assert_eq!(
            eviction_pass(false, 0, Some(50), Some(&request), Some("17 1000"), None, 0),
            None
        );
        assert!(eviction_pass(
            false,
            0,
            Some(50),
            Some(&parse_claim_request("18 1000")),
            Some("17 1000"),
            None,
            0
        )
        .is_some());
        let legacy = parse_claim_request("");
        assert_eq!(legacy.bytes, None);
        assert!(
            eviction_pass(false, 0, Some(50), Some(&legacy), None, None, 0)
                .unwrap()
                .continues(Some(50), u64::MAX)
        );
        assert_eq!(
            eviction_pass(false, 0, Some(50), Some(&legacy), Some(""), None, 0),
            None
        );
        let both = eviction_pass(true, 0, Some(50), Some(&request), None, None, 0).unwrap();
        assert_eq!(
            both.kind,
            EvictionKind::Claim,
            "a request the runner sent is served ahead of a spent grant, on the bytes it asked for"
        );
    }

    // TEST_SCENARIO: a guest held at its floor by files in its own home, which eviction never touches, gains no room from a pass: what a pass frees the guard takes again, so the guest is at its floor at the next look too. A pass at every look would then delete its scratch entry by entry as each crossed the hour, and one pass per shortage would never clear a burst younger than the hour it spares, which keeps the agent at its floor for good: so a spent grant is served once per hour, the age its pass spares, while a request the runner sent gets its own pass whenever it comes.
    #[test]
    fn a_spent_grant_is_evicted_once_per_age_it_spares() {
        let below = POOL_GUARD_FLOOR - 1;
        let now = 10 * CLAIM_EVICT_AGE;
        let kind = |swept_at| {
            eviction_pass(true, below, Some(9), None, None, swept_at, now).map(|pass| pass.kind)
        };
        assert_eq!(kind(None), Some(EvictionKind::Grant), "no pass has run yet");
        assert_eq!(
            kind(Some(now - CLAIM_EVICT_AGE + 1)),
            None,
            "a pass within the hour it spares stands, so the entries it spared are not deleted as they cross it"
        );
        assert_eq!(
            kind(Some(now - CLAIM_EVICT_AGE)),
            Some(EvictionKind::Grant),
            "a burst a pass spared is cleared once it is old enough, or the agent stays out of room"
        );
        let request = parse_claim_request("7 1000");
        assert_eq!(
            eviction_pass(true, below, Some(9), Some(&request), None, Some(now), now)
                .unwrap()
                .kind,
            EvictionKind::Claim,
            "a request the runner sent is served all the same"
        );
    }

    // TEST_SCENARIO: a room that hovers on a level keeps the mark it had, so the console does not carry a line for every look: a full guest stays full until it clears the band, a held one stays held the same way, and a mark that gets worse is made at once, since the agent's writes fail sooner than the band allows.
    #[test]
    fn a_room_hovering_on_a_level_keeps_its_mark() {
        let (full, floor) = (crate::guest::HOME_FULL_BYTES, POOL_GUARD_FLOOR);
        assert_eq!(room_of(full + ROOM_BAND - 1, Some(Room::Full)), Room::Full);
        assert_eq!(room_of(full + ROOM_BAND, Some(Room::Full)), Room::Held);
        assert_eq!(room_of(floor + ROOM_BAND - 1, Some(Room::Held)), Room::Held);
        assert_eq!(room_of(floor + ROOM_BAND, Some(Room::Held)), Room::Room);
        assert_eq!(room_of(floor - 1, Some(Room::Room)), Room::Held);
        assert_eq!(room_of(full - 1, Some(Room::Held)), Room::Full);

        let mut mark = room_of(full - 1, None);
        for room in [full, full + 1, full - 1, full + ROOM_BAND - 1, full] {
            mark = room_of(room, Some(mark));
            assert_eq!(mark, Room::Full, "{room}");
        }
        mark = room_of(full + ROOM_BAND, Some(mark));
        for room in [
            floor + ROOM_BAND - 1,
            floor + ROOM_BAND - 2,
            floor + ROOM_BAND - 1,
        ] {
            let next = room_of(room, Some(mark));
            assert_eq!(next, Room::Held, "{room}");
            mark = next;
        }
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

    // TEST_SCENARIO: the guard reports the generation it has taken up and not the one the runner published. A runner that republishes while the guard still holds the old id leaves the reported generation on the old id, because that is the grant its room is counted from; a guest comparing room figures across that moment would otherwise judge a renewal the guard had not read yet. It reports no generation once no grant holds the guest.
    #[test]
    fn a_generation_is_reported_only_once_the_guard_took_it_up() {
        let (disk, used) = (100 * GIB, 20 * GIB);
        let mut state = PoolGuard::default();
        assert_eq!(state.applied(), None);
        let avail = disk - used;
        state.size(Some(("1".into(), 10 * GIB)), avail, used);
        assert_eq!(state.applied(), Some("1"));
        state.size(Some(("1".into(), 10 * GIB)), avail, used);
        assert_eq!(state.applied(), Some("1"));
        state.size(Some(("2".into(), 10 * GIB)), avail, used);
        assert_eq!(state.applied(), Some("2"));
        state.size(None, disk, used);
        assert_eq!(state.applied(), None);
    }
}
