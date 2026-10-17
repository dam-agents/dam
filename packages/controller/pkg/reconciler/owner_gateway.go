package reconciler

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"slices"
	"strconv"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	ownerGatewayPortBase     = 20000
	ownerGatewaySlots        = 512
	annOwnerGatewaySlot      = "agent-platform.ai/owner-gateway-slot"
	ownerGatewayCredsVolume  = "credentials"
	ownerGatewayConfigBudget = 1 << 20
)

func (r *AgentReconciler) ownerGatewayServes(spec *apiv1.AgentSpec) bool {
	return r.config.VM.Enabled && r.config.VM.Gateway.PerOwner && spec.IsVM()
}

func ownerGatewayProxyPort(slot int) int    { return ownerGatewayPortBase + 2*slot }
func ownerGatewayResolverPort(slot int) int { return ownerGatewayPortBase + 2*slot + 1 }

func ownerGatewayPortRange() (first, last int) {
	return ownerGatewayPortBase, ownerGatewayResolverPort(ownerGatewaySlots - 1)
}

// UNIT_BOUNDARY_DESCRIPTION: a runner whose egress is confined reaches its owner's gateway only on the ports machines use. With an owner gateway those are its agent port range, TCP and UDP, on the owner gateway pod alone, beside the per-agent gateways' ports while both kinds exist.
func admitOwnerGatewayEgress(np *networkingv1.NetworkPolicy, agentNS, owner string) {
	if len(np.Spec.Egress) == 0 {
		return
	}
	tcp, udp := corev1.ProtocolTCP, corev1.ProtocolUDP
	first, last := ownerGatewayPortRange()
	from := intstr.FromInt(first)
	end := int32(last)
	np.Spec.Egress = append(np.Spec.Egress, networkingv1.NetworkPolicyEgressRule{
		To: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": agentNS}},
			PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app.kubernetes.io/component": ownerGatewayComponent, envoyOwnerLabel: owner}},
		}},
		Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &from, EndPort: &end}, {Protocol: &udp, Port: &from, EndPort: &end}},
	})
}

// UNIT_BOUNDARY_DESCRIPTION: each vm Agent of an owner holds one slot on its owner gateway: the proxy port and the resolver port its own Service maps to. The slot is recorded on that Service, which outlives every reconcile, so a controller restart reallocates nothing, and the lowest slot no Service of the owner holds is the next one taken. The caller holds the owner's lock, so two agents never take one slot.
func allocateOwnerGatewaySlot(name string, services []corev1.Service) (int, bool) {
	held := map[int]bool{}
	for _, svc := range services {
		slot, err := strconv.Atoi(svc.Annotations[annOwnerGatewaySlot])
		if err != nil {
			continue
		}
		if svc.Name == GatewayName(name) {
			return slot, true
		}
		held[slot] = true
	}
	for slot := range ownerGatewaySlots {
		if !held[slot] {
			return slot, true
		}
	}
	return 0, false
}

type ownerGatewayMember struct {
	agent     *apiv1.Agent
	secrets   []corev1.Secret
	slot      int
	clusterIP string
	served    bool
}

