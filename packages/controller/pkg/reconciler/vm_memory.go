package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/labels"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: an owner's runner is under memory pressure once
// UNIT_BOUNDARY_DESCRIPTION: what its running machines are counted at, with
// UNIT_BOUNDARY_DESCRIPTION: its reserve, passes this share of its limit; the
// UNIT_BOUNDARY_DESCRIPTION: controller then hibernates idle agents until it
// UNIT_BOUNDARY_DESCRIPTION: is back under the target share, so one reclaim
// UNIT_BOUNDARY_DESCRIPTION: buys room for growth rather than the next pass.
const (
	memoryPressurePercent = 90
	memoryTargetPercent   = 80
)

// UNIT_BOUNDARY_DESCRIPTION: remembers the running machine as the runner
// UNIT_BOUNDARY_DESCRIPTION: last reported it: what its VMM holds, and the
// UNIT_BOUNDARY_DESCRIPTION: size it booted with, which a new size reaches
// UNIT_BOUNDARY_DESCRIPTION: only at its next start. A machine that is not
// UNIT_BOUNDARY_DESCRIPTION: running holds nothing to remember. An unknown
// UNIT_BOUNDARY_DESCRIPTION: state is not a machine that stopped, so it
// UNIT_BOUNDARY_DESCRIPTION: forgets nothing: what the runner last reported
// UNIT_BOUNDARY_DESCRIPTION: stands until it reads the machine again.
func (r *AgentReconciler) noteMachineUse(name string, machine vmrunner.MachineStatus) {
	if machine.State == vmrunner.StateUnknown {
		return
	}
	if machine.State == vmrunner.StateRunning {
		r.vmLive.Store(name, machine)
		return
	}
	r.vmLive.Delete(name)
}

func (r *AgentReconciler) liveMachine(name string) vmrunner.MachineStatus {
	live, _ := r.vmLive.Load(name)
	machine, _ := live.(vmrunner.MachineStatus)
	return machine
}

// UNIT_BOUNDARY_DESCRIPTION: what a machine that should run is counted at,
// UNIT_BOUNDARY_DESCRIPTION: the same way the runner admits it: its measured
// UNIT_BOUNDARY_DESCRIPTION: use plus headroom, never above its size, and at
// UNIT_BOUNDARY_DESCRIPTION: least the warm-up floor, or its size when that is
// UNIT_BOUNDARY_DESCRIPTION: smaller or no floor is set, until the runner has
// UNIT_BOUNDARY_DESCRIPTION: measured it and while it reports it warming up.
// UNIT_BOUNDARY_DESCRIPTION: A running machine's size is the larger of the one
// UNIT_BOUNDARY_DESCRIPTION: it booted with and the one its next start takes.
func (r *AgentReconciler) accountedMemoryMiB(ctx context.Context, owner, name string, spec *apiv1.AgentSpec) int {
	live := r.liveMachine(name)
	machineMiB, _ := r.machineMemoryMiB(ctx, owner, spec)
	size := max(machineMiB, live.MemoryMiB)
	floor := size
	if boot := r.config.VM.Runner.BootMiB; boot > 0 {
		floor = min(size, boot)
	}
	if live.UsedMiB == 0 {
		return floor
	}
	counted := min(size, live.UsedMiB+r.config.VM.Runner.HeadroomMiB)
	if live.Warming {
		return max(counted, floor)
	}
	return counted
}

// UNIT_BOUNDARY_DESCRIPTION: how much more memory the owner's machines are
// UNIT_BOUNDARY_DESCRIPTION: counted at, with the reserve, than `percent` of
// UNIT_BOUNDARY_DESCRIPTION: the runner's limit; zero or less when they fit,
// UNIT_BOUNDARY_DESCRIPTION: and always zero for an install with no limit,
// UNIT_BOUNDARY_DESCRIPTION: and for a pool that cannot be read, which says
// UNIT_BOUNDARY_DESCRIPTION: nothing about how much memory the machines may hold.
func (r *AgentReconciler) runnerOvershootMiB(ctx context.Context, owner string, demandMiB, percent int) int {
	limit, err := r.runnerLimitMiB(ctx, owner)
	if err != nil || limit == 0 {
		return 0
	}
	return demandMiB + r.config.VM.Runner.ReserveMiB - limit*percent/100
}

