package reconciler

import (
	"cmp"
	"context"
	stderrors "errors"
	"fmt"
	"log/slog"
	"net"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const AgentContainerName = "agent"

// UNIT_BOUNDARY_DESCRIPTION: the agent home, which is the same path on both backends. On the vm backend platform-init, which is Rust and runs inside the guest, bind-mounts the disk here, so the path is stated in the vm runner's contract fixtures and a test here holds this constant to them, because nothing else would notice the two drifting.
const agentHomeDir = "/home/agent"

// UNIT_BOUNDARY_DESCRIPTION: where a container agent sees the node's harness tools, which a DaemonSet installs into a host directory. The default image bakes no tools and names this path as its mise system data dir. No baked image uses the path, so the controller mounts it read-only into every agent pod once the install sets the host directory.
const agentHarnessToolsDir = "/opt/platform/harness-tools"

func portInt32(p int) int32 {
	if p < 0 || p > 65535 {
		panic(fmt.Sprintf("port out of range: %d (must be 0..65535)", p))
	}
	return int32(p)
}

const (
	LabelAgent  = "agent-platform.ai/agent"
	LabelPair   = "agent-platform.ai/pair"
	LabelRole   = "agent-platform.ai/role"
	RoleAgent   = "agent"
	RoleGateway = "gateway"

	LabelMount = "agent-platform.ai/mount"

	LabelPool          = "agent-platform.ai/pool"
	LabelPoolAvailable = "agent-platform.ai/pool-available"
)

const annRollRev = "agent-platform.ai/roll-rev"

func sanitizeMountName(path string) string {
	return strings.ReplaceAll(strings.TrimPrefix(path, "/"), "/", "-")
}

// UNIT_BOUNDARY_DESCRIPTION: an Agent's secretRef names a Secret by name alone, in the namespace that also holds every other owner's credentials, the runners' tokens and the gateways' keys, and every key of it lands in the agent's environment on both backends. So only a Secret carrying the Agent's own owner label is honoured, and never one the platform manages — the credentials a gateway injects and the pull Secrets the api-server writes carry the managed-by label, and a runner's token and certificate its component — because those are meant for everything except the agent. The refusal names the label to add rather than the Secret's contents, so an operator's Secret that predates the rule is one label away from working.
func (r *AgentReconciler) ownedSecretRef(ctx context.Context, agent *apiv1.Agent) (*corev1.Secret, error) {
	name := agent.Spec.SecretRef
	if name == "" {
		return nil, nil
	}
	sec, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("reading secretRef %s: %w", name, err)
	}
	owner := agent.Labels[envoyOwnerLabel]
	if owner == "" || sec.Labels[envoyOwnerLabel] != owner {
		return nil, secretRefRefused(fmt.Sprintf("secretRef %s does not carry this agent's owner label (%s), so its keys are not given to the agent; label the Secret with its owner to use it", name, envoyOwnerLabel))
	}
	if sec.Labels[envoyManagedByLabel] != "" || sec.Labels["app.kubernetes.io/component"] == vmRunnerComponent {
		return nil, secretRefRefused(fmt.Sprintf("secretRef %s is a Secret the platform manages, which is never given to an agent", name))
	}
	return sec, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a secretRef the agent may not have, as against one that could not be read. A refusal is final for the Secret as it stands, so the agent is rendered without it — which also takes it off an agent that already had it — and the reconcile reports it; a read that failed is retried instead.
type secretRefRefused string

func (e secretRefRefused) Error() string { return string(e) }

// UNIT_BOUNDARY_DESCRIPTION: the agent's spec as its workload is rendered: the stored spec, less a secretRef the check refused, and the refusal to report once the rest of the reconcile is done.
func (r *AgentReconciler) renderedSpec(ctx context.Context, agent *apiv1.Agent) (*apiv1.AgentSpec, string, error) {
	_, err := r.ownedSecretRef(ctx, agent)
	var refused secretRefRefused
	switch {
	case stderrors.As(err, &refused):
		spec := agent.Spec
		spec.SecretRef = ""
		return &spec, refused.Error(), nil
	case err != nil:
		return nil, "", err
	}
	return &agent.Spec, "", nil
}

func agentProxyAddr(cfg *config.Config, gatewayClusterIP string) string {
	return fmt.Sprintf("http://%s:%d", gatewayClusterIP, cfg.EnvoyPort)
}

func agentPlatformEnv(name string, cfg *config.Config, agentHome, proxyAddr string) []corev1.EnvVar {
	proxyHost, proxyPort := strings.TrimPrefix(proxyAddr, "http://"), "80"
	if h, p, err := net.SplitHostPort(proxyHost); err == nil {
		proxyHost, proxyPort = h, p
	}
	javaToolOptions := fmt.Sprintf(
		"-Duser.home=%s -Dhttp.proxyHost=%s -Dhttp.proxyPort=%s -Dhttps.proxyHost=%s -Dhttps.proxyPort=%s",
		agentHome, proxyHost, proxyPort, proxyHost, proxyPort,
	)
	return []corev1.EnvVar{
		{Name: "JAVA_TOOL_OPTIONS", Value: javaToolOptions},
		{Name: "HTTPS_PROXY", Value: proxyAddr},
		{Name: "HTTP_PROXY", Value: proxyAddr},
		{Name: "https_proxy", Value: proxyAddr},
		{Name: "http_proxy", Value: proxyAddr},
		{Name: "NODE_EXTRA_CA_CERTS", Value: "/etc/platform/ca/ca.crt"},
		{Name: "NODE_USE_SYSTEM_CA", Value: "1"},
		{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		{Name: "NO_PROXY", Value: "localhost,127.0.0.1,::1"},
		{Name: "no_proxy", Value: "localhost,127.0.0.1,::1"},
		{Name: "PLATFORM_AGENT_ID", Value: name},
		{Name: "API_SERVER_URL", Value: fmt.Sprintf("http://%s:%d", cfg.HarnessHost(), cfg.HarnessServerPort)},
		{Name: "HOME", Value: agentHome},
		{Name: "PLATFORM_MCP_URL", Value: fmt.Sprintf("%s/api/agents/%s/mcp", cfg.HarnessServerURL, name)},
		{Name: "PLATFORM_POD_FILES_EVENTS_URL", Value: fmt.Sprintf("%s/api/agents/%s/pod-files/events", cfg.HarnessServerURL, name)},
	}
}

func BuildAgentStatefulSet(name string, agentSpec *apiv1.AgentSpec, cfg *config.Config, ownerRef metav1.OwnerReference, gatewayClusterIP string) *appsv1.StatefulSet {
	base := cfg.AgentBase
	defaults := cfg.AgentTemplateDefaults

	pullPolicy := agentSpec.ImagePullPolicy
	if pullPolicy == "" {
		pullPolicy = defaults.ImagePullPolicy
	}
	agentHome := agentHomeDir
	specMounts := resolveSpecMounts(agentSpec, defaults)

	replicas := int32(1)

	labels := map[string]string{
		LabelAgent: name,
		LabelPair:  name,
		LabelRole:  RoleAgent,
	}
	podLabels := map[string]string{}
	for k, v := range labels {
		podLabels[k] = v
	}
	podLabels["istio.io/dataplane-mode"] = "none"

	proxyAddr := agentProxyAddr(cfg, gatewayClusterIP)

	env := agentPlatformEnv(name, cfg, agentHome, proxyAddr)

	for _, e := range defaults.Env {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}
	if agentSpec.Harness != "" {
		env = append(env, corev1.EnvVar{Name: "PLATFORM_HARNESS", Value: agentSpec.Harness})
	}

	var envFrom []corev1.EnvFromSource
	if agentSpec.SecretRef != "" {
		envFrom = append(envFrom, corev1.EnvFromSource{
			SecretRef: &corev1.SecretEnvSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: agentSpec.SecretRef},
			},
		})
	}

	var volumes []corev1.Volume
	var volumeMounts []corev1.VolumeMount
	var pvcs []corev1.PersistentVolumeClaim

	for _, m := range specMounts {
		volName := sanitizeMountName(m.Path)
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name: volName, MountPath: m.Path,
		})
		if m.Persist {
			storageSize := effectiveMountSize(m, agentSpec, defaults)
			pvcSpec := corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(storageSize)},
				},
			}
			if sc := cmp.Or(agentSpec.StorageClass, base.StorageClass); sc != "" {
				pvcSpec.StorageClassName = &sc
			}
			pvcs = append(pvcs, corev1.PersistentVolumeClaim{
				ObjectMeta: metav1.ObjectMeta{
					Name:   volName,
					Labels: map[string]string{LabelAgent: name, LabelMount: volName},
				},
				Spec: pvcSpec,
			})
		} else {
			volumes = append(volumes, corev1.Volume{
				Name:         volName,
				VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
			})
		}
	}

	volumes = append(volumes, agentCAVolume(name, cfg))
	volumeMounts = append(volumeMounts, corev1.VolumeMount{
		Name: "ca-cert", MountPath: "/etc/platform/ca", ReadOnly: true,
	})
	if base.ToolsHostPath != "" {
		dir := corev1.HostPathDirectoryOrCreate
		volumes = append(volumes, corev1.Volume{Name: "harness-tools", VolumeSource: corev1.VolumeSource{
			HostPath: &corev1.HostPathVolumeSource{Path: base.ToolsHostPath, Type: &dir},
		}})
		volumeMounts = append(volumeMounts, corev1.VolumeMount{Name: "harness-tools", MountPath: agentHarnessToolsDir, ReadOnly: true})
	}

	resourceReqs := corev1.ResourceRequirements{}
	resourceReqs.Limits = toResourceList(agentSpec.Resources.Limits)
	if defaults.Resources != nil {
		for name, q := range defaults.Resources.Limits {
			if _, set := resourceReqs.Limits[name]; !set {
				resourceReqs.Limits[name] = q
			}
		}
	}
	if len(resourceReqs.Limits) == 0 {
		resourceReqs.Limits = nil
	}
	resourceReqs.Requests = toResourceList(agentSpec.Resources.Requests)
	for _, dim := range []struct {
		name  corev1.ResourceName
		floor resource.Quantity
		milli bool
	}{
		{corev1.ResourceCPU, cfg.RequestsMinCPU, true},
		{corev1.ResourceMemory, cfg.RequestsMinMemory, false},
	} {
		if _, set := resourceReqs.Requests[dim.name]; set {
			continue
		}
		if limit, ok := resourceReqs.Limits[dim.name]; ok {
			resourceReqs.Requests[dim.name] = deriveRequest(limit, cfg.RequestsFraction, dim.floor, dim.milli)
		}
	}
	if len(resourceReqs.Requests) == 0 {
		resourceReqs.Requests = nil
	}

	var initContainers []corev1.Container
	if ic := buildIptablesInitContainer(cfg, gatewayClusterIP); ic != nil {
		initContainers = append(initContainers, *ic)
	}
	if ic := buildNPGateInitContainer(cfg, gatewayClusterIP); ic != nil {
		initContainers = append(initContainers, *ic)
	}

	var pullSecrets []corev1.LocalObjectReference
	if agentSpec.ImagePullSecretRef != "" {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: agentSpec.ImagePullSecretRef})
	}
	for _, n := range base.ImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: n})
	}

	var startupProbe, readinessProbe, livenessProbe *corev1.Probe
	if cfg.AgentProbesEnabled {
		startupProbe = &corev1.Probe{
			ProbeHandler:     corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds:    1,
			FailureThreshold: 120,
		}
		readinessProbe = &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 1,
		}
		livenessProbe = &corev1.Probe{
			ProbeHandler:     corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds:    10,
			TimeoutSeconds:   5,
			FailureThreshold: 12,
		}
	}

	if base.Probes != nil {
		if base.Probes.Startup != nil && startupProbe != nil {
			startupProbe = base.Probes.Startup
		}
		if base.Probes.Readiness != nil && readinessProbe != nil {
			readinessProbe = base.Probes.Readiness
		}
		if base.Probes.Liveness != nil && livenessProbe != nil {
			livenessProbe = base.Probes.Liveness
		}
	}

	containers := []corev1.Container{{
		Name:            AgentContainerName,
		Image:           agentSpec.Image,
		ImagePullPolicy: corev1.PullPolicy(pullPolicy),
		Ports: []corev1.ContainerPort{{
			Name: "acp", ContainerPort: 8080,
		}},
		Env:             env,
		EnvFrom:         envFrom,
		StartupProbe:    startupProbe,
		ReadinessProbe:  readinessProbe,
		LivenessProbe:   livenessProbe,
		SecurityContext: base.ContainerSecurityContext,
		Resources:       resourceReqs,
		VolumeMounts:    volumeMounts,
	}}

	falseVal := false
	automountSAToken := &falseVal
	shareProcessNS := &falseVal
	enableServiceLinks := &falseVal

	podMeta := metav1.ObjectMeta{
		Labels: podLabels,
	}
	applyAgentBaseMeta(&podMeta, base)

	podSpec := corev1.PodSpec{
		ServiceAccountName:            name,
		TerminationGracePeriodSeconds: &base.TerminationGracePeriod,
		ImagePullSecrets:              pullSecrets,
		SecurityContext:               base.PodSecurityContext,
		InitContainers:                initContainers,
		AutomountServiceAccountToken:  automountSAToken,
		ShareProcessNamespace:         shareProcessNS,
		EnableServiceLinks:            enableServiceLinks,
		Containers:                    containers,
		Volumes:                       volumes,
	}
	applyAgentBaseScheduling(&podSpec, base)
	applyTemplateScheduling(&podSpec, agentSpec)

	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       cfg.Namespace,
			Labels:          labels,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:             &replicas,
			ServiceName:          name,
			Selector:             &metav1.LabelSelector{MatchLabels: labels},
			VolumeClaimTemplates: pvcs,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: podMeta,
				Spec:       podSpec,
			},
		},
	}
}

