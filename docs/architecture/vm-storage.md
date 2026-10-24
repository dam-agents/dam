# VM storage

Last verified: 2026-10-23

A machine keeps one disk on its owner's [VM runner](vm-runner.md) rather than a volume per mounted path, and an owner's disks all sit on one claim.
This page owns what that disk holds, what survives a stop, and how the runner keeps the claim from filling.

## The disk

**A machine has no PVC, and one disk.** That disk has no size of its own: it is sparse and may grow to the owner's whole storage pool — their [UserBudget](budgets.md)'s `storage`, else the install's value — so what the owner's disks take is what they write.
A new machine is created at the pool, since every runner release creates a disk at the size it is asked for.
An existing machine is sent the pool only once its runner has reported the machine's disk, since an older runner would restart a running machine to grow it; until then it keeps the size the Agent's spec gives.
The path the disk holds apart from the root is `HOME`.
That is not a field an Agent sets: `HOME` is fixed, and it is already the only path every template and starter kit in the chart persists.
The disk sits on the owner's [VM runner](vm-runner.md) volume, grows with its size at the machine's next start and never shrinks, survives hibernation, restarts and a new image, and goes with the Agent on delete.
An Agent whose mounts ask to persist a path outside `HOME` is refused rather than reconciled, because a machine cannot keep it and silently dropping it is how an agent comes to look healthy while discarding its work.

**The whole machine persists, per root generation.** Everything outside `HOME` is the image's root: an overlay platform-init lays over the image, its upper layer on the disk, kept across stops, restarts and new images of one generation.
A generation is a string key an image declares in its env and compares whole, never parsed or ordered: the default image's names it, such as `default-1`, and an image the platform builds on it appends its own segment, such as `default-1/gepa-1`, so a key names the image's lineage.
An image built from the default one elsewhere inherits the default's key unless it declares its own, and so keeps a root the default image wrote.
An image's build changes its key only on a change that breaks an older root; an image declaring none is its own generation.
The runner names it in the share at every start, and any other key, an extending image's included, or none named, boots onto an empty upper: what must outlast that belongs under `HOME`.
**Nothing the platform writes at boot lands in the kept root.** A file a boot rewrote there would hide every later image's copy of it, so the boot builds the CA bundle under `/run`, a fresh tmpfs on every boot.
The entry that maps `agent` to uid 0 for SSH logins is in a layer platform-init builds in memory at every boot, between the image and the upper: the image's `/etc/passwd` with that entry at its end.
It is an ordinary file of the root, so `useradd` replaces it as on any root, and only then does the upper hold a copy, as with any file the agent writes.
The agent runs as root there, and a tool that takes its home from the user database rather than `HOME`, as OpenSSH does for keys and known hosts, would write to `/root` on that root, so the image's build gives uid 0's entry the agent's `HOME`.
The old upper is renamed aside with the record of its image and deleted in the background, so a root of millions of files does not hold up the boot; one a stop cut short is deleted on the next boot.
smolvm keeps a root of its own and binds the whole disk into it; platform-init leaves both behind, and fails the boot rather than run on them.
Temporary folders are the exception: `/tmp` and `/var/tmp` are directories of that root, empty on every boot whatever the image ships there, and `HOME`'s `.cache` and `.npm` are ordinary directories of the home.
`/var/cache` stays in the root: an image ships its caches there, and an empty folder over them rebuilt them each boot.
The caches share the disk with the agent's work, so when it runs short, or the runner marks the owner's claim under it short, platform-init deletes their oldest entries, never through a link or a mount.
A disk pass runs until a fifth of the disk is free; a claim's stops at the bytes the runner asked for.
It deletes only from `HOME`'s `.cache` and `.npm`, caches by the XDG specification and by npm, and never from `/tmp` or `/var/tmp`, whatever a directory's mark or age: a tool can drop that mark, write work there and rename it while a pass runs, so nothing makes one safe to delete.
An entry goes whole or not at all: a tool keeping part of its cache takes it for complete and fails.
Deletion is bound to the tree it judged, not the name it listed.
Use is the newest modification or change time in the entry: a write moves those, a read moves none the guest keeps.
An entry used in the last ten minutes stays.
A short claim is mostly the agents' homes, which no eviction touches, so it does not bring that rule on: each request is served once, by one pass that keeps what was used in the last hour, stops at the bytes the runner asked of that machine, and reads the request again before each entry.
A guest at its grant's floor keeps that hour with no byte bound, served once an hour rather than at every look.
Each eviction, and a disk still short with nothing left to evict, is a console line.
An agent that exits with its home nearly out of space or inodes is a full home.
A boot that finds the disk with no space or inode left deletes what earlier boots set aside and the last boot's temporary folders, which it would empty anyway, and tries again.
A boot that still has no room stops, and its console line says the home is full, so the runner reports a full home and its fix: more storage, which brings more of both.
platform-init mounts the guest's storage disk with synchronous discards, so a block the agent frees reaches the runner's volume as its filesystem frees it and stops counting against the owner's storage; it also trims the whole disk every minute and before its guard preallocates, which retries the ranges still free.
Both use the same discard, so a device that refuses one returns nothing.
Once the image runs, the disk is reachable only through what platform-init mounted from it.