// UNIT_BOUNDARY_DESCRIPTION: frees `needMiB` on the owner's runner by
// UNIT_BOUNDARY_DESCRIPTION: hibernating their vm agents under the rules a
// UNIT_BOUNDARY_DESCRIPTION: blocked start reclaims by: unattended, idle past
// UNIT_BOUNDARY_DESCRIPTION: the floor, saying it is idle when asked,
// UNIT_BOUNDARY_DESCRIPTION: longest-idle first, and only when the
// UNIT_BOUNDARY_DESCRIPTION: agents chosen cover the whole need — no agent is
// UNIT_BOUNDARY_DESCRIPTION: hibernated for room that would still not suffice.
// UNIT_BOUNDARY_DESCRIPTION: A `partial` reclaim, on the runner's own pressure
// UNIT_BOUNDARY_DESCRIPTION: signal, hibernates what it can instead: near an
// UNIT_BOUNDARY_DESCRIPTION: OOM kill, which takes a machine of the owner,
// UNIT_BOUNDARY_DESCRIPTION: freeing some memory beats freeing none. When no
// UNIT_BOUNDARY_DESCRIPTION: agent says it is idle, it hibernates the agents
// UNIT_BOUNDARY_DESCRIPTION: that did not answer as a last resort, as the kill
// UNIT_BOUNDARY_DESCRIPTION: stops them too; an agent that says it is busy is
// UNIT_BOUNDARY_DESCRIPTION: never hibernated.
// UNIT_BOUNDARY_DESCRIPTION: An agent whose cold boot is still in progress
// UNIT_BOUNDARY_DESCRIPTION: is not hibernated by a reclaim that is not
// UNIT_BOUNDARY_DESCRIPTION: `partial`, which would lose the start it is
// UNIT_BOUNDARY_DESCRIPTION: waiting for: a slow boot outlasts the idle floor
// UNIT_BOUNDARY_DESCRIPTION: its wake started.
// UNIT_BOUNDARY_DESCRIPTION: The runner's pressure signal may still take it,
// UNIT_BOUNDARY_DESCRIPTION: as the OOM kill would stop it too.
// UNIT_BOUNDARY_DESCRIPTION: Each frees what it is counted at, so a guest
// UNIT_BOUNDARY_DESCRIPTION: holding little frees little.
// UNIT_BOUNDARY_DESCRIPTION: A refused start and the memory pass reclaim for
// UNIT_BOUNDARY_DESCRIPTION: one owner from different goroutines, so the need
// UNIT_BOUNDARY_DESCRIPTION: is read, and the agents chosen are hibernated and
// UNIT_BOUNDARY_DESCRIPTION: stop counting, under the owner's lock: the next
// UNIT_BOUNDARY_DESCRIPTION: reclaim sees the room already freed instead of
// UNIT_BOUNDARY_DESCRIPTION: choosing and counting the same agents again.
func (r *AgentReconciler) reclaimRunnerMemory(ctx context.Context, owner, self string, need func() (int, error), partial, forRefusedStart bool) (int, error) {
	if owner == "" {
		return 0, nil
	}
	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()
	needMiB, err := need()
	if err != nil || needMiB <= 0 {
		return 0, err
	}
	candidates, err := r.reclaimableAgents(ctx, self, owner, forRefusedStart)
	if err != nil {
		return 0, err
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].idleSince.Before(candidates[j].idleSince) })
	var chosen, silent []reclaimCandidate
	left := needMiB
	for _, c := range candidates {
		if left <= 0 {
			break
		}
		if c.vmMiB == 0 || c.holdsNothing || c.booting && !partial {
			continue
		}
		idle, answered := r.podStatus(ctx, c.name)
		if !idle {
			if !answered {
				silent = append(silent, c)
			}
			continue
		}
		left -= c.vmMiB
		chosen = append(chosen, c)
	}
	why := "reclaimed idle agent to free memory on its owner's VM runner"
	if partial && len(chosen) == 0 {
		why = "reclaimed an agent that did not answer, as no agent said it is idle, to stop an OOM kill on its owner's VM runner"
		for _, c := range silent {
			if left <= 0 {
				break
			}
			left -= c.vmMiB
			chosen = append(chosen, c)
		}
	}
	if len(chosen) == 0 || left > 0 && !partial {
		return 0, nil
	}
	r.noteFreedUnderPressure(owner)
	return r.hibernateReclaimed(ctx, chosen, owner, self, why)
}