func resolveSpecMounts(agentSpec *apiv1.AgentSpec, defaults config.AgentTemplateDefaults) []apiv1.Mount {
	if len(agentSpec.Mounts) > 0 {
		return agentSpec.Mounts
	}
	var out []apiv1.Mount
	for _, m := range defaults.Mounts {
		out = append(out, apiv1.Mount{Path: m.Path, Persist: m.Persist, Size: m.Size})
	}
	return out
}

func effectiveMountSize(m apiv1.Mount, agentSpec *apiv1.AgentSpec, defaults config.AgentTemplateDefaults) string {
	if m.Size != "" {
		return m.Size
	}
	if agentSpec.StorageSize != "" {
		return agentSpec.StorageSize
	}
	return defaults.StorageSize
}

func applyPoolClaims(ss *appsv1.StatefulSet, claims map[string]string) {
	if len(claims) == 0 {
		return
	}
	kept := ss.Spec.VolumeClaimTemplates[:0]
	for _, vct := range ss.Spec.VolumeClaimTemplates {
		if _, claimed := claims[vct.Name]; claimed {
			continue
		}
		kept = append(kept, vct)
	}
	ss.Spec.VolumeClaimTemplates = kept
	for mountName, pvcName := range claims {
		ss.Spec.Template.Spec.Volumes = append(ss.Spec.Template.Spec.Volumes, corev1.Volume{
			Name: mountName,
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pvcName},
			},
		})
	}
}

