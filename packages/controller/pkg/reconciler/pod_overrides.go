package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

func applyAgentBaseMeta(meta *metav1.ObjectMeta, base config.AgentBase) {
	for k, v := range base.ExtraLabels {
		if _, taken := meta.Labels[k]; taken {
			continue
		}
		if meta.Labels == nil {
			meta.Labels = map[string]string{}
		}
		meta.Labels[k] = v
	}
	for k, v := range base.ExtraAnnotations {
		if _, taken := meta.Annotations[k]; taken {
			continue
		}
		if meta.Annotations == nil {
			meta.Annotations = map[string]string{}
		}
		meta.Annotations[k] = v
	}
}

func applyAgentBaseScheduling(spec *corev1.PodSpec, base config.AgentBase) {
	if len(base.NodeSelector) > 0 {
		spec.NodeSelector = base.NodeSelector
	}
	if len(base.Tolerations) > 0 {
		spec.Tolerations = base.Tolerations
	}
	if base.Affinity != nil {
		spec.Affinity = base.Affinity
	}
	if len(base.TopologySpreadConstraints) > 0 {
		spec.TopologySpreadConstraints = base.TopologySpreadConstraints
	}
	if base.PriorityClassName != "" {
		spec.PriorityClassName = base.PriorityClassName
	}
	if base.RuntimeClassName != "" {
		rc := base.RuntimeClassName
		spec.RuntimeClassName = &rc
	}
}

func applyTemplateScheduling(spec *corev1.PodSpec, agentSpec *apiv1.AgentSpec) {
	if agentSpec.RuntimeClassName != "" {
		rc := agentSpec.RuntimeClassName
		spec.RuntimeClassName = &rc
	}
	if len(agentSpec.NodeSelector) > 0 {
		merged := make(map[string]string, len(spec.NodeSelector)+len(agentSpec.NodeSelector))
		for k, v := range spec.NodeSelector {
			merged[k] = v
		}
		for k, v := range agentSpec.NodeSelector {
			merged[k] = v
		}
		spec.NodeSelector = merged
	}
}
