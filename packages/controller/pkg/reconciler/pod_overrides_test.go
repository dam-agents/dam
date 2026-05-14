package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// configWith returns testConfig with `base` stamped onto its AgentBase so
// tests can swap the chart-level policy without mutating the shared fixture.
func configWith(base config.AgentBase) *config.Config {
	c := *testConfig
	c.AgentBase = base
	return &c
}

// fullAgentBase exercises every Layer-A field so the apply helpers don't
// silently drop any during refactors.
func fullAgentBase() config.AgentBase {
	return config.AgentBase{
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
		Probes: &config.AgentProbes{
			Startup: &corev1.Probe{
				ProbeHandler:     corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/custom-startup", Port: intstr.FromString("acp")}},
				PeriodSeconds:    5,
				FailureThreshold: 60,
			},
		},
		ContainerSecurityContext: &corev1.SecurityContext{
			Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
		},
		AccessMode:             "ReadWriteMany",
		TerminationGracePeriod: 5,
	}
}

// applyAgentBaseMeta + Scheduling cover all of Layer A's pod-shape effects.

func TestApplyAgentBaseMeta_AddsExtraLabelsAndAnnotations(t *testing.T) {
	meta := &metav1.ObjectMeta{
		Labels:      map[string]string{LabelInstance: "my-instance"},
		Annotations: map[string]string{"agent-platform.ai/gh-token-available": "true"},
	}
	applyAgentBaseMeta(meta, fullAgentBase())
	assert.Equal(t, "platform", meta.Labels["team"])
	assert.Equal(t, "false", meta.Annotations["sidecar.istio.io/inject"])

	// Controller-managed keys must not be overwritten.
	assert.Equal(t, "my-instance", meta.Labels[LabelInstance])
	assert.Equal(t, "true", meta.Annotations["agent-platform.ai/gh-token-available"])
}

func TestApplyAgentBaseScheduling_StampsAllFields(t *testing.T) {
	spec := &corev1.PodSpec{}
	applyAgentBaseScheduling(spec, fullAgentBase())
	assert.Equal(t, "agents", spec.NodeSelector["workload"])
	require.Len(t, spec.Tolerations, 1)
	require.NotNil(t, spec.Affinity)
	require.Len(t, spec.TopologySpreadConstraints, 1)
	assert.Equal(t, "platform-agent", spec.PriorityClassName)
	require.NotNil(t, spec.RuntimeClassName)
	assert.Equal(t, "kata", *spec.RuntimeClassName)
}

// $HOME substitution lives in the chart (agent-templates.yaml + the
// controller/deployment.yaml AGENT_TEMPLATE_DEFAULTS replace). The
// controller and reconciler tests assert resolved paths flow through
// unchanged; the substitution itself is exercised by `helm template`.

// End-to-end via BuildAgentStatefulSet — chart-level AgentBase fields land
// on the pod; gateway pod (covered in gateway_test.go) does NOT receive them.

func TestBuildAgentStatefulSet_AgentBase_FullSurface(t *testing.T) {
	cfg := configWith(fullAgentBase())
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, cfg, testOwnerCM, nil, "")
	require.NotNil(t, ss)
	spec := ss.Spec.Template.Spec
	meta := ss.Spec.Template.ObjectMeta

	assert.Equal(t, "platform", meta.Labels["team"])
	assert.Equal(t, "false", meta.Annotations["sidecar.istio.io/inject"])
	assert.Equal(t, "agents", spec.NodeSelector["workload"])
	require.Len(t, spec.Tolerations, 1)
	require.NotNil(t, spec.Affinity)
	require.Len(t, spec.TopologySpreadConstraints, 1)
	assert.Equal(t, "platform-agent", spec.PriorityClassName)
	require.NotNil(t, spec.RuntimeClassName)
	assert.Equal(t, "kata", *spec.RuntimeClassName)

	agent := spec.Containers[0]
	require.NotNil(t, agent.SecurityContext)
	require.NotNil(t, agent.SecurityContext.Capabilities)
	assert.Equal(t, []corev1.Capability{"ALL"}, agent.SecurityContext.Capabilities.Drop)
	require.NotNil(t, agent.StartupProbe)
	require.NotNil(t, agent.StartupProbe.HTTPGet)
	assert.Equal(t, "/custom-startup", agent.StartupProbe.HTTPGet.Path)
}

// Per-template Layer-B overrides — template values win over chart defaults.

func TestBuildAgentStatefulSet_TemplateOverridesPullPolicyAndResources(t *testing.T) {
	cfg := *testConfig
	cfg.AgentTemplateDefaults.ImagePullPolicy = "IfNotPresent"
	cfg.AgentTemplateDefaults.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("100m"),
			corev1.ResourceMemory: resource.MustParse("256Mi"),
		},
	}

	tmpl := *testAgent
	tmpl.ImagePullPolicy = "Always"
	tmpl.Resources = types.ResourceSpec{
		Requests: map[string]string{"cpu": "2", "memory": "4Gi"},
	}
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, &tmpl, &cfg, testOwnerCM, nil, "")
	c := ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, corev1.PullAlways, c.ImagePullPolicy, "template pullPolicy wins")
	assert.Equal(t, resource.MustParse("2"), c.Resources.Requests[corev1.ResourceCPU], "template resources win")
}

// When AgentSpec omits mounts/env, the chart's AgentTemplateDefaults supplies
// the fallback list (replace semantics — see config.AgentTemplateDefaults).

func TestBuildAgentStatefulSet_FallsBackToTemplateDefaultsMountsAndEnv(t *testing.T) {
	// AGENT_TEMPLATE_DEFAULTS ships with absolute paths — the chart's
	// `replace "$HOME"` resolves the placeholder at install time.
	cfg := *testConfig
	cfg.AgentTemplateDefaults.Mounts = []config.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/tmp", Persist: false},
	}
	cfg.AgentTemplateDefaults.Env = []config.EnvVar{{Name: "PORT", Value: "8080"}}

	bare := &types.AgentSpec{Image: "ghcr.io/myorg/agent:latest", Version: types.SpecVersion}
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, bare, &cfg, testOwnerCM, nil, "")

	var sawHome bool
	for _, vm := range ss.Spec.Template.Spec.Containers[0].VolumeMounts {
		if vm.MountPath == "/home/agent" {
			sawHome = true
		}
	}
	assert.True(t, sawHome, "chart-default mount applied when AgentSpec omits mounts")

	var sawPort bool
	for _, e := range ss.Spec.Template.Spec.Containers[0].Env {
		if e.Name == "PORT" && e.Value == "8080" {
			sawPort = true
		}
	}
	assert.True(t, sawPort, "chart-default env applied when AgentSpec omits env")
}
