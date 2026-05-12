package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// configWith returns testConfig with `ac` stamped onto its AgentConfig so the
// shared testConfig isn't mutated across tests.
func configWith(ac config.AgentConfig) *config.Config {
	c := *testConfig
	// Preserve testConfig defaults (e.g. ImagePullPolicy IfNotPresent set by
	// the test setup) while letting the caller layer override fields.
	c.AgentConfig = *c.AgentConfig.Merge(&ac)
	return &c
}

// fullAgentConfig exercises every override field at once so the apply
// helpers don't silently drop something during refactors.
func fullAgentConfig() config.AgentConfig {
	return config.AgentConfig{
		ExtraLabels:      map[string]string{"team": "platform"},
		ExtraAnnotations: map[string]string{"sidecar.istio.io/inject": "false"},
		NodeSelector:     map[string]string{"workload": "agents"},
		Tolerations: []corev1.Toleration{{
			Key: "dedicated", Operator: corev1.TolerationOpEqual, Value: "agents", Effect: corev1.TaintEffectNoSchedule,
		}},
		Affinity: &corev1.Affinity{
			NodeAffinity: &corev1.NodeAffinity{
				RequiredDuringSchedulingIgnoredDuringExecution: &corev1.NodeSelector{
					NodeSelectorTerms: []corev1.NodeSelectorTerm{{
						MatchExpressions: []corev1.NodeSelectorRequirement{{
							Key: "node-role", Operator: corev1.NodeSelectorOpIn, Values: []string{"sandbox"},
						}},
					}},
				},
			},
		},
		TopologySpreadConstraints: []corev1.TopologySpreadConstraint{{
			MaxSkew: 1, TopologyKey: "topology.kubernetes.io/zone", WhenUnsatisfiable: corev1.DoNotSchedule,
		}},
		PriorityClassName: "platform-agent",
		RuntimeClassName:  "kata",
		ExtraEnv:          []corev1.EnvVar{{Name: "OPERATOR_FLAG", Value: "true"}},
		ExtraVolumes: []corev1.Volume{{
			Name: "extra-ca", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
		}},
		ExtraVolumeMounts: []corev1.VolumeMount{{Name: "extra-ca", MountPath: "/etc/extra-ca"}},
		Resources: &corev1.ResourceRequirements{
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("2"),
				corev1.ResourceMemory: resource.MustParse("4Gi"),
			},
			Limits: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
			},
		},
		Probes: &config.AgentProbes{
			Startup: &corev1.Probe{
				ProbeHandler:     corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/custom-startup", Port: intstr.FromString("acp")}},
				PeriodSeconds:    5,
				FailureThreshold: 60,
			},
		},
	}
}

// --- BuildAgentStatefulSet (long-lived agent) ---

func TestBuildAgentStatefulSet_AgentConfig_FullSurface(t *testing.T) {
	cfg := configWith(fullAgentConfig())
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, cfg, testOwnerCM, nil)
	require.NotNil(t, ss)
	spec := ss.Spec.Template.Spec
	meta := ss.Spec.Template.ObjectMeta

	assert.Equal(t, "platform", meta.Labels["team"])
	assert.Equal(t, "false", meta.Annotations["sidecar.istio.io/inject"])
	assert.Equal(t, "agents", spec.NodeSelector["workload"])
	require.Len(t, spec.Tolerations, 1)
	assert.Equal(t, "dedicated", spec.Tolerations[0].Key)
	require.NotNil(t, spec.Affinity)
	require.Len(t, spec.TopologySpreadConstraints, 1)
	assert.Equal(t, "platform-agent", spec.PriorityClassName)
	require.NotNil(t, spec.RuntimeClassName)
	assert.Equal(t, "kata", *spec.RuntimeClassName)

	agent := spec.Containers[0]
	var sawOperatorEnv bool
	for _, e := range agent.Env {
		if e.Name == "OPERATOR_FLAG" && e.Value == "true" {
			sawOperatorEnv = true
		}
	}
	assert.True(t, sawOperatorEnv, "extraEnv should be appended to agent container env")

	var sawExtraMount bool
	for _, m := range agent.VolumeMounts {
		if m.Name == "extra-ca" && m.MountPath == "/etc/extra-ca" {
			sawExtraMount = true
		}
	}
	assert.True(t, sawExtraMount, "extraVolumeMounts should be appended to agent container")

	var sawExtraVolume bool
	for _, v := range spec.Volumes {
		if v.Name == "extra-ca" {
			sawExtraVolume = true
		}
	}
	assert.True(t, sawExtraVolume, "extraVolumes should be appended to pod volumes")

	require.NotNil(t, agent.StartupProbe)
	require.NotNil(t, agent.StartupProbe.HTTPGet)
	assert.Equal(t, "/custom-startup", agent.StartupProbe.HTTPGet.Path)

	assert.Equal(t, resource.MustParse("2"), agent.Resources.Requests[corev1.ResourceCPU])
	assert.Equal(t, resource.MustParse("8Gi"), agent.Resources.Limits[corev1.ResourceMemory])
}