Mounting the disk is the platform's job rather than the image's.
The runner hands every machine a read-only share holding the MITM CA and **platform-init**, and runs platform-init as the machine's entrypoint; it claims the disk, refuses to boot when the disk did not attach, moves the image onto its fresh root, seeds `HOME` once from whatever the image ships there, bind-mounts it, and starts the image's own entrypoint, which it then supervises ([vm-runner](vm-runner.md)).
Any image therefore keeps its agent's home, even one that has never heard of this platform: platform-init is linked statically and needs nothing from the image.
An image that ships `HOME` as a symlink is seeded from what the link points at, and the link is replaced by a directory before the bind, so the home is on the disk and never on the root an image update discards; a disk an older platform-init gave a linked home is seeded again from what that home holds.
**Nothing from `HOME` is ever run.** The home is the agent's to write, so every step platform-init takes as root comes from the share or from platform-init itself: nothing the home carries can plant one, and a `.platform/boot.d` an older home carries is ignored.
Beside the agent's home, in a namespace of its own so a `log` directory in that home cannot collide with it, the disk holds the platform state a machine's root cannot keep: the guest's boot log, where an agent's output goes since the harness never writes to the console, kept one boot deep so a machine that died still explains itself on the boot after, and bounded while it is written so an agent that logs without pause cannot fill its disk; an image's boot may keep its extracted trust store in a directory of its root rather than rebuilding it, which the platform's own images, whose rebuild is quick, leave unused.
The log is rebuilt or resumed by the next boot rather than being state an Agent can lose.

**A disk that holds a filesystem is never formatted at boot.** platform-init, the guest's init, mounts the storage disk itself and never formats it: a disk it cannot mount, or cannot read, fails the boot with the reason on the machine's console and stays as it was, for the next start to mount once the cause passes.
smolvm's guest agent, which it replaces, formatted a disk it could not repair, which erased a home that only a passing I/O error, a killed repair or a kernel that lacks one of its features kept from mounting.
A btrfs disk that does not mount fails the boot and stays as it is, since btrfs has no repair a boot may run unattended.
A Mac host runner runs the same agent, taken from the runner image.

**A disk that has lost its home fails the boot.** A disk that was formatted anyway looks exactly like one never seeded.
So the runner records in the machine's share, the first time its guest answers — which it does only once platform-init has put the home on the disk, from the image — that the disk holds a home, and keeps the record for as long as the machine exists.
A boot that finds the record but no home stops, with the reason on the machine's console, rather than seeding a fresh home that would look healthy.
The record is learned from the answer rather than read off the disk, because the host does not parse a filesystem a guest has had root on.
The runner makes every new disk itself, btrfs at its full size, before any guest has touched it ([vm-runner](vm-runner.md)).
A disk from before that, ext4 or btrfs in the old directory layout, fails its boot and is kept as it is ([vm-runner](vm-runner.md)).
On a Mac host runner the loss is refused, not prevented.

## The owner's claim

**The claim those disks sit on is the owner's pool.** One claim per owner holds every machine disk they have and their bookkeeping, and every disk may grow to the pool, so the claim is created at the pool; the image trees are on the node, not the claim.
It grows in place when the pool rises and is never shrunk, so a lowered pool only stops its growth.
A refused growth is reported and reconciliation continues: the runner still serves every agent at the size it has.

