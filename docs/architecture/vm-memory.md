# VM memory

Last verified: 2026-10-19

An owner's machines share the memory of their [runner](vm-runner.md), and it is counted by what they use rather than by their sizes.
That memory is the owner's whole pool for vm agents, which have no size of their own and stand outside the [budget](budgets.md)'s Ceiling.
The pool is the install's runner memory limit (`virtualization.runner.resources.limits.memory`) unless the owner's [UserBudget](budgets.md#the-ceiling) sets `memory`; `cpu` there caps the runner's CPU limit the same way.

**A pool changes in place.** The controller reads each owner's UserBudget again at every memory pass, every 30 seconds, before it creates an owner's runner claim, which never shrinks, and whenever it starts one of their machines, so a machine woken after the pool changed is sized from the new pool; it resizes the running runner pod's memory limit and CPU limit through its resize subresource, so a raised or lowered pool restarts no machine; the pod's roll leaves its memory limit and request out of what it compares, and a pod created later starts at the pool rendered then.
A pool that rises is the limit at once.
One that falls is the target of admission and reclaim at once, but the limit itself stops at what the running machines are counted at plus the reserve, in 512 MiB steps, and comes down as they stop, since a limit under them would have the kernel kill the runner with every machine.
A machine's new size reaches it at its next start.

**An unread pool is unknown, not the install's default.** A controller that has not read an owner's UserBudget has no pool for them, and the install's default is smaller than some owners' pools and larger than others, so it stands in for none: a claim built at it can never come down again, a memory limit built at it falls under the machines already running on it, and a machine sized from it is sized past the pool its owner meant.
While a pool is unread the controller creates no claim and no Deployment for that owner and changes no size, and retries; a pool read once is kept when a later read fails, so a moment of trouble changes nothing.
A claim and a runner that already exist are left as they are, and an agent that should stop still stops: neither needs a size from the pool.
No reclaim is decided from an unread pool either: it is the pool that says how much memory an owner's machines may hold.

**Every machine may grow to half the pool.** A machine's size is half of what its runner hands out — the runner's memory limit less its reserve — whatever its Agent's spec names, so one agent can use most of the pool while a runaway guest meets its own OOM killer before it takes the runner, and every sibling, over the limit.
Every machine gets the install's vCPUs (`virtualization.runner.machineCPUs`); they are threads of the runner, so an idle machine costs nothing.
The controller keeps the runner pod's CPU limit, resized in place, at the vCPUs of the machines that should be running plus one machine's worth for the runner itself and the VMMs' own threads, never above the owner's CPU pool: their UserBudget's `cpu`, else a CPU limit the install sets.
Unless the pool caps it lower, a guest is never throttled below its vCPUs, and one runaway VMM cannot take the whole node.
A cluster without in-place resize sets no CPU limit.
The [host runner](vm-host-runner.md) admits against a share of the Mac's memory that the controller never learns, not against the chart's pod limit, so there the Agent's spec still sets its machine's memory; its vCPUs still come from the install.
A new size reaches a running machine at its next start, not by rebooting it ([vm-runner](vm-runner.md)); until then the controller counts it at the larger of the two sizes, in memory and in vCPUs.
A machine's size is the most its guest can see; the host commits only the pages the guest touches, and the guest hands freed pages back through free-page reporting, so an idle agent on a 2 GiB machine holds a few hundred MiB.

**A machine boots small and grows.** A guest's kernel writes a page descriptor for every page of its RAM before it runs anything, and under nested virtualization that costs 65 to 85 ms per GiB: most of a second for a 12 GiB machine.
So the runner boots each machine with the warm-up floor below (`virtualization.runner.bootMiB`), or its size when that is smaller, and grows it to its size as soon as the start returns, through the virtio-mem area smolvm gives every guest.
The VMM maps the added RAM, platform-init puts each memory block online as the guest's virtio-mem driver adds it (the driver adds no more once 1 GiB of it waits offline), and the start ends once the guest has plugged it all.
Every boot does this again, since each boots from the floor, except a machine the runner has recorded as unable to grow (below).
Readiness does not wait for the grow, which runs while the workload starts, because waiting would put the same page work back on the path; a guest that allocates past the floor before the grow ends meets its own OOM killer.
A machine that cannot grow is stopped and booted again whole within the same start, unless its guest has already answered: the agent reads ready by then, and a reboot would drop a prompt sent to it, so that guest runs at the floor until its next start.
Either way the runner records beside the machine that it cannot grow, under its own VM runtime, and boots it whole from then on; a runner release with another runtime tries the grow again.
smolvm's own resize is not used: it refuses a VMM without a cgroup of its own, which no VMM in a runner pod has, and admits growth against the host's free memory rather than by use.
Free-page reporting returns the added RAM's freed pages as it does the boot RAM's.

**Guest RAM and the guest kernel are mapped for huge pages.** KVM maps guest memory in 2 MiB pages only where the host address agrees with the guest address modulo 2 MiB, and an ordinary allocation almost never does.
Under nested virtualization each guest page the guest touches first then costs a fault through both hypervisors, about 20 µs for each 4 KiB.
On a Linux runner libkrun therefore places the boot RAM, the RAM a grow adds, and a copy of the guest kernel at host addresses that agree, so a host whose transparent huge pages are `always` backs them with huge pages.
The platform does not advise that RAM with `MADV_HUGEPAGE`, as upstream libkrun does not.
On the nested dev hosts (huge pages `always`, defrag `madvise`) the advice made no difference under real conditions; it helped only when page cache had nearly exhausted host memory, a state the nodes did not reach.
On bare metal an advised fault compacts host memory synchronously and was slower, which is why upstream leaves it out.
The added RAM is anonymous memory rather than libkrun's shared-memory file, which a host whose shared-memory huge pages are off (as on RHEL by default) backs with 4 KiB pages whatever its placement; only a branchable machine, which no runner starts, keeps the file.
The guest writes the page descriptors of added RAM into that RAM itself, so huge pages also make the grow about five times faster.

**The runner measures every running machine.** Its health prober reads the resident memory of each running machine's VMM at every probe and reports it in the machine's status.
The owner sees the same figures on the home dashboard: what is committed against the pool, and each agent's share of it ([budgets](budgets.md)).
The figure is kept out of what moves the status version, so it never wakes a waiting status read on its own.
A probe that cannot read the figure, or the machine's state, keeps the last figure it read, so a failed read never counts a guest as holding nothing, and admission counts such a machine at least at its warm-up floor while that figure stands, since a figure from before the failure is not what it holds now.

**The runner watches its own memory.** Every second it reads its working set off its cgroup — what the cgroup charges less the file cache the kernel can drop, the figure the kubelet reads — against its limit.
At 95% the runner is under pressure, and it stays so until the working set falls below 90%.
A pressure read waits on a version of its own, which moves when pressure starts or ends and every ten seconds while it lasts; before it moves, the runner measures every running machine again, so the statuses read on it are current.
A runner with no cgroup v2 to read — the host runner, a cgroup v1 node — never reports pressure.

**A running machine is counted at its use plus headroom.** That is its measured use plus a per-machine headroom (`virtualization.runner.headroomMiB`), never more than its size.
A runner measures every machine it finds running as it starts, before it admits anything, so after a hand-off or a restart the machines it took over count at what they hold rather than as machines not yet measured.
A running machine whose stored spec cannot be read — a corrupt file, or one a runner of another shape wrote — counts at that measurement plus headroom too, and at everything the runner hands out for machines when it was never measured: a spec nobody can read is not a machine holding nothing, and admitting the next machine beside it as if it held nothing is how the runner goes over its limit.
**A machine warming up counts at least at the warm-up floor** (`virtualization.runner.bootMiB`), or its size when that is smaller: a machine not yet measured, every machine an action is bringing up, and a running machine for two minutes after its boot began, whatever it was measured at.
The harness starts only once the guest answers, about a second after the boot, and grows to 2 to 3 GiB within the next minute, so a machine measured right after its boot holds little of what it will hold; the warm-up is a fixed time rather than one that ends at the guest's answer, since the answer is when the growth begins.
The runner reports a machine warming up in its status, and the controller counts it the same way.
Counting a boot at half the pool would let only two machines boot at once; at the floor, as many machines warm up together as the pool holds floors, and a runner roll or many wakes at once start the rest in waves as the first ones warm up, each refused start retried within 30 seconds ([budgets](budgets.md)).
Admission, the committed-memory metric and the runner's memory request all count the same way; only the request rounds, as below, and only the request keeps a figure the probe could not refresh below the warm-up floor: the status carries the last figure the runner read, so the request built from it can sit below admission for that machine.
A machine the runner refused counts toward nothing until a retry gets it running, whether it was refused for room, which parks the Agent, or for storage, a home that is full, an image it cannot fetch, a seed that is missing or a boot that failed, which all leave the Agent awake with no machine: it holds nothing meanwhile.
A machine that boots, restarts or stops holds its memory meanwhile, and the runner keeps a refusal's reason until the action it admitted completes, so the reason alone says nothing: what counts is a refusal with nothing running or in flight.
So the CPU limit and the pass that judges pressure count it at nothing.
Were it counted beside the machines the runner did admit, it would push the owner past the 90% threshold, and the pass would hibernate those to make room for the one the runner refused.
Only the refused start's own reclaim and the figures its refusal quotes still count it, since the room it lacks is what its count is for.
The memory a refusal quotes as in use is what its owner's machines hold, the same that Home shows.
The controller records the runner's answer where it gives it, under the owner's lock, so the count is current before the Agent's status carries it, and the pass keeps each status it reads under that same lock, so a reading taken before a refusal cannot outlast it.

**Admission is against use, so an owner may run more machines than their sizes add up to.** A machine starts while every machine's count, the start's own count and the runner's reserve fit under the runner's limit; otherwise the runner refuses it with the shortfall named, and the Agent is parked as [budgets](budgets.md) describes.
A machine whose own state cannot be read counts as a running one only when something says a VMM may hold it: this runner measured it, or a VMM process holds its directory.
Counted, it counts as a running machine does: at its measured use plus headroom, never more than its size while the spec reads, at least its warm-up floor until it is measured or while the figure it holds is one no probe could refresh, and at the whole handout when its spec cannot be read and it was never measured.
A record that no longer decodes is not that evidence: a stopped or hibernated machine's record fails the same way, and counting it would hold its room against every start its owner makes — an unknown VMM is not an absent one, and an unreadable record is not a running one.
That limit is the one the kernel holds the runner to, read off its cgroup's `memory.max` at every admission and pressure sample, so a limit resized in place counts at once; a runner with no cgroup v2 limit to read uses the limit it was started with.

**The scheduler reserves what the machines use.** The controller keeps the runner pod's memory request, resized in place, at the machines' counts plus the reserve, in 512 MiB steps so a guest that drifts at every probe does not resize the pod, within the install's request and the limit.
The request rises a step as soon as the counts need it, but falls only once they are a quarter step below the step under it, so use that sits on a step boundary does not resize the pod at every pass; admission and the metric stay exact.
A cluster without in-place resize keeps the install's request.
A node that defers or refuses the resize leaves the pod at the request it has; each of the owner's vm Agents then carries a `RunnerCapacity` condition saying which, with the kubelet's account, and a Warning Event, while readiness is left alone, since the machines run at what the pod has ([observability](observability.md#platform-service-export)).

**Room is freed from the owner's own idle agents.** A start the runner refused, and an owner whose counted memory passes 90% of the runner's limit, hibernate that owner's vm agents under the rules a blocked start reclaims by in [budgets](budgets.md): unattended, hibernation enabled, idle past the floor, saying it is idle when asked (one that does not answer may be mid-turn with its guest saturated, so it is spared), longest-idle first, and only when the agents chosen cover the whole shortfall; under pressure the target is 80%.
A machine the runner refused frees nothing, so the reclaim passes it over for one that holds memory.
An agent whose cold boot is still in progress is not hibernated for a refused start or past the 90% threshold, since its last activity is the wake that began a boot which can outlast the idle floor; the runner's pressure signal may still take it, as the OOM kill would stop it too.
A refused start is retried once their machines have stopped.
No other owner's agent is touched, and an agent hibernated this way says it was put to sleep automatically to free memory ([budgets](budgets.md)).
Because a running machine's use reaches the controller only when its agent reconciles, the controller also asks each owner's runner about its running machines every 30 seconds, which is what pressure is judged from and what moves the request between reconciles.
That pass reconciles one of the owner's agents only when the request their counts call for differs from the runner pod's, so a count held within its step wakes nothing.
The runner's own pressure signal runs the same pass for that owner at once, without waiting for the counted threshold, since the kernel's view is the one that kills the runner.
Its need is the larger of the counted and the measured overshoot of the 80% target, and it may hibernate fewer agents than cover it: near an OOM kill, freeing some memory beats freeing none.
When no candidate says it is idle, this pass alone hibernates the candidates that did not answer, as a last resort, because the kill would stop them too; one that answered busy is never hibernated.
The controller holds one watch on each owner's pressure, and a pass on it hibernates nothing more for fifteen seconds after any reclaim of that owner hibernated agents, because the runner's measured working set still holds their machines until they have stopped.
The two passes never run together for one owner.
A refused start's reclaim and the pass do run side by side, so each reads its need and hibernates the agents it chose under the owner's lock, and those agents stop counting at once: the reclaim that comes next sees the room already freed and does not choose or count them again.

**Guests give back cold memory.** A guest keeps the files it read cached until something needs the memory, and the host counts that cache as the machine's.
Every minute platform-init hands the cache on the kernel's inactive list to cgroup v2 proactive reclaim, and the freed pages return to the host within seconds.
Guests swap to zram, which platform-init sets up at boot at twice the RAM the guest boots with, compressed with zstd, so the same pass also hands over the inactive anonymous memory: what the agent's processes hold but have not touched lately is kept compressed, and the pages it filled return to the host.
A guest kernel without zram has no swap, and then only file pages go.
A V8 heap is cold only between collections: Node's idle memory reducer walks the whole heap a couple of times after it stops growing, which reads every page back from zram once, and the next pass compresses it again.
Free-page reporting returns only whole 2 MiB blocks, so memory a program frees between pages the guest still uses stays counted; when the free memory in smaller blocks rises by 128 MiB, the same pass reclaims that much cold cache and slab and compacts the guest's memory, so the freed pages merge into blocks the host takes back.

**What can still go wrong.** A harness that grows past the warm-up floor while it warms up, or past its headroom between two probes after, and the seconds a hibernation takes can still take the runner over its limit, and the kernel then kills the runner with every machine of its owner.
The pressure signal makes that rarer; it cannot rule it out.
When it happens, each agent that was ready before the kill says that its owner's memory ran out, read off the runner pod's last termination, through the runner's restart and its machine's boot, until it is ready again or a more specific reason, such as a failed boot, replaces it; the owner sees one notice naming every agent that restarted, which asks them to disable agents they are not using.
An agent woken after the kill carries nothing, and nothing on the agents records the kill once they are ready.
The owner also gets one Slack direct message naming the agents that restarted, the [resource alert](budgets.md#resource-alerts) for the kill.