// UNIT_BOUNDARY_DESCRIPTION: how long after its runner pod started an owner's
// UNIT_BOUNDARY_DESCRIPTION: machines are still coming back. A restart, a roll or a
// UNIT_BOUNDARY_DESCRIPTION: drain boots them again, and the runner counts each boot
// UNIT_BOUNDARY_DESCRIPTION: at its warm-up floor for two minutes until it has warmed,
// UNIT_BOUNDARY_DESCRIPTION: so the pool reads full until they have all settled.
// UNIT_BOUNDARY_DESCRIPTION: KNOWN CEILING: the pod's clock knows only that the
// UNIT_BOUNDARY_DESCRIPTION: runner restarted, never which machines are warming, so it
// UNIT_BOUNDARY_DESCRIPTION: misses a single guest restarted by the runner's own health
// UNIT_BOUNDARY_DESCRIPTION: prober, and a wave that outlasts the window; the upgrade
// UNIT_BOUNDARY_DESCRIPTION: path is the runner-reported warm-up the history of this
// UNIT_BOUNDARY_DESCRIPTION: issue carries.
const runnerWarmUpWindow = 10 * time.Minute

// UNIT_BOUNDARY_DESCRIPTION: whether the owner's runner pod started within
// UNIT_BOUNDARY_DESCRIPTION: runnerWarmUpWindow, from the times Kubernetes keeps on
// UNIT_BOUNDARY_DESCRIPTION: the pod itself: the newest of the pod's own start and its
// UNIT_BOUNDARY_DESCRIPTION: containers' starts, since a runner whose container restarted
// UNIT_BOUNDARY_DESCRIPTION: is one whose machines came back with it. The figure is the
// UNIT_BOUNDARY_DESCRIPTION: pod's, so a controller restarted mid-wave reads the same one
// UNIT_BOUNDARY_DESCRIPTION: the controller before it read, where nothing in a
// UNIT_BOUNDARY_DESCRIPTION: controller's own memory would survive it. A pod the cluster
// UNIT_BOUNDARY_DESCRIPTION: does not hold, or one that reports no time at all, is no
// UNIT_BOUNDARY_DESCRIPTION: evidence of a wave, and the pool is the owner's to free.
func (r *AgentReconciler) runnerWarmingUp(ctx context.Context, owner string) bool {
	pods, err := r.runnerPods(ctx, owner, true)
	if err != nil {
		return false
	}
	var started time.Time
	later := func(at time.Time) {
		if at.After(started) {
			started = at
		}
	}
	for _, pod := range pods {
		if pod.Status.StartTime != nil {
			later(pod.Status.StartTime.Time)
		}
		for _, container := range pod.Status.ContainerStatuses {
			if running := container.State.Running; running != nil {
				later(running.StartedAt.Time)
			}
		}
	}
	return !started.IsZero() && r.clockNow().Sub(started) < runnerWarmUpWindow
}

// UNIT_BOUNDARY_DESCRIPTION: a running machine's use is learned only when its
// UNIT_BOUNDARY_DESCRIPTION: agent reconciles, which a settled agent does every
// UNIT_BOUNDARY_DESCRIPTION: few minutes, while guests grow within seconds. So
// UNIT_BOUNDARY_DESCRIPTION: every pass asks each owner's runner, in one read,
// UNIT_BOUNDARY_DESCRIPTION: about their running machines, hibernates idle
// UNIT_BOUNDARY_DESCRIPTION: agents of an owner under pressure, and returns one
// UNIT_BOUNDARY_DESCRIPTION: agent of each owner whose runner pod's request
// UNIT_BOUNDARY_DESCRIPTION: differs from what their counts call for, for the
// UNIT_BOUNDARY_DESCRIPTION: caller to reconcile so the request follows them.
func (r *AgentReconciler) MemoryPass(ctx context.Context) []string {
	if r.agentCache == nil {
		return nil
	}
	items, err := r.agentCache.ByNamespace(r.config.Namespace).List(labels.Everything())
	if err != nil {
		slog.WarnContext(ctx, "vm memory: listing agents", "error", err)
		return nil
	}
	byOwner := map[string][]*apiv1.Agent{}
	for _, obj := range items {
		a, err := FromCacheObject[apiv1.Agent](obj)
		if err != nil || a.Labels[envoyOwnerLabel] == "" {
			continue
		}
		byOwner[a.Labels[envoyOwnerLabel]] = append(byOwner[a.Labels[envoyOwnerLabel]], a)
	}
	var moved []string
	for owner, agents := range byOwner {
		if name, ok := r.ownerMemoryPass(ctx, owner, agents, nil); ok {
			moved = append(moved, name)
		}
	}
	return moved
}

