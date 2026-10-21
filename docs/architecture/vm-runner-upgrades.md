# VM runner upgrades

Last verified: 2026-10-21

How a change to the [runner](vm-runner.md) reaches owners whose machines are running: as a **roll** of the runner pod, which reboots the owner's machines, or, for a new runner release only, as a **hand-off** inside the pod, which reboots none unless the release declares that its machines must reboot onto it, which rolls the pod instead.

## Rolls

**A change to the runner pod rolls across owners, not all at once.** Because a pod restart reboots every machine of that owner, a new runner image or a controller release that renders the pod differently would otherwise reboot every vm machine in the install together, where container agents roll one at a time.
The controller records a hash of the pod it rendered on each runner, leaves a runner alone while that hash is unchanged, and lets a changed one roll only while fewer than the install's roll width are mid-roll.
That hash leaves out every field the controller changes on the running pod in place, and the class the chart sets for every runner at once: the memory limit, which is the owner's pool, and the memory request ([vm-memory](vm-memory.md)), the CPU limit and the zero CPU request the same resize sets, and the PriorityClass, which a pod takes when it is rolled for another reason ([vm-runner](vm-runner.md)).
None of those alone rolls a runner, so none of them reboots an owner's machines, and a pod created later takes whatever the install renders then.
The roll width is a count of runners, one by default, or a share of the runners the install has, rounded up to at least one: a count alone cannot keep up, since one runner at a time takes an install of a thousand owners days to roll.
A runner is mid-roll from that moment until its new pod is ready and every machine that was ready before is ready again, or its agent is gone; a settle timeout bounds the wait for machines, so one that never comes back does not stall everyone else.
The machines it waits on are listed in the runner's `runner-awaiting` annotation, and [the idle checker](agent-lifecycle.md#hibernate) leaves every one of them awake: a hibernated machine never comes back ready, so a sweep that hibernated one would make the roll wait out its settle timeout and give up on machines that were only idle.
The list is written when the roll starts and cleared in the write that settles it or finds its machines did not come back in time, and the idle checker leaves a stalled roll's list alone, since that roll is waiting on nothing of the owner's.
That release happens on the owner's own turn whether or not any other runner asks for a place: a runner already on the pod it should run asks for none, so the last roll of an upgrade would otherwise keep its wait — and the pin on its machines — standing for good.
A pod that never became ready is the other half of it: past the settle timeout that roll is marked stalled and keeps its place, so the release goes no further, and the mark is what ends its pin.
A runner already mid-roll holds one of the width's places, so rolling it again replaces a target that failed in the place it holds rather than taking another: a fleet that shrinks under a stalled roll — owners removed, the share falling below the runners stuck on it — still takes a corrective roll, where counting its peers alone would leave every one of them blocked.
A new pod that is still not ready at the timeout is a broken runner release, not a slow machine: that roll keeps its place, so the release goes no further, and is marked stalled, reported as an error and written as a Warning Event on its Deployment, until its pod becomes ready or the pod changes again.
That hold is bounded by `rollout.stalledTimeout`, half an hour by default, counted from the moment the roll started: past it the stalled runner gives up its place and the next owner rolls, keeping the stalled mark until its pod is ready.
A truly broken release therefore breaks owners one at a time instead of freezing every owner's upgrade.
The exceptions are states no release can cause: a pod still creating its containers, none ever started, whose claim the attach controller refuses as Multi-Attach, an old pod that never finishes terminating because its node is gone or not ready, and a runner whose pod admission refused to create at all.
That last one is skipped only while another owner's runner already runs the same pod shape and is ready, which the refused runner's own ReplicaSet reports as a failed create: the runners share one namespace, one ServiceAccount and one security policy, so a refusal the release causes refuses them all, and a ready peer proves the shape is admitted.
With no ready peer the refusal halts the roll, which is what a broken release looks like.
Each says nothing about the release, so the roll is reported as an error, counted and skipped, and other owners keep rolling; the runner comes up on the new pod once its fault clears.
Every other state still halts the roll: a pod the scheduler cannot place, since a release that adds a node selector or raises a request makes every runner unplaceable, a container that started, an image that does not pull.
The node is read through the node read grant the chart adds with virtualization; an install without it cannot tell a lost node, so a pod stuck terminating halts the roll there.
A runner whose pod is unchanged is not rolled — unless its runner holds the configured release as one whose machines must reboot onto it, which rolls the pod with a revised template ([below](#hand-offs)) — but labels or owner references that drifted on it are put back without touching the pod.
A new owner's runner is created at once, since there is nothing of theirs to protect.
A changed runner also waits for its owner's agents to be idle, since a roll ends the turn an agent is in.
Before it takes a place in the roll, the controller asks each of the owner's ready machines the idle checker's own question, whether its agent's status says idle, all at once, and an agent that does not answer counts as idle.
A runner with a busy agent holds no place, so other owners roll meanwhile, and the next pass offers it again.
The install's idle wait, a day by default so that a multi-hour kept job finishes, bounds this from the first pass that found the owner busy, and is recorded on the runner so a controller restart does not start it over; past it, the runner rolls with the agent busy, so an owner who is never idle still gets the release.
**A runner that cannot reach its node's image cache does not wait out the idle wait.** Such a runner boots only the trees its own machines already hold, so every image its owner has not booted yet is refused ([vm-image-cache](vm-image-cache.md)), and the image update job holds each upgrade rather than moving an Agent back.
Waiting would protect one turn and cost the owner every image move for the whole idle wait, so a runner whose cache stays out of reach rolls with the agent busy.
It takes a minute of the runner saying so first: a cache service restarted, or a socket rebound under it, refuses a connect for seconds, and one refused probe is not worth the turns of a healthy, busy runner.
The first pass that reads the refusal records when it read it on the runner's Deployment, so the wait is judged across passes and a controller restart does not start it over, and a cache that answers in between clears the record and starts the minute again.
The minute therefore counts only the time a pass watched the refusal: a pass that finds no place in the roll asks nothing and forgets the record, since a cache that recovered while every place was taken is never seen to recover.
The wait is otherwise what it was: a runner whose cache answers waits, and so does one that cannot be asked at all, since a runner that answers nothing may still have a working cache.
**A held roll is reported once per transition, not once per pass.** The controller writes a Kubernetes Event on the runner's Deployment when the wait starts, when the cache goes out of reach, when it passes the idle wait, and when a cache that stayed out of reach takes the roll past that wait, naming whichever of the busy agents, the node directory that runner mounts as its cache, and the runner's own refusal explains that transition, and only once the write that records the transition has landed.
A roll held right now is one series in `platform.vm_runner.roll_held_for_idle`, the age of the roll held longest, observed rather than recorded: it reads zero when the last hold ends, and drops a hold no pass reported for half an hour, well past the drift pass and the ten-minute sweep that refresh a live one, so a queue delay never reads as a deletion; it names no owner, since a runner is per owner and no exported series names a person ([observability](observability.md)), and the Events on the runner are what say which roll is held.
An operator therefore reads one line per change in `kubectl get events`, and one series per roll held now, rather than one log line per reconcile.
Rolls advance as agents reconcile and on the periodic sweep, which offers every runner its turn so owners whose agents all sleep still roll, as many turns at once as the roll is wide, handed out in name order; which runners are mid-roll is read once every few seconds rather than on every turn, and a roll the controller starts counts at once.
That read takes only what the runners' Deployments record, and calls no runner, since every owner's decision waits on it.
Whether a runner's machines came back is asked on its own owner's turn, an agent of theirs reconciling or the sweep reaching them, and so is the owner's own list of ready machines before it takes a place.
So a runner that stops answering holds up only its own owner's agents, during a roll or a release as at any other time.
The sweep only ever updates a runner that exists — creating one is an agent's reconcile's alone.
A roll still reboots each owner's machines once: nothing checkpoints them across it, and the VMM host is the same pod as the machine API it serves.
So a published chart pins the runner image by digest, and a rebuild that changes nothing in the image — only the record of when and with what it was built — keeps the image it would have replaced: a release that leaves the runner as it was rolls no runner.

## Hand-offs

A [runner](vm-runner.md) pod's machines are its processes, so restarting the pod reboots every machine of its owner.
Most runner changes do not need the pod restarted: what changes is the runner process, not the VMMs it started.
Every install with runner pods therefore names a node directory for runner releases ([values](../../helm/values.yaml)), and the chart refuses one that clears it; each pod takes a new runner image from there in place, without rebooting a machine, unless that release declares a reboot key its pod does not run, which rolls the pod instead (below; a pod whose own release declares no key takes it in place).
On OpenShift the directory the kubelet creates carries the host's own SELinux label, which a confined runner may not read, so the stager labels it, and everything it stages, for containers at the plain level every runner's own categories can read; to set that label it runs as the unconfined container type, as the [image cache](vm-image-cache.md) service does, under the SCC the install names for its runners.
A cluster admin can instead have the nodes create and label the directory themselves, with the node configuration in [`etc/openshift-node-config/`](../../etc/openshift-node-config/).

**A runner release** is the runner with the two guest binaries it copies into every machine's share, platform-init and platform-runc, so the side that writes a share and the side that reads it stay one version.
Each release also records the **runtime** it was built against: the smolvm release with the first stage of platform-init as the guests' init, the guest kernel and the libkrun the platform patches, the image tooling, and the base image's libc.
The runner is itself the VMM of every machine it starts, and loads its runtime's libraries and agent root, so the runtime travels with the release.
That first stage only executes the share's platform-init, which is the release's, so a machine's init is always the release that wrote its share.
Its guest kernel is the smolvm release's own libkrunfw, Linux 6.18 with [smol-machines/libkrunfw#31](https://github.com/smol-machines/libkrunfw/pull/31), rebuilt with a patch that adds btrfs ([vm-runner](vm-runner.md)) and zram swap ([vm-memory](vm-memory.md)).
The image build refuses a rebuilt kernel whose version is not the release's.
Without that fix, from 6.15 on, FUSE DAX corrupts a mapped file that another process opens, and a guest of 6 GiB or more dies of SIGBUS ([smol-machines/smolvm#1741](https://github.com/smol-machines/smolvm/issues/1741)); 6.18 also stalls a guest whose mapped working set outgrows the DAX window.
The vm e2e lane boots a 6 GiB guest with the runner's kernel and checks both, so a smolvm release whose kernel fails them fails the lane.
The Mac's host runner has the same kernel, and its guests have no FUSE DAX.
The pod's libc does not: a release whose runner does not load in the pod can take it over only as a new pod.

**The stager** is a DaemonSet on the runners' nodes, and the only writer of the release directory, or rather of the install's own subdirectory of it, named after the agent namespace, so installs that share nodes do not prune each other's releases.
It runs the chart's runner image and copies the release that image carries under the image reference, with the runtime it names once per runtime, each appearing whole or not at all, and keeps the newest few releases and the runtimes they name.
Runner pods mount the directory read-only, so a guest that escapes into its runner cannot replace a release another owner's runner takes next.
It runs as root with no capability: root owns every file it copies and prunes, and the image build gives root read access to each of them, and write and search access to each directory.
A chart upgrade replaces every stager at once, since a stager serves nothing once it has staged, so the new release reaches each node after that node's own image pull.

**The loader** is the runner pod's entrypoint.
It supervises one runner process and runs the release the controller names over the runner's own machine API, with its token: the runner writes the name into the loader's directory in the pod, which the loader reads every second, so a hand-off starts seconds after the call.
The name lives as long as the pod: a runner process that restarts keeps it, and a new pod runs its own image until the controller names the release again.
The pod's own image is always available as a release.
A staged one is used once the stager has reached the pod's node, and the loader first copies it, and its runtime, into the pod: the stager may remove them from the node while a runner still copies its guest binaries from one or a VMM still serves its agent rootfs from the other.
Before a hand-off the loader checks that the release's runner loads in the pod at all.
The loader restarts a runner that exits, with a backoff, and passes a stop of the pod to the runner, which then stops every machine as the [runner](vm-runner.md) page describes.
A stop that arrives while no runner can take it — the old one closing for a hand-off, a release being copied in, a backoff — is kept: a hand-off not yet begun is dropped, a backoff is cut short, and the stop goes to the next runner once that runner has set up its own stop, since one killed before that leaves its machines to be powered off with the pod.

**A hand-off** replaces the runner process.
The loader signals the runner, which closes as it would for a stop but leaves every machine running, then starts the named release.
The new runner reads each machine's record, finds its VMM alive, and publishes its port again, as any restarted runner does.
The machines and their disks are untouched, and each keeps the runtime it booted; the machines the new runner starts boot its own runtime, so a machine moves to a new runtime at its next boot.
The runner records the runtime each machine booted, and manages a machine on another runtime assuming the two are compatible, rather than testing every pair of releases: a runtime error on such a machine, or a guest quiet for half a minute instead of ten, reboots it onto the runner's own runtime.
That reboot is the safety for a new runtime, and it waits on the machine failing: a fix a running guest needs — a new libkrun, guest kernel or platform-init — reaches it only when a hand-off's machine errs or goes quiet.
So a release declares which of what a machine booted it changes, as a reboot key it carries in its release directory, written by the image build from [`packages/vm-runner/reboot-id`](../../packages/vm-runner/reboot-id): a runner refuses a release whose key differs from the one it runs, holding it as `reboot`, and each owner's runner pod rolls onto that release instead, rebooting that owner's machines.
That key also covers the loader, which a hand-off never replaces: the loader is the pod's entrypoint and only the pod's own image carries it, so a release that needs a new one — a loader that records the signal of a machine that outlived its runner, say — declares a key of its own, and the roll that hold causes is what delivers it.
An upgrade that changes the pod's shape along with the release rolls every runner pod once, onto the configured image, so the loader the image now carries arrives with that roll; the two are not one step, since the controller comes up first and a pod whose roll has not come yet still runs the loader its own image was built with, so a death only that loader can record goes unnamed until the roll reaches it.
The key is compared whole and never parsed, and a release that changes nothing a machine booted carries the key before it, so the pods it reaches take it in place.
A release built before keys declares none, and so does a pod built from one: with nothing to compare, the keyed release is handed off in place and no machine reboots, until that pod's shape changes for another reason, which rolls it onto a release that carries a key.
The pod roll a `reboot` hold causes does not wait for the owner's agents to be idle, which would otherwise hold the release back a day from an owner who is never idle.
That roll ends the turn each busy agent is in, and the controller reports the owner and those agents when it rolls past them.
That exemption belongs to the roll that carries the release, never to a roll a changed pod shape causes, which keeps its idle wait.
The runner's own answer is what the controller rolls on: a release it holds as `reboot` ends the hand-off, and the pod roll that follows takes its own place in the width.
Such a roll writes the image that carries the release, which the pod does not have yet — a pod on the configured image already runs the release it declares — and that change to the pod template is what restarts it, rebooting the machines.
The vm e2e lane's runner release spec rolls a live machine onto a release that declares a new key, and back onto the install's, so a key's roll reaches a running machine there and not only a fake runner.
A runner that holds that release as failed keeps the pod it has: a pod on the release would fail the same way and take its machines with it, so the refusal to reboot does not overrule what the runner reported.
Leaving a runtime otherwise is configuring the release before it again, which the hand-off takes unless that release declares another key than the pod runs, which rolls the pod.
platform-init flushes the agent's home to the disk when the workload stops, so a stop whose quiesce a guest does not confirm, which the runner ends with a power-off, costs no more than a power cut and not the agent's last writes.
The loader keeps a runtime in the pod while any VMM still boots from it: it finds each VMM by its command line and reads the agent root the runner recorded beside the VMM's boot config at its start.
A VMM makes itself non-dumpable, so its memory map is shut to the loader, and smolvm deletes the boot config once read; a VMM with no record, one an older release started, keeps every runtime.
Connections already open through a published port drop with the old process, and the machine API is down for the seconds between the two.
A VMM whose runner exited is reaped by the loader, which asks the kernel to hand it every orphan of this pod: the pod's init would otherwise inherit the machine and reap it without a word, and the VMM's exit signal is the only record of how the machine went down.
The loader writes that signal beside the runner's machine records, one file per pid, written under another name and renamed into place, and the runner that adopted the machine reads it once and names the kill by it — `MachineOOMKilled` or `MachineSeccompKilled` ([vm-runner](vm-runner.md)).
A record stays until it is old, since the runner learns the pid it names only from the record itself.
A release that exits within a minute of taking over is held as **failed**, and the loader goes back to the release it replaced until the controller names another.
A runner under a loader whose machine API fails to serve exits as a hand-off does, leaving every machine running, so the release the loader goes back to, or the same one restarted, adopts them without a reboot; a pod stop that arrives during that close still stops them, and a runner with no loader stops them first, since its exit ends the pod.

**What the controller does.** It names the configured runner image to each runner over the machine API, as many at a time as the roll's width, and records the release it named on the runner's Deployment, as metadata that changes no pod.
That record is what a restarted controller resumes from, and what it names again to a runner that reports neither running nor taking it, a pod that restarted and forgot.
A hand-off reboots nothing, but the loader's fallback catches only a release that exits: one that runs and then refuses to manage machines would, named everywhere at once, break every owner together.
So a hand-off holds a place in the same roll as a pod roll, and a new release is named only while fewer than the roll's width of runners are mid-roll or mid-hand-off.
A runner already mid-hand-off takes the release in the place it holds, as a mid-roll runner takes a corrective roll, so a fleet that shrinks under the width still offers every runner stuck on a broken release the corrected one.
It ends no turn, so it does not wait for idle agents.
A runner whose pod is about to roll is not named a release: the roll starts it on the configured image.
A runner is mid-hand-off from the moment its release is named until it reports the release running, every machine that was ready before is ready again, stopped, or gone with its agent, and no ensure of that owner's machines was refused since.
As with a roll, the runner is asked on its own owner's turn, so a hand-off settles, or is found in trouble, when an agent of that owner reconciles or the sweep reaches them.
An owner with no ready machine has no agent to settle their hand-off, so the sweep, on its turn for them, waits until their runner has taken the release, the hand-off stalls, or the settle timeout passes.
The sweep runs as many such turns at once as the roll is wide, so one pass takes a release to every owner with nothing running in about owners divided by the width hand-offs of a few seconds each, while owners with running machines still take it a few at a time.
The rollout sweep runs apart from the orphan sweep, so a long pass delays no cleanup.
A runner with ready machines stays mid-hand-off for at least two minutes, and naming the release writes the runner's Deployment, which requeues every vm Agent of that owner: each ensures its machine against the new runner, and an ensure the new release refuses stalls the hand-off from that Agent's reconcile.
The wait outlasts those ensures so a release that runs but refuses them is seen before the next owner is named it.
A hand-off is in trouble when the runner holds the release as failed, when the runner refuses an ensure, or when it has not settled within the settle timeout; a runner that cannot be reached, or answers that it is shutting down, is the hand-off itself and does not count.
Time the runner reports the release not staged on its node does not count either: the hand-off's start moves up while it waits, so the settle timeout runs from about when the stager reached the node, and a stager that never does keeps the hand-off waiting in its place rather than stalled.
A hand-off in trouble is marked stalled on the runner's Deployment, reported as an error and counted, and keeps its place, so the release goes no further, as with a pod that is never ready — except that the stalled bound releases a roll's place alone, and a stalled hand-off keeps its own until the release changes.
A newer configured image resumes the release, starting with the runner that stalled, and so does an operator removing the stall annotation.
A runner that needs a pod for the release ends its hand-off, and the pod roll that follows takes its own place.
The pod's image is left out of what the roll compares, so a runner pod rolls for a change to its shape, and a release that must reboot its machines rolls it with the image change that carries the release.
A pod rendered by a controller from before releases were named over the machine API has a loader that reads only a mounted ConfigMap; its shape is not the one rendered now, so it rolls once, through the ordinary roll, and the roll removes the ConfigMap.
The runner serves what its loader holds and why, with the reason drawn from a fixed vocabulary: not staged yet, built for another pod, rebooting its machines, or failed.
The controller reads it for a runner whose pod image is not the configured one, which is every runner a release has yet to reach, and rolls the pod of one that holds the release as `reboot`.
A release built for another pod rolls the pod, onto the configured image, and so does one that reboots its machines; so does a runner that has not answered for ten minutes since it was named a new release, a loader that can bring up neither that release nor the one before, until it answers that it runs the release or holds it as failed; a release not yet staged is waited for; a failed one is never rolled onto, since a pod on it would fail the same way and take the machines with it.
What the loader is given, what the controller names, and what the runner reports, are held in the contract documents beside the runner ([`packages/vm-runner/contract/`](../../packages/vm-runner/contract/)).
