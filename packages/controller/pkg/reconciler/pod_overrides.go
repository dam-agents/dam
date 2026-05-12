package reconciler

import (
	"strings"

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

// substituteHome replaces the literal `$HOME` placeholder with the chart's
// agentHome value. Used for AgentSpec mount paths and skill paths so
// templates don't have to hardcode the home directory.
func substituteHome(s, home string) string {
	if home == "" {
		return s
	}
	return strings.ReplaceAll(s, "$HOME", home)
}

func substituteHomeAll(paths []string, home string) []string {
	if len(paths) == 0 || home == "" {
		return paths
	}
	out := make([]string, len(paths))
	for i, p := range paths {
		out[i] = substituteHome(p, home)
	}
	return out
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
