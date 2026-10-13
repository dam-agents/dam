# VM memory

Last verified: 2026-10-13

An owner's machines share the memory of their [runner](vm-runner.md), and it is counted by what they use rather than by their sizes.
That memory is the owner's whole pool for vm agents, which have no size of their own and stand outside the [budget](budgets.md).

**Every machine may grow to half the pool.** A machine's size is half of what its runner hands out — the runner's memory limit less its reserve — whatever its Agent's spec names, so one agent can use most of the pool while a runaway guest meets its own OOM killer before it takes the runner, and every sibling, over the limit.
Every machine gets the install's vCPUs (`virtualization.runner.machineCPUs`); they are threads of the runner, so an idle machine costs nothing.
The controller keeps the runner pod's CPU limit, resized in place, at the vCPUs of the machines that should be running plus one machine's worth for the runner itself and the VMMs' own threads, never above a CPU limit the install sets.
Unless the install caps it lower, a guest is never throttled below its vCPUs, and one runaway VMM cannot take the whole node.
A cluster without in-place resize sets no CPU limit.
The [host runner](vm-host-runner.md) admits against a share of the Mac's memory that the controller never learns, not against the chart's pod limit, so there the Agent's spec still sets its machine's memory; its vCPUs still come from the install.
A new size reaches a running machine at its next start, not by rebooting it ([vm-runner](vm-runner.md)); until then the controller counts it at the larger of the two sizes, in memory and in vCPUs.
A machine's size is the most its guest can see; the host commits only the pages the guest touches, and the guest hands freed pages back through free-page reporting, so an idle agent on a 2 GiB machine holds a few hundred MiB.

**A machine boots small and grows.** A guest's kernel writes a page descriptor for every page of its RAM before it runs anything, and under nested virtualization that costs 65 to 85 ms per GiB: most of a second for a 12 GiB machine.
So the runner boots each machine with the boot estimate below (`virtualization.runner.bootMiB`), or its size when that is smaller, and grows it to its size as soon as the start returns, through the virtio-mem area smolvm gives every guest.
The guest kernel leaves added RAM offline unless told otherwise, and its virtio-mem driver adds no more once 1 GiB of it waits offline, so the runner first has the guest kernel online each block as it adds it; the VMM then maps the added RAM, and the start ends once the guest has plugged it all and the guest agent confirms it is online.
Every boot does this again, since each boots from the estimate.
Readiness does not wait for the grow, which runs while the workload starts, because waiting would put the same page work back on the path; a guest that allocates past the estimate before the grow ends meets its own OOM killer.
A machine that cannot grow is stopped and booted again whole within the same start, so no running machine stays small.
smolvm's own resize is not used: it refuses a VMM without a cgroup of its own, which no VMM in a runner pod has, and admits growth against the host's free memory rather than by use.
Free-page reporting returns the added RAM's freed pages as it does the boot RAM's.

**Guest RAM and the guest kernel are mapped for huge pages.** KVM maps guest memory in 2 MiB pages only where the host address agrees with the guest address modulo 2 MiB, and an ordinary allocation almost never does.
Under nested virtualization each guest page the guest touches first then costs a fault through both hypervisors, about 20 µs for each 4 KiB.
On a Linux runner the platform's libkrun patch therefore places the boot RAM, the RAM a grow adds, and a copy of the guest kernel at host addresses that agree, and asks the host for transparent huge pages there.
The request matters on a nested host whose huge-page defrag is `madvise`: a fallback to 4 KiB pages costs about 10 ms per 2 MiB, compaction about 2.
The added RAM is anonymous memory rather than libkrun's shared-memory file, which a host whose shared-memory huge pages are off (as on RHEL by default) backs with 4 KiB pages whatever its placement; only a branchable machine, which no runner starts, keeps the file.
The guest writes the page descriptors of added RAM into that RAM itself, so huge pages also make the grow about five times faster.

**The runner measures every running machine.** Its health prober reads the resident memory of each running machine's VMM at every probe and reports it in the machine's status.
The figure is kept out of what moves the status version, so it never wakes a waiting status read on its own.

**A running machine is counted at its use plus headroom.** That is its measured use plus a per-machine headroom (`virtualization.runner.headroomMiB`), never more than its size.
A machine not yet measured, and every machine an action is bringing up, counts at a boot estimate (`virtualization.runner.bootMiB`), or its size when that is smaller, until the runner first measures it.
That is about 100 ms after its start returns, before the agent's harness has started; only a guest whose harness answered during the start waits for the steady probe, about ten seconds on.
So from then on a machine counts at little more than its booted guest until later probes see the harness grow.
Counting a boot at half the pool would let only two machines boot at once, so a runner roll or a few wakes together would refuse the rest; the cost is that machines whose harnesses start together are under-counted until the probes catch up.
Admission, the committed-memory metric and the runner's memory request all count the same way; only the request rounds, as below.

**Admission is against use, so an owner may run more machines than their sizes add up to.** A machine starts while every machine's count, the start's own count and the runner's reserve fit under the runner's limit; otherwise the runner refuses it with the shortfall named, and the Agent is parked as [budgets](budgets.md) describes.

**The scheduler reserves what the machines use.** The controller keeps the runner pod's memory request, resized in place, at the machines' counts plus the reserve, in 512 MiB steps so a guest that drifts at every probe does not resize the pod, within the install's request and the limit.
The request rises a step as soon as the counts need it, but falls only once they are a quarter step below the step under it, so use that sits on a step boundary does not resize the pod at every pass; admission and the metric stay exact.
A cluster without in-place resize keeps the install's request.

**Room is freed from the owner's own idle agents.** A start the runner refused, and an owner whose counted memory passes 90% of the runner's limit, hibernate that owner's vm agents under the rules a blocked start reclaims by in [budgets](budgets.md): unattended, hibernation enabled, idle past the floor, longest-idle first, and only when the agents chosen cover the whole shortfall; under pressure the target is 80%.
A refused start is retried once their machines have stopped.
No other owner's agent is touched.
Because a running machine's use reaches the controller only when its agent reconciles, the controller also asks each owner's runner about its running machines every 30 seconds, which is what pressure is judged from and what moves the request between reconciles.
That pass reconciles one of the owner's agents only when the request their counts call for differs from the runner pod's, so a count held within its step wakes nothing.

**Guests give back cold page cache.** A guest keeps the files it read cached until something needs the memory, and the host counts that cache as the machine's.
Every minute platform-init hands the cache on the kernel's inactive list to cgroup v2 proactive reclaim, and the freed pages return to the host within seconds.
Guests have no swap, so only file pages go.

**What can still go wrong.** Guests that grow together past their headroom between two passes can take the runner over its limit, and the kernel then kills the runner with every machine of its owner.
Headroom and the pressure threshold make that rarer; they cannot rule it out.