func TestBuildAgentStatefulSet_AgentConfig_ControllerLabelsWin(t *testing.T) {
	// Operator must not be able to overwrite selector labels — those are
	// load-bearing for the Service selector and pair-scoping NetworkPolicy.
	cfg := configWith(config.AgentConfig{
		ExtraLabels: map[string]string{
			LabelInstance: "OVERRIDDEN",
			"team":        "platform",
		},
		ExtraAnnotations: map[string]string{
			"agent-platform.ai/gh-token-available": "OVERRIDDEN",
			"sidecar.istio.io/inject":              "false",
		},
	})
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, cfg, testOwnerCM, nil)
	meta := ss.Spec.Template.ObjectMeta

	assert.Equal(t, "my-instance", meta.Labels[LabelInstance], "controller label must not be overridden")
	assert.Equal(t, "platform", meta.Labels["team"], "new label should still land")
	assert.Equal(t, "false", meta.Annotations["agent-platform.ai/gh-token-available"], "controller annotation must not be overridden — gh-token-available comes from the credential set")
	assert.Equal(t, "false", meta.Annotations["sidecar.istio.io/inject"], "new annotation should still land")
}

func TestBuildAgentStatefulSet_AgentConfig_ProbesGatedByMasterSwitch(t *testing.T) {
	// AgentProbesEnabled=false → overrides do nothing (master switch wins).
	cfg := configWith(fullAgentConfig())
	cfg.AgentProbesEnabled = false
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, cfg, testOwnerCM, nil)
	agent := ss.Spec.Template.Spec.Containers[0]
	assert.Nil(t, agent.StartupProbe, "probe overrides should not bypass the master enable switch")
	assert.Nil(t, agent.ReadinessProbe)
	assert.Nil(t, agent.LivenessProbe)
}

func TestBuildAgentStatefulSet_AgentConfig_Empty(t *testing.T) {
	// Sanity: zero AgentConfig must not panic and must not perturb the pod
	// shape — only the chart-default fields (ImagePullPolicy, etc.) apply.
	cfg := configWith(config.AgentConfig{})
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, cfg, testOwnerCM, nil)
	spec := ss.Spec.Template.Spec
	assert.Nil(t, spec.RuntimeClassName)
	assert.Nil(t, spec.NodeSelector)
	assert.Empty(t, spec.Tolerations)
}

func TestBuildAgentStatefulSet_AgentConfig_ResourcesEmptyKeepsTemplate(t *testing.T) {
	// An empty `resources: {}` block (no requests/limits) must not silently
	// wipe the agent template's resources. Operators get the template's
	// values until they explicitly set requests or limits.
	cfg := configWith(config.AgentConfig{Resources: &corev1.ResourceRequirements{}})
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, cfg, testOwnerCM, nil)
	agent := ss.Spec.Template.Spec.Containers[0]
	// testAgent.Resources sets cpu=250m / memory=512Mi as requests
	assert.Equal(t, resource.MustParse("250m"), agent.Resources.Requests[corev1.ResourceCPU])
}