// UNIT_BOUNDARY_DESCRIPTION: the owner gateway pod. One replica, and a template change surges a new pod before the old one stops, so a roll never leaves the owner's agents without a gateway. Nothing about one agent is in the template: listeners, resolver blocks, credentials and the leaf are files the running pod watches, so a grant, a rotation or an agent added or removed never restarts it. The memory request is fixed for that reason: about 23 MiB with one agent and 5 MiB more per agent (measured with two hosts each, one metered), so the request covers a typical owner and the limit stays unset like the per-agent gateway's.
func buildOwnerGatewayDeployment(owner string, cfg *config.Config, ownerRefs []metav1.OwnerReference) *appsv1.Deployment {
	name := ownerGatewayName(cfg.ReleaseName, owner)
	labels := ownerGatewayLabels(cfg.ReleaseName, owner)
	envoy := envoyContainer(name, cfg, nil, nil)
	envoy.VolumeMounts = []corev1.VolumeMount{
		{Name: envoyBootstrapVolume, MountPath: envoyBootstrapMount, ReadOnly: true},
		{Name: ownerGatewayCredsVolume, MountPath: envoyCredentialsRoot, ReadOnly: true},
		{Name: envoyLeafTLSVolume, MountPath: envoyLeafTLSMount, ReadOnly: true},
	}
	envoy.Resources.Requests[corev1.ResourceMemory] = resource.MustParse("96Mi")
	dns := machineDNSContainer(cfg, "")
	dns.Env = nil
	dns.Ports = nil
	falseVal := false
	grace := gatewayTerminationGracePeriod
	one := int32(1)
	surge, unavailable := intstr.FromInt(1), intstr.FromInt(0)
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: cfg.Namespace, Labels: labels, OwnerReferences: ownerRefs},
		Spec: appsv1.DeploymentSpec{
			Replicas: &one,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{
				"app.kubernetes.io/component": ownerGatewayComponent,
				envoyOwnerLabel:               owner,
			}},
			Strategy: appsv1.DeploymentStrategy{
				Type:          appsv1.RollingUpdateDeploymentStrategyType,
				RollingUpdate: &appsv1.RollingUpdateDeployment{MaxSurge: &surge, MaxUnavailable: &unavailable},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					ServiceAccountName:            name,
					AutomountServiceAccountToken:  &falseVal,
					EnableServiceLinks:            &falseVal,
					TerminationGracePeriodSeconds: &grace,
					Containers:                    []corev1.Container{envoy, dns},
					Volumes: []corev1.Volume{
						{Name: envoyBootstrapVolume, VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: name}}}},
						{Name: ownerGatewayCredsVolume, VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: name + "-credentials"}}},
						{Name: envoyLeafTLSVolume, VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: name + ownerGatewayLeafSuffix}}},
					},
				},
			},
		},
	}
}

func buildOwnerGatewayConfigMap(owner string, cfg *config.Config, rendered ownerGatewayConfig, corefile string, ownerRefs []metav1.OwnerReference) *corev1.ConfigMap {
	data := map[string]string{
		ownerGatewayBootstrap:  rendered.Bootstrap,
		ownerGatewayLDSKey:     rendered.LDS,
		ownerGatewayCDSKey:     rendered.CDS,
		ownerGatewayLeafSDSKey: rendered.LeafSDS,
		machineDNSCorefileKey:  corefile,
	}
	maps.Copy(data, rendered.Lua)
	if cfg.GatewayUpstreamTrustBundle != "" {
		data[envoyUpstreamCAKey] = cfg.GatewayUpstreamTrustBundle
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            ownerGatewayName(cfg.ReleaseName, owner),
			Namespace:       cfg.Namespace,
			Labels:          ownerGatewayLabels(cfg.ReleaseName, owner),
			OwnerReferences: ownerRefs,
		},
		Data: data,
	}
}

func configMapSize(cm *corev1.ConfigMap) int {
	n := 0
	for k, v := range cm.Data {
		n += len(k) + len(v)
	}
	return n
}

// UNIT_BOUNDARY_DESCRIPTION: the owner gateway admits only the owner's own runner, which dials it on each machine's behalf, on the agent port range for TCP and UDP, and the controller on the proxy ports for its readiness probe. The controller is in the ambient mesh, so its probe also arrives on HBONE.
func buildOwnerGatewayIngressPolicy(owner string, cfg *config.Config, ownerRefs []metav1.OwnerReference) *networkingv1.NetworkPolicy {
	tcp, udp := corev1.ProtocolTCP, corev1.ProtocolUDP
	first, last := ownerGatewayPortRange()
	from := intstr.FromInt(first)
	end := int32(last)
	hbone := intstr.FromInt(hbonePort)
	runner := networkingv1.NetworkPolicyPeer{PodSelector: &metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)}}
	controller := networkingv1.NetworkPolicyPeer{
		NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.ReleaseNamespace}},
		PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{
			"app.kubernetes.io/component": "controller",
			"app.kubernetes.io/instance":  cfg.APIServerInstanceLabel,
		}},
	}
	name := ownerGatewayName(cfg.ReleaseName, owner)
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: name + "-ingress", Namespace: cfg.Namespace, Labels: ownerGatewayLabels(cfg.ReleaseName, owner), OwnerReferences: ownerRefs},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"app.kubernetes.io/component": ownerGatewayComponent, envoyOwnerLabel: owner}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
			Ingress: []networkingv1.NetworkPolicyIngressRule{
				{From: []networkingv1.NetworkPolicyPeer{runner}, Ports: []networkingv1.NetworkPolicyPort{
					{Protocol: &tcp, Port: &from, EndPort: &end},
					{Protocol: &udp, Port: &from, EndPort: &end},
				}},
				{From: []networkingv1.NetworkPolicyPeer{controller}, Ports: []networkingv1.NetworkPolicyPort{
					{Protocol: &tcp, Port: &from, EndPort: &end},
					{Protocol: &tcp, Port: &hbone},
				}},
			},
		},
	}
}

