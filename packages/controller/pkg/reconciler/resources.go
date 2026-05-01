package reconciler

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

func BuildStatefulSet(name string, instance *types.InstanceSpec, agentSpec *types.AgentSpec, cfg *config.Config, agentName string, ownerCM *corev1.ConfigMap, connectorEnvs []corev1.EnvVar, credentialSecrets []corev1.Secret) *appsv1.StatefulSet {
	replicas := int32(1)
	if instance.DesiredState == "hibernated" {
		replicas = 0
	}

	labels := map[string]string{"humr.ai/instance": name}
	caCertPath := "/etc/humr/ca/ca.crt"

	// Egress proxy address: OneCLI gateway by default, Envoy sidecar on
	// localhost when the experimental credential injector is enabled.
	var proxyAddr string
	if instance.ExperimentalCredentialInjector {
		proxyAddr = fmt.Sprintf("http://127.0.0.1:%d", cfg.EnvoyPort)
	} else {
		// $(ONECLI_ACCESS_TOKEN) is interpolated by K8s at pod start from the
		// agent token Secret. OneCLI accepts the token as the password.
		proxyAddr = fmt.Sprintf("http://x:$(ONECLI_ACCESS_TOKEN)@%s:%d", cfg.GatewayFQDN(), cfg.GatewayPort)
	}

	// Base env. ONECLI_ACCESS_TOKEN is omitted on the experimental path —
	// the sidecar reads credentials from disk; the agent has no token at all.
	env := []corev1.EnvVar{}
	if !instance.ExperimentalCredentialInjector {
		tokenSecretName := AgentTokenSecretName(agentName)
		env = append(env, corev1.EnvVar{Name: "ONECLI_ACCESS_TOKEN", ValueFrom: &corev1.EnvVarSource{
			SecretKeyRef: &corev1.SecretKeySelector{
				LocalObjectReference: corev1.LocalObjectReference{Name: tokenSecretName},
				Key:                  "access-token",
			},
		}})
	}
	env = append(env,
		corev1.EnvVar{Name: "HTTPS_PROXY", Value: proxyAddr},
		corev1.EnvVar{Name: "HTTP_PROXY", Value: proxyAddr},
		corev1.EnvVar{Name: "https_proxy", Value: proxyAddr},
		corev1.EnvVar{Name: "http_proxy", Value: proxyAddr},
		corev1.EnvVar{Name: "NO_PROXY", Value: cfg.APIServerHost},
		corev1.EnvVar{Name: "no_proxy", Value: cfg.APIServerHost},
		corev1.EnvVar{Name: "SSL_CERT_FILE", Value: caCertPath},
		corev1.EnvVar{Name: "NODE_EXTRA_CA_CERTS", Value: caCertPath},
		corev1.EnvVar{Name: "GIT_SSL_CAINFO", Value: caCertPath},
		corev1.EnvVar{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		corev1.EnvVar{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		corev1.EnvVar{Name: "ADK_INSTANCE_ID", Value: name},
		corev1.EnvVar{Name: "API_SERVER_URL", Value: cfg.APIServerURL()},
		corev1.EnvVar{Name: "HOME", Value: cfg.AgentHome},
		corev1.EnvVar{Name: "HUMR_MCP_URL", Value: fmt.Sprintf("%s/api/instances/%s/mcp", cfg.HarnessServerURL, name)},
		// agent-runtime opens this SSE stream and materializes pod-files
		// (gh hosts.yml today; more producers later) directly under HOME.
		// Forks deliberately do NOT receive this env — see fork_resources.go.
		corev1.EnvVar{Name: "HUMR_POD_FILES_EVENTS_URL", Value: fmt.Sprintf("%s/api/instances/%s/pod-files/events", cfg.HarnessServerURL, name)},
	)

	// Order matters: K8s resolves duplicate env names by keeping the last
	// occurrence, so connector < template < instance — user overrides win.
	env = append(env, connectorEnvs...)
	for _, e := range agentSpec.Env {
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

	for _, m := range agentSpec.Mounts {
		volName := types.SanitizeMountName(m.Path)
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name: volName, MountPath: m.Path,
		})
		if m.Persist {
			// Per-mount `size:` (issue #244) wins over the cluster-wide
			// AgentStorageSize default; both fall back to 10Gi.
			// Validation happens in ParseAgentSpec, so MustParse here is safe.
			storageSize := m.Size
			if storageSize == "" {
				storageSize = cfg.AgentStorageSize
			}
			if storageSize == "" {
				storageSize = "10Gi"
			}
			pvcSpec := corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany},
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceStorage: resource.MustParse(storageSize),
					},
				},
			}
			if cfg.AgentStorageClass != "" {
				sc := cfg.AgentStorageClass
				pvcSpec.StorageClassName = &sc
			}
			pvcs = append(pvcs, corev1.PersistentVolumeClaim{
				ObjectMeta: metav1.ObjectMeta{
					Name:   volName,
					Labels: labels,
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

	// CA cert volume.
	// - OneCLI path: emptyDir, populated by an init container that fetches the
	//   self-signed CA from OneCLI's gateway.
	// - Experimental Envoy path: projected from the cert-manager-issued leaf
	//   Secret. We expose only the `ca.crt` key — the `tls.key` stays inside
	//   the Envoy sidecar's mount, never the agent's.
	if instance.ExperimentalCredentialInjector && len(credentialSecrets) > 0 {
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
		Name: "ca-cert", MountPath: "/etc/humr/ca", ReadOnly: true,
	})

	// Resources
	resourceReqs := corev1.ResourceRequirements{}
	if agentSpec.Resources.Requests != nil {
		resourceReqs.Requests = toResourceList(agentSpec.Resources.Requests)
	}
	if agentSpec.Resources.Limits != nil {
		resourceReqs.Limits = toResourceList(agentSpec.Resources.Limits)
	}

	// Init containers: CA cert fetch (platform) + optional user init.
	//
	// The CA init container fetches OneCLI's MITM CA from its web API. On the
	// experimental Envoy path the CA comes from a projected Secret (see above)
	// and OneCLI is unreachable anyway (NetworkPolicy), so the init is skipped.
	var initContainers []corev1.Container
	if !instance.ExperimentalCredentialInjector {
		caCertScript := fmt.Sprintf(
			`until wget -qO /etc/humr/ca/ca.crt "%s/api/gateway/ca" 2>/dev/null; do sleep 2; done`,
			cfg.WebURL())
		initContainers = append(initContainers, corev1.Container{
			Name:            "fetch-ca-cert",
			Image:           cfg.CACertInitImage,
			ImagePullPolicy: corev1.PullIfNotPresent,
			Command:         []string{"sh", "-c", caCertScript},
			VolumeMounts: []corev1.VolumeMount{{
				Name: "ca-cert", MountPath: "/etc/humr/ca",
			}},
		})
	}
	if agentSpec.Init != "" {
		initContainers = append(initContainers, corev1.Container{
			Name:            "init",
			Image:           agentSpec.Image,
			ImagePullPolicy: corev1.PullPolicy(cfg.AgentImagePullPolicy),
			Command:         []string{"sh", "-c", agentSpec.Init},
			VolumeMounts:    volumeMounts,
		})
	}

	// Image pull secrets
	var pullSecrets []corev1.LocalObjectReference
	for _, name := range cfg.AgentImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: name})
	}

	// Pod security context
	var podSec *corev1.PodSecurityContext
	if agentSpec.SecurityContext != nil {
		podSec = &corev1.PodSecurityContext{
			RunAsNonRoot: agentSpec.SecurityContext.RunAsNonRoot,
		}
	}

	// Experimental: pod-level wiring for the Envoy credential-injector sidecar.
	containers := []corev1.Container{{
		Name:            "agent",
		Image:           agentSpec.Image,
		ImagePullPolicy: corev1.PullPolicy(cfg.AgentImagePullPolicy),
		Ports: []corev1.ContainerPort{{
			Name: "acp", ContainerPort: 8080,
		}},
		Env:     env,
		EnvFrom: envFrom,
		// Fast (1s) during startup so wake-up is detected quickly, slow
		// (10s) afterwards so we're not probing every agent pod every
		// second forever. FailureThreshold=120 → ~2 min of startup
		// runway, enough for a cold pull of a large agent image.
		StartupProbe: &corev1.Probe{
			ProbeHandler:     corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds:    1,
			FailureThreshold: 120,
		},
		ReadinessProbe: &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 10,
		},
		LivenessProbe: &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 10,
		},
		SecurityContext: &corev1.SecurityContext{
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
			},
		},
		Resources:    resourceReqs,
		VolumeMounts: volumeMounts,
	}}
	var automountSAToken *bool
	var shareProcessNS *bool
	podAnnotations := map[string]string{}
	for k, v := range cfg.AgentPodAnnotations {
		podAnnotations[k] = v
	}
	if instance.ExperimentalCredentialInjector {
		// Sidecar only — the agent container never sees credential mounts.
		volumes = append(volumes, envoySidecarVolumes(name, credentialSecrets)...)
		containers = append(containers, envoySidecarContainer(cfg, credentialSecrets))
		// ADR-033 Threat Model: agent must have no SA token (Secret-read RBAC
		// would otherwise bypass volume-mount scoping) and process namespace
		// must not be shared with the sidecar.
		falseVal := false
		automountSAToken = &falseVal
		shareProcessNS = &falseVal

		// GH_TOKEN signal. The OneCLI sentinel doesn't apply here, so tooling
		// inside the agent has no way to know whether GitHub auth is wired up
		// other than to make a request and observe a 401. Surface the state
		// explicitly so wrapper scripts (and any GH_TOKEN-aware tool that
		// learns about it) can short-circuit with a meaningful error, and so
		// operators can see it via `kubectl get pod -o yaml` annotations.
		ghAvail := "false"
		if hasGitHubCredential(credentialSecrets) {
			ghAvail = "true"
		}
		containers[0].Env = append(containers[0].Env, corev1.EnvVar{
			Name:  "HUMR_GH_TOKEN_AVAILABLE",
			Value: ghAvail,
		})
		podAnnotations["humr.ai/gh-token-available"] = ghAvail

		// Roll trigger (DRAFT-unified-hitl-ux #10): hash of the Secret set
		// driving the Envoy bootstrap. When the api-server adds an
		// allow-only Secret to promote a host onto L7, the hash changes,
		// the pod template diverges, and the StatefulSet rolls so Envoy
		// picks up the new chain set + leaf cert. Without this, Secret
		// list changes regenerate the bootstrap CM but don't restart the
		// pod, and Envoy keeps serving the old config.
		podAnnotations["humr.ai/envoy-secrets-rev"] = envoySecretsRev(credentialSecrets)
	}

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
				ObjectMeta: metav1.ObjectMeta{
					Labels:      labels,
					Annotations: podAnnotations,
				},
				Spec: corev1.PodSpec{
					TerminationGracePeriodSeconds: &cfg.TerminationGracePeriod,
					ImagePullSecrets:              pullSecrets,
					SecurityContext:               podSec,
					InitContainers:                initContainers,
					AutomountServiceAccountToken:  automountSAToken,
					ShareProcessNamespace:         shareProcessNS,
					Containers:                    containers,
					Volumes:                       volumes,
				},
			},
		},
	}
}