// --- BuildGatewayStatefulSet (long-lived gateway) ---

func TestBuildGatewayStatefulSet_AgentConfig_SchedulingAndMeta(t *testing.T) {
	cfg := configWith(fullAgentConfig())
	ss := BuildGatewayStatefulSet("my-instance", false, cfg, testOwnerCM, nil)
	spec := ss.Spec.Template.Spec
	meta := ss.Spec.Template.ObjectMeta

	assert.Equal(t, "platform", meta.Labels["team"])
	assert.Equal(t, "agents", spec.NodeSelector["workload"])
	require.NotNil(t, spec.RuntimeClassName)
	assert.Equal(t, "kata", *spec.RuntimeClassName)
	assert.Equal(t, "platform-agent", spec.PriorityClassName)

	// Gateway must NOT inherit extraEnv / extraVolumes — those are agent-only.
	envoy := spec.Containers[0]
	for _, e := range envoy.Env {
		assert.NotEqual(t, "OPERATOR_FLAG", e.Name, "gateway container must not receive agent-scoped extraEnv")
	}
	for _, v := range spec.Volumes {
		assert.NotEqual(t, "extra-ca", v.Name, "gateway pod must not receive agent-scoped extraVolumes")
	}

	// envoy-secrets-rev annotation must survive — operator can't overwrite the roll trigger.
	_, hasRev := meta.Annotations["agent-platform.ai/envoy-secrets-rev"]
	assert.True(t, hasRev, "gateway roll-trigger annotation must always be present")
}

// --- BuildForkAgentJob (per-turn fork agent) ---

func TestBuildForkAgentJob_AgentConfig_FullSurface(t *testing.T) {
	cfg := configWith(fullAgentConfig())
	fork := &types.ForkSpec{Instance: "parent-inst", ForeignSub: "user-42"}
	job := BuildForkAgentJob("fork-1", fork, &types.InstanceSpec{}, testAgent, cfg, testOwnerCM, nil)
	spec := job.Spec.Template.Spec
	meta := job.Spec.Template.ObjectMeta

	assert.Equal(t, "platform", meta.Labels["team"])
	require.NotNil(t, spec.RuntimeClassName)
	assert.Equal(t, "kata", *spec.RuntimeClassName)
	assert.Equal(t, "agents", spec.NodeSelector["workload"])

	agent := spec.Containers[0]
	var sawOperatorEnv bool
	for _, e := range agent.Env {
		if e.Name == "OPERATOR_FLAG" {
			sawOperatorEnv = true
		}
	}
	assert.True(t, sawOperatorEnv, "fork agent should receive operator-supplied extraEnv")

	var sawExtraVolume bool
	for _, v := range spec.Volumes {
		if v.Name == "extra-ca" {
			sawExtraVolume = true
		}
	}
	assert.True(t, sawExtraVolume)
}

// --- BuildForkGatewayPod (per-turn fork gateway) ---

func TestBuildForkGatewayPod_AgentConfig_SchedulingAndMeta(t *testing.T) {
	cfg := configWith(fullAgentConfig())
	pod := BuildForkGatewayPod("fork-1", "parent-inst", cfg, testOwnerCM, nil)

	assert.Equal(t, "platform", pod.Labels["team"])
	require.NotNil(t, pod.Spec.RuntimeClassName)
	assert.Equal(t, "kata", *pod.Spec.RuntimeClassName)
	assert.Equal(t, "agents", pod.Spec.NodeSelector["workload"])

	envoy := pod.Spec.Containers[0]
	for _, e := range envoy.Env {
		assert.NotEqual(t, "OPERATOR_FLAG", e.Name, "fork gateway must not receive agent-scoped extraEnv")
	}
}