func BuildAgentService(name string, cfg *config.Config, ownerRef metav1.OwnerReference) *corev1.Service {
	selector := map[string]string{LabelPair: name, LabelRole: RoleAgent}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: name, LabelPair: name, LabelRole: RoleAgent},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  selector,
			Ports: []corev1.ServicePort{{
				Name: "acp", Port: 8080, TargetPort: intstr.FromInt32(8080),
			}},
		},
	}
}

func toResourceList(m map[string]string) corev1.ResourceList {
	rl := make(corev1.ResourceList)
	for k, v := range m {
		q, err := resource.ParseQuantity(v)
		if err != nil || q.Sign() <= 0 {
			slog.Warn("ignoring invalid resource quantity in agent spec; chart default applies",
				"resource", k, "value", v)
			continue
		}
		rl[corev1.ResourceName(k)] = q
	}
	return rl
}

func deriveRequest(limit resource.Quantity, fraction float64, floor resource.Quantity, milli bool) resource.Quantity {
	var derived resource.Quantity
	if milli {
		derived = *resource.NewMilliQuantity(int64(float64(limit.MilliValue())*fraction), limit.Format)
	} else {
		derived = *resource.NewQuantity(int64(float64(limit.Value())*fraction), limit.Format)
	}
	if derived.Cmp(floor) < 0 {
		derived = floor
	}
	if derived.Cmp(limit) > 0 {
		derived = limit
	}
	return derived
}

