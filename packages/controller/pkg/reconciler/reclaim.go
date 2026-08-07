package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// Reclaiming room for a blocked start (#3184).
//
// A start refused by the budget gate is usually blocked by room the owner is
// already done with, sitting behind an idle timeout that has not lapsed — up to
// an hour on the chart default. Rather than refuse and tell the user to go stop
// something, the gate hibernates the owner's own idle agents early.
//
// This is the single exception to "the budget constrains starting, never
// running": the trigger is admission pressure from the *same owner*, never a
// ceiling change, and never another owner's demand or cluster pod pressure.
//
// It rules synchronously. Reserved counts *desired* replicas (see
// reservedByOwner), so scaling a victim's pair to zero frees budget the moment
// the write lands — the same reconcile can then admit, with no parked-and-retry
// state to carry. Pods draining afterwards are the scheduler's problem, which
// the Budget model has never modelled.
const (
	// reclaimIdleFloor is the minimum idle age of a reclaim candidate, on top
	// of the ordinary idleness checks. Two jobs: it spares an agent a user may
	// be a breath away from using again, and it is what makes reclaim
	// non-recursive — an agent admitted by reclaiming carries fresh activity,
	// so it cannot be the next start's victim and A-evicts-B-evicts-A cannot
	// close. Lowering it weakens that guarantee, not just the courtesy.
	reclaimIdleFloor = 3 * time.Minute
)

type reclaimCandidate struct {
	name      string
	vm        bool
	idleSince time.Time
	cpu       resource.Quantity
	mem       resource.Quantity
}

// reclaimIdleRoom tries to free enough of the owner's Reserved to admit
// `agent`, by hibernating that owner's unattended idle agents ahead of their
// timeout, longest-idle first. Reports whether it freed anything; the caller
// re-runs the gate for the actual verdict, so the admission arithmetic has one
// home.
//
// All-or-nothing: nothing is hibernated unless the candidates provably cover
// the shortfall, so no agent is ever killed for a start that was going to be
// refused anyway.
func (r *AgentReconciler) reclaimIdleRoom(ctx context.Context, agent *apiv1.Agent, owner string) (bool, error) {
	if owner == "" {
		return false, nil
	}

	chosen, err := r.pickReclaimCandidates(ctx, agent, owner)
	if err != nil || len(chosen) == 0 {
		return false, err
	}

	// Stamp before scaling: an unstamped victim would be scaled straight back
	// up by its own next reconcile, since its activity is still inside its
	// timeout — that is the whole premise of reclaiming it.
	now := time.Now().UTC().Format(time.RFC3339)
	for _, c := range chosen {
		if err := r.stampReclaimed(ctx, c.name, now); err != nil {
			return false, err
		}
		if err := hibernateAgentPair(ctx, r.client, r.dynamic, r.config.Namespace, c.name, c.vm); err != nil {
			return false, err
		}
		slog.InfoContext(ctx, "reclaimed idle agent to admit a blocked start",
			"agent", c.name, "for", agent.Name, "owner", owner, "idleFor", time.Since(c.idleSince).Round(time.Second))
	}
	return true, nil
}

// pickReclaimCandidates returns the victims to hibernate, longest-idle first,
// or nil when the owner's idle agents cannot cover the shortfall.
func (r *AgentReconciler) pickReclaimCandidates(ctx context.Context, agent *apiv1.Agent, owner string) ([]reclaimCandidate, error) {
	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()

	reservedCPU, reservedMem, err := r.reservedByOwner(ctx, owner, agent.Name)
	if err != nil {
		return nil, err
	}
	ceilCPU, ceilMem, err := r.ceilingFor(ctx, owner)
	if err != nil {
		return nil, err
	}
	candCPU, candMem := r.limitsOf(&agent.Spec)

	// Shortfall: what the start overflows the Ceiling by, per dimension.
	needCPU := reservedCPU.DeepCopy()
	needCPU.Add(candCPU)
	needCPU.Sub(ceilCPU)
	needMem := reservedMem.DeepCopy()
	needMem.Add(candMem)
	needMem.Sub(ceilMem)

	candidates, err := r.reclaimableAgents(ctx, agent.Name, owner)
	if err != nil {
		return nil, err
	}
	// Longest idle first; the probe is the expensive part, so it runs lazily as
	// the greedy accumulation walks the list, never over the whole owner.
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].idleSince.Before(candidates[j].idleSince) })

	var chosen []reclaimCandidate
	for _, c := range candidates {
		if needCPU.Sign() <= 0 && needMem.Sign() <= 0 {
			break
		}
		// The runtime is authoritative about its own idleness, exactly as for
		// an ordinary hibernation. An unreachable pod counts as not busy.
		if r.busyProbe(ctx, c.name) {
			continue
		}
		needCPU.Sub(c.cpu)
		needMem.Sub(c.mem)
		chosen = append(chosen, c)
	}
	if needCPU.Sign() > 0 || needMem.Sign() > 0 {
		return nil, nil // cannot cover the shortfall — hibernate nothing
	}
	return chosen, nil
}

