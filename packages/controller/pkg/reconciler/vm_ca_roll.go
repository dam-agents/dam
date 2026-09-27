package reconciler

import (
	"log/slog"
	"time"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: a running machine that has been handed a new MITM CA and has not yet come back ready. The runner applies a new CA as a stop and a start, so a CA rotation, which reaches every agent's leaf Secret, would otherwise reboot every vm machine of the install at once — exactly what the runner roll exists to prevent. `version` is the machine's status version when the runner accepted the new CA; the reboot is over once the machine is ready at a later one.
type caRoll struct {
	started  time.Time
	version  uint64
	accepted bool
}

// UNIT_BOUNDARY_DESCRIPTION: the CA a machine is sent. A machine that is stopped, or starting now, takes the new CA at once, since it reboots anyway; so does one the controller has no record of, after a restart. A running machine takes it only while fewer than the roll width (`rollout.maxConcurrent`, the same width runner rolls use) are rebooting for a CA; otherwise it keeps the CA it runs with and is offered the new one on a later reconcile. A reboot that has not finished within the settle timeout stops holding its place.
func (r *AgentReconciler) gateCARestart(name, want string, live bool) string {
	r.caMu.Lock()
	defer r.caMu.Unlock()
	held, known := r.machineCA[name]
	if !known || held == want || !live {
		return want
	}
	if _, rolling := r.caRolls[name]; rolling {
		return want
	}
	limit, timeout := runnerRolloutLimits(r.config.VM.Runner)
	for other, roll := range r.caRolls {
		if time.Since(roll.started) > timeout {
			slog.Warn("vm machine: a reboot for a new MITM CA did not finish in time, the next machine may take it", "agent", other, "timeout", timeout)
			delete(r.caRolls, other)
		}
	}
	if len(r.caRolls) >= limit {
		slog.Info("vm machine: the MITM CA changed, waiting for other machines to reboot first", "agent", name, "rebooting", len(r.caRolls))
		return held
	}
	if r.caRolls == nil {
		r.caRolls = map[string]caRoll{}
	}
	r.caRolls[name] = caRoll{started: time.Now()}
	slog.Info("vm machine: rebooting to take a new MITM CA", "agent", name)
	return want
}

func (r *AgentReconciler) noteMachineCA(name, sent string, running bool, st vmrunner.MachineStatus) {
	r.caMu.Lock()
	defer r.caMu.Unlock()
	if r.machineCA == nil {
		r.machineCA = map[string]string{}
	}
	r.machineCA[name] = sent
	roll, rolling := r.caRolls[name]
	switch {
	case !rolling:
	case !running:
		delete(r.caRolls, name)
	case !roll.accepted:
		r.caRolls[name] = caRoll{started: roll.started, version: st.Version, accepted: true}
	case st.Ready && st.Version > roll.version:
		delete(r.caRolls, name)
	}
}

func (r *AgentReconciler) forgetMachineCA(name string) {
	r.caMu.Lock()
	defer r.caMu.Unlock()
	delete(r.machineCA, name)
	delete(r.caRolls, name)
}