func buildOwnerGatewayEgressPolicy(owner string, cfg *config.Config, ownerRefs []metav1.OwnerReference) *networkingv1.NetworkPolicy {
	np := BuildGatewayEgressNetworkPolicy(ownerGatewayName(cfg.ReleaseName, owner), cfg, metav1.OwnerReference{})
	np.Labels = ownerGatewayLabels(cfg.ReleaseName, owner)
	np.OwnerReferences = ownerRefs
	np.Spec.PodSelector = metav1.LabelSelector{MatchLabels: map[string]string{"app.kubernetes.io/component": ownerGatewayComponent, envoyOwnerLabel: owner}}
	return np
}

func (r *AgentReconciler) ownerGatewayServices(ctx context.Context, agents []string) ([]corev1.Service, error) {
	list, err := r.client.CoreV1().Services(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: LabelRole + "=" + RoleGateway})
	if err != nil {
		return nil, fmt.Errorf("listing gateway Services: %w", err)
	}
	var out []corev1.Service
	for _, svc := range list.Items {
		if slices.Contains(agents, svc.Labels[LabelAgent]) {
			out = append(out, svc)
		}
	}
	return out, nil
}

// UNIT_BOUNDARY_DESCRIPTION: renders and applies the owner gateway for every vm Agent of the owner, from an agent's reconcile while it holds the owner's lock. Every agent gets its slot first, recorded on its own gateway Service, so the listeners render on their final ports. The ConfigMap must fit in 1 MiB, the limit of one object; a larger owner is refused here with the reason, and its agents keep their own gateways, until an xDS server in the controller replaces the files.
func (r *AgentReconciler) ensureOwnerGateway(ctx context.Context, owner string) (map[string]ownerGatewayMember, error) {
	refs := r.runnerOwnerRef(ctx)
	items, err := r.ownerAgents(ctx, owner)
	if err != nil {
		return nil, err
	}
	var vmAgents []*apiv1.Agent
	var vmNames []string
	for _, obj := range items {
		agent, err := FromCacheObject[apiv1.Agent](obj)
		if err != nil || !agent.Spec.IsVM() || agent.DeletionTimestamp != nil {
			continue
		}
		vmAgents = append(vmAgents, agent)
		vmNames = append(vmNames, agent.Name)
	}
	services, err := r.ownerGatewayServices(ctx, vmNames)
	if err != nil {
		return nil, err
	}
	byName := map[string]corev1.Service{}
	for _, svc := range services {
		byName[svc.Name] = svc
	}
	members := map[string]ownerGatewayMember{}
	var names []string
	for _, agent := range vmAgents {
		svc, ok := byName[GatewayName(agent.Name)]
		if !ok || svc.Spec.ClusterIP == "" || svc.Spec.ClusterIP == corev1.ClusterIPNone {
			continue
		}
		slot, ok := allocateOwnerGatewaySlot(agent.Name, services)
		if !ok {
			return nil, fmt.Errorf("the owner gateway has no free slot for agent %s (%d slots)", agent.Name, ownerGatewaySlots)
		}
		if svc.Annotations[annOwnerGatewaySlot] != strconv.Itoa(slot) {
			if err := r.recordOwnerGatewaySlot(ctx, svc.Name, slot); err != nil {
				return nil, err
			}
			svc.Annotations = map[string]string{annOwnerGatewaySlot: strconv.Itoa(slot)}
			services = append(services, svc)
		}
		secrets, err := listAgentCredentialSecrets(ctx, r.client, r.config.Namespace, agent.Name, owner, agent.Spec.GrantedSecretIDs, agent.Spec.GrantedConnectionIDs)
		if err != nil {
			return nil, err
		}
		members[agent.Name] = ownerGatewayMember{agent: agent, secrets: secrets, slot: slot, clusterIP: svc.Spec.ClusterIP, served: svc.Annotations[annOwnerGatewayServed] == "true"}
		names = append(names, agent.Name)
	}
	slices.Sort(names)
	var agents []ownerGatewayAgent
	var blocks []ownerResolverBlock
	var granted [][]corev1.Secret
	var leafAgents []ownerLeafAgent
	for _, name := range names {
		m := members[name]
		chains := chainsFromSecrets(m.secrets, m.agent.Spec.L7Hosts)
		for i := range chains {
			chains[i].RequireAddress = m.agent.Spec.RequireConnectionAddress
		}
		agents = append(agents, ownerGatewayAgent{Name: name, AttributionID: m.agent.Spec.TelemetryAttributionID, ProxyPort: ownerGatewayProxyPort(m.slot), Chains: chains})
		blocks = append(blocks, ownerResolverBlock{Port: ownerGatewayResolverPort(m.slot), ClusterIP: m.clusterIP})
		granted = append(granted, m.secrets)
		leafAgents = append(leafAgents, ownerLeafAgent{Secrets: m.secrets, L7Hosts: m.agent.Spec.L7Hosts})
	}
	rendered, err := renderOwnerGateway(agents, r.config)
	if err != nil {
		return nil, err
	}
	cm := buildOwnerGatewayConfigMap(owner, r.config, rendered, ownerResolverCorefile(blocks), refs)
	if size := configMapSize(cm); size > ownerGatewayConfigBudget-4096 {
		return nil, fmt.Errorf("the owner gateway's configuration for %d agents is %d KiB, past the 1 MiB a ConfigMap holds", len(agents), size>>10)
	}
	name := ownerGatewayName(r.config.ReleaseName, owner)
	err = concurrently(
		func() error { return r.applyConfigMap(ctx, cm) },
		func() error {
			_, err := r.applyOwnerCredentialSecret(ctx, buildOwnerCredentialSecret(owner, r.config, granted, refs))
			return err
		},
		func() error {
			return r.applyCertificate(ctx, buildOwnerLeafCertificate(owner, r.config, leafAgents, refs))
		},
		func() error { return r.ensureOwnerGatewayServiceAccount(ctx, owner, refs) },
		func() error {
			return applyNetworkPolicy(ctx, r.client, buildOwnerGatewayIngressPolicy(owner, r.config, refs))
		},
		func() error {
			return applyNetworkPolicy(ctx, r.client, buildOwnerGatewayEgressPolicy(owner, r.config, refs))
		},
	)
	if err != nil {
		return nil, fmt.Errorf("applying the owner gateway's objects: %w", err)
	}
	if err := r.applyOwnerGatewayDeployment(ctx, buildOwnerGatewayDeployment(owner, r.config, refs)); err != nil {
		return nil, fmt.Errorf("applying the owner gateway %s: %w", name, err)
	}
	for agentName, rev := range rendered.Revisions {
		r.ownerGatewayRevisions.Store(agentName, rev)
	}
	r.cutOverToOwnerGateway(ctx, owner, members)
	return members, nil
}