const (
	agentTrustedCAsConfigMap = "agent-trusted-cas"
	agentTrustedCAsKey       = "extra-cas.crt"
)

// UNIT_BOUNDARY_DESCRIPTION: what an agent trusts under /etc/platform/ca: its gateway's MITM CA, and the extra CAs the install names, so a host its gateway passes through untouched still verifies when a TLS-inspecting proxy further out intercepts it. Without extra CAs the volume is the leaf Secret alone, exactly as before. The extras come from the one ConfigMap the chart renders from the same value for every agent; the projection is optional, so a pod still starts with its gateway's CA alone if that ConfigMap is missing.
func agentCAVolume(name string, cfg *config.Config) corev1.Volume {
	leaf := corev1.KeyToPath{Key: "ca.crt", Path: "ca.crt"}
	if cfg.ExtraTrustedCAs == "" {
		return corev1.Volume{
			Name: "ca-cert",
			VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{
				SecretName: EnvoyLeafSecretName(name),
				Items:      []corev1.KeyToPath{leaf},
			}},
		}
	}
	return corev1.Volume{
		Name: "ca-cert",
		VolumeSource: corev1.VolumeSource{Projected: &corev1.ProjectedVolumeSource{
			Sources: []corev1.VolumeProjection{
				{Secret: &corev1.SecretProjection{
					LocalObjectReference: corev1.LocalObjectReference{Name: EnvoyLeafSecretName(name)},
					Items:                []corev1.KeyToPath{leaf},
				}},
				{ConfigMap: &corev1.ConfigMapProjection{
					LocalObjectReference: corev1.LocalObjectReference{Name: agentTrustedCAsConfigMap},
					Items:                []corev1.KeyToPath{{Key: agentTrustedCAsKey, Path: agentTrustedCAsKey}},
					Optional:             new(true),
				}},
			},
		}},
	}
}