**The runner guards the claim by its use.** The disks are sparse, so they can add up to more than the claim holds, and a guest sees its own disk as free while the claim under it fills; once the claim has no block left, a guest's write into its disk has nowhere to go.
So the runner measures the claim itself: past 75% used it asks every machine's guest, through its share, to give back scratch: each running one its even part of what would bring use back under 70%.
It asks again only once the claim has filled five points further, and clears the request once use is back under 70%, so a claim the homes keep full has not every guest delete its scratch again every minute.
A guest a grant holds is judged by the room its guard leaves it, not by the disk's share.
A guest is held to the claim's room too: each look grants each machine that is neither asleep nor absent an even part of what is left below 95% of the claim, and a sleeping or absent one nothing, so a wake never boots on the room its share held; a start looks again first, and platform-init preallocates unnamed files on the disk so the guest can write only what is left of its grant.
No grant is more than that room, so a write larger than all of it plus the floor a guest may write past its grant is refused whatever the guest has been granted.
A claim the runner cannot measure grants nothing, so no guest is held to it, and it says so each time it loses the measure and each time it gets it back.
A guest held below 256 MiB may still write 256 MiB in all, once, until a grant with room comes, so with N agents running the claim can pass 95% by at most N times that.
One writer that fills its part before the next look meets "no space left on device" at its part, not at 95%: at roughly 85% with eight machines up, 87% with four, and higher with fewer, since the room below 95% is split between them and renewed every 30 s.
The next look renews its part once the claim has moved, so its next write succeeds, and an agent that handles the error carries on.
That is accepted for now, since the agent survives the error and its next write succeeds; a fix would renew a short machine's part in seconds rather than at the look's cadence.
The agent that used it up gets room again once the claim has room, through a grant that holds the floor: when another agent is deleted or frees files, or the storage grows, as the full-home message says; a sleep and wake also gives the floor again, for one more way in to free its own files.
A write past it fails inside the guest with "no space left on device", which the agent handles and the runner reports as a full home, and the claim stays writable for the owner's other agents.
Their blocks are only marked in the guest's filesystem, never written, so they take nothing from the claim, and they have no names, so the filesystem frees them when the guest stops.
btrfs reports free space late, and as an estimate that can pass the disk's size, so the guard reads what it holds from its files' blocks, syncs before it moves, moves past a margin once per commit at most, and grows only as far as the disk takes.
A shrink drops whole files, never part of one, and a clean stop releases them all.
Eviction counts the guard's blocks back as free while no grant holds the guest, so a guest held to the claim does not read its own disk as short.
The guard counts what the guest's filesystem reports as used, so it does not see all that the claim gives a disk: metadata blocks are holes until first written, and blocks a guest frees take room on the claim until their discard reaches it.
Past 90% it creates no machine, and a machine it starts boots at the disk size it has; past 95%, where guests' writes start to fail, it starts and restarts no machine either, so between the two an owner whose agents are all asleep can still get into one to clean it up.
It reports each refusal as `MachineStorageFull` with how full the storage is and how to free it, and never stops a running machine, which would free nothing and lose what the guest holds in memory.
An out-of-space error the runner meets anywhere on the claim is reported the same way, and so is a boot that fails while the claim is that full, since a guest whose writes fail fails its boot with nothing typed in the error.
A storage refusal parks the Agent when its start was what was refused: the gateway goes to zero with the machine it would proxy, the start is retried at the parked tick while the Agent should run, and it starts once space frees.
A machine that is up is not parked for it, since parking halts a running machine and nothing a guest keeps in memory frees disk: the refusal is then only reported.
Nor is an Agent that should be asleep: a machine that is absent while it sleeps is still shaped by a create the runner refuses on a critical claim, and parking would flip its status out of hibernated on every pass.
The api-server says the same before an Agent is written: it reads the owner's runner through its read-only usage capability, and refuses a new Agent — a create, a kit applied, a spawn — once the claim is 90% used, with the figures and the same three ways out.
Usage it cannot read refuses nothing, since the runner refuses the machine anyway.
The same read names each machine's disk, so a user whose storage is short is shown what fills it ([budgets](budgets.md)).
Past 90%, and again past 95% when writes start failing, the owner also gets a Slack direct message with the same figures and ways out ([resource alerts](budgets.md#resource-alerts)).

**A write the claim has no room for waits instead of failing.** virtio-blk can report a failed write to the guest only as an I/O error, and on that error the guest drops the data in its page cache that a write had accepted, and btrfs aborts its transaction and turns the filesystem read-only.
So the runner's libkrun holds a guest write that the claim refuses with no space, and tries it again every second until it fits, as QEMU does by default.
The guest's I/O waits meanwhile, and continues with nothing lost once the claim has room: through another guest's trims, a deleted agent or a larger storage.
A stop of the machine ends the wait: the write fails as before, or a kill ends the machine as a power cut would, which btrfs's copy-on-write recovers from without errors.
A flush is never tried again: after a failed fsync the host can have dropped the data, and a second fsync would report it written.
