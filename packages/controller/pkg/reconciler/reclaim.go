package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

const (
	// UNIT_BOUNDARY_DESCRIPTION: the idle floor of the passes that free room on
	// UNIT_BOUNDARY_DESCRIPTION: their own initiative — the 90% pass and the
	// UNIT_BOUNDARY_DESCRIPTION: runner's pressure signal — where a machine
	// UNIT_BOUNDARY_DESCRIPTION: someone used a minute ago must not be taken
	// UNIT_BOUNDARY_DESCRIPTION: and nothing is waiting on the room.
	reclaimIdleFloor = 3 * time.Minute
	// UNIT_BOUNDARY_DESCRIPTION: the floor of the one reclaim that a start is
	// UNIT_BOUNDARY_DESCRIPTION: waiting for: an owner who started an agent
	// UNIT_BOUNDARY_DESCRIPTION: said so, so the machine of theirs that has been
	// UNIT_BOUNDARY_DESCRIPTION: idle half a minute is the room to free.
	refusedStartFloor = 30 * time.Second
)

type reclaimCandidate struct {
	name            string
	idleSince       time.Time
	forRefusedStart bool
	cpu             resource.Quantity
	mem             resource.Quantity
	vmMiB           int
	booting         bool
	holdsNothing    bool
}

func (r *AgentReconciler) reclaimIdleRoom(ctx context.Context, agent *apiv1.Agent, owner string) (bool, error) {
	if owner == "" {
		return false, nil
	}

	chosen, err := r.pickReclaimCandidates(ctx, agent, owner)
	if err != nil || len(chosen) == 0 {
		return false, err
	}

	if _, err := r.hibernateReclaimed(ctx, chosen, owner, agent.Name, "reclaimed idle agent to admit a blocked start"); err != nil {
		return false, err
	}
	return true, nil
}

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

	needCPU := reservedCPU.DeepCopy()
	needCPU.Add(candCPU)
	needCPU.Sub(ceilCPU)
	needMem := reservedMem.DeepCopy()
	needMem.Add(candMem)
	needMem.Sub(ceilMem)

	candidates, err := r.reclaimableAgents(ctx, agent.Name, owner, false)
	if err != nil {
		return nil, err
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].idleSince.Before(candidates[j].idleSince) })

	var chosen []reclaimCandidate
	for _, c := range candidates {
		if needCPU.Sign() <= 0 && needMem.Sign() <= 0 {
			break
		}
		if c.vmMiB > 0 {
			continue
		}
		if idle, _ := r.podStatus(ctx, c.name); !idle {
			continue
		}
		needCPU.Sub(c.cpu)
		needMem.Sub(c.mem)
		chosen = append(chosen, c)
	}
	if needCPU.Sign() > 0 || needMem.Sign() > 0 {
		return nil, nil
	}
	return chosen, nil
}

func (r *AgentReconciler) reclaimableAgents(ctx context.Context, self, owner string, forRefusedStart bool) ([]reclaimCandidate, error) {
	agents, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: envoyOwnerLabel + "=" + owner,
	})
	if err != nil {
		return nil, fmt.Errorf("listing owner agents: %w", err)
	}

	now := r.clockNow().UTC()
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
		idleTimeout := effectiveIdleTimeout(peer.Spec.HibernationTimeout, peer.Spec.IsVM(), r.config.AgentBase)
		idleSince, ok := reclaimEligible(peer, idleTimeout, now, r.reclaimFloor(peer, now, forRefusedStart))
		if !ok {
			continue
		}
		up, err := r.agentDesiredUp(ctx, peer.Name, peer.Spec.IsVM())
		if err != nil {
			return nil, err
		}
		if !up {
			continue
		}
		cpu, mem := r.limitsOf(&peer.Spec)
		c := reclaimCandidate{name: peer.Name, idleSince: idleSince, forRefusedStart: forRefusedStart, cpu: cpu, mem: mem, booting: vmBootInProgress(item, idleTimeout, now)}
		if peer.Spec.IsVM() {
			c.vmMiB = r.accountedMemoryMiB(ctx, owner, peer.Name, &peer.Spec)
			c.holdsNothing = r.refusedWithoutMachine(peer) || r.waitingForRoom(peer)
		}
		out = append(out, c)
	}
	return out, nil
}

