package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"
)

// terminationReason returns a reason token + message for a pod's abnormal container exit; ok=false on a clean exit.
func terminationReason(pod *corev1.Pod) (reason, message string, ok bool) {
	if pod == nil {
		return "", "", false
	}
	for _, cs := range pod.Status.ContainerStatuses {
		if t := cs.State.Terminated; t != nil {
			if r, m, ok := classifyTermination(t); ok {
				return r, m, true
			}
		}
		if cs.State.Waiting != nil && cs.LastTerminationState.Terminated != nil {
			if r, m, ok := classifyTermination(cs.LastTerminationState.Terminated); ok {
				return r, m, true
			}
		}
	}
	return "", "", false
}

func classifyTermination(t *corev1.ContainerStateTerminated) (reason, message string, ok bool) {
	if t.Reason == "OOMKilled" {
		return "OutOfMemory", "out of memory (OOMKilled)", true
	}
	if t.ExitCode != 0 {
		msg := fmt.Sprintf("exited with code %d", t.ExitCode)
		if t.Reason != "" {
			msg = fmt.Sprintf("%s (%s)", msg, t.Reason)
		}
		return "ContainerTerminated", msg, true
	}
	return "", "", false
}
