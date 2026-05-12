package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

// Merge: scalars — override wins when non-empty, base preserved otherwise.
func TestAgentConfig_Merge_Scalars(t *testing.T) {
	base := &AgentConfig{
		ImagePullPolicy:   "IfNotPresent",
		StorageClass:      "platform-rwx",
		AccessMode:        "ReadWriteMany",
		StorageSize:       "10Gi",
		PriorityClassName: "default",
		RuntimeClassName:  "",
	}
	override := &AgentConfig{
		ImagePullPolicy:  "Always",
		StorageSize:      "",   // unset — base preserved
		RuntimeClassName: "kata",
	}
	got := base.Merge(override)
	assert.Equal(t, "Always", got.ImagePullPolicy, "override wins")
	assert.Equal(t, "platform-rwx", got.StorageClass, "base preserved when override unset")
	assert.Equal(t, "10Gi", got.StorageSize, "empty override does not wipe base")
	assert.Equal(t, "default", got.PriorityClassName)
	assert.Equal(t, "kata", got.RuntimeClassName, "base empty → override wins")
}

// Merge: Extra* slices are additive — the operator's chart-level extras AND
// the per-agent extras both land on the pod.
func TestAgentConfig_Merge_ExtrasAppend(t *testing.T) {
	base := &AgentConfig{
		ImagePullSecrets:  []string{"regcred"},
		ExtraEnv:          []corev1.EnvVar{{Name: "CLUSTER", Value: "prod"}},
		ExtraVolumes:      []corev1.Volume{{Name: "extra-ca", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}}},
		ExtraVolumeMounts: []corev1.VolumeMount{{Name: "extra-ca", MountPath: "/etc/extra-ca"}},
	}
	override := &AgentConfig{
		ImagePullSecrets:  []string{"agentcred", "regcred"}, // "regcred" already present — dedup
		ExtraEnv:          []corev1.EnvVar{{Name: "AGENT_FLAG", Value: "1"}},
		ExtraVolumes:      []corev1.Volume{{Name: "agent-data", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}}},
		ExtraVolumeMounts: []corev1.VolumeMount{{Name: "agent-data", MountPath: "/data"}},
	}
	got := base.Merge(override)
	assert.Equal(t, []string{"regcred", "agentcred"}, got.ImagePullSecrets, "image pull secrets dedupe")
	require.Len(t, got.ExtraEnv, 2)
	assert.Equal(t, "CLUSTER", got.ExtraEnv[0].Name)
	assert.Equal(t, "AGENT_FLAG", got.ExtraEnv[1].Name)
	require.Len(t, got.ExtraVolumes, 2)
	require.Len(t, got.ExtraVolumeMounts, 2)
}

// Merge: Extra* maps merge per-key, override wins on collision.
func TestAgentConfig_Merge_ExtrasMapsMerge(t *testing.T) {
	base := &AgentConfig{
		ExtraLabels:      map[string]string{"team": "platform", "tier": "default"},
		ExtraAnnotations: map[string]string{"sidecar.istio.io/inject": "false"},
	}
	override := &AgentConfig{
		ExtraLabels:      map[string]string{"tier": "premium", "agent": "kata"},
		ExtraAnnotations: map[string]string{"admission.stackrox.io/break-glass": "ticket-1"},
	}
	got := base.Merge(override)
	assert.Equal(t, "platform", got.ExtraLabels["team"])
	assert.Equal(t, "premium", got.ExtraLabels["tier"], "override wins on collision")
	assert.Equal(t, "kata", got.ExtraLabels["agent"])
	assert.Equal(t, "false", got.ExtraAnnotations["sidecar.istio.io/inject"])
	assert.Equal(t, "ticket-1", got.ExtraAnnotations["admission.stackrox.io/break-glass"])
}

// Merge: whole-policy fields replace wholesale — partial policies don't
// compose cleanly (a half-overridden Affinity is worse than either side).
func TestAgentConfig_Merge_WholePolicyReplace(t *testing.T) {
	base := &AgentConfig{
		NodeSelector: map[string]string{"workload": "default"},
		Tolerations: []corev1.Toleration{{
			Key: "base", Operator: corev1.TolerationOpExists,
		}},
		Resources: &corev1.ResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("100m")},
		},
	}
	override := &AgentConfig{
		NodeSelector: map[string]string{"workload": "agents", "gpu": "true"},
		Tolerations: []corev1.Toleration{{
			Key: "override", Operator: corev1.TolerationOpEqual, Value: "1",
		}},
		Resources: &corev1.ResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("500m")},
		},
	}
	got := base.Merge(override)
	assert.Equal(t, map[string]string{"workload": "agents", "gpu": "true"}, got.NodeSelector, "selector replaced wholesale")
	require.Len(t, got.Tolerations, 1)
	assert.Equal(t, "override", got.Tolerations[0].Key)
	assert.Equal(t, resource.MustParse("500m"), got.Resources.Requests[corev1.ResourceCPU])
}

// Merge: empty Resources{} block doesn't silently wipe the base — only
// requests-or-limits-set triggers replacement. Same guard as the resources
// override applied at pod-build time.
func TestAgentConfig_Merge_EmptyResourcesKeepsBase(t *testing.T) {
	base := &AgentConfig{
		Resources: &corev1.ResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("100m")},
		},
	}
	override := &AgentConfig{Resources: &corev1.ResourceRequirements{}}
	got := base.Merge(override)
	require.NotNil(t, got.Resources)
	assert.Equal(t, resource.MustParse("100m"), got.Resources.Requests[corev1.ResourceCPU])
}

// Merge: probes merge per-probe so an override can set one probe without
// disturbing the others.
func TestAgentConfig_Merge_ProbesPerProbeReplace(t *testing.T) {
	baseStartup := &corev1.Probe{PeriodSeconds: 1}
	baseReadiness := &corev1.Probe{PeriodSeconds: 5}
	overrideReadiness := &corev1.Probe{PeriodSeconds: 10}
	base := &AgentConfig{Probes: &AgentProbes{Startup: baseStartup, Readiness: baseReadiness}}
	override := &AgentConfig{Probes: &AgentProbes{Readiness: overrideReadiness}}
	got := base.Merge(override)
	require.NotNil(t, got.Probes)
	assert.Same(t, baseStartup, got.Probes.Startup, "untouched startup probe preserved")
	assert.Same(t, overrideReadiness, got.Probes.Readiness, "override replaces matching probe")
	assert.Nil(t, got.Probes.Liveness)
}

// Merge: nil receiver and nil override both work without panicking.
func TestAgentConfig_Merge_NilSafety(t *testing.T) {
	var nilCfg *AgentConfig
	got := nilCfg.Merge(&AgentConfig{ImagePullPolicy: "Always"})
	assert.Equal(t, "Always", got.ImagePullPolicy)

	base := &AgentConfig{ImagePullPolicy: "IfNotPresent"}
	got = base.Merge(nil)
	assert.Equal(t, "IfNotPresent", got.ImagePullPolicy)
}