// UNIT_BOUNDARY_DESCRIPTION: the floor a peer is held to. A start a runner refused for
// UNIT_BOUNDARY_DESCRIPTION: room is an owner asking for a machine now, so it frees one
// UNIT_BOUNDARY_DESCRIPTION: idle half a minute rather than three; and one whose machine
// UNIT_BOUNDARY_DESCRIPTION: began holding memory inside that half minute is held to no
// UNIT_BOUNDARY_DESCRIPTION: floor at all, since a wake that answered a single request and
// UNIT_BOUNDARY_DESCRIPTION: then idled is the room it holds and nothing else. Whether it
// UNIT_BOUNDARY_DESCRIPTION: woke is read from the stamp of the machine's own start, which
// UNIT_BOUNDARY_DESCRIPTION: only a start or a wake moves: a readiness that went false for a
// UNIT_BOUNDARY_DESCRIPTION: failed request and true again on the next is a machine that
// UNIT_BOUNDARY_DESCRIPTION: never stopped holding its room, so it keeps the half minute. The
// UNIT_BOUNDARY_DESCRIPTION: passes that free room on their own initiative keep their floor.
func (r *AgentReconciler) reclaimFloor(peer *apiv1.Agent, now time.Time, forRefusedStart bool) time.Duration {
	if !forRefusedStart {
		return reclaimIdleFloor
	}
	if up, err := time.Parse(time.RFC3339Nano, peer.Annotations[annMachineUp]); err == nil && now.Sub(up) < refusedStartFloor {
		return 0
	}
	return refusedStartFloor
}

func reclaimEligible(peer *apiv1.Agent, idleTimeout time.Duration, now time.Time, floor time.Duration) (time.Time, bool) {
	annotations := peer.Annotations
	if idleTimeout <= 0 {
		return time.Time{}, false
	}
	if annotations[annActiveSession] == "true" || annotations[annInvocationsActive] == "true" {
		return time.Time{}, false
	}
	if annotations[annSweepable] == "true" {
		return time.Time{}, false
	}
	if annotations[annStopRequested] != "" || annotations[annStorageMigration] != "" || annotations[annRuntimeMigration] != "" {
		return time.Time{}, false
	}
	last, err := time.Parse(time.RFC3339, annotations[annLastActivity])
	if err != nil {
		return time.Time{}, false
	}
	if now.Sub(last) < floor {
		return time.Time{}, false
	}
	return last, true
}

// UNIT_BOUNDARY_DESCRIPTION: writes the reclaim stamp, and only onto the
// UNIT_BOUNDARY_DESCRIPTION: version of the Agent the reclaim re-read it at:
// UNIT_BOUNDARY_DESCRIPTION: an api-server write landing between that read and
// UNIT_BOUNDARY_DESCRIPTION: this patch bumps the version and the patch fails
// UNIT_BOUNDARY_DESCRIPTION: with a conflict instead of spending the activity
// UNIT_BOUNDARY_DESCRIPTION: of an agent somebody just touched.
func (r *AgentReconciler) stampReclaimed(ctx context.Context, name, stamp, resourceVersion string) error {
	return r.stampAnnotation(ctx, name, annReclaimedAt, stamp, resourceVersion)
}

func (r *AgentReconciler) stampAnnotation(ctx context.Context, name, key, value, resourceVersion string) error {
	meta := map[string]any{"annotations": map[string]string{key: value}}
	if resourceVersion != "" {
		meta["resourceVersion"] = resourceVersion
	}
	raw, err := json.Marshal(map[string]any{"metadata": meta})
	if err != nil {
		return fmt.Errorf("encoding the %s stamp: %w", key, err)
	}
	if _, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).
		Patch(ctx, name, types.MergePatchType, raw, metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("stamping %s on agent %s: %w", key, name, err)
	}
	return nil
}