func (r *AgentReconciler) recordOwnerGatewaySlot(ctx context.Context, svcName string, slot int) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		svc, err := r.client.CoreV1().Services(r.config.Namespace).Get(ctx, svcName, metav1.GetOptions{})
		if err != nil {
			return err
		}
		metav1.SetMetaDataAnnotation(&svc.ObjectMeta, annOwnerGatewaySlot, strconv.Itoa(slot))
		_, err = r.client.CoreV1().Services(r.config.Namespace).Update(ctx, svc, metav1.UpdateOptions{})
		return err
	})
}

func (r *AgentReconciler) ensureOwnerGatewayServiceAccount(ctx context.Context, owner string, refs []metav1.OwnerReference) error {
	falseVal := false
	desired := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:            ownerGatewayName(r.config.ReleaseName, owner),
			Namespace:       r.config.Namespace,
			Labels:          ownerGatewayLabels(r.config.ReleaseName, owner),
			OwnerReferences: refs,
		},
		AutomountServiceAccountToken: &falseVal,
	}
	_, err := r.client.CoreV1().ServiceAccounts(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
	if k8serrors.IsAlreadyExists(err) {
		return nil
	}
	return err
}

func (r *AgentReconciler) applyOwnerGatewayDeployment(ctx context.Context, desired *appsv1.Deployment) error {
	cli := r.client.AppsV1().Deployments(desired.Namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
		if k8serrors.IsNotFound(err) {
			_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
			if err == nil {
				slog.Info("owner gateway: created", "deployment", desired.Name)
			}
			return err
		}
		if err != nil {
			return err
		}
		hash := templateHash(desired.Spec.Template, desired.Spec.Strategy)
		if existing.Annotations[annStatefulSetTemplate] == hash {
			return nil
		}
		existing.Spec.Template = desired.Spec.Template
		existing.Spec.Strategy = desired.Spec.Strategy
		existing.Spec.Replicas = desired.Spec.Replicas
		metav1.SetMetaDataAnnotation(&existing.ObjectMeta, annStatefulSetTemplate, hash)
		_, err = cli.Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

// UNIT_BOUNDARY_DESCRIPTION: removes everything an owner gateway is made of, once the owner has no vm Agent left. Its objects all carry the owner gateway's labels and name, so this is one delete each.
func (r *AgentReconciler) deleteOwnerGateway(ctx context.Context, owner string) {
	name, ns := ownerGatewayName(r.config.ReleaseName, owner), r.config.Namespace
	opts := metav1.DeleteOptions{}
	for _, del := range []func() error{
		func() error { return r.client.AppsV1().Deployments(ns).Delete(ctx, name, opts) },
		func() error { return r.client.CoreV1().ConfigMaps(ns).Delete(ctx, name, opts) },
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, name+"-credentials", opts) },
		func() error {
			return r.dynamic.Resource(certificateGVR).Namespace(ns).Delete(ctx, name+ownerGatewayLeafSuffix, opts)
		},
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, name+ownerGatewayLeafSuffix, opts) },
		func() error { return r.client.CoreV1().ServiceAccounts(ns).Delete(ctx, name, opts) },
		func() error { return r.client.NetworkingV1().NetworkPolicies(ns).Delete(ctx, name+"-ingress", opts) },
		func() error {
			return r.client.NetworkingV1().NetworkPolicies(ns).Delete(ctx, name+"-gateway-egress", opts)
		},
	} {
		if err := del(); err != nil && !k8serrors.IsNotFound(err) {
			slog.Warn("removing an owner gateway", "owner", owner, "error", err)
		}
	}
}

