# VM runner upgrades

Last verified: 2026-10-15

How a change to the [runner](vm-runner.md) reaches owners whose machines are running: as a **roll** of the runner pod, which reboots the owner's machines, or, for a new runner release only, as a **hand-off** inside the pod, which reboots none.

## Rolls

**A change to the runner pod rolls across owners, not all at once.** Because a pod restart reboots every machine of that owner, a new runner image or a controller release that renders the pod differently would otherwise reboot every vm machine in the install together, where container agents roll one at a time.
The controller records a hash of the pod it rendered on each runner — less its memory limit, the owner's pool, and its memory request, both of which it changes in place ([vm-memory](vm-memory.md)) — leaves a runner alone while that hash is unchanged, and lets a changed one roll only while fewer than the install's roll width (one by default) are mid-roll.
A runner is mid-roll from that moment until its new pod is ready and every machine that was ready before is ready again, or its agent is gone; a settle timeout bounds the wait for machines, so one that never comes back does not stall everyone else.
A new pod that is still not ready at the timeout is a broken runner release, not a slow machine: that roll keeps its place, so the release goes no further, and is marked stalled and reported as an error until its pod becomes ready or the pod changes again.
The exception is a pod stuck in a state no release can cause: one still creating its containers, none ever started, whose claim the attach controller refuses as Multi-Attach, or an old pod that never finishes terminating because its node is gone or not ready.
That says nothing about the release, so the roll is reported as an error, counted and skipped, and other owners keep rolling; the runner comes up on the new pod once its fault clears.
Every other state still halts the roll: a pod the scheduler cannot place, since a release that adds a node selector or raises a request makes every runner unplaceable, a container that started, an image that does not pull.
The node is read through the node read grant the chart adds with virtualization; an install without it cannot tell a lost node, so a pod stuck terminating halts the roll there.
A runner whose pod is unchanged is not rolled, but labels or owner references that drifted on it are put back without touching the pod.
A new owner's runner is created at once, since there is nothing of theirs to protect.
A changed runner also waits for its owner's agents to be idle, since a roll ends the turn an agent is in.
Before it takes a place in the roll, the controller asks each of the owner's ready machines the idle checker's own question, whether its agent's status says idle, and an agent that does not answer counts as idle.
A runner with a busy agent holds no place, so other owners roll meanwhile, and the next pass offers it again.
The install's idle wait, an hour by default, bounds this from the first pass that found the owner busy, and is recorded on the runner so a controller restart does not start it over; past it, the runner rolls with the agent busy, so an owner who is never idle still gets the release.
Rolls advance as agents reconcile and on the periodic sweep, which offers every runner its turn in name order so owners whose agents all sleep still roll; which runners are mid-roll is read once every few seconds rather than on every turn, and a roll the controller starts counts at once.
The sweep only ever updates a runner that exists — creating one is an agent's reconcile's alone.
A roll still reboots each owner's machines once: nothing checkpoints them across it, and the VMM host is the same pod as the machine API it serves.
So a published chart pins the runner image by digest, and a rebuild that changes nothing in the image — only the record of when and with what it was built — keeps the image it would have replaced: a release that leaves the runner as it was rolls no runner.

## Hand-offs

A [runner](vm-runner.md) pod's machines are its processes, so restarting the pod reboots every machine of its owner.
Most runner changes do not need the pod restarted: what changes is the runner process, not the VMMs it started.
An install that names a node directory for runner releases ([values](../../helm/values.yaml)) therefore takes a new runner image into each pod in place, without rebooting a machine.
An install that names none rolls the pod for every runner image.
On OpenShift the directory the kubelet creates carries the host's own SELinux label, which a confined runner may not read, so the stager labels it, and everything it stages, for containers at the plain level every runner's own categories can read; to set that label it runs as the unconfined container type, as the [image cache](vm-image-cache.md) service does, under the SCC the install names for its runners.
A cluster admin can instead have the nodes create and label the directory themselves, with the node configuration in [`etc/openshift-node-config/`](../../etc/openshift-node-config/).

