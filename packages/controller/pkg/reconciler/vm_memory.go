package reconciler

import (
	"context"
	"log/slog"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
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

// UNIT_BOUNDARY_DESCRIPTION: remembers what the runner last measured a
// UNIT_BOUNDARY_DESCRIPTION: machine's VMM holding; a machine that is not
// UNIT_BOUNDARY_DESCRIPTION: running holds nothing to remember.
func (r *AgentReconciler) noteMachineUse(name string, machine vmrunner.MachineStatus) {
	if machine.State == vmrunner.StateRunning && machine.UsedMiB > 0 {
		r.vmUsedMiB.Store(name, machine.UsedMiB)
		return
	}
	r.vmUsedMiB.Delete(name)
}

// UNIT_BOUNDARY_DESCRIPTION: what a machine that should run is counted at,
// UNIT_BOUNDARY_DESCRIPTION: the same way the runner admits it: its measured
// UNIT_BOUNDARY_DESCRIPTION: use plus headroom, never above its size, and its
// UNIT_BOUNDARY_DESCRIPTION: full size until the runner has measured it.
func (r *AgentReconciler) accountedMemoryMiB(name string, spec *apiv1.AgentSpec) int {
	size := r.machineMemoryMiB(spec)
	used, ok := r.vmUsedMiB.Load(name)
	if !ok {
		return size
	}
	return min(size, used.(int)+r.config.VM.Runner.HeadroomMiB)
}

func (r *AgentReconciler) runnerLimitMiB() int {
	if res := r.config.VM.Runner.Resources; res != nil {
		if q, ok := res.Limits[corev1.ResourceMemory]; ok {
			return int(q.Value() >> 20)
		}
	}
	return 0
}

// UNIT_BOUNDARY_DESCRIPTION: how much more memory the owner's machines are
// UNIT_BOUNDARY_DESCRIPTION: counted at, with the reserve, than `percent` of
// UNIT_BOUNDARY_DESCRIPTION: the runner's limit; zero or less when they fit,
// UNIT_BOUNDARY_DESCRIPTION: and always zero for an install with no limit.
func (r *AgentReconciler) runnerOvershootMiB(demandMiB, percent int) int {
	limit := r.runnerLimitMiB()
	if limit == 0 {
		return 0
	}
	return demandMiB + r.config.VM.Runner.ReserveMiB - limit*percent/100
}

// UNIT_BOUNDARY_DESCRIPTION: frees `needMiB` on the owner's runner by
// UNIT_BOUNDARY_DESCRIPTION: hibernating their vm agents under the rules a
// UNIT_BOUNDARY_DESCRIPTION: blocked start reclaims by: unattended, idle past
// UNIT_BOUNDARY_DESCRIPTION: the floor, longest-idle first, and only when the
// UNIT_BOUNDARY_DESCRIPTION: agents chosen cover the whole need — no agent is
// UNIT_BOUNDARY_DESCRIPTION: hibernated for room that would still not suffice.
// UNIT_BOUNDARY_DESCRIPTION: Each frees what it is counted at, so a guest
// UNIT_BOUNDARY_DESCRIPTION: holding little frees little.
func (r *AgentReconciler) reclaimRunnerMemory(ctx context.Context, owner, self string, needMiB int) (bool, error) {
	if owner == "" || needMiB <= 0 {
		return false, nil
	}
	lock := r.ownerLock(owner)
	lock.Lock()
	candidates, err := r.reclaimableAgents(ctx, self, owner)
	if err != nil {
		lock.Unlock()
		return false, err
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].idleSince.Before(candidates[j].idleSince) })
	var chosen []reclaimCandidate
	left := needMiB
	for _, c := range candidates {
		if left <= 0 {
			break
		}
		if c.vmMiB == 0 || r.busyProbe(ctx, c.name) {
			continue
		}
		left -= c.vmMiB
		chosen = append(chosen, c)
	}
	lock.Unlock()
	if left > 0 {
		return false, nil
	}
	return true, r.hibernateReclaimed(ctx, chosen, owner, self, "reclaimed idle agent to free memory on its owner's VM runner")
}

// UNIT_BOUNDARY_DESCRIPTION: a running machine's use is learned only when its
// UNIT_BOUNDARY_DESCRIPTION: agent reconciles, which a settled agent does every
// UNIT_BOUNDARY_DESCRIPTION: few minutes, while guests grow within seconds. So
// UNIT_BOUNDARY_DESCRIPTION: every pass asks each owner's runner about their
// UNIT_BOUNDARY_DESCRIPTION: running machines, hibernates idle agents of an
// UNIT_BOUNDARY_DESCRIPTION: owner under pressure, and returns one agent of each
// UNIT_BOUNDARY_DESCRIPTION: owner whose counted memory moved, for the caller to
// UNIT_BOUNDARY_DESCRIPTION: reconcile so the runner's request follows it.
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
		if name, ok := r.ownerMemoryPass(ctx, owner, agents); ok {
			moved = append(moved, name)
		}
	}
	return moved
}

func (r *AgentReconciler) ownerMemoryPass(ctx context.Context, owner string, agents []*apiv1.Agent) (string, bool) {
	runner, err := r.runnerFor(ctx, owner)
	if err != nil {
		return "", false
	}
	var first *apiv1.Agent
	for _, a := range agents {
		running, err := r.peerShouldRun(ctx, a.Name)
		if err != nil || !running {
			continue
		}
		if first == nil {
			first = a
		}
		status, err := runner.Status(ctx, a.Name)
		if err != nil {
			continue
		}
		r.noteMachineUse(a.Name, status)
	}
	if first == nil {
		return "", false
	}
	demand, err := r.ownerRunnerDemand(ctx, owner, first, true)
	if err != nil {
		return "", false
	}
	if r.runnerOvershootMiB(demand.memoryMiB, memoryPressurePercent) > 0 {
		need := r.runnerOvershootMiB(demand.memoryMiB, memoryTargetPercent)
		if _, err := r.reclaimRunnerMemory(ctx, owner, "", need); err != nil {
			slog.WarnContext(ctx, "vm memory: reclaiming under pressure", "owner", owner, "error", err)
		}
	}
	rounded := roundedMiB(demand.memoryMiB)
	if last, ok := r.ownerDemandMiB.Swap(owner, rounded); ok && last.(int) == rounded {
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
	demand, err := r.ownerRunnerDemand(ctx, owner, agent, true)
	if err != nil {
		return err
	}
	_, err = r.reclaimRunnerMemory(ctx, owner, agent.Name, r.runnerOvershootMiB(demand.memoryMiB, 100))
	return err
}
