package reconciler

import (
	"context"
	"time"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: how long one status read on the runner may wait for a change. The runner caps its own wait above this, so the read ends with an answer rather than a timeout.
const vmStatusWait = 25 * time.Second

// UNIT_BOUNDARY_DESCRIPTION: the watch on one machine that is on its way up. Nothing in the cluster changes when a guest starts answering — there is no pod to watch — so the controller asks the runner, with a long poll that returns when the machine's status version moves. A change requeues the Agent at once and ends the watch, and the ordinary reconcile publishes the new status and starts another watch if the machine is still not ready. That keeps one code path for status writes, and a full reconcile only when something changed.
type machineWatch struct {
	cancel context.CancelFunc
}

func machineComingUp(st vmrunner.MachineStatus) bool {
	return !st.Ready && (st.Reason == "" || st.Reason == vmrunner.ReasonNotReady)
}

// UNIT_BOUNDARY_DESCRIPTION: starts watching the machine from the status version the reconcile just read, unless a watch on it is already running. The watch lives no longer than the reconciler's lifetime, so losing leadership or shutting down ends it. A running watch that holds an older version answers at once and requeues, so the next reconcile starts one from the newer version.
func (r *AgentReconciler) watchMachine(runner *vmrunner.Client, name string, since uint64) {
	if r.requeue == nil {
		return
	}
	r.machineWatchMu.Lock()
	defer r.machineWatchMu.Unlock()
	if _, ok := r.machineWatches[name]; ok {
		return
	}
	if r.machineWatches == nil {
		r.machineWatches = map[string]*machineWatch{}
	}
	ctx, cancel := context.WithCancel(r.lifetime)
	w := &machineWatch{cancel: cancel}
	r.machineWatches[name] = w
	go r.awaitMachineChange(ctx, w, runner, name, since)
}

// UNIT_BOUNDARY_DESCRIPTION: ends the watch without a requeue: the machine is ready, stopped, parked or deleted, and whatever did that already reconciles the Agent.
func (r *AgentReconciler) unwatchMachine(name string) {
	r.machineWatchMu.Lock()
	defer r.machineWatchMu.Unlock()
	if w, ok := r.machineWatches[name]; ok {
		w.cancel()
		delete(r.machineWatches, name)
	}
}

func (r *AgentReconciler) watchingMachine(name string) bool {
	r.machineWatchMu.Lock()
	defer r.machineWatchMu.Unlock()
	_, ok := r.machineWatches[name]
	return ok
}

// UNIT_BOUNDARY_DESCRIPTION: reads until the version moves, then requeues the Agent. A read that fails — the runner rolling, its token rotated — also ends the watch, with a requeue after the readiness poll, because only a full reconcile can find the runner again. The watch is removed before the requeue, so the reconcile it causes can start the next one.
func (r *AgentReconciler) awaitMachineChange(ctx context.Context, w *machineWatch, runner *vmrunner.Client, name string, since uint64) {
	after := time.Duration(0)
	defer func() {
		r.machineWatchMu.Lock()
		if r.machineWatches[name] == w {
			delete(r.machineWatches, name)
		}
		r.machineWatchMu.Unlock()
		if ctx.Err() == nil {
			r.requeue(name, after)
		}
		w.cancel()
	}()
	for ctx.Err() == nil {
		st, err := runner.WaitStatus(ctx, name, since, vmStatusWait)
		if err != nil {
			after = vmReadinessPoll
			return
		}
		if st.Version != since {
			return
		}
	}
}