const (
	annOwnerGatewayServed = "agent-platform.ai/owner-gateway"
	ownerListenerRecheck  = 2 * time.Second
)

// UNIT_BOUNDARY_DESCRIPTION: the gateway Service of a vm Agent its owner gateway serves: it selects the owner gateway pod and maps each of its ports onto the agent's slot, the proxy, HTTP and TLS ports onto the proxy port and DNS onto the resolver port. Only these ports are declared, and a ClusterIP carries nothing on a port it does not declare (measured on OVN-Kubernetes and k3s), so a guest pinned to its own ClusterIP reaches only its own listener. The Service keeps its ClusterIP, so no machine spec changes. Until the agent is cut over its Service keeps selecting its own gateway pod.
func (r *AgentReconciler) ownerGatewayServiceFor(ctx context.Context, desired *corev1.Service, owner string) (*corev1.Service, error) {
	existing, err := r.client.CoreV1().Services(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return desired, nil
	}
	if err != nil {
		return nil, err
	}
	slot, err := strconv.Atoi(existing.Annotations[annOwnerGatewaySlot])
	if err != nil || existing.Annotations[annOwnerGatewayServed] != "true" {
		return desired, nil
	}
	return retargetedGatewayService(desired, owner, slot), nil
}

func retargetedGatewayService(svc *corev1.Service, owner string, slot int) *corev1.Service {
	out := svc.DeepCopy()
	out.Spec.Selector = map[string]string{"app.kubernetes.io/component": ownerGatewayComponent, envoyOwnerLabel: owner}
	proxy, resolver := intstr.FromInt(ownerGatewayProxyPort(slot)), intstr.FromInt(ownerGatewayResolverPort(slot))
	for i := range out.Spec.Ports {
		if out.Spec.Ports[i].Name == "dns" || out.Spec.Ports[i].Name == "dns-tcp" {
			out.Spec.Ports[i].TargetPort = resolver
		} else {
			out.Spec.Ports[i].TargetPort = proxy
		}
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: an agent's listener is current when its health path answers with the revision rendered for it last. Envoy applies a changed file about a second after the kubelet syncs it, and a file that does not load leaves the last good one running, so a stale or missing listener reads as not current rather than as an outage. The controller probes through the same port the agent's traffic takes.
func (r *AgentReconciler) ownerListenerCurrent(ctx context.Context, agent, host string, port int) (bool, string) {
	want, ok := r.ownerGatewayRevisions.Load(agent)
	if !ok {
		return false, "the owner gateway has not rendered this agent's listener yet"
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://%s/__platform_healthz", net.JoinHostPort(host, strconv.Itoa(port))), nil)
	if err != nil {
		return false, err.Error()
	}
	resp, err := r.ownerGatewayProbe().Do(req)
	if err != nil {
		return false, "the owner gateway does not answer on this agent's listener: " + err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
	if resp.StatusCode != http.StatusOK || string(body) != want.(string) {
		return false, fmt.Sprintf("the owner gateway still serves an older listener for this agent (has %q, want %q)", body, want)
	}
	return true, ""
}

func (r *AgentReconciler) ownerGatewayProbe() *http.Client {
	if r.ownerProbeClient != nil {
		return r.ownerProbeClient
	}
	return &http.Client{Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}}
}

// UNIT_BOUNDARY_DESCRIPTION: an agent moves to its owner gateway only once that pod serves its current listener, probed at the pod's own address because its Service still selects the agent's own gateway pod. The move rewrites only the Service's selector and target ports, keeps its ClusterIP and so changes no machine spec, and is marked on the Service, so every later reconcile renders the moved form. Readiness after the move is probed through the Service.
func (r *AgentReconciler) cutOverToOwnerGateway(ctx context.Context, owner string, members map[string]ownerGatewayMember) {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent + "," + envoyOwnerLabel + "=" + owner})
	if err != nil {
		return
	}
	podIP := ""
	for _, p := range pods.Items {
		if p.DeletionTimestamp == nil && isPodReady(p) && p.Status.PodIP != "" {
			podIP = p.Status.PodIP
		}
	}
	if podIP == "" {
		return
	}
	for name, m := range members {
		if m.served {
			continue
		}
		if ok, _ := r.ownerListenerCurrent(ctx, name, podIP, ownerGatewayProxyPort(m.slot)); !ok {
			continue
		}
		if err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
			svc, err := r.client.CoreV1().Services(r.config.Namespace).Get(ctx, GatewayName(name), metav1.GetOptions{})
			if err != nil {
				return err
			}
			moved := retargetedGatewayService(svc, owner, m.slot)
			metav1.SetMetaDataAnnotation(&moved.ObjectMeta, annOwnerGatewayServed, "true")
			_, err = r.client.CoreV1().Services(r.config.Namespace).Update(ctx, moved, metav1.UpdateOptions{})
			return err
		}); err != nil {
			slog.Warn("owner gateway: moving the agent's Service failed; it keeps its own gateway", "agent", name, "error", err)
			continue
		}
		slog.Info("owner gateway: the agent's Service now selects its owner gateway", "agent", name, "owner", owner, "slot", m.slot)
	}
}
