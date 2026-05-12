package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// applyAgentPodMeta merges operator-supplied labels and annotations into the
// pod template metadata. Controller-managed keys (already present in `meta`)
// win on collision — load-bearing selectors and the gateway's
// `envoy-secrets-rev` annotation must not be overwritten.
func applyAgentPodMeta(meta *metav1.ObjectMeta, ac config.AgentConfig) {
	for k, v := range ac.ExtraLabels {
		if _, taken := meta.Labels[k]; taken {
			continue
		}
		if meta.Labels == nil {
			meta.Labels = map[string]string{}
		}
		meta.Labels[k] = v
	}
	for k, v := range ac.ExtraAnnotations {
		if _, taken := meta.Annotations[k]; taken {
			continue
		}
		if meta.Annotations == nil {
			meta.Annotations = map[string]string{}
		}
		meta.Annotations[k] = v
	}
}

// applyAgentPodScheduling stamps the pod-level scheduling / runtime fields
// onto every controller-rendered pod. Only non-zero values apply — leaving a
// field unset in values.yaml keeps cluster defaults.
func applyAgentPodScheduling(spec *corev1.PodSpec, ac config.AgentConfig) {
	if len(ac.NodeSelector) > 0 {
		spec.NodeSelector = ac.NodeSelector
	}
	if len(ac.Tolerations) > 0 {
		spec.Tolerations = ac.Tolerations
	}
	if ac.Affinity != nil {
		spec.Affinity = ac.Affinity
	}
	if len(ac.TopologySpreadConstraints) > 0 {
		spec.TopologySpreadConstraints = ac.TopologySpreadConstraints
	}
	if ac.PriorityClassName != "" {
		spec.PriorityClassName = ac.PriorityClassName
	}
	if ac.RuntimeClassName != "" {
		rc := ac.RuntimeClassName
		spec.RuntimeClassName = &rc
	}
}

// applyAgentContainer appends operator-supplied env / volume mounts to the
// agent container and replaces probes / resources when overrides are set.
// ExtraEnv appends AFTER the user's instance/agent-spec env so operator
// policy wins — K8s resolves duplicate env names by keeping the last
// occurrence. ExtraVolumes are appended to the pod's Volumes slice in the
// caller; this only touches the container side.
func applyAgentContainer(c *corev1.Container, ac config.AgentConfig) {
	c.Env = append(c.Env, ac.ExtraEnv...)
	c.VolumeMounts = append(c.VolumeMounts, ac.ExtraVolumeMounts...)
	// Resources override replaces the agent template's resources entirely —
	// operator policy wins (cluster LimitRange pattern). An empty Resources
	// block decodes to a zero struct and must not silently wipe the
	// template's requests/limits.
	if ac.Resources != nil && (ac.Resources.Requests != nil || ac.Resources.Limits != nil) {
		c.Resources = *ac.Resources
	}
	if ac.Probes == nil {
		return
	}
	if ac.Probes.Startup != nil && c.StartupProbe != nil {
		c.StartupProbe = ac.Probes.Startup
	}
	if ac.Probes.Readiness != nil && c.ReadinessProbe != nil {
		c.ReadinessProbe = ac.Probes.Readiness
	}
	if ac.Probes.Liveness != nil && c.LivenessProbe != nil {
		c.LivenessProbe = ac.Probes.Liveness
	}
}
