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

const (
	reclaimIdleFloor = 3 * time.Minute
)

type reclaimCandidate struct {
	name      string
	vm        bool
	idleSince time.Time
	cpu       resource.Quantity
	mem       resource.Quantity
}

func (r *AgentReconciler) reclaimIdleRoom(ctx context.Context, agent *apiv1.Agent, owner string) (bool, error) {
	if owner == "" {
		return false, nil
	}

	chosen, err := r.pickReclaimCandidates(ctx, agent, owner)
	if err != nil || len(chosen) == 0 {
		return false, err
	}

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

	candidates, err := r.reclaimableAgents(ctx, agent.Name, owner)
	if err != nil {
		return nil, err
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].idleSince.Before(candidates[j].idleSince) })

	var chosen []reclaimCandidate
	for _, c := range candidates {
		if needCPU.Sign() <= 0 && needMem.Sign() <= 0 {
			break
		}
		if r.busyProbe(ctx, c.name) {
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
			continue
		}
		cpu, mem := r.limitsOf(&peer.Spec)
		out = append(out, reclaimCandidate{name: peer.Name, vm: peer.Spec.IsVM(), idleSince: idleSince, cpu: cpu, mem: mem})
	}
	return out, nil
}

func reclaimEligible(annotations map[string]string, idleTimeout time.Duration, now time.Time) (time.Time, bool) {
	if idleTimeout <= 0 {
		return time.Time{}, false
	}
	if annotations[annActiveSession] == "true" || annotations[annExperimentActive] == "true" {
		return time.Time{}, false
	}
	if annotations[annSweepable] == "true" {
		return time.Time{}, false
	}
	if annotations[annStopRequested] != "" || annotations[annStorageMigration] != "" {
		return time.Time{}, false
	}
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