// reclaimableAgents lists the owner's agents eligible to be reclaimed for a
// start: scaled up, unattended, and idle past the floor.
func (r *AgentReconciler) reclaimableAgents(ctx context.Context, self, owner string) ([]reclaimCandidate, error) {
	agents, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: envoyOwnerLabel + "=" + owner,
	})
	if err != nil {
		return nil, fmt.Errorf("listing owner agents: %w", err)
	}

	now := time.Now().UTC()
	var out []reclaimCandidate
	for i := range agents.Items {
		item := &agents.Items[i]
		if item.GetName() == self {
			continue
		}
		peer, err := FromCacheObject[apiv1.Agent](item)
		if err != nil {
			return nil, fmt.Errorf("decoding agent %s: %w", item.GetName(), err)
		}
		idleSince, ok := reclaimEligible(peer.Annotations,
			effectiveIdleTimeout(peer.Spec.HibernationTimeout, r.config.AgentBase.IdleTimeout.AsDuration()), now)
		if !ok {
			continue
		}
		up, err := r.agentDesiredUp(ctx, peer.Name, peer.Spec.IsVM())
		if err != nil {
			return nil, err
		}
		if !up {
			continue // already down: holds no room to reclaim
		}
		cpu, mem := r.limitsOf(&peer.Spec)
		out = append(out, reclaimCandidate{name: peer.Name, vm: peer.Spec.IsVM(), idleSince: idleSince, cpu: cpu, mem: mem})
	}
	return out, nil
}

// reclaimEligible reports whether an agent may be hibernated early to free room
// for a peer, and how long it has been idle. Eligibility is deliberately
// narrower than the idle checker's: reclaim kills a pod whose *own* timeout
// says it may keep running, so it only ever touches agents nobody is attached
// to.
func reclaimEligible(annotations map[string]string, idleTimeout time.Duration, now time.Time) (time.Time, bool) {
	// "Always run" is a declaration, not a default to be overridden.
	if idleTimeout <= 0 {
		return time.Time{}, false
	}
	// Attached, or holding declared work. A session pin is what makes silent
	// reclaim defensible — the runtime's idle flag reads an attached chat with
	// no turn running as idle, so the probe alone would happily kill a pod
	// somebody is watching.
	if annotations[annActiveSession] == "true" || annotations[annExperimentActive] == "true" {
		return time.Time{}, false
	}
	// An invocation target's driver is blocked polling for its result: it is
	// unattended only in the sense that no human is watching.
	if annotations[annSweepable] == "true" {
		return time.Time{}, false
	}
	// Already coming down for another reason; leave those paths alone.
	if annotations[annStopRequested] != "" || annotations[annStorageMigration] != "" {
		return time.Time{}, false
	}
	// No usable activity stamp ⇒ no positive idle signal. Fails open, like
	// shouldRun: absent data never justifies a scale-down.
	last, err := time.Parse(time.RFC3339, annotations[annLastActivity])
	if err != nil {
		return time.Time{}, false
	}
	if now.Sub(last) < reclaimIdleFloor {
		return time.Time{}, false
	}
	return last, true
}

func (r *AgentReconciler) stampReclaimed(ctx context.Context, name, stamp string) error {
	raw, err := json.Marshal(map[string]any{
		"metadata": map[string]any{"annotations": map[string]string{annReclaimedAt: stamp}},
	})
	if err != nil {
		return fmt.Errorf("encoding reclaim stamp: %w", err)
	}
	if _, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).
		Patch(ctx, name, types.MergePatchType, raw, metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("stamping reclaimed agent %s: %w", name, err)
	}
	return nil
}