// UNIT_BOUNDARY_DESCRIPTION: one owner's pass, from the half-minute tick or,
// UNIT_BOUNDARY_DESCRIPTION: with `pressure`, from their runner's signal. The
// UNIT_BOUNDARY_DESCRIPTION: two never run together for one owner, since both
// UNIT_BOUNDARY_DESCRIPTION: would pick the same idle agents for the same need;
// UNIT_BOUNDARY_DESCRIPTION: a refused start's reclaim beside them is kept
// UNIT_BOUNDARY_DESCRIPTION: apart by the owner's lock in reclaimRunnerMemory.
// UNIT_BOUNDARY_DESCRIPTION: Under the signal the counted threshold is not
// UNIT_BOUNDARY_DESCRIPTION: waited for: the kernel's view is what kills the
// UNIT_BOUNDARY_DESCRIPTION: runner, so the need is the larger of the counted
// UNIT_BOUNDARY_DESCRIPTION: and the measured overshoot of the target.
// UNIT_BOUNDARY_DESCRIPTION: The agent the pass counts and reconciles from is
// UNIT_BOUNDARY_DESCRIPTION: one the runner has not refused: the pass asks for
// UNIT_BOUNDARY_DESCRIPTION: that agent's reconcile to size the pod, and a
// UNIT_BOUNDARY_DESCRIPTION: reconcile counts its own pending start, so a
// UNIT_BOUNDARY_DESCRIPTION: refused anchor would ask for a resize to a machine
// UNIT_BOUNDARY_DESCRIPTION: the runner will not start.
func (r *AgentReconciler) ownerMemoryPass(ctx context.Context, owner string, agents []*apiv1.Agent, pressure *vmrunner.RunnerPressure) (string, bool) {
	if !r.beginMemoryPass(owner) {
		return "", false
	}
	defer r.endMemoryPass(owner)
	runner, err := r.runnerFor(ctx, owner)
	if err != nil {
		return "", false
	}
	r.refreshVMPool(ctx, owner)
	var first *apiv1.Agent
	var up []string
	lock := r.ownerLock(owner)
	for _, a := range agents {
		running, err := r.peerShouldRun(ctx, a.Name)
		if err != nil || !running {
			continue
		}
		up = append(up, a.Name)
		if first == nil && !r.refusedWithoutMachine(a) {
			first = a
		}
	}
	if first == nil {
		return "", false
	}
	// UNIT_BOUNDARY_DESCRIPTION: one usage read answers for every machine of the owner, where a status read each was a round trip per running agent every half minute. A machine the read does not list is one the runner does not hold, and its last measurement is forgotten as a status read of it would forget it. A runner that does not mark its machines with the memory figures is older than them — a runner release the controller has not rolled yet — and is asked about each machine in turn, as it was before, since its zeroes would count a warming machine at its measured use and forget the size a machine still runs at. A failed read leaves the last measurements in place, as a failed status read of one machine did, and does not end the pass: a measured machine counts at its last use and one never measured at its warm-up floor, or its size when that is smaller, as it does on any pass, and under the runner's pressure signal the need comes from the kernel's working set, which needs no measurement at all. Every sample is kept under the owner's lock, the one a reconcile records the runner's answer under, so the two cannot cross: a sample read before a refusal is kept before it, and the answer that follows drops it.
	lock.Lock()
	usage, err := runner.Usage(ctx)
	switch {
	case err != nil:
		slog.WarnContext(ctx, "vm memory: reading the runner's usage", "owner", owner, "error", err)
	case usage.MachineFigures:
		held := make(map[string]vmrunner.MachineUsage, len(usage.Machines))
		for _, m := range usage.Machines {
			held[m.ID] = m
		}
		for _, name := range up {
			m := held[name]
			r.noteMachineUse(name, vmrunner.MachineStatus{State: m.State, CPUs: m.CPUs, MemoryMiB: m.MemoryMiB, UsedMiB: m.UsedMiB, Warming: m.Warming})
		}
	default:
		for _, name := range up {
			status, err := runner.Status(ctx, name)
			if err != nil {
				continue
			}
			r.noteMachineUse(name, status)
		}
	}
	lock.Unlock()
	demand, err := r.heldRunnerDemand(ctx, owner, first, true)
	if err != nil {
		return "", false
	}
	_, err = r.reclaimRunnerMemory(ctx, owner, "", func() (int, error) {
		demand, err := r.heldRunnerDemand(ctx, owner, first, true)
		if err != nil {
			return 0, err
		}
		switch {
		case pressure != nil && !r.freedUnderPressureSince(owner, time.Now().Add(-pressureReclaimCooldown)):
			limit := pressure.LimitMiB
			if pool, err := r.runnerLimitMiB(ctx, owner); err == nil && pool > 0 {
				limit = min(limit, pool)
			}
			return max(r.runnerOvershootMiB(ctx, owner, demand.memoryMiB, memoryTargetPercent), pressure.WorkingSetMiB-limit*memoryTargetPercent/100), nil
		case pressure == nil && r.runnerOvershootMiB(ctx, owner, demand.memoryMiB, memoryPressurePercent) > 0:
			// UNIT_BOUNDARY_DESCRIPTION: the counted total is the boot floors of a wave while one is still coming back, and falls to what the machines measure once they have warmed, so the pass hibernates nobody for that share, as a refused start does not take its room from an idle agent either. The pressure pass below keeps reclaiming, since the kernel's working set is what kills a machine, and a machine near the limit is not a wave.
			if r.runnerWarmingUp(ctx, owner) {
				return 0, nil
			}
			return r.runnerOvershootMiB(ctx, owner, demand.memoryMiB, memoryTargetPercent), nil
		}
		return 0, nil
	}, pressure != nil, false)
	if err != nil {
		slog.WarnContext(ctx, "vm memory: reclaiming under pressure", "owner", owner, "error", err)
	}
	if !r.runnerPodMoves(ctx, owner, demand) {
		return "", false
	}
	return first.Name, true
}

