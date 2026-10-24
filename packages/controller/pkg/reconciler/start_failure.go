package reconciler

import (
	"fmt"
	"time"

	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const (
	startFailureRestarts = 3
	startFailureNotReady = 10 * time.Minute
	admissionMessageMax  = 1024
)

// UNIT_BOUNDARY_DESCRIPTION: how long a vm machine may run on one spec without answering before it is reported NeverReady. It must be well under the chart's vm idle timeout, five minutes from the wake: an Agent moved while hibernated takes the new image on its next wake, so the report and the image update job's move back have to land before the idle checker hibernates it again. It must also be under the runner's own ten-minute restart of a quiet guest that once answered, which every moved machine has, since that restart stops the clock. A guest boots in seconds and the runner reports one silent for a minute as a slow boot, so two minutes running without an answer is a failure. The idle checker holds a vm agent whose boot is in progress until its start is decided, so the report lands under a shorter vm idle timeout too.
const vmStartFailureNotReady = 2 * time.Minute

type startFailure struct {
	reason, message string
}

// UNIT_BOUNDARY_DESCRIPTION: what the controller remembers of a vm machine on one spec generation, since the runner's status names no spec: the restart count the runner reported when the generation was first seen, and since when the machine has been running without being ready. A status read after an Ensure with a new spec is the new spec's, because the runner reports a restart in flight as not ready. It lives in memory only, so a controller restart starts the clock again and delays a report by at most the bound.
type vmStartClock struct {
	generation    int64
	restartsAtGen int32
	notReadySince time.Time
}

// UNIT_BOUNDARY_DESCRIPTION: how the vm machine is failing on the current spec, and the clock to keep for the next read. The runner restarts a guest that answered and then went quiet, and counts it, but never restarts one that never answered, so the first is a crash loop counted from this generation on and the second is a machine that runs past the bound without becoming ready. A count below the one remembered means the runner restarted and forgot, so the count starts again. Only the running state starts the not-ready clock: a create, a start or a restart in flight is the runner's own work, an image pull included, and so is a boot the runner reports copying a disk, and the re-boot that follows a VMM the kernel or its seccomp filter killed, which the runner bounds itself and reports as a kill reason until the guest answers.
func vmStartFailure(prev vmStartClock, generation int64, st vmrunner.MachineStatus, now time.Time) (vmStartClock, startFailure) {
	if prev.generation != generation || st.Restarts < prev.restartsAtGen {
		prev = vmStartClock{generation: generation, restartsAtGen: st.Restarts}
	}
	switch {
	case st.Ready || st.State != vmrunner.StateRunning || st.Reason == vmrunner.ReasonCopyingDisk || st.Reason == vmrunner.ReasonOOMKilled || st.Reason == vmrunner.ReasonSeccompKilled:
		prev.notReadySince = time.Time{}
	case prev.notReadySince.IsZero():
		prev.notReadySince = now
	}
	switch {
	case st.Ready:
		return prev, startFailure{}
	case st.Restarts-prev.restartsAtGen >= startFailureRestarts:
		return prev, startFailure{apiv1.ReasonCrashLoop, fmt.Sprintf("the guest stopped answering and was restarted %d times", st.Restarts-prev.restartsAtGen)}
	case !prev.notReadySince.IsZero() && now.Sub(prev.notReadySince) >= vmStartFailureNotReady:
		return prev, startFailure{apiv1.ReasonNeverReady, fmt.Sprintf("the machine ran for %s without answering", vmStartFailureNotReady)}
	}
	return prev, startFailure{}
}

func setStartFailure(s *apiv1.AgentStatus, f startFailure, generation int64) {
	if f.reason == "" {
		apimeta.RemoveStatusCondition(&s.Conditions, apiv1.ConditionStartFailed)
		return
	}
	apimeta.SetStatusCondition(&s.Conditions, metav1.Condition{
		Type:               apiv1.ConditionStartFailed,
		Status:             metav1.ConditionTrue,
		Reason:             f.reason,
		Message:            f.message,
		ObservedGeneration: generation,
	})
}
