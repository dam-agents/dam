package reconciler

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// portInt32 narrows a config-supplied port (typed `int` because it comes
// from `strconv.Atoi` on an env var) to int32 with an explicit upper-bound
// check. Without the check, env-driven int → int32 conversion is flagged
// by CodeQL (`go/incorrect-integer-conversion`) and could wrap on 32-bit
// platforms; here it's a config-bootstrap invariant — port numbers are
// uint16 — so a panic is the right shape if the operator misconfigures.
func portInt32(p int) int32 {
	if p < 0 || p > 65535 {
		panic(fmt.Sprintf("port out of range: %d (must be 0..65535)", p))
	}
	return int32(p)
}

// ADR-038 paired-pod labels. `LabelPair` identifies the two pods of a single
// agent/gateway pair; `LabelRole` distinguishes the roles inside the pair.
//
// Pair scope is *per orchestration unit*, not per instance: long-lived
// instances use the instance name as the pair key, but forks use the fork
// name (each fork has its own paired gateway, the parent's gateway is not
// shared). The `LabelInstance` label still identifies the parent instance
// for ext_authz / pod-IP resolver purposes — for long-lived pods it equals
// the pair key, for fork pods it points at the parent instance so traffic
// resolves under the parent's egress rules (ADR-027).
const (
	LabelInstance = "agent-platform.ai/instance"
	LabelPair     = "agent-platform.ai/pair"
	LabelRole     = "agent-platform.ai/role"
	RoleAgent     = "agent"
	RoleGateway   = "gateway"
)

// agentProxyAddr is the agent's HTTPS_PROXY value: the paired gateway pod's
// Service DNS. Service-form is stable across gateway pod restarts (ADR-038).
func agentProxyAddr(instanceName string, cfg *config.Config) string {
	return fmt.Sprintf("http://%s:%d", GatewayName(instanceName), cfg.EnvoyPort)
}

