package reconciler

import (
	"fmt"
	"math"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/yaml"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

var VirtualMachinesGVR = schema.GroupVersionResource{
	Group: "kubevirt.io", Version: "v1", Resource: "virtualmachines",
}

const (
	vmRunStrategyAlways = "Always"
	vmRunStrategyHalted = "Halted"
)

func VMCloudInitSecretName(agentName string) string { return agentName + "-vm-cloudinit" }

func vmWorkspacePVCName(agentName, volName string) string {
	return fmt.Sprintf("%s-%s-0", volName, agentName)
}

func BuildVMWorkspacePVCs(name string, agentSpec *types.AgentSpec, cfg *config.Config) []*corev1.PersistentVolumeClaim {
	base := cfg.AgentBase
	defaults := cfg.AgentTemplateDefaults
	var pvcs []*corev1.PersistentVolumeClaim
	for _, m := range resolveSpecMounts(agentSpec, defaults) {
		if !m.Persist {
			continue
		}
		volName := types.SanitizeMountName(m.Path)
		spec := corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(effectiveMountSize(m, agentSpec, defaults))},
			},
		}
		if sc := effectiveStorageClass(agentSpec, base); sc != "" {
			spec.StorageClassName = &sc
		}
		pvcs = append(pvcs, &corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{
				Name:      vmWorkspacePVCName(name, volName),
				Namespace: cfg.Namespace,
				Labels:    map[string]string{LabelAgent: name, LabelMount: volName},
			},
			Spec: spec,
		})
	}
	return pvcs
}

const vmAgentUID = 65532

func BuildVMCloudInitSecret(name string, agentSpec *types.AgentSpec, cfg *config.Config, ownerRef metav1.OwnerReference, gatewayClusterIP, caCrt string) (*corev1.Secret, error) {
	defaults := cfg.AgentTemplateDefaults
	agentHome := agentHomeDir

	envFile := ""
	for _, e := range agentPlatformEnv(name, cfg, agentHome, agentProxyAddr(cfg, gatewayClusterIP)) {
		envFile += e.Name + "=" + shellQuote(e.Value) + "\n"
	}
	for _, e := range defaults.Env {
		envFile += e.Name + "=" + shellQuote(e.Value) + "\n"
	}

	gateEnv := ""
	if cfg.KubeAPIAddr != "" {
		gateEnv = "PLATFORM_KUBE_API_DENY=" + shellQuote(cfg.KubeAPIAddr) + "\n"
	}

	type cloudFile struct {
		Path        string `json:"path"`
		Permissions string `json:"permissions"`
		Content     string `json:"content"`
	}
	cc := struct {
		WriteFiles []cloudFile `json:"write_files"`
		BootCmd    [][]string  `json:"bootcmd,omitempty"`
	}{
		WriteFiles: []cloudFile{
			{Path: "/etc/platform/env", Permissions: "0644", Content: envFile},
			{Path: "/etc/platform/gate.env", Permissions: "0644", Content: gateEnv},
			{Path: "/etc/platform/ca/ca.crt", Permissions: "0644", Content: caCrt},
		},
	}
	for _, m := range resolveSpecMounts(agentSpec, defaults) {
		if !m.Persist {
			cc.BootCmd = append(cc.BootCmd, []string{"sh", "-c", fmt.Sprintf(
				"mkdir -p %[1]s && chown %[2]d:%[2]d %[1]s || true",
				shellQuote(m.Path), vmAgentUID,
			)})
			continue
		}
		tag := types.SanitizeMountName(m.Path)
		cc.BootCmd = append(cc.BootCmd, []string{"sh", "-c", fmt.Sprintf(
			"mkdir -p %[1]s && { mountpoint -q %[1]s || mount -t virtiofs %[2]s %[1]s; } || true",
			shellQuote(m.Path), shellQuote(tag),
		)})
	}
	cc.BootCmd = append(cc.BootCmd, []string{"sh", "-c", fmt.Sprintf(
		"mkdir -p /tmp/agent-cache && chown %[1]d:%[1]d /tmp/agent-cache && { [ -L %[2]s/.cache ] || rm -rf %[2]s/.cache; } && ln -sfn /tmp/agent-cache %[2]s/.cache || true",
		vmAgentUID, shellQuote(agentHome),
	)})
	cc.BootCmd = append(cc.BootCmd, []string{"env", "HOME=" + agentHome, "sh", "-c",
		`[ -f "$HOME/.initialized" ] || { cp -rn /app/working-dir/. "$HOME/" 2>/dev/null || true; touch "$HOME/.initialized"; }; mkdir -p "$HOME/work"`,
	})

	body, err := yaml.Marshal(cc)
	if err != nil {
		return nil, fmt.Errorf("encoding cloud-init userdata: %w", err)
	}
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            VMCloudInitSecretName(name),
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: name, LabelPair: name, LabelRole: RoleAgent},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		StringData: map[string]string{"userdata": "#cloud-config\n" + string(body)},
	}, nil
}

