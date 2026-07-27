package reconciler

import (
	"fmt"
	"math"

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

// VirtualMachinesGVR addresses kubevirt.io/v1 VirtualMachines via the dynamic
// client — like cert-manager Certificates, we don't pull in the typed client
// for one resource shape.
var VirtualMachinesGVR = schema.GroupVersionResource{
	Group: "kubevirt.io", Version: "v1", Resource: "virtualmachines",
}

// vmRunStrategyAlways / vmRunStrategyHalted are the two run states the
// controller flips between — the VM-backend equivalent of replicas 1 / 0.
const (
	vmRunStrategyAlways = "Always"
	vmRunStrategyHalted = "Halted"
)

// VMCloudInitSecretName names the per-agent cloud-init Secret the VM boots
// from (NoCloud userdata: platform env file, MITM CA, virtiofs mounts).
func VMCloudInitSecretName(agentName string) string { return agentName + "-vm-cloudinit" }

// vmWorkspacePVCName mirrors the name a StatefulSet volumeClaimTemplate would
// produce (`<mount>-<agent>-0`), so container→vm mental models and any
// name-based tooling stay consistent.
func vmWorkspacePVCName(agentName, volName string) string {
	return fmt.Sprintf("%s-%s-0", volName, agentName)
}

// BuildVMWorkspacePVCs renders the explicit PVCs backing a VM agent's
// persisted mounts — the VM path has no volumeClaimTemplates, so the
// reconciler creates what the StatefulSet controller would have. Same labels
// as template-derived PVCs, so deletion and the orphan sweep apply unchanged;
// deliberately no ownerRef (matching StatefulSet PVC semantics — the
// controller deletes them explicitly on Agent delete).
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
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.PersistentVolumeAccessMode(base.AccessMode)},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(effectiveMountSize(m, agentSpec, defaults))},
			},
		}
		if base.StorageClass != "" {
			sc := base.StorageClass
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

// BuildVMCloudInitSecret renders the NoCloud userdata the guest consumes at
// boot: the platform env block as /etc/platform/env (the VM image's
// agent-runtime unit sources it), the MITM CA at the same path the container
// backend mounts it, and one virtiofs fstab entry per mount. Everything
// user-configurable still rides the runtime channel — this is platform wiring
// only, exactly like pod env on the container backend.
func BuildVMCloudInitSecret(name string, agentSpec *types.AgentSpec, cfg *config.Config, ownerRef metav1.OwnerReference, gatewayClusterIP, caCrt string) (*corev1.Secret, error) {
	defaults := cfg.AgentTemplateDefaults
	agentHome := agentSpec.AgentHome
	if agentHome == "" {
		agentHome = defaults.AgentHome
	}

	envFile := ""
	for _, e := range agentPlatformEnv(name, cfg, agentHome, agentProxyAddr(cfg, gatewayClusterIP)) {
		envFile += e.Name + "=" + e.Value + "\n"
	}
	for _, e := range defaults.Env {
		envFile += e.Name + "=" + e.Value + "\n"
	}

	type cloudFile struct {
		Path        string `json:"path"`
		Permissions string `json:"permissions"`
		Content     string `json:"content"`
	}
	cc := struct {
		WriteFiles []cloudFile `json:"write_files"`
		Mounts     [][]string  `json:"mounts,omitempty"`
	}{
		WriteFiles: []cloudFile{
			{Path: "/etc/platform/env", Permissions: "0644", Content: envFile},
			{Path: "/etc/platform/ca/ca.crt", Permissions: "0644", Content: caCrt},
		},
	}
	for _, m := range resolveSpecMounts(agentSpec, defaults) {
		// virtiofs tag == sanitized mount name (matches the filesystem device
		// on the VM spec). nofail keeps a broken share from wedging boot into
		// emergency mode — agent-runtime just sees an empty dir and fails loud.
		cc.Mounts = append(cc.Mounts, []string{
			types.SanitizeMountName(m.Path), m.Path, "virtiofs", "defaults,nofail", "0", "0",
		})
	}
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

// BuildAgentVirtualMachine renders the VM-backend counterpart of
// BuildAgentStatefulSet: one kubevirt.io/v1 VirtualMachine whose
// virt-launcher pod carries the same labels as an agent pod would — the
// per-pair NetworkPolicies, the agent Service selector, the ambient-mesh
// opt-out, and the pod informer all keep working against the launcher pod
// unchanged. runStrategy is owned by applyVirtualMachine (the replicas
// analogue); the value rendered here is a create-time default only.
//
// Non-persisted mounts, the user init script, and warm-pool claims are
// container-backend concepts and deliberately don't render here.
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
	// Same ambient opt-out as the container backend: the kernel NetworkPolicy
	// on the virt-launcher pod must see real destinations, not HBONE.
	podLabels["istio.io/dataplane-mode"] = "none"

	// Guest sizing: spec limits map 1:1 onto the guest (requests == limits by
	// CRD validation on the vm backend); missing dimensions fall back like the
	// container path so no VM renders unbounded.
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
	cores := int64(math.Ceil(float64(cpu.MilliValue()) / 1000))
	if cores < 1 {
		cores = 1
	}

	disks := []any{
		map[string]any{"name": "boot", "disk": map[string]any{"bus": "virtio"}},
		map[string]any{"name": "cloudinit", "disk": map[string]any{"bus": "virtio"}},
		// Serial "scratch" gives the guest a stable /dev/disk/by-id handle;
		// the VM image's scratch unit formats and mounts it for the
		// docker/k3s image stores (state there dies with hibernation).
		map[string]any{"name": "scratch", "serial": "scratch", "disk": map[string]any{"bus": "virtio"}},
	}
	volumes := []any{
		map[string]any{"name": "boot", "containerDisk": map[string]any{"image": agentSpec.Image, "imagePullPolicy": pullPolicy}},
		map[string]any{"name": "cloudinit", "cloudInitNoCloud": map[string]any{"secretRef": map[string]any{"name": VMCloudInitSecretName(name)}}},
		map[string]any{"name": "scratch", "emptyDisk": map[string]any{"capacity": cfg.VM.ScratchSize}},
	}
	var filesystems []any
	for _, m := range resolveSpecMounts(agentSpec, defaults) {
		if !m.Persist {
			continue // ephemeral mounts have no VM analogue; the guest rootfs overlay covers them
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
		// Kubelet executes the probe against the launcher pod IP; masquerade
		// forwards it to the guest, so ready == agent-runtime healthy — which
		// also gates the headless Service endpoint the api-server dials.
		podSpec["readinessProbe"] = map[string]any{
			"httpGet":             map[string]any{"path": "/healthz", "port": 8080},
			"initialDelaySeconds": 5,
			"periodSeconds":       2,
			"failureThreshold":    3,
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

// toUnstructuredSlice JSON-shapes a typed slice for embedding in an
// unstructured object.
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