**A runner release** is the runner with the two guest binaries it copies into every machine's share, platform-init and platform-runc, so the side that writes a share and the side that reads it stay one version.
Each release also records the **runtime** it was built against: the smolvm release with its guest agent, the guest kernel and the libkrun the platform patches, the image tooling, and the base image's libc.
The runner is itself the VMM of every machine it starts, and loads its runtime's libraries and guest agent, so the runtime travels with the release.
Its guest kernel is the smolvm release's own, Linux 6.18 with [smol-machines/libkrunfw#31](https://github.com/smol-machines/libkrunfw/pull/31).
Without that fix, from 6.15 on, FUSE DAX corrupts a mapped file that another process opens, and a guest of 6 GiB or more dies of SIGBUS ([smol-machines/smolvm#1741](https://github.com/smol-machines/smolvm/issues/1741)); 6.18 also stalls a guest whose mapped working set outgrows the DAX window.
The vm e2e lane boots a 6 GiB guest with the runner's kernel and checks both, so a smolvm release whose kernel fails them fails the lane.
The Mac's host runner has the same kernel, and its guests have no FUSE DAX.
The pod's libc does not: a release whose runner does not load in the pod can take it over only as a new pod.

**The stager** is a DaemonSet on the runners' nodes, and the only writer of the release directory.
It runs the chart's runner image and copies the release that image carries under the image reference, with the runtime it names once per runtime, each appearing whole or not at all, and keeps the newest few releases and the runtimes they name.
Runner pods mount the directory read-only, so a guest that escapes into its runner cannot replace a release another owner's runner takes next.
It runs as root with no capability: root owns every file it copies and prunes, and the image build gives root read access to each of them, and write and search access to each directory.
A chart upgrade rolls the stager, which stages the new release.

**The loader** is the runner pod's entrypoint.
It supervises one runner process and runs the release the controller names in a ConfigMap per runner, which the runner's Deployment owns.
The pod's own image is always available as a release.
A staged one is used once the stager has reached the pod's node, and the loader first copies it, and its runtime, into the pod: the stager may remove them from the node while a runner still copies its guest binaries from one or a VMM still serves its guest agent from the other.
Before a hand-off the loader checks that the release's runner loads in the pod at all.
The loader restarts a runner that exits, with a backoff, and passes a stop of the pod to the runner, which then stops every machine as the [runner](vm-runner.md) page describes.

**A hand-off** replaces the runner process.
The loader signals the runner, which closes as it would for a stop but leaves every machine running, then starts the named release.
The new runner reads each machine's record, finds its VMM alive, and publishes its port again, as any restarted runner does.
The machines and their disks are untouched, and each keeps the runtime it booted; the machines the new runner starts boot its own runtime, so a machine moves to a new runtime at its next boot.
The runner records the runtime each machine booted, and manages a machine on another runtime assuming the two are compatible, rather than testing every pair of releases: a runtime error on such a machine, or a guest quiet for half a minute instead of ten, reboots it onto the runner's own runtime.
platform-init flushes the agent's home to the disk when the workload stops, so a stop whose quiesce an older guest agent does not confirm, which the runner ends with a power-off, costs a journal replay and not the agent's last writes.
The loader keeps a runtime in the pod while any VMM still maps it.
Connections already open through a published port drop with the old process, and the machine API is down for the seconds between the two.
A VMM whose runner exited is reaped by the pod's init.
A release that exits within a minute of taking over is held as **failed**, and the loader goes back to the release it replaced until the controller names another.

**What the controller does.** It names the configured runner image in each runner's ConfigMap, as many at a time as the roll's width.
A hand-off reboots nothing, but the loader's fallback catches only a release that exits: one that runs and then refuses to manage machines would, named everywhere at once, break every owner together.
So a hand-off holds a place in the same roll as a pod roll, and a new release is named only while fewer than the roll's width of runners are mid-roll or mid-hand-off.
It ends no turn, so it does not wait for idle agents.
A runner is mid-hand-off from the moment its release is named until it reports the release running, every machine that was ready before is ready again, stopped, or gone with its agent, and no ensure of that owner's machines was refused since.
A runner with ready machines stays mid-hand-off for at least two health polls, so each running agent has had an ensure against the new release before the next owner is named it.
A hand-off is in trouble when the runner holds the release as failed, when the runner refuses an ensure, or when it has not settled within the settle timeout; a runner that cannot be reached, or answers that it is shutting down, is the hand-off itself and does not count.
A hand-off in trouble is marked stalled on the runner's ConfigMap, reported as an error and counted, and keeps its place, so the release goes no further, as with a pod that is never ready.
A newer configured image resumes the release, starting with the runner that stalled, and so does an operator removing the stall annotation.
A runner that needs a pod for the release ends its hand-off, and the pod roll that follows takes its own place.
The pod's image is left out of what the roll compares, so a runner pod rolls only for a change to its shape.
The runner serves what its loader holds and why, with the reason drawn from a fixed vocabulary: not staged yet, built for another pod, or failed.
The controller reads it for a runner whose pod image is not the configured one.
A release built for another pod rolls the pod, onto the configured image; so does every release built against another runtime when the install keeps one runtime per pod, the switch back should a new runtime not manage machines an older one started; so does a runner that has not answered for ten minutes since it was named a new release, a loader that can bring up neither that release nor the one before, until it answers that it runs the release or holds it as failed; a release not yet staged is waited for; a failed one is never rolled onto, since a pod on it would fail the same way and take the machines with it.
What the loader is given, and what the runner reports, are held in the contract documents beside the runner ([`packages/vm-runner/contract/`](../../packages/vm-runner/contract/)).
