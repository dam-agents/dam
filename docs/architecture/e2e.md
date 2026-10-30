# End-to-end suite

Last verified: 2026-10-30

The **e2e suite** is the smoke test that proves an install works from outside the cluster: Playwright drives the web UI and the public API against a real k3s install, and a mock harness answers the Agents' turns.
It is the only test that covers a change across the whole system — login through Keycloak, the mesh's policies, the api-server, the controller and an Agent behind it — so a full-suite run takes it twice, once per lane.

## Lanes

A **lane** is a gateway topology for the Agents a spec creates, each a machine on its owner's VM runner.
One lane runs the chart's default, a gateway pod per Agent; the other turns on the [owner gateway](credential-gateway.md#owner-gateway), one gateway pod per owner.
The lanes differ in nothing else, and each runs on its own runner.
Both run in every full-suite run; a pull request runs the default lane alone, since the push to main runs both on the merged tree, so a fault only one topology has still shows within one main run.
The lane is one variable, `E2E_GATEWAY_PER_OWNER`, which the install reads to turn the owner gateway on.

## Projects and the order between them

The specs are grouped into Playwright **projects**, one per area, whose dependencies chain the state they share: the auth project stores the user's login, the agent project creates the suite's mock Agent and the Connection its chat turns need, and the chain project drives that Agent through messages, Sessions, Slack and egress.
A spec that boots and drives an Agent of its own runs in a project after those, one at a time, because each of them competes for the same cluster's compute.
Five specs reach into the machine itself: the harness tools spec runs an agent on the harness tools the default image bakes, the browser tabs spec drives the agent's own browser, the boot matrix breaks a machine's boot the ways a host failure does — it kills the machine's VMM at the steps of a boot that platform-init reports on the machine's console, once at a running guest with writes synced into HOME, and empties the disk's layout mark — the storage trim spec measures the claim under an agent's machine, and the runner release spec rolls a live machine onto a second runner release and back, with the chart's own upgrade.
The runner release spec runs after every project the run keeps, whatever the scope drops: a runner pod rolls every machine its owner has, so it waits for the suite, and it leaves the install on the values it found there.
The claim-filling case refuses from the host side unless the claim is a filesystem of its own, which is read from inside the runner: the device of the claim's path against the devices of both mounts the chart hands the runner from the node itself, with the claim's filesystem type from the kernel's mount table.
A filesystem that is not one — an overlay, a tmpfs — is refused as no proof, and so is a read where a node mount could not be read or the two disagree, since one readable mount says nothing about which filesystem is the node's.
The device is the path's own inode field and not the filesystem's count of free inodes: two directories on one filesystem share the first and differ in the second.
Neither the provisioner's name nor the PersistentVolume's source can say where a volume's blocks are, and both are wrong in both directions: a CSI driver named for the node's disk hands out a directory of it, and a CSI driver backed by a network is storage of its own.
Its fill comes off after the spec whether its own case reached the removal or not, and the allocator runs in a process group of its own that the teardown signals and waits out until no member of it is left before the file is removed, because a local `kubectl` that gave up waiting leaves that process writing to the owner's storage after the removal; the flag that arms the teardown is set before the call that can write the fill.
The group is what the teardown kills, and never a process matched by its command line: the teardown runs as `sh -c`, so its own command line holds every string it contains, and a match on those would find the teardown itself before it removed anything.
The filler writes and reads back its own pid, group and start time before it allocates, and exits ahead of its body if that record did not take, so a fill that no teardown could name is never written; the launch clears any earlier record or stops, so a new writer cannot hide under a stale one.
The filler stays alive as the leader of its group until the teardown ends it, because a group whose leader is gone cannot be proved to be this filler's: the kernel may hand a freed group id to another session, and membership alone would name a stranger.
The record outlives the fill's removal and goes only after that removal is read back, so a claim briefly read-only leaves the next call able to name the writer and finish the job; a call that finds no record passes only when the fill and the script are gone, so repeating a finished teardown is safe.
The boot matrix runs with the other specs that boot an Agent of their own, one at a time, for the compute they would otherwise share.
Its cases that need room a CI node cannot spare, a disk with no block left and a claim with none, are opt-in through `E2E_DISK_FILL_GIB` and `E2E_CLAIM_FILL_GIB`: a machine's disk is a sparse file on its owner's claim, that claim is a directory of the node's disk, and a fill takes that room whenever its filesystem allocates the blocks instead of marking them.
The storage trim spec's always-on share-recovery case needs no configurable host-fill budget and runs on every in-cluster run: it first writes and deletes 256 MiB of real bytes through a renewal and compares the guest's free space with the grant the runner published, then fills the guest's remaining room without writing bytes, so the guest is held at its share without the claim paying for it, and waits a renewal window: the runner grants a new look's room at every look, so a fill the claim never paid for is room the guest is given again, and the case measures the guest against that renewed grant.
Each comparison reads the grant and the guest's free space in one guest command, with the grant line on both sides of the room so a sample that straddles a renewal is retried.
The renewed comparison needs a grant the runner published after the case's own write, and both of its bounds are waited for on one sample, so a room the guard has not yet moved is neither accepted nor rejected.
The case also checks the machines' grants against the claim, for every run and with no host byte: no guest may be granted more than the room left below 95% of the claim's capacity, and each running guest is granted a part of it.
That is a policy check and not the ceiling regression: a sum of observed grants cannot prove the whole claim's ceiling, so the near-ceiling refusal still needs the claim filled.
The next case is the direct refusal the share-recovery case cannot make: a guest held at its share is refused its next write, and refused for want of space.
That probe is deliberately coarser than the wedge it guards.
It does not judge the write at the size of the guest's own grant: a renewal can return room between the fill and the write, and no guest-side figure says which allowance the guard has applied, so a write allowed at the guest's share cannot be told from one a renewal preceded.
Instead the case marks the guest's whole remaining room and asks for more than any grant the guest could be given in the meantime — everything the claim has left below its 95% ceiling, which no grant exceeds even with one machine up, plus the floor every guest may write past its grant, the guard's step and the case's slack — so no renewal that lands before the write can make it fit.
What it loses is the size of the refusal: a guest refused at its share and one refused at ten times its share both pass, and only the claim-ceiling case below reads a refusal close to a real share.
What it keeps is the direct coverage the always-on lane had none of: the guest's room against its grant says the guard left the guest no room, never that a write was refused.
The write is made once and never retried until it is refused, so a guest let past the bound fails the case rather than earning a pass on a later attempt.
Its fill, writes, trim, share recovery, sibling write and grant policy keep running in the case before it.
The opt-in ceiling case is unchanged.
It skips on a Mac host runner, where the first case measures no machine's disk.
The case beside it fills the claim itself with real bytes to read the ceiling, and spends `E2E_DISK_FILL_GIB` of the host to do it, so it skips when the claim would need more than that or the variable is unset.
The spec that deletes a user's VM runner runs after the rest of the suite, since that runner runs every other machine of that user.
The tier under `src/tests/full/` is on demand: a local run asks for it, and no CI run takes it.