// BuildAgentStatefulSet renders the agent half of the paired pod set
// (ADR-038). The agent container holds zero credentials; egress credential
// injection happens in the paired gateway pod, reached via HTTPS_PROXY.
//
// `credentialSecrets` is consulted only for the GH_TOKEN-availability signal
// surfaced as an env var and pod annotation; no Secret material is mounted
// into the agent pod.
//
// `gatewayClusterIP` is injected into `hostAliases` when `DisableDNS` is on,
// so `HTTPS_PROXY=http://<pair>-gateway:<port>` resolves without DNS. Empty
// when the controller doesn't have the IP yet — caller is expected to
// fail-closed in that case.
func BuildAgentStatefulSet(name string, instance *types.InstanceSpec, agentSpec *types.AgentSpec, cfg *config.Config, ownerCM *corev1.ConfigMap, credentialSecrets []corev1.Secret, gatewayClusterIP string) *appsv1.StatefulSet {
	base := cfg.AgentBase
	defaults := cfg.AgentTemplateDefaults

	// Layer B fallbacks — template wins when set, else chart-wide default.
	pullPolicy := agentSpec.ImagePullPolicy
	if pullPolicy == "" {
		pullPolicy = defaults.ImagePullPolicy
	}
	agentHome := agentSpec.AgentHome
	if agentHome == "" {
		agentHome = defaults.AgentHome
	}
	specMounts := agentSpec.Mounts
	if len(specMounts) == 0 {
		specMounts = configMountsToTypes(defaults.Mounts)
	}
	specEnv := agentSpec.Env
	if len(specEnv) == 0 {
		specEnv = configEnvToTypes(defaults.Env)
	}

	replicas := int32(1)
	if instance.DesiredState == "hibernated" {
		replicas = 0
	}

	labels := map[string]string{
		LabelInstance: name,
		LabelPair:     name,
		LabelRole:     RoleAgent,
	}
	// Agent pods are deliberately NOT mesh participants. In ambient mode,
	// istio-cni iptables rewrites every outbound to ztunnel:15008 before
	// the kernel NetworkPolicy filter sees the real destination, so a
	// destination-pinned NP cannot enforce "agent → paired gateway only" —
	// it admits any HBONE-bound packet, i.e. any in-mesh destination.
	// Opting the agent out at the pod level removes the ztunnel redirect;
	// the per-pair `<id>-agent-egress` NetworkPolicy then sees real
	// destination IPs and gates them at L3/L4. The agent has no SPIFFE
	// identity in this model; mesh-keyed AuthorizationPolicy on the gateway
	// pod is gone (NP is the gate). The paired gateway pod remains a mesh
	// participant — its SPIFFE principal still gates gateway → harness and
	// gateway → ext-authz hops (ADR-041).
	podLabels := map[string]string{}
	for k, v := range labels {
		podLabels[k] = v
	}
	podLabels["istio.io/dataplane-mode"] = "none"

	caCertPath := "/etc/platform/ca/ca.crt"

	proxyAddr := agentProxyAddr(name, cfg)

	// The agent container holds zero platform credentials. Inbound calls to
	// agent-runtime's tRPC are gated by the api-server's mesh
	// AuthorizationPolicies; ALL outbound calls — external hosts AND the
	// harness API — cross the paired gateway pod.
	//
	// ADR-041: identity for harness traffic comes from the gateway pod's
	// SPIFFE principal (gateway runs as the per-instance SA). When the
	// gateway's Envoy forwards to the harness Service, ztunnel encapsulates
	// the connection with the gateway's principal, and the waypoint
	// enforces principal == URL `:id`. The Envoy bootstrap routes
	// harness traffic without ext_authz HITL gating and without
	// credential-header injection.
	env := []corev1.EnvVar{
		{Name: "HTTPS_PROXY", Value: proxyAddr},
		{Name: "HTTP_PROXY", Value: proxyAddr},
		{Name: "https_proxy", Value: proxyAddr},
		{Name: "http_proxy", Value: proxyAddr},
		{Name: "SSL_CERT_FILE", Value: caCertPath},
		{Name: "NODE_EXTRA_CA_CERTS", Value: caCertPath},
		{Name: "GIT_SSL_CAINFO", Value: caCertPath},
		{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		{Name: "ADK_INSTANCE_ID", Value: name},
		{Name: "API_SERVER_URL", Value: cfg.APIServerURL()},
		{Name: "HOME", Value: agentHome},
		{Name: "PLATFORM_MCP_URL", Value: fmt.Sprintf("%s/api/instances/%s/mcp", cfg.HarnessServerURL, name)},
		// agent-runtime opens this SSE stream and materializes pod-files
		// (gh hosts.yml today; more producers later) directly under HOME.
		// Forks deliberately do NOT receive this env — see fork_resources.go.
		{Name: "PLATFORM_POD_FILES_EVENTS_URL", Value: fmt.Sprintf("%s/api/instances/%s/pod-files/events", cfg.HarnessServerURL, name)},
	}

	// Order matters: K8s resolves duplicate env names by keeping the last
	// occurrence, so credential placeholders < template < instance — user
	// overrides win. The placeholders only need to satisfy the harness's
	// "is this env set?" check; Envoy in the paired gateway overwrites the
	// header on the wire.
	env = append(env, credentialEnvVars(credentialSecrets)...)
	for _, e := range specEnv {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}
	for _, e := range instance.Env {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}

	// EnvFrom secretRef
	var envFrom []corev1.EnvFromSource
	if instance.SecretRef != "" {
		envFrom = append(envFrom, corev1.EnvFromSource{
			SecretRef: &corev1.SecretEnvSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: instance.SecretRef},
			},
		})
	}

	// Volumes + mounts + PVC templates
	var volumes []corev1.Volume
	var volumeMounts []corev1.VolumeMount
	var pvcs []corev1.PersistentVolumeClaim

	for _, m := range specMounts {
		volName := types.SanitizeMountName(m.Path)
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name: volName, MountPath: m.Path,
		})
		if m.Persist {
			// Size precedence: per-mount > AgentSpec.StorageSize > chart default.
			// All three sources are validated upstream (Config.Validate at startup
			// for the chart default, ParseAgentSpec for the spec.yaml values).
			storageSize := m.Size
			if storageSize == "" {
				storageSize = agentSpec.StorageSize
			}
			if storageSize == "" {
				storageSize = defaults.StorageSize
			}
			pvcSpec := corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{corev1.PersistentVolumeAccessMode(base.AccessMode)},
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(storageSize)},
				},
			}
			if base.StorageClass != "" {
				sc := base.StorageClass
				pvcSpec.StorageClassName = &sc
			}
			pvcs = append(pvcs, corev1.PersistentVolumeClaim{
				ObjectMeta: metav1.ObjectMeta{
					Name:   volName,
					Labels: map[string]string{LabelInstance: name},
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

	// CA cert volume — projected from the cert-manager-issued Envoy leaf
	// Secret. We expose only the `ca.crt` key; the `tls.key` stays inside
	// the gateway pod's mount, never the agent's. This is the only
	// platform-issued data the agent pod mounts (ADR-038).
	if len(credentialSecrets) > 0 {
		volumes = append(volumes, corev1.Volume{
			Name: "ca-cert",
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: EnvoyLeafSecretName(name),
					Items: []corev1.KeyToPath{{
						Key:  "ca.crt",
						Path: "ca.crt",
					}},
				},
			},
		})
	} else {
		volumes = append(volumes, corev1.Volume{
			Name:         "ca-cert",
			VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
		})
	}
	volumeMounts = append(volumeMounts, corev1.VolumeMount{
		Name: "ca-cert", MountPath: "/etc/platform/ca", ReadOnly: true,
	})

	// Resources: template wins when set, else chart-wide default.
	resourceReqs := corev1.ResourceRequirements{}
	if agentSpec.Resources.Requests != nil {
		resourceReqs.Requests = toResourceList(agentSpec.Resources.Requests)
	}
	if agentSpec.Resources.Limits != nil {
		resourceReqs.Limits = toResourceList(agentSpec.Resources.Limits)
	}
	if resourceReqs.Requests == nil && resourceReqs.Limits == nil && defaults.Resources != nil {
		resourceReqs = *defaults.Resources
	}

	// Init container: template wins, else chart-wide default.
	initScript := agentSpec.Init
	if initScript == "" {
		initScript = defaults.Init
	}
	var initContainers []corev1.Container
	// Egress-lockdown runs before the user init so the allow-list is in
	// place by the time anything dials the network.
	if ic := buildIptablesInitContainer(cfg, gatewayClusterIP); ic != nil {
		initContainers = append(initContainers, *ic)
	}
	if initScript != "" {
		initContainers = append(initContainers, corev1.Container{
			Name:            "init",
			Image:           agentSpec.Image,
			ImagePullPolicy: corev1.PullPolicy(pullPolicy),
			Command:         []string{"sh", "-c", initScript},
			Env:             []corev1.EnvVar{{Name: "HOME", Value: agentHome}},
			VolumeMounts:    volumeMounts,
		})
	}

	// Image pull secrets — chart-only.
	var pullSecrets []corev1.LocalObjectReference
	for _, n := range base.ImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: n})
	}

	// GH_TOKEN signal. Surface whether a GitHub credential is wired up so
	// wrapper scripts and operators can detect missing auth without making
	// a 401-eliciting request first.
	ghAvail := "false"
	if hasGitHubCredential(credentialSecrets) {
		ghAvail = "true"
	}
	env = append(env, corev1.EnvVar{Name: "PLATFORM_GH_TOKEN_AVAILABLE", Value: ghAvail})

	// Fast (1s) during startup so wake-up is detected quickly, slow
	// (10s) afterwards so we're not probing every agent pod every
	// second forever. FailureThreshold=120 → ~2 min of startup
	// runway, enough for a cold pull of a large agent image.
	var startupProbe, readinessProbe, livenessProbe *corev1.Probe
	if cfg.AgentProbesEnabled {
		startupProbe = &corev1.Probe{
			ProbeHandler:     corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds:    1,
			FailureThreshold: 120,
		}
		readinessProbe = &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 10,
		}
		livenessProbe = &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 10,
		}
	}

	// Probes — chart-level Probes overrides (base.Probes) replace the
	// matching default per-field when the master switch is on.
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
		Name:            "agent",
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

	podAnnotations := map[string]string{
		"agent-platform.ai/gh-token-available": ghAvail,
	}

	// ADR-033 Threat Model: agent must have no SA token (Secret-read RBAC
	// would otherwise bypass the per-pod credential boundary). With the
	// paired-pod split (ADR-038) the agent and gateway are different pods
	// so process-namespace sharing is structurally moot, but we keep
	// `false` explicit for clarity.
	falseVal := false
	automountSAToken := &falseVal
	shareProcessNS := &falseVal

	podMeta := metav1.ObjectMeta{
		Labels:      podLabels,
		Annotations: podAnnotations,
	}
	applyAgentBaseMeta(&podMeta, base)

	var hostAliases []corev1.HostAlias
	if base.DisableDNS && gatewayClusterIP != "" {
		hostAliases = append(hostAliases, buildGatewayHostAlias(name, gatewayClusterIP))
	}

	podSpec := corev1.PodSpec{
		// Agent pod opts out of ambient mesh
		// (`istio.io/dataplane-mode: none` pod label above); it has no
		// SPIFFE workload identity. The per-instance SA still scopes
		// Secret access at the controller level —
		// `automountServiceAccountToken: false` keeps the SA token
		// off-pod (ADR-033 threat model).
		ServiceAccountName:            name,
		TerminationGracePeriodSeconds: &base.TerminationGracePeriod,
		ImagePullSecrets:              pullSecrets,
		SecurityContext:               base.PodSecurityContext,
		InitContainers:                initContainers,
		AutomountServiceAccountToken:  automountSAToken,
		ShareProcessNamespace:         shareProcessNS,
		Containers:                    containers,
		Volumes:                       volumes,
		HostAliases:                   hostAliases,
	}
	applyAgentBaseScheduling(&podSpec, base)

	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: cfg.Namespace,
			Labels:    labels,
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
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

// BuildAgentService is the headless Service the api-server uses to reach the
// agent pod's ACP/tRPC port. Selector pins to the pair key + role=agent so
// the gateway pod (which carries the same instance label) is excluded.
func BuildAgentService(name string, cfg *config.Config, ownerCM *corev1.ConfigMap) *corev1.Service {
	selector := map[string]string{LabelPair: name, LabelRole: RoleAgent}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: cfg.Namespace,
			Labels:    map[string]string{LabelInstance: name, LabelPair: name, LabelRole: RoleAgent},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  selector,
			Ports: []corev1.ServicePort{{
				Name: "acp", Port: 8080, TargetPort: intstr.FromString("acp"),
			}},
		},
	}
}

func toResourceList(m map[string]string) corev1.ResourceList {
	rl := make(corev1.ResourceList)
	for k, v := range m {
		rl[corev1.ResourceName(k)] = resource.MustParse(v)
	}
	return rl
}
