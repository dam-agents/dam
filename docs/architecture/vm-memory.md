# VM memory

Last verified: 2026-10-05

An owner's machines share the memory of their [runner](vm-runner.md), and it is counted by what they use rather than by their sizes. A machine's size is the most its guest can see; the host commits only the pages the guest touches, and the guest hands freed pages back through free-page reporting, so an idle agent on a 2 GiB machine holds a few hundred MiB.

**The runner measures every running machine.** Its health prober reads the resident memory of each machine's VMM at the steady probe cadence and reports it in the machine's status. The figure is kept out of what moves the status version, so it never wakes a waiting status read on its own.

**A running machine is counted at its use plus headroom.** That is its measured use plus a per-machine headroom (`virtualization.runner.headroomMiB`), never more than its size. A machine not yet measured, and every machine an action is bringing up, counts at its full size, so a boot is never admitted into room it may need. Admission, the committed-memory metric and the runner's memory request all count the same way.

**Admission is against use, so an owner may run more machines than their sizes add up to.** A machine starts while every machine's count, the start's own size and the runner's reserve fit under the runner's limit; otherwise the runner refuses it with the shortfall named, and the Agent is parked as [budgets](budgets.md) describes.

**The scheduler reserves what the machines use.** The controller keeps the runner pod's memory request, resized in place, at the machines' counts plus the reserve, in 512 MiB steps so a guest that drifts at every probe does not resize the pod, within the install's request and the limit. A cluster without in-place resize keeps the install's request.

**Room is freed from the owner's own idle agents.** A start the runner refused, and an owner whose counted memory passes 90% of the runner's limit, hibernate that owner's vm agents under the rules a blocked start reclaims by in [budgets](budgets.md): unattended, hibernation enabled, idle past the floor, longest-idle first, and only when the agents chosen cover the whole shortfall; under pressure the target is 80%. A refused start is retried once their machines have stopped. No other owner's agent is touched. Because a running machine's use reaches the controller only when its agent reconciles, the controller also asks each owner's runner about its running machines every 30 seconds, which is what pressure is judged from and what moves the request between reconciles.

**Guests give back cold page cache.** A guest keeps the files it read cached until something needs the memory, and the host counts that cache as the machine's. Every minute platform-init hands the cache on the kernel's inactive list to cgroup v2 proactive reclaim, and the freed pages return to the host within seconds. Guests have no swap, so only file pages go.

**What can still go wrong.** Guests that grow together past their headroom between two passes can take the runner over its limit, and the kernel then kills the runner with every machine of its owner. Headroom and the pressure threshold make that rarer; they cannot rule it out.