## Scope: what a pull request runs

A pull request runs the smoke suite on the default lane, with a reduced set of specs; every other event runs both lanes and all of the specs — a push to main, the nightly run, and a dispatch.
The reduction is measured, not guessed: over five weeks of CI ending 2026-10-18, about 600 failed e2e jobs came from a handful of specs, and only some of those failures were likely real — the same spec failing in both lanes of one run, or again on the pull request's next run.
A spec that never fails for real earns nothing on a pull request.

Deferral is a coverage gap until a merge queue is back: a change reaches main after its reduced run, and the push to main then takes the full set on the merged tree, so a break shows on main within one run.
The Playwright config owns the list of specs a run takes: the workflow passes the event's scope as `E2E_SCOPE`, and the config turns that into what each project runs and which projects a reduced run leaves with no spec at all.
A spec may read that same scope for its own route: the scheduled-fire case waits up to a minute for a cron tick on a full run, and fires the same trigger with run-now on a pull request.
What that route leaves out is proved by the full set on the push to main and on the nightly run.
Each lane's job summary states the scope beside its timings, so a green pull request is never read as a green full suite.
The two summaries hold the same table, so a phase of one lane compares with the same phase of the other; a phase a lane never reached reads `n/a`.

The merge queue is Mergify's.
It tests each queued pull request on top of `main` and the pull requests queued ahead of it, as a draft pull request from a `mergify/merge-queue/*` branch, so its run is a `pull_request` run.
`cd.yml` tells that run from a pull request's own run by the branch name, and gives it the merge queue's scope: both lanes, every spec, and the `verify-queue` check the queue merges on.

## Running it

`mise run e2e` is the CI path: a fresh cluster, the suite, teardown.
`e2e:loop` iterates against a warm cluster, and the [cluster-ops skill](../../.agents/skills/cluster-ops/SKILL.md) covers both.
A warm cluster shares its machine's CPUs with the browser, so `e2e:loop` sets `E2E_TIMEOUT_SCALE` to 3 and the config multiplies its default test and expect timeouts by it; a spec that sets its own timeout keeps it, and CI keeps the defaults.

An agent runs the suite for its checkout in an [Environment](environments.md) of its own with `e2e:loop -- --environment <name>`, so its parallel runs do not take turns on one test cluster.
The install there takes only what the checkout changed, and the suite reaches the install's backchannel and its cluster's API over the Environment Link, on a port of that Environment's own, so several Environments and the local test cluster run side by side on one agent.
The specs run on the agent, and the browser they drive runs in the Environment beside the install, so the pages a spec loads do not wait on the agent's other work.
An Environment runs no mesh, so a run there says nothing about the mesh's policies; the CI lanes still run them.

A CI runner and its cluster are gone once the job ends, so a failure has to explain itself in the job's own record.
A tRPC call a spec makes that fails names its procedure, its HTTP status and the answer it got, because the api-server redacts an internal error to "internal server error" and the spec's stack names no call.
A failed run dumps the cluster's state into the job log, with every error line the api-server logged during the suite, since the server side of a 500 is there and nowhere else.
