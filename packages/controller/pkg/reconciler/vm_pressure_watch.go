package reconciler

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"k8s.io/apimachinery/pkg/labels"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: how long a pressure watch on a runner that does not serve the pressure read waits before it ends, so the next reconcile asks again: a runner handed off to a newer release serves it without a new pod.
const pressureUnservedBackoff = 10 * time.Minute

// UNIT_BOUNDARY_DESCRIPTION: how long after a reclaim under pressure the owner's runner is not reclaimed for again on its signal. The machines it hibernated take seconds to stop, and until they have, the runner's working set still counts them, so a second signal would hibernate more agents for room already freed.
const pressureReclaimCooldown = 15 * time.Second

// UNIT_BOUNDARY_DESCRIPTION: how long a pressure watch that failed a read waits before asking again, doubling up to pressureReconnectMax. A settled agent no longer reconciles every minute, so a watch ended by one failed read — a runner restarting, a connection dropped — would be started again only by the next change or the five-minute sweep, and the counted threshold left in its place is the view the kernel's does not share.
const (
	pressureReconnect    = time.Second
	pressureReconnectMax = 30 * time.Second
)

// UNIT_BOUNDARY_DESCRIPTION: starts the one pressure watch on the owner's runner, unless it is already running. Only a runner in the cluster with a read pool and a memory limit reports pressure; the host runner admits against a share of the Mac's memory the controller never learns. The watch lives no longer than the reconciler's lifetime, retries a read that failed, and ends only on a runner that does not serve the read, which the next reconcile asks again: a runner handed off to a newer release serves it without a new pod. An owner whose pool is unread is left to that next reconcile too.
func (r *AgentReconciler) watchRunnerPressure(runner *vmrunner.Client, owner string) {
	if r.lifetime == nil || r.config.VM.Runner.HostAddress != "" {
		return
	}
	if limit, err := r.runnerLimitMiB(r.lifetime, owner); err != nil || limit == 0 {
		return
	}
	r.machineWatchMu.Lock()
	defer r.machineWatchMu.Unlock()
	if _, ok := r.pressureWatches[owner]; ok {
		return
	}
	if r.pressureWatches == nil {
		r.pressureWatches = map[string]*machineWatch{}
	}
	ctx, cancel := context.WithCancel(r.lifetime)
	w := &machineWatch{cancel: cancel}
	r.pressureWatches[owner] = w
	go r.awaitRunnerPressure(ctx, w, runner, owner)
}

func (r *AgentReconciler) unwatchRunnerPressure(owner string) {
	r.machineWatchMu.Lock()
	defer r.machineWatchMu.Unlock()
	if w, ok := r.pressureWatches[owner]; ok {
		w.cancel()
		delete(r.pressureWatches, owner)
	}
}

func (r *AgentReconciler) awaitRunnerPressure(ctx context.Context, w *machineWatch, runner *vmrunner.Client, owner string) {
	defer func() {
		r.machineWatchMu.Lock()
		if r.pressureWatches[owner] == w {
			delete(r.pressureWatches, owner)
		}
		r.machineWatchMu.Unlock()
		w.cancel()
	}()
	var since uint64
	wait := pressureReconnect
	for ctx.Err() == nil {
		asked := time.Now()
		p, err := runner.WaitPressure(ctx, since, vmStatusWait)
		if errors.Is(err, vmrunner.ErrNotServed) {
			select {
			case <-ctx.Done():
			case <-time.After(pressureUnservedBackoff):
			}
			return
		}
		if err != nil {
			select {
			case <-ctx.Done():
			case <-time.After(wait):
			}
			wait = min(2*wait, pressureReconnectMax)
			continue
		}
		wait = pressureReconnect
		if p.Version == since {
			// UNIT_BOUNDARY_DESCRIPTION: a closing runner answers every wait at once, so an unchanged answer that came early waits out the rest of a second before asking again.
			select {
			case <-ctx.Done():
			case <-time.After(time.Second - time.Since(asked)):
			}
			continue
		}
		since = p.Version
		if p.Pressured {
			r.pressurePass(ctx, owner, p)
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the memory pass for one owner, run on their runner's pressure signal rather than on the half-minute tick.
func (r *AgentReconciler) pressurePass(ctx context.Context, owner string, p vmrunner.RunnerPressure) {
	if r.agentCache == nil {
		return
	}
	items, err := r.agentCache.ByNamespace(r.config.Namespace).List(labels.SelectorFromSet(labels.Set{envoyOwnerLabel: owner}))
	if err != nil {
		slog.WarnContext(ctx, "vm memory: listing the owner's agents under pressure", "owner", owner, "error", err)
		return
	}
	var agents []*apiv1.Agent
	for _, obj := range items {
		if a, err := FromCacheObject[apiv1.Agent](obj); err == nil && vmSideOf(a) != nil {
			agents = append(agents, a)
		}
	}
	if name, ok := r.ownerMemoryPass(ctx, owner, agents, &p); ok && r.requeue != nil {
		r.requeue(name, 0)
	}
}