func BuildAgentVirtualMachine(name string, agentSpec *types.AgentSpec, cfg *config.Config, ownerRef metav1.OwnerReference, gatewayClusterIP string) (*unstructured.Unstructured, error) {
	base := cfg.AgentBase
	defaults := cfg.AgentTemplateDefaults

	pullPolicy := agentSpec.ImagePullPolicy
	if pullPolicy == "" {
		pullPolicy = defaults.ImagePullPolicy
	}

	labels := map[string]any{LabelAgent: name, LabelPair: name, LabelRole: RoleAgent}
	podLabels := map[string]any{}
	for k, v := range labels {
		podLabels[k] = v
	}
	podLabels["istio.io/dataplane-mode"] = "none"

	limits := toResourceList(agentSpec.Resources.Limits)
	if defaults.Resources != nil {
		for rn, q := range defaults.Resources.Limits {
			if _, set := limits[rn]; !set {
				limits[rn] = q
			}
		}
	}
	cpu := limits[corev1.ResourceCPU]
	mem := limits[corev1.ResourceMemory]
	cores := vmGuestCores(cpu)

	disks := []any{
		map[string]any{"name": "boot", "cache": "writeback", "disk": map[string]any{"bus": "virtio"}},
		map[string]any{"name": "cloudinit", "disk": map[string]any{"bus": "virtio"}},
		map[string]any{"name": "scratch", "serial": "scratch", "cache": "writeback", "disk": map[string]any{"bus": "virtio"}},
	}
	bootDisk := map[string]any{"image": agentSpec.Image}
	if pullPolicy != "" {
		bootDisk["imagePullPolicy"] = pullPolicy
	}
	if ref := agentSpec.ImagePullSecretRef; ref != "" {
		bootDisk["imagePullSecret"] = ref
	} else if len(base.ImagePullSecrets) > 0 {
		bootDisk["imagePullSecret"] = base.ImagePullSecrets[0]
	}
	volumes := []any{
		map[string]any{"name": "boot", "containerDisk": bootDisk},
		map[string]any{"name": "cloudinit", "cloudInitNoCloud": map[string]any{"secretRef": map[string]any{"name": VMCloudInitSecretName(name)}}},
		map[string]any{"name": "scratch", "emptyDisk": map[string]any{"capacity": cfg.VM.ScratchSize}},
	}
	var filesystems []any
	for _, m := range resolveSpecMounts(agentSpec, defaults) {
		if !m.Persist {
			continue
		}
		volName := types.SanitizeMountName(m.Path)
		filesystems = append(filesystems, map[string]any{"name": volName, "virtiofs": map[string]any{}})
		volumes = append(volumes, map[string]any{
			"name":                  volName,
			"persistentVolumeClaim": map[string]any{"claimName": vmWorkspacePVCName(name, volName)},
		})
	}

	devices := map[string]any{
		"disks":      disks,
		"rng":        map[string]any{},
		"interfaces": []any{map[string]any{"name": "default", "masquerade": map[string]any{}}},
	}
	if len(filesystems) > 0 {
		devices["filesystems"] = filesystems
	}

	podSpec := map[string]any{
		"terminationGracePeriodSeconds": base.TerminationGracePeriod,
		"domain": map[string]any{
			"cpu":     map[string]any{"cores": cores},
			"memory":  map[string]any{"guest": mem.String()},
			"devices": devices,
		},
		"networks": []any{map[string]any{"name": "default", "pod": map[string]any{}}},
		"volumes":  volumes,
	}
	if cfg.AgentProbesEnabled {
		podSpec["readinessProbe"] = map[string]any{
			"httpGet":             map[string]any{"path": "/healthz", "port": int64(8080)},
			"initialDelaySeconds": int64(5),
			"periodSeconds":       int64(2),
			"failureThreshold":    int64(3),
		}
	}
	if len(cfg.VM.NodeSelector) > 0 || len(agentSpec.NodeSelector) > 0 {
		sel := map[string]any{}
		for k, v := range cfg.VM.NodeSelector {
			sel[k] = v
		}
		for k, v := range agentSpec.NodeSelector {
			sel[k] = v
		}
		podSpec["nodeSelector"] = sel
	}
	if len(cfg.VM.Tolerations) > 0 {
		tols, err := toUnstructuredSlice(cfg.VM.Tolerations)
		if err != nil {
			return nil, fmt.Errorf("encoding vm tolerations: %w", err)
		}
		podSpec["tolerations"] = tols
	}

	u := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "kubevirt.io/v1",
		"kind":       "VirtualMachine",
		"metadata": map[string]any{
			"name":      name,
			"namespace": cfg.Namespace,
			"labels":    labels,
		},
		"spec": map[string]any{
			"runStrategy": vmRunStrategyHalted,
			"template": map[string]any{
				"metadata": map[string]any{"labels": podLabels},
				"spec":     podSpec,
			},
		},
	}}
	u.SetOwnerReferences([]metav1.OwnerReference{ownerRef})
	return u, nil
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func vmGuestCores(cpu resource.Quantity) int64 {
	cores := int64(math.Ceil(float64(cpu.MilliValue()) / 1000))
	if cores < 1 {
		cores = 1
	}
	return cores
}

func toUnstructuredSlice[T any](in []T) ([]any, error) {
	out := make([]any, len(in))
	for i := range in {
		raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&in[i])
		if err != nil {
			return nil, err
		}
		out[i] = raw
	}
	return out, nil
}