// UNIT_BOUNDARY_DESCRIPTION: guests move by a few MiB at every probe, and each
// UNIT_BOUNDARY_DESCRIPTION: new request is a resize the node acts on, so the
// UNIT_BOUNDARY_DESCRIPTION: request moves in whole steps.
const memoryRequestStepMiB = 512

func roundedMiB(mib int) int {
	return (mib + memoryRequestStepMiB - 1) / memoryRequestStepMiB * memoryRequestStepMiB
}

// UNIT_BOUNDARY_DESCRIPTION: puts the agents a reclaim chose to sleep, and answers how many of them it did. The idle probe they were chosen on takes time, and the api-server writes pins and activity without taking the owner's lock, so each victim is read again just before its stamp: one that gained a pin, fresh activity, a stop request or a migration since selection is left running, and so is one whose version moved between that read and the stamp. The other victims are still reclaimed, since the room the start needs is freed by whichever of them holds it. The count is what the caller counts as room made even when a later one fails: a failure stops the loop, so the agents it did hibernate are the side effects the retry finds and the ones it did not are the work a later pass repeats. A victim whose stop was accepted and whose gateway is down counts even when the status write that publishes it failed, because that room is freed and the next pass cannot choose it again; one it skipped counts nothing, since it still holds its room.
func (r *AgentReconciler) hibernateReclaimed(ctx context.Context, chosen []reclaimCandidate, owner, forName, why string) (int, error) {
	now := r.clockNow().UTC()
	stamp := now.Format(time.RFC3339Nano)
	hibernated := 0
	for _, c := range chosen {
		live, err := r.backend.Get(ctx, c.name)
		if err != nil {
			return hibernated, fmt.Errorf("re-reading reclaimed agent %s: %w", c.name, err)
		}
		peer, err := FromCacheObject[apiv1.Agent](live)
		if err != nil {
			return hibernated, err
		}
		if _, ok := reclaimEligible(peer, effectiveIdleTimeout(peer.Spec.HibernationTimeout, r.config.AgentBase), now, r.reclaimFloor(peer, now, c.forRefusedStart)); !ok {
			slog.InfoContext(ctx, "left an agent running: it stopped being idle while its reclaim was being decided", "agent", c.name, "for", forName, "owner", owner)
			continue
		}
		if err := r.stampAnnotation(ctx, c.name, annReclaimedAt, stamp, live.GetResourceVersion()); err != nil {
			if apierrors.IsConflict(err) {
				slog.InfoContext(ctx, "left an agent running: it changed while its reclaim was being decided", "agent", c.name, "for", forName, "owner", owner)
				continue
			}
			return hibernated, err
		}
		if c.vmMiB > 0 {
			r.vmRunning.Store(c.name, false)
		}
		down, err := hibernateAgentPair(ctx, r.client, r.backend, r.HaltMachine, owner, r.config.Namespace, c.name)
		if down {
			hibernated++
		}
		if err != nil {
			return hibernated, err
		}
		slog.InfoContext(ctx, why, "agent", c.name, "for", forName, "owner", owner, "idleFor", time.Since(c.idleSince).Round(time.Second))
	}
	return hibernated, nil
}

