package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// applyAgentBaseMeta merges chart-level ExtraLabels / ExtraAnnotations into
// the pod template metadata. Controller-managed keys already present in
// `meta` win on collision — load-bearing selectors and the gateway's
// `envoy-secrets-rev` annotation must not be overwritten.
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

// applyAgentBaseScheduling stamps chart-level scheduling fields onto agent
// and fork-agent pods. Only non-zero values apply.
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

// applyTemplateScheduling layers per-template RuntimeClassName / NodeSelector
// over the chart-wide base. NodeSelector keys merge (onto a fresh copy, never
// the shared config map); RuntimeClassName replaces.
func applyTemplateScheduling(spec *corev1.PodSpec, agentSpec *types.AgentSpec) {
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

// configMountsToTypes / configEnvToTypes shuttle the chart-side fallback
// shapes (config.Mount / config.EnvVar) into the per-instance types the
// reconciler already builds pods from. The shapes are identical bar the
// package — splitting them keeps `config` independent of `types`.
func configMountsToTypes(in []config.Mount) []types.Mount {
	if len(in) == 0 {
		return nil
	}
	out := make([]types.Mount, len(in))
	for i, m := range in {
		out[i] = types.Mount{Path: m.Path, Persist: m.Persist, Size: m.Size}
	}
	return out
}

func configEnvToTypes(in []config.EnvVar) []types.EnvVar {
	if len(in) == 0 {
		return nil
	}
	out := make([]types.EnvVar, len(in))
	for i, e := range in {
		out[i] = types.EnvVar{Name: e.Name, Value: e.Value}
	}
	return out
}
