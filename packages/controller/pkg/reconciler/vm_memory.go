package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

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
// UNIT_BOUNDARY_DESCRIPTION: running holds nothing to remember.
func (r *AgentReconciler) noteMachineUse(name string, machine vmrunner.MachineStatus) {
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
	size := max(r.machineMemoryMiB(ctx, owner, spec), live.MemoryMiB)
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
// UNIT_BOUNDARY_DESCRIPTION: and always zero for an install with no limit.
func (r *AgentReconciler) runnerOvershootMiB(ctx context.Context, owner string, demandMiB, percent int) int {
	limit := r.runnerLimitMiB(ctx, owner)
	if limit == 0 {
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
// UNIT_BOUNDARY_DESCRIPTION: OOM kill, which takes every machine of the owner,
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
func (r *AgentReconciler) reclaimRunnerMemory(ctx context.Context, owner, self string, need func() (int, error), partial bool) (bool, error) {
	if owner == "" {
		return false, nil
	}
	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()
	needMiB, err := need()
	if err != nil || needMiB <= 0 {
		return false, err
	}
	candidates, err := r.reclaimableAgents(ctx, self, owner)
	if err != nil {
		return false, err
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].idleSince.Before(candidates[j].idleSince) })
	var chosen, silent []reclaimCandidate
	left := needMiB
	for _, c := range candidates {
		if left <= 0 {
			break
		}
		if c.vmMiB == 0 || c.booting && !partial {
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
		return false, nil
	}
	r.noteFreedUnderPressure(owner)
	return true, r.hibernateReclaimed(ctx, chosen, owner, self, why)
}

// UNIT_BOUNDARY_DESCRIPTION: a running machine's use is learned only when its
// UNIT_BOUNDARY_DESCRIPTION: agent reconciles, which a settled agent does every
// UNIT_BOUNDARY_DESCRIPTION: few minutes, while guests grow within seconds. So
// UNIT_BOUNDARY_DESCRIPTION: every pass asks each owner's runner about their
// UNIT_BOUNDARY_DESCRIPTION: running machines, hibernates idle agents of an
// UNIT_BOUNDARY_DESCRIPTION: owner under pressure, and returns one agent of each
// UNIT_BOUNDARY_DESCRIPTION: owner whose runner pod's request differs from what
// UNIT_BOUNDARY_DESCRIPTION: their counts call for, for the caller to reconcile
// UNIT_BOUNDARY_DESCRIPTION: so the request follows them.
func (r *AgentReconciler) MemoryPass(ctx context.Context) []string {
	if r.agentCache == nil || !r.config.VM.Enabled {
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
		if err != nil || vmSideOf(a) == nil || a.Labels[envoyOwnerLabel] == "" {
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
// UNIT_BOUNDARY_DESCRIPTION: The agent the pass counts from is one the
// UNIT_BOUNDARY_DESCRIPTION: runner has not refused: a parked machine holds
// UNIT_BOUNDARY_DESCRIPTION: nothing, and its floor must not hibernate the
// UNIT_BOUNDARY_DESCRIPTION: machines the runner did admit.
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
	for _, a := range agents {
		running, err := r.peerShouldRun(ctx, a.Name)
		if err != nil || !running {
			continue
		}
		status, err := runner.Status(ctx, a.Name)
		if err != nil {
			continue
		}
		r.noteMachineUse(a.Name, status)
		if first == nil && !r.parkedWithoutMachine(a) {
			first = a
		}
	}
	if first == nil {
		return "", false
	}
	demand, err := r.ownerRunnerDemand(ctx, owner, first, true)
	if err != nil {
		return "", false
	}
	_, err = r.reclaimRunnerMemory(ctx, owner, "", func() (int, error) {
		demand, err := r.ownerRunnerDemand(ctx, owner, first, true)
		if err != nil {
			return 0, err
		}
		switch {
		case pressure != nil && !r.freedUnderPressureSince(owner, time.Now().Add(-pressureReclaimCooldown)):
			limit := pressure.LimitMiB
			if pool := r.runnerLimitMiB(ctx, owner); pool > 0 {
				limit = min(limit, pool)
			}
			return max(r.runnerOvershootMiB(ctx, owner, demand.memoryMiB, memoryTargetPercent), pressure.WorkingSetMiB-limit*memoryTargetPercent/100), nil
		case pressure == nil && r.runnerOvershootMiB(ctx, owner, demand.memoryMiB, memoryPressurePercent) > 0:
			return r.runnerOvershootMiB(ctx, owner, demand.memoryMiB, memoryTargetPercent), nil
		}
		return 0, nil
	}, pressure != nil)
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

func (r *AgentReconciler) hibernateReclaimed(ctx context.Context, chosen []reclaimCandidate, owner, forName, why string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	for _, c := range chosen {
		if err := r.stampReclaimed(ctx, c.name, now); err != nil {
			return err
		}
		if c.vmMiB > 0 {
			r.vmRunning.Store(c.name, false)
		}
		if err := hibernateAgentPair(ctx, r.client, r.dynamic, r.HaltMachine, owner, r.config.Namespace, c.name); err != nil {
			return err
		}
		slog.InfoContext(ctx, why, "agent", c.name, "for", forName, "owner", owner, "idleFor", time.Since(c.idleSince).Round(time.Second))
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: a start the runner refused for memory frees the
// UNIT_BOUNDARY_DESCRIPTION: room it lacks from the owner's idle agents, and
// UNIT_BOUNDARY_DESCRIPTION: the parked retry starts it once their machines
// UNIT_BOUNDARY_DESCRIPTION: have stopped.
func (r *AgentReconciler) reclaimForRefusedStart(ctx context.Context, agent *apiv1.Agent, owner string) error {
	_, err := r.reclaimRunnerMemory(ctx, owner, agent.Name, func() (int, error) {
		demand, err := r.ownerRunnerDemand(ctx, owner, agent, true)
		return r.runnerOvershootMiB(ctx, owner, demand.memoryMiB, 100), err
	}, false)
	return err
}

// UNIT_BOUNDARY_DESCRIPTION: the refusal quotes the pool out of the same total Home shows, the runner's whole limit, and the room the start itself needs, since a start is refused for that need while the pool can still look half empty. A runner outside the cluster admits against a share of its host's memory the controller never learns, so its refusal goes without figures rather than quote the chart's limit.
func (r *AgentReconciler) vmMemoryFullMessage(ctx context.Context, agent *apiv1.Agent, owner string) string {
	const next = "It starts on its own once room frees up, since the platform puts idle agents to sleep to make room when it can, or you can disable an agent you aren't using."
	if r.config.VM.Runner.HostAddress != "" {
		return "Your VM agents' memory is full, so this agent can't start yet. " + next
	}
	pool := r.runnerLimitMiB(ctx, owner)
	limit := pool - r.config.VM.Runner.ReserveMiB
	demand, err := r.ownerRunnerDemand(ctx, owner, agent, false)
	var with runnerDemand
	if err == nil {
		with, err = r.ownerRunnerDemand(ctx, owner, agent, true)
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