// UNIT_BOUNDARY_DESCRIPTION: what the owner reads while a start waits for the node: it is not their memory that is gone, so the message says what the platform is doing about it rather than quote a pool that has room. Where the node has deferred or refused the resize the controller frees that room from their idle agents itself, and the sentence stays true: the machine starts once the node grants what it holds.
const vmAwaitingAllocationMessage = "Your VM agent is waiting for the node to grant its runner the memory this start needs. It starts on its own as soon as the node does."

// UNIT_BOUNDARY_DESCRIPTION: what the owner reads while a start waits out the
// UNIT_BOUNDARY_DESCRIPTION: machines their runner is bringing back after it
// UNIT_BOUNDARY_DESCRIPTION: restarted: the pool is not short of their memory, it is
// UNIT_BOUNDARY_DESCRIPTION: holding the warm-up floors of machines that are still
// UNIT_BOUNDARY_DESCRIPTION: settling, so the sentence says what the platform is
// UNIT_BOUNDARY_DESCRIPTION: waiting for rather than quote a pool that will have room.
// UNIT_BOUNDARY_DESCRIPTION: It names no time, since this is a bound on how long the
// UNIT_BOUNDARY_DESCRIPTION: platform waits rather than a promise of when the start runs.
const vmAwaitingWarmUpMessage = "Your VM agents are still starting up after their runner restarted, so this one waits for them to settle instead of putting one of them to sleep. It starts on its own once room frees up."

// UNIT_BOUNDARY_DESCRIPTION: what the owner reads while a start refused for room is
// UNIT_BOUNDARY_DESCRIPTION: waited for rather than refused: the platform has already
// UNIT_BOUNDARY_DESCRIPTION: put one of their idle agents to sleep for it, and that
// UNIT_BOUNDARY_DESCRIPTION: machine's memory frees as it stops. Nothing is the
// UNIT_BOUNDARY_DESCRIPTION: owner's to do, so the sentence names what the platform
// UNIT_BOUNDARY_DESCRIPTION: is doing, and the wait ends as a refusal with
// UNIT_BOUNDARY_DESCRIPTION: vmMemoryFullMessage once nothing has freed room for it
// UNIT_BOUNDARY_DESCRIPTION: inside memoryReclaimWait.
const vmAwaitingMemoryMessage = "Your VM agents' memory is full, so an idle agent of yours is being put to sleep to make room. This one starts on its own in a moment."

// UNIT_BOUNDARY_DESCRIPTION: a start the runner refused for memory frees the
// UNIT_BOUNDARY_DESCRIPTION: room it lacks from the owner's idle agents, and
// UNIT_BOUNDARY_DESCRIPTION: the parked retry starts it once their machines
// UNIT_BOUNDARY_DESCRIPTION: have stopped. `boundMiB` is the room the start is
// UNIT_BOUNDARY_DESCRIPTION: measured against: the owner's pool for a start the
// UNIT_BOUNDARY_DESCRIPTION: pool refused, and what the node holds for the
// UNIT_BOUNDARY_DESCRIPTION: runner for one the node has not granted, where the
// UNIT_BOUNDARY_DESCRIPTION: pool has room and its figure would free nothing.
// UNIT_BOUNDARY_DESCRIPTION: It answers how many agents it put to sleep, which is what
// UNIT_BOUNDARY_DESCRIPTION: tells the caller the start is waiting for room it has
// UNIT_BOUNDARY_DESCRIPTION: already freed rather than refused for room nothing gave,
// UNIT_BOUNDARY_DESCRIPTION: and counts them past a later agent's failure: that agent's
// UNIT_BOUNDARY_DESCRIPTION: Hibernate did not happen, the ones before it did.
func (r *AgentReconciler) reclaimForRefusedStart(ctx context.Context, agent *apiv1.Agent, owner string, boundMiB func() (int, error)) (int, error) {
	return r.reclaimRunnerMemory(ctx, owner, agent.Name, func() (int, error) {
		bound, err := boundMiB()
		if err != nil || bound <= 0 {
			return 0, err
		}
		// UNIT_BOUNDARY_DESCRIPTION: the room to free is the one the runner holds or is about to hold, which leaves the other starts waiting for the node out of it: a waiting start holds nothing yet, and counting it here would ask for room no idle agent can give, so neither waiter is ever admitted. The request the resize carries keeps counting them; only this reclaim total does not. The start being admitted is the one it is for, so it is counted on its own.
		held, err := r.heldRunnerDemand(ctx, owner, agent, false)
		if err != nil {
			return 0, err
		}
		own := r.accountedMemoryMiB(ctx, owner, agent.Name, &agent.Spec)
		return held.memoryMiB + own + r.config.VM.Runner.ReserveMiB - bound, nil
	}, false, true)
}

