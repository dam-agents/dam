package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
)

func waitingPod(reason string) *corev1.Pod {
	return &corev1.Pod{
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: reason}}},
			},
		},
	}
}

func terminatedPod(reason string, exitCode int32) *corev1.Pod {
	return &corev1.Pod{
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: reason, ExitCode: exitCode}}},
			},
		},
	}
}

func TestTerminationReason(t *testing.T) {
	tests := []struct {
		name       string
		pod        *corev1.Pod
		wantOK     bool
		wantReason string
		wantMsg    string
	}{
		{name: "nil pod", pod: nil, wantOK: false},
		{name: "no container statuses", pod: &corev1.Pod{}, wantOK: false},
		{
			name:       "oom killed",
			pod:        terminatedPod("OOMKilled", 137),
			wantOK:     true,
			wantReason: "OutOfMemory",
			wantMsg:    "out of memory (OOMKilled)",
		},
		{
			name:       "non-zero exit",
			pod:        terminatedPod("Error", 1),
			wantOK:     true,
			wantReason: "ContainerTerminated",
			wantMsg:    "exited with code 1 (Error)",
		},
		{name: "clean exit", pod: terminatedPod("Completed", 0), wantOK: false},
		{
			name:       "image pull backoff",
			pod:        waitingPod("ImagePullBackOff"),
			wantOK:     true,
			wantReason: "ImagePullFailure",
			wantMsg:    "can't pull image (check the registry credential)",
		},
		{
			name:       "err image pull",
			pod:        waitingPod("ErrImagePull"),
			wantOK:     true,
			wantReason: "ImagePullFailure",
			wantMsg:    "can't pull image (check the registry credential)",
		},
		{
			name:       "invalid image name",
			pod:        waitingPod("InvalidImageName"),
			wantOK:     true,
			wantReason: "InvalidImageName",
			wantMsg:    "invalid image name",
		},
		{name: "container creating is not a failure", pod: waitingPod("ContainerCreating"), wantOK: false},
		{name: "pod initializing is not a failure", pod: waitingPod("PodInitializing"), wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reason, msg, ok := terminationReason(tt.pod)
			assert.Equal(t, tt.wantOK, ok)
			assert.Equal(t, tt.wantReason, reason)
			assert.Equal(t, tt.wantMsg, msg)
		})
	}
}

func TestTerminationReason_PriorTerminationBeatsWaiting(t *testing.T) {
	pod := &corev1.Pod{
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{
					State:                corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}},
					LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", ExitCode: 137}},
				},
			},
		},
	}

	reason, msg, ok := terminationReason(pod)
	assert.True(t, ok)
	assert.Equal(t, "OutOfMemory", reason)
	assert.Equal(t, "out of memory (OOMKilled)", msg)
}
