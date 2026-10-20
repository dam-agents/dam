package reconciler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: the fields of an owner's UserBudget that override their VM pool. A field left nil is the install's value. The pool is read on every reconcile of every vm agent and on every memory pass, and a starting machine reconciles every half second, so the overrides are kept in memory: the memory pass reads them again every 30 seconds, and a reconcile reads them only for an owner not yet seen, when it starts a machine, or when the owner's runner claim is about to be created — the memory pass skips an owner with nothing running, and a claim built from a stale pool would keep that size, since a claim never shrinks.
type vmPool struct {
	memory  *resource.Quantity
	cpu     *resource.Quantity
	storage *resource.Quantity
}

// UNIT_BOUNDARY_DESCRIPTION: an owner whose UserBudget this process has never read has no pool, and that is not the same as an empty one. The install's default is smaller than some owners' pools and larger than others: sized from it, a claim grows to it and can never shrink again, a memory limit falls under the machines already running on it, and their next machine is sized past the pool they meant. Every caller that would set a size from the pool refuses and retries instead; one that only counts what the machines hold keeps counting from what it does know — an Agent's own memory where its share of the pool is unknown, and no limit at all — so a count is never built from a pool this process has not read.
var errVMPoolUnread = errors.New("the owner's UserBudget is unread, so their VM pool is unknown")

func (r *AgentReconciler) vmPoolOf(ctx context.Context, owner string) (vmPool, error) {
	if pool, ok := r.vmPools.Load(owner); ok {
		return pool.(vmPool), nil
	}
	return r.refreshVMPool(ctx, owner)
}

// UNIT_BOUNDARY_DESCRIPTION: reads the owner's UserBudget again. A read that fails keeps the overrides last read, so an API server that is slow for a moment does not shrink a pool back to the install's; an owner never read at all has none to keep, which is what errVMPoolUnread says.
func (r *AgentReconciler) refreshVMPool(ctx context.Context, owner string) (vmPool, error) {
	obj, err := r.dynamic.Resource(UserBudgetsGVR).Namespace(r.config.Namespace).Get(ctx, "budget-"+owner, metav1.GetOptions{})
	var pool vmPool
	switch {
	case k8serrors.IsNotFound(err):
	case err != nil:
		slog.Warn("vm runner: reading the owner's UserBudget, the pool stays as it was", "owner", owner, "error", err)
		return r.lastVMPool(owner, err)
	default:
		b, err := FromCacheObject[apiv1.UserBudget](obj)
		if err != nil {
			slog.Warn("vm runner: decoding the owner's UserBudget, the pool stays as it was", "owner", owner, "error", err)
			return r.lastVMPool(owner, err)
		}
		pool = vmPool{memory: b.Spec.Memory, cpu: b.Spec.CPU, storage: b.Spec.Storage}
	}
	r.vmPools.Store(owner, pool)
	return pool, nil
}

// UNIT_BOUNDARY_DESCRIPTION: the pool last read for the owner, or the refusal to answer for one this process has never read.
func (r *AgentReconciler) lastVMPool(owner string, cause error) (vmPool, error) {
	if last, ok := r.vmPools.Load(owner); ok {
		return last.(vmPool), nil
	}
	return vmPool{}, fmt.Errorf("%w: %w", errVMPoolUnread, cause)
}

func (r *AgentReconciler) runnerLimitMiB(ctx context.Context, owner string) (int, error) {
	pool, err := r.vmPoolOf(ctx, owner)
	if err != nil {
		return 0, err
	}
	if pool.memory != nil {
		return int(pool.memory.Value() >> 20), nil
	}
	if res := r.config.VM.Runner.Resources; res != nil {
		if q, ok := res.Limits[corev1.ResourceMemory]; ok {
			return int(q.Value() >> 20), nil
		}
	}
	return 0, nil
}

func (r *AgentReconciler) runnerCPUCeiling(ctx context.Context, owner string) (*resource.Quantity, error) {
	pool, err := r.vmPoolOf(ctx, owner)
	if err != nil {
		return nil, err
	}
	if pool.cpu != nil {
		return pool.cpu, nil
	}
	if res := r.config.VM.Runner.Resources; res != nil {
		if q, ok := res.Limits[corev1.ResourceCPU]; ok {
			return &q, nil
		}
	}
	// UNIT_BOUNDARY_DESCRIPTION: an install that sets only the memory it gives the runner still needs a CPU bound at creation, or a runaway VMM takes the node until a resize lands, and for ever on a cluster that cannot resize. Every machine the pool can hold at boot costs the warm-up floor of memory, so the machines that fit plus one more for the runner is the figure. It is a cap on the pod, not on how many machines are ever admitted: once machines warm up, admission counts their measured use and headroom rather than their floors, so more of them may fit and share this cap, and a guest can be throttled below its vCPUs when they all use them at once.
	limitMiB, err := r.runnerLimitMiB(ctx, owner)
	if err != nil {
		return nil, err
	}
	if limitMiB <= 0 {
		return nil, nil
	}
	// UNIT_BOUNDARY_DESCRIPTION: with no warm-up floor to divide the pool by, two machines' worth is the figure: each takes at most half of it, so an owner can still run a pair and no single VMM can take the node's every core. One machine would cap a pair below what the pool they were given allows, and any further one is a guess. It is a creation cap only: lightly resident machines beyond the pair may fit and share it, and then be throttled below their vCPUs while they use them together.
	boot := r.config.VM.Runner.BootMiB
	machines := 2
	if boot > 0 {
		machines = limitMiB/boot + 1
	}
	cpus := resource.NewQuantity(int64(machines*max(r.config.VM.Runner.MachineCPUs, 1)), resource.DecimalSI)
	return cpus, nil
}

func (r *AgentReconciler) runnerStorageCeiling(ctx context.Context, owner string) (resource.Quantity, error) {
	pool, err := r.vmPoolOf(ctx, owner)
	if err != nil {
		return resource.Quantity{}, err
	}
	if pool.storage != nil {
		return *pool.storage, nil
	}
	ceiling, err := resource.ParseQuantity(r.config.VM.Runner.Storage)
	if err != nil {
		return resource.Quantity{}, fmt.Errorf("vm runner storage %q is not a quantity: %w", r.config.VM.Runner.Storage, err)
	}
	return ceiling, nil
}
