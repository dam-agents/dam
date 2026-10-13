package reconciler

import (
	"context"
	"fmt"
	"log/slog"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: the fields of an owner's UserBudget that override their VM pool. A field left nil is the install's value. The pool is read on every reconcile of every vm agent and on every memory pass, and a starting machine reconciles every half second, so the overrides are kept in memory: the memory pass reads them again every 30 seconds, and a reconcile reads them only for an owner not yet seen.
type vmPool struct {
	memory  *resource.Quantity
	cpu     *resource.Quantity
	storage *resource.Quantity
}

func (r *AgentReconciler) vmPoolOf(ctx context.Context, owner string) vmPool {
	if pool, ok := r.vmPools.Load(owner); ok {
		return pool.(vmPool)
	}
	return r.refreshVMPool(ctx, owner)
}

// UNIT_BOUNDARY_DESCRIPTION: reads the owner's UserBudget again. A read that fails keeps the overrides last read, so an API server that is slow for a moment does not shrink a pool back to the install's.
func (r *AgentReconciler) refreshVMPool(ctx context.Context, owner string) vmPool {
	obj, err := r.dynamic.Resource(UserBudgetsGVR).Namespace(r.config.Namespace).Get(ctx, "budget-"+owner, metav1.GetOptions{})
	var pool vmPool
	switch {
	case k8serrors.IsNotFound(err):
	case err != nil:
		slog.Warn("vm runner: reading the owner's UserBudget, the pool stays as it was", "owner", owner, "error", err)
		if last, ok := r.vmPools.Load(owner); ok {
			return last.(vmPool)
		}
	default:
		b, err := FromCacheObject[apiv1.UserBudget](obj)
		if err != nil {
			slog.Warn("vm runner: decoding the owner's UserBudget, the pool stays as it was", "owner", owner, "error", err)
			if last, ok := r.vmPools.Load(owner); ok {
				return last.(vmPool)
			}
			break
		}
		pool = vmPool{memory: b.Spec.Memory, cpu: b.Spec.CPU, storage: b.Spec.Storage}
	}
	r.vmPools.Store(owner, pool)
	return pool
}

func (r *AgentReconciler) runnerStorageCeiling(ctx context.Context, owner string) (resource.Quantity, error) {
	if pool := r.vmPoolOf(ctx, owner); pool.storage != nil {
		return *pool.storage, nil
	}
	ceiling, err := resource.ParseQuantity(r.config.VM.Runner.Storage)
	if err != nil {
		return resource.Quantity{}, fmt.Errorf("vm runner storage %q is not a quantity: %w", r.config.VM.Runner.Storage, err)
	}
	return ceiling, nil
}