func BuildService(name string, cfg *config.Config, ownerCM *corev1.ConfigMap) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: cfg.Namespace,
			Labels:    map[string]string{"humr.ai/instance": name},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  map[string]string{"humr.ai/instance": name},
			Ports: []corev1.ServicePort{{
				Name: "acp", Port: 8080, TargetPort: intstr.FromString("acp"),
			}},
		},
	}
}

func BuildNetworkPolicy(name string, cfg *config.Config, ownerCM *corev1.ConfigMap, instance *types.InstanceSpec) *networkingv1.NetworkPolicy {
	tcp := corev1.ProtocolTCP
	udp := corev1.ProtocolUDP
	acpPort := intstr.FromInt32(8080)
	gwPort := intstr.FromInt32(int32(cfg.GatewayPort))
	webPort := intstr.FromInt32(int32(cfg.WebPort))
	harnessPort := intstr.FromInt32(int32(cfg.HarnessServerPort))
	extAuthzPort := intstr.FromInt32(int32(cfg.ExtAuthzPort))
	httpsPort := intstr.FromInt32(443)
	httpPort := intstr.FromInt32(80)
	dnsPort := intstr.FromInt32(53)
	dnsTargetPort := intstr.FromInt32(5353)

	egress := []networkingv1.NetworkPolicyEgressRule{}
	if instance.ExperimentalCredentialInjector {
		// Sidecar reaches arbitrary upstreams. ADR-033 §Decision keeps the
		// first-cut allowlist permissive (no DNS allowlist in v1) — refinement
		// is a follow-up.
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{
			Ports: []networkingv1.NetworkPolicyPort{
				{Protocol: &tcp, Port: &httpsPort},
				{Protocol: &tcp, Port: &httpPort},
			},
		})
		// HITL ext_authz gate (DRAFT-unified-hitl-ux). Envoy in this same
		// pod calls the API server's ext_authz endpoint on every credentialed
		// request. `failure_mode_allow: false` means a blocked call here
		// fails closed — i.e. agent gets 403 with no inbox prompt. So this
		// rule is required wherever the credential-injector path is enabled.
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{
			To: []networkingv1.NetworkPolicyPeer{{
				PodSelector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"app.kubernetes.io/component": "apiserver"},
				},
				NamespaceSelector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.ReleaseNamespace},
				},
			}},
			Ports: []networkingv1.NetworkPolicyPort{
				{Protocol: &tcp, Port: &extAuthzPort},
			},
		})
	} else {
		// OneCLI (cross-namespace: runs in the release namespace)
		// Gateway port for HTTPS proxy, web port for container-config (CA cert fetch)
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{
			To: []networkingv1.NetworkPolicyPeer{{
				PodSelector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"app.kubernetes.io/component": "onecli"},
				},
				NamespaceSelector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.ReleaseNamespace},
				},
			}},
			Ports: []networkingv1.NetworkPolicyPort{
				{Protocol: &tcp, Port: &gwPort},
				{Protocol: &tcp, Port: &webPort},
			},
		})
	}
	egress = append(egress,
		networkingv1.NetworkPolicyEgressRule{
			// Harness API server: separate port exposing only the subset of
			// API available to agent harnesses (triggers, MCP tools).
			To: []networkingv1.NetworkPolicyPeer{{
				PodSelector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"app.kubernetes.io/component": "apiserver"},
				},
				NamespaceSelector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.ReleaseNamespace},
				},
			}},
			Ports: []networkingv1.NetworkPolicyPort{
				{Protocol: &tcp, Port: &harnessPort},
			},
		},
		networkingv1.NetworkPolicyEgressRule{
			// DNS — allow both port 53 (service port) and 5353 (target port).
			// OVN-Kubernetes evaluates egress policy after DNAT, so the policy
			// sees the post-DNAT target port. OpenShift DNS pods run CoreDNS
			// on 5353 behind a Service that maps 53→5353.
			Ports: []networkingv1.NetworkPolicyPort{
				{Protocol: &tcp, Port: &dnsPort},
				{Protocol: &udp, Port: &dnsPort},
				{Protocol: &tcp, Port: &dnsTargetPort},
				{Protocol: &udp, Port: &dnsTargetPort},
			},
		},
	)

	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name + "-egress",
			Namespace: cfg.Namespace,
			Labels:    map[string]string{"humr.ai/instance": name},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{"humr.ai/instance": name},
			},
			PolicyTypes: []networkingv1.PolicyType{
				networkingv1.PolicyTypeEgress,
				networkingv1.PolicyTypeIngress,
			},
			Egress: egress,
			Ingress: []networkingv1.NetworkPolicyIngressRule{{
				Ports: []networkingv1.NetworkPolicyPort{{
					Protocol: &tcp, Port: &acpPort,
				}},
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
