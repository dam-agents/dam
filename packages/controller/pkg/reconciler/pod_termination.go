package reconciler

import (
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
)

func isPodReady(pod corev1.Pod) bool {
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

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
		if cs.State.Waiting != nil {
			if cs.LastTerminationState.Terminated != nil {
				if r, m, ok := classifyTermination(cs.LastTerminationState.Terminated); ok {
					return r, m, true
				}
			}
			if r, m, ok := classifyWaiting(cs.State.Waiting); ok {
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

func classifyWaiting(w *corev1.ContainerStateWaiting) (reason, message string, ok bool) {
	switch w.Reason {
	case "ImagePullBackOff", "ErrImagePull", "RegistryUnavailable", "ImageInspectError":
		return "ImagePullFailure", "can't pull image (check the registry credential)", true
	case "InvalidImageName":
		return "InvalidImageName", "invalid image name", true
	}
	return "", "", false
}

// UNIT_BOUNDARY_DESCRIPTION: one OOM kill of a runner pod's runner container, named by the container that died and the time it finished: the terminated container's own id and the kernel's finished time are what tell two kills of one owner's runner apart, and neither changes when the pod's container restarts, so the same kill keeps the same name across a controller or a runner restart. A pod keeps only its container's last termination, so a kill older than the restart after it is forgotten.
type runnerKill struct {
	ID string
	At time.Time
}

func (k runnerKill) IsZero() bool { return k.At.IsZero() }

// UNIT_BOUNDARY_DESCRIPTION: the latest OOM kill the pod records for its runner container: its current state while the container has not restarted yet, else its last termination.
func runnerOOMKillOf(pod *corev1.Pod) runnerKill {
	var kill runnerKill
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.Name != vmRunnerComponent {
			continue
		}
		for _, t := range []*corev1.ContainerStateTerminated{cs.State.Terminated, cs.LastTerminationState.Terminated} {
			if t == nil || t.Reason != "OOMKilled" || !t.FinishedAt.After(kill.At) {
				continue
			}
			kill = runnerKill{ID: t.ContainerID + "@" + t.FinishedAt.UTC().Format(time.RFC3339), At: t.FinishedAt.Time}
		}
	}
	return kill
}