// UNIT_BOUNDARY_DESCRIPTION: the refusal quotes the pool out of the same total Home shows, the runner's whole limit, and the room the start itself needs, since a start is refused for that need while the pool can still look half empty. A runner outside the cluster admits against a share of its host's memory the controller never learns, so its refusal goes without figures rather than quote the chart's limit.
func (r *AgentReconciler) vmMemoryFullMessage(ctx context.Context, agent *apiv1.Agent, owner string) string {
	const next = "It starts on its own once room frees up, since the platform puts idle agents to sleep to make room when it can, or you can disable an agent you aren't using."
	if r.config.VM.Runner.HostAddress != "" {
		return "Your VM agents' memory is full, so this agent can't start yet. " + next
	}
	pool, err := r.runnerLimitMiB(ctx, owner)
	limit := pool - r.config.VM.Runner.ReserveMiB
	var demand, with runnerDemand
	if limit > 0 {
		demand, err = r.ownerRunnerDemand(ctx, owner, agent, false)
		if err == nil {
			with, err = r.ownerRunnerDemand(ctx, owner, agent, true)
		}
	}
	if err != nil {
		slog.Warn("reading the owner's VM memory for a refused start's message failed; the message goes without figures", "agent", agent.Name, "error", err)
	}
	if limit <= 0 || err != nil {
		return "Your VM agents' memory is full, so this agent can't start yet. " + next
	}
	return fmt.Sprintf("Your VM agents are using %.1f of %.1f GiB of memory, and starting this agent needs about %.1f GiB more, so it can't start yet. %s",
		float64(min(demand.memoryMiB, limit))/1024, float64(pool)/1024, float64(max(with.memoryMiB-demand.memoryMiB, 0))/1024, next)
}

// UNIT_BOUNDARY_DESCRIPTION: when a reclaim last hibernated an agent for a refused
// UNIT_BOUNDARY_DESCRIPTION: start, which is what makes that start wait instead of
// UNIT_BOUNDARY_DESCRIPTION: reading as a refusal: the machine a reclaim hibernated
// UNIT_BOUNDARY_DESCRIPTION: stops within seconds, so a start whose room was just
// UNIT_BOUNDARY_DESCRIPTION: freed starts by itself. A reclaim that frees more room
// UNIT_BOUNDARY_DESCRIPTION: moves the stamp, so a start that keeps needing room keeps
// UNIT_BOUNDARY_DESCRIPTION: waiting while the owner's idle agents still cover it.
// UNIT_BOUNDARY_DESCRIPTION: KNOWN CEILING: a start nothing freed room for inside the
// UNIT_BOUNDARY_DESCRIPTION: window is a refusal again, a bound on how long the platform
// UNIT_BOUNDARY_DESCRIPTION: waits rather than proof that no room can be freed: past it
// UNIT_BOUNDARY_DESCRIPTION: the parked tick keeps retrying, and the message says what
// UNIT_BOUNDARY_DESCRIPTION: frees the room.
// UNIT_BOUNDARY_DESCRIPTION: The deadline is stamped on the Agent rather than kept beside
// UNIT_BOUNDARY_DESCRIPTION: the reconciler: a controller restarted while a reclaimed
// UNIT_BOUNDARY_DESCRIPTION: machine still stops has no idle agent left to choose, and
// UNIT_BOUNDARY_DESCRIPTION: nothing in its memory would tell it that room was freed a
// UNIT_BOUNDARY_DESCRIPTION: second before it started, so it would read the wait as a
// UNIT_BOUNDARY_DESCRIPTION: refusal and fail a wake on memory already being handed back.
// UNIT_BOUNDARY_DESCRIPTION: The stamp is the deadline, so a restart reads how long is
// UNIT_BOUNDARY_DESCRIPTION: left rather than restarting the clock, and it stays out of
// UNIT_BOUNDARY_DESCRIPTION: the activity and hibernation stamps: a start waiting for
// UNIT_BOUNDARY_DESCRIPTION: room it freed is not a start someone asked for.
const memoryReclaimWait = time.Minute

