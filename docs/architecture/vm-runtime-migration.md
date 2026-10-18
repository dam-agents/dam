# VM runtime migration

Last verified: 2026-10-17

A **runtime migration** moves one container Agent onto the `vm` Backend's [runners](vm-runner.md) at the user's request, and can be undone until the Agent's machine has booted from the copy; the UI offers it only to users who opted into the new runtime.
`HOME` is the only path a machine keeps whatever image it boots, and a container's root outside its persisted mounts is the image's and keeps nothing ([persistence](persistence.md#per-agent-pvcs)), so a migration carries exactly one thing: the volume that held `HOME`, copied as the machine's home.
An Agent whose mounts persist any other path — outside `HOME`, or a volume of its own inside it — is refused with each such path named, rather than moved without it; a mount that is not persisted, such as `/tmp`, is carried by nothing and refuses nothing.
The api-server plans from the mounts the controller renders — the Agent's own, or the install's template defaults when it names none — and refuses such a path, an Agent that does not persist `HOME`, which leaves nothing to carry, an Agent already being moved or still clearing up an earlier move, and one mid-way through a storage migration; the UI offers the move from that same refusal.
Starting the move is also refused when the owner's [VM pool](budgets.md#what-is-counted) cannot hold it: the move needs about twice the home's size on that pool's storage — the seed until the switch, and as much again on the machine's first disk — up to the level the runner itself refuses a seed at, and the pool needs the memory for one more machine, which may grow to half of it.
Those figures come from the runner's own [usage read](vm-runner.md), so the plan says them before the user agrees, and an unreadable pool refuses nothing, since the runner refuses what it has no room for on its own.
Otherwise it writes a request and no spec: the **target** shape and a **snapshot** of every field the switch will change.
That write, and every later one — an abort, a retry, the switch — is conditioned on the version of the Agent it was decided from, so a change in between — a storage migration starting, a second request, the controller's status — fails it as a conflict, decided again from a fresh read and reported to retry if it keeps losing.
The container spec stays the Agent's spec until the machine has proven the copy, so the api-server stays the only spec writer and the switch is its write, not the controller's.
The rest is the controller's, and every step is derived from cluster state and from the migration's status condition — its phase, its reason and the copy attempts — so a restart resumes it.
It first makes the owner's runner and the machine, stopped, in the target shape, while the container keeps running and keeps its Service: that **preflight** proves the runner schedules, the image is fetched and unpacked and the disk is made before the Agent loses anything, and whatever it waits on is its reason.
Memory is admitted only when a machine starts, so a runner too small for it shows at the boot, still before the point of no return.
Only then does it scale the container's StatefulSet to zero — keeping it, and its claims, for an abort, and the storage migration leaves those claims alone while a runtime migration runs — and record which volume held `HOME`; once the pod is gone it runs a copy Job — the runner image's own archive writer, reading that volume read-only, or, for a volume only one node can attach, a CSI clone of it cut for that attempt — that streams it to the owner's runner; and only then lets the machine boot, so platform-init seeds the fresh disk from the copy instead of from the image.
The machine boots once even for an Agent that was asleep or stopped when the move began, and that stop holds again once the guest has answered.
No stop holds the boot, not even one asked for during the move, because every wake is refused until the move ends and nothing could release it; the api-server refuses a sleep while the move holds the Agent, and a stop from the preflight, whose own clear may have been missed, waits for the guest's answer like an older one.
While it boots the gateway serves the machine, admitting the owner's runner, and the container stays down, so the Agent's Service routes to the machine instead, as a vm Agent's does; an abort before the verified boot gives the container its headless Service back.
With the [owner gateway](credential-gateway.md#owner-gateway) on, the migrating Agent keeps its own gateway until its Backend switches, and moves to the owner gateway like any vm Agent after that.
A guest that answers with its home from the copy's seed, as the next paragraph says, makes the migration **verified**, the point of no return; the api-server, which polls for verified Agents, then switches the Backend to the target shape and withdraws the request in one write, and only after that does the controller remove the StatefulSet and the seed and retain the old home volume.
A copy that fails is reported with the copy Job's own error and retried, and so is one whose pod has not started ten minutes after its Job was made — a volume still attached to another node, a mount that fails — with the reason its pod's Events give; after three attempts, or once the migration has run for six hours, it is **failed**, with the reason on the Agent.
A copy no fresh attempt can change — a home past the copy's walk limits, or larger than the machine's disk — fails it at the first attempt instead, saying what the user can change.
The copy stays on the owner's storage until the move is done, and the first boot restores as much again onto the machine's disk on the same storage, so a move needs about twice the home's size.
The runner looks at the storage every 64 MiB of an upload, and stops it as storage full once what it wrote, counted twice, would take the storage to 90%, the level up to which the owner's other agents are protected; the message says the move needs about twice the home's size and how much is free.
A write that finds the storage full anyway is reported as storage full too, not as the runner's own error.
A failed migration keeps a container it had stopped stopped and one it never stopped running, until the user retries or aborts.
A **retry** starts over from the preflight with a fresh machine, since a boot that failed may have seeded part of its disk.
An **abort** is valid in every phase before verified: the api-server withdraws the request and writes the snapshot's fields back, and the controller deletes the copy Job and the machine with its seed and removes the condition; the old volumes never lost their labels, so the container resumes on them as they were.
An abort does not wait on a runner that cannot be reached, since that is when a user most needs the container back: the controller marks the machine it could not delete as left on the Agent (`agent-platform.ai/runtime-migration-machine-left`) and removes the condition anyway.
Such an Agent no longer claims a machine of its name, so the [orphan sweep](vm-runner.md#runner-lifecycle) deletes it once the runner answers and drops the mark; a new migration of the Agent deletes it first, so its machine starts on a fresh disk.
Both writes carry the version they were decided from — the api-server's abort against the controller's status, the controller's verified mark against the request — so exactly one of an abort and a verified boot wins.
The copy Job waits for the runner to accept its connection before it uploads, because a policy engine admits a new pod to the runner's ingress rule only after the pod exists.

**The copy Job holds a seed capability, never the runner's token.** The Job parses what an agent wrote, and the token drives every route for every machine of the owner, so the controller mints the Job a capability instead: an HMAC over the machine, the seed scope, a random nonce and an expiry, keyed with a key derived from the runner's token under a fixed label, so the runner checks it with no second secret to distribute and the Job cannot work the token back out of it.
It is fresh for every Job, expires shortly after the Job's active deadline, and sits in a Secret that only that Job mounts and that is deleted with it, and whenever the migration is aborted, retried or fails.
The runner accepts it on the seed upload of the machine it names and nowhere else, and only while the controller's latest spec for that machine marks it as migrating — the controller sets the mark from the preflight until the copy is in and drops it before the first boot or when the migration fails, and a retry's fresh machine takes it again — no guest has yet answered from the machine's disk, and the capability is unspent.
A seed not yet booted from may be replaced, because an attempt can store its seed and still fail with its answer lost; each Job makes one attempt, so the retry is a new Job with a fresh capability.
A capability is spent before its seed is stored, and what was spent is kept on the runner's claim beside the machine, so a restart does not forget it.
The token still opens the seed upload and every other route; the controller itself never seeds.
Each stored seed goes on the runner's security log with its machine, size, digest and what let it in, and each refused capability with the reason, naming a capability only by a fingerprint the controller also logs when it mints one.
A runner not yet rolled onto a release that knows capabilities refuses them, so a migration on it retries until its runner rolls.
Both sides hold the derivation to a shared contract document ([`packages/vm-runner/contract/`](../../packages/vm-runner/contract/)).

**The boot is held to the copy.** A guest that answers proves only that it booted, and a seed can go missing between the copy and the boot — a runner claim lost or recreated, a node that crashed before the upload was durable, an operator — after which platform-init would seed the image's home and the migration would look done.
So the seed is a contract from end to end.
The copy Job reports the seed the runner stored, its size and digest, once the runner's answer matched what was sent; the controller records it on the Agent and sends it with the machine's desired shape for as long as the migration boots, and a boot with no seed recorded is held down.
The Job is the only record of that seed, so it has no time to live and is deleted only once the seed is on the Agent: a controller that restarts or comes late finds one or the other, and the migration boots without another copy.
The runner starts that machine only while its share holds exactly that seed, judged by the digest its upload was answered with, and otherwise refuses under a reason of its own; it also writes the expectation into the share, where the guest reads it and cannot change it.
platform-init then restores the home from that seed, hashing it as it unpacks, or fails the boot — it never falls back to the image — and records on the disk which seed it used, so a reboot before the migration ends mounts that home again and refuses any other.
Until the guest first answers, the runner reports the boot as copying a disk, so a large home's restore is held for up to six hours rather than restarted, and the controller counts it as neither a failed start nor idle.
When the guest first answers, the runner records the expected seed as the one the home came from and reports it in the machine's status: platform-init let the image start only on a home from that seed, so the answer is the proof, and nothing is read off a disk the guest has had root on.
A change in the expectation alone restarts no machine.
The controller marks the migration verified only when the machine is ready and reports the seed it expects.
A seed the runner does not hold, a home from anything else, or a copy that did not say which seed it stored sends the migration back to copying, with the reason on the Agent: the machine is deleted, so the new copy lands on a fresh disk, and the old volumes, which keep their labels until the switch, are copied again, as one more copy attempt.
A runner that reports no seed reads as a home from elsewhere, so its migrations are copied again until the owner's runner rolls onto a release that does.

**The copy Job is confined, pinned and throttled.** It runs under the runtime's default seccomp profile with no escalation and a read-only root; a shared home volume is read as the agent's uid, a block one as root holding DAC_READ_SEARCH alone.
It runs under the cluster's default runtime even where agent pods run under Kata: a Kata pod's memory cap covers the whole VM but is sized from the container's limit, far below the guest's RAM, so reading a large home would fill the guest's page cache past the cap, the VMM would be killed, and the pod would be left running with nothing able to stop it.
Like the storage migration's copy, it runs only platform tooling over the agent's data, never agent code.
Its own NetworkPolicy reaches only the owner's runner, pinned by address with no DNS, and copies are capped per install and per owner.
An Agent with no volume skips the copy and boots from the image, still through the verified boot and the switch.

**A single-node home is copied from a clone.** A volume only one node can attach stays attached to the node the container last ran on until that node's kubelet lets it go, and a node with a sandbox that will not die never does, so a copy pod placed anywhere else waits on Multi-Attach.
So each attempt asks the CSI driver for a clone of the home — a claim of the same class, mode and size whose data source is the home — and reads that instead; the backend cuts it without attaching the home anywhere, the container is already down so it holds exactly what the copy would read, and a clone an earlier stuck pod still holds blocks no later attempt, which reads one of its own.
The clone is owned by the Agent and carries none of the Agent's volume labels, so nothing takes it for the Agent's own volume, and it is deleted with its attempt, when the copy lands, and when the migration fails, is aborted or ends.
A shared volume is read in place, as is one no CSI driver serves or whose PersistentVolume the controller may not read; an install whose driver cannot clone sets `virtualization.runtimeMigration.cloneSource: false` to read every volume in place.
What holds a migration up is said as [observability](observability.md#runtime-migration) describes.

**What the user is told.** Before anything is written, the api-server answers a read-only **plan** for the move, read off the same refusal a migrate checks, so the plan and the request cannot disagree: the paths that cannot move and why, that the new disk grows inside its owner's storage pool rather than having a size of its own, whether a sleeping Agent will be started to finish the move — which counts against its owner's [budget](budgets.md) while it runs — and the retention window below, read from the same chart value the controller uses.
The confirm dialog shows that plan, and says the move can be aborted until the Agent has started on the new runtime.
An Agent the api-server would refuse keeps a disabled Migrate whose card, opened by hover or tap, lists the refusal reasons in the words the request refuses with.
From the container's stop until the machine has booted from the copy the Agent reads as **migrating**, ahead of every state but an error, and so does one whose migration failed after the stop, since it stays stopped until retried or aborted; through the preflight, an abort and a verified boot it reads as whichever side is starting or running.
A wake for a migrating Agent, the owner's own included, is refused at once rather than waited out, so a chat reads "moving to the new runtime", a [channel](channel-turns.md) message is answered "try again in a few minutes" — or, after a failure, that the move failed and waits on its owner — instead of timing out, and a [schedule](schedules.md#fire) fire is held.

**The old volumes are retained.** Once the Backend has switched, the volume the copy was read from is kept for a retention window (`virtualization.runtimeMigration.retention`, a week by default) rather than deleted, so work that turns out to be missing after the move can still be recovered.
The controller takes it out of everything that finds an agent's volumes by label — the agent and mount labels go, so the warm pool, the storage migration, the orphan sweep and a StatefulSet's claims never see it — and marks it `retained-for` the Agent, with annotations naming the path it held and the time it is kept until.
It is owned by the Agent, and the controller deletes it when the Agent is deleted or, from its periodic sweep, once the window has passed; a window that is not a readable time is kept and warned about, never read as expired.
Because a StatefulSet claims volumes by name, an Agent put back on the container backend by hand is refused while anything is retained for it, rather than silently resuming from its pre-migration home.
An operator recovers from a retained volume as the runbook below says, and ends the window early by deleting the claim.

**What the seed carries.** The copy is the home as one tree, entry by entry: names relative to `HOME`, modes, modification times to the second, symlinks as the links they are whatever they point at, a file with several names once, and a sparse file as its data and a map of its holes, which platform-init restores as holes again.
Owners stay numeric, except that the uid and gid the install runs agent containers as become root's, the user a machine's harness runs as, so git and ssh accept what the agent owned; every other owner is kept.
Extended attributes, ACLs, sockets, fifos and devices are not carried.
What only the container used stays behind: the runtime's env file, which the platform pushes again when the machine's runtime first says hello, so no stale credentials land on the disk, and the container's link from `~/.cache` to pod-local scratch, so a machine keeps its caches in `HOME`.
The machine's runtime waits for the env file for 15 seconds before it starts the harness without it, and a harness that started without its env is recycled when the push lands, which waits up to 10 seconds for a call in flight and then fails it.
An Agent is ready only after the switch, so the push does not wait for that: it goes out once the migration is verified, which the guest's first answer makes it, through the Service that already routes to the machine.
Only a verified machine gets it, because a machine whose home is not the copy is deleted, and the env holds the Agent's credentials.
The api-server looks for verified Agents every 2 seconds, so the switch follows soon after.
The copy Job walks the home within a bound on depth, entries and memory, and a home past one fails the copy with a message that names it.
The runner drops an upload that sends nothing for minutes, because the upload holds the machine down; it flushes the seed and the share before it answers, and removes a seed a killed runner left half-staged at the machine's next action or when the seed is removed.
The copy Job gives up an upload the runner stops reading or never answers, so the attempt is retried.
platform-init flushes the restored home to the disk before it gives it its name, so a stop mid-seed never leaves a named but partial home.

## Operating a migration

A runbook for operators; every name below is the label or annotation the controller and api-server write.

**Find what is retained.** A retained volume carries the label `agent-platform.ai/retained-for` naming its Agent, and the annotations `agent-platform.ai/retained-mount` (the path it held) and `agent-platform.ai/retained-until` (an RFC 3339 time).
List them with `kubectl get pvc -n <agent-namespace> -l agent-platform.ai/retained-for=<agent>`, or across Agents with `-l agent-platform.ai/retained-for`.
Volumes of a migration that has not switched yet are not retained: they are still the Agent's own, labelled as any container Agent's volumes are.

**Read one, as hostile content.** The volume holds whatever the agent wrote, as root in its own sandbox, so treat it as untrusted: device nodes, setuid binaries and symlinks pointing anywhere on the host that mounts it.

- Mount it read-only, and with `nosuid,nodev,noexec`: set those in the PersistentVolume's mount options before a pod mounts it, and mount the claim read-only in the pod as well.
- Use a pod of your own, not the Agent's: a minimal image, no service-account token, no network beyond what the copy needs, running as a non-root user with every capability dropped.
  Never run anything from the volume.
- Never follow a symlink out of it.
  Copy links as links — `tar` without `-h`, `cp -P`, `rsync -l` without `-L` — and never resolve one while reading.
- Copy what you need into the Agent's `HOME` through the files API, or anywhere else, and delete the pod.

**Extend the window.** Overwrite the time with `kubectl annotate pvc <name> -n <agent-namespace> agent-platform.ai/retained-until=<RFC 3339 time> --overwrite`.
A value that is not a readable time is kept and warned about, never read as expired, so a typo never deletes the only copy.

**Unstick a migration.** The Agent's `RuntimeMigrating` condition names the phase and why it waits, and the Agent's status counts the copy attempts.
A migration that cannot finish fails on its own after three copy attempts or six hours, and at the first attempt when the home cannot fit the machine.
Until it is verified it can be aborted, which returns the Agent to the container on its old volumes, or, once failed, retried, which starts over with a fresh machine; the Agent's owner does either from the Agent's row.
An operator without the UI withdraws the request by removing the `agent-platform.ai/runtime-migration` annotation and its `-target`, `-snapshot` and `-retry` companions, which the controller treats as an abort; the spec was never switched, and the `-snapshot` annotation, read before it is removed, holds the fields as they were.
A retry by hand sets `agent-platform.ai/runtime-migration-retry` to the current time.
A verified migration cannot be aborted: the machine is the Agent now, and what the copy missed is recovered from the retained volumes.