// UNIT_BOUNDARY_DESCRIPTION: the moment a start refused for room is given before the
// UNIT_BOUNDARY_DESCRIPTION: refusal is read as the pool's, when no reclaim freed
// UNIT_BOUNDARY_DESCRIPTION: anything: the page shows the loader first and the refusal
// UNIT_BOUNDARY_DESCRIPTION: second, so a start that a machine going idle a few seconds
// UNIT_BOUNDARY_DESCRIPTION: later would have fitted is not refused in the second it takes
// UNIT_BOUNDARY_DESCRIPTION: the owner to read it. It is spent once per start, never
// UNIT_BOUNDARY_DESCRIPTION: renewed, and a reclaim inside it takes over the wait with the
// UNIT_BOUNDARY_DESCRIPTION: minute it earns.
const memoryGraceWait = 20 * time.Second

// UNIT_BOUNDARY_DESCRIPTION: a deadline whose write has not landed is still a deadline: the room it stamps was freed by a hibernation nothing can undo, so the wait is read from what is kept beside the reconciler until that write lands, and it is the deadline earned rather than a fresh minute, expiring on its own clock whether or not it ever lands.
func (r *AgentReconciler) memoryWaiting(agent *apiv1.Agent) bool {
	until := agent.Annotations[annMemoryWaitUntil]
	if kept, ok := r.memoryWaitWrites.Load(agent.Name); ok {
		until = kept.(string)
	}
	at, err := time.Parse(time.RFC3339, until)
	return err == nil && r.clockNow().Before(at)
}

// UNIT_BOUNDARY_DESCRIPTION: the retry of that same write, before this refusal is read as the pool's, so a write lost once costs another attempt rather than the start's wake. What it tried to write is kept until the wait itself ends, because the Agent the next reconcile reads may still be the one cached before the write landed.
func (r *AgentReconciler) retryMemoryWait(ctx context.Context, name string) {
	if until, ok := r.memoryWaitWrites.Load(name); ok {
		_ = r.stampAnnotation(ctx, name, annMemoryWaitUntil, until.(string), "")
	}
}

func (r *AgentReconciler) noteMemoryWait(ctx context.Context, name string) error {
	until := r.clockNow().Add(memoryReclaimWait).UTC().Format(time.RFC3339)
	err := r.stampAnnotation(ctx, name, annMemoryWaitUntil, until, "")
	if err != nil {
		r.memoryWaitWrites.Store(name, until)
	}
	return err
}

func (r *AgentReconciler) clearMemoryWait(ctx context.Context, agent *apiv1.Agent) error {
	r.memoryWaitWrites.Delete(agent.Name)
	if agent.Annotations[annMemoryWaitUntil] == "" {
		return nil
	}
	return r.stampAnnotation(ctx, agent.Name, annMemoryWaitUntil, "", "")
}

func (r *AgentReconciler) beginMemoryPass(owner string) bool {
	r.memoryPassMu.Lock()
	defer r.memoryPassMu.Unlock()
	if r.memoryPassing[owner] {
		return false
	}
	if r.memoryPassing == nil {
		r.memoryPassing = map[string]bool{}
	}
	r.memoryPassing[owner] = true
	return true
}

func (r *AgentReconciler) endMemoryPass(owner string) {
	r.memoryPassMu.Lock()
	defer r.memoryPassMu.Unlock()
	delete(r.memoryPassing, owner)
}

func (r *AgentReconciler) noteFreedUnderPressure(owner string) {
	r.memoryPassMu.Lock()
	defer r.memoryPassMu.Unlock()
	if r.pressureFreed == nil {
		r.pressureFreed = map[string]time.Time{}
	}
	r.pressureFreed[owner] = time.Now()
}

func (r *AgentReconciler) freedUnderPressureSince(owner string, since time.Time) bool {
	r.memoryPassMu.Lock()
	defer r.memoryPassMu.Unlock()
	return r.pressureFreed[owner].After(since)
}
