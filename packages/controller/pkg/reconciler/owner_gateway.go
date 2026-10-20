package reconciler

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	ownerGatewayPortBase     = 20000
	ownerGatewaySlots        = 512
	annOwnerGatewaySlot      = "agent-platform.ai/owner-gateway-slot"
	annOwnerRegenerated      = "agent-platform.ai/owner-gateway-regenerated"
	ownerGatewayFilesVolume  = "gateway-files"
	ownerGatewayDNSVolume    = "gateway-dns"
	ownerGatewayConfigBudget = 1 << 20
	// UNIT_BOUNDARY_DESCRIPTION: an owner gateway that stops cuts every agent's model streams at once. Envoy exits at once on SIGTERM, so the old pod first sleeps in preStop, out of its Services' endpoints and still serving what it holds, while the surged new pod takes every new connection; a stream that ends within the sleep is not cut. The cost is only how long a roll takes, and a stream longer than that is still reset.
	ownerGatewayTerminationGrace int64 = 30
)

func (r *AgentReconciler) ownerGatewayServes(spec *apiv1.AgentSpec) bool {
	return r.config.VM.Enabled && r.config.VM.Gateway.PerOwner && spec.IsVM()
}

func (r *AgentReconciler) ownerGatewayOn(owner string) bool {
	_, refused := r.ownerGatewayRefused.Load(owner)
	return r.config.VM.Enabled && r.config.VM.Gateway.PerOwner && !refused
}

func ownerGatewayProxyPort(slot int) int    { return ownerGatewayPortBase + 2*slot }
func ownerGatewayResolverPort(slot int) int { return ownerGatewayPortBase + 2*slot + 1 }

func ownerGatewayPortRange() (first, last int) {
	return ownerGatewayPortBase, ownerGatewayResolverPort(ownerGatewaySlots - 1)
}

// UNIT_BOUNDARY_DESCRIPTION: a runner reaches its owner's gateway only on the ports machines use. With an owner gateway those are its agent port range, TCP and UDP, on the owner gateway pod alone, beside the per-agent gateways' ports while both kinds exist.
func admitOwnerGatewayEgress(np *networkingv1.NetworkPolicy, agentNS, owner string) {
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

// UNIT_BOUNDARY_DESCRIPTION: the owner gateway pod. One replica, and a template change surges a new pod before the old one stops, so a roll never leaves the owner's agents without a gateway. The surge holds only because the new pod turns ready on Envoy's health listener, which Envoy opens only once its first load of the agents' listener and cluster files is done. Nothing about one agent is in the template: listeners, resolver blocks, credentials and the leaf are files the running pod watches, so a grant, a rotation or an agent added or removed never restarts it. The memory request is fixed for that reason: about 23 MiB with one agent and 5 MiB more per agent (measured with two hosts each, one metered), so the request covers a typical owner and the limit stays unset like the per-agent gateway's.
func buildOwnerGatewayDeployment(owner string, cfg *config.Config, ownerRefs []metav1.OwnerReference) *appsv1.Deployment {
	name := ownerGatewayName(cfg.ReleaseName, owner)
	labels := ownerGatewayLabels(cfg.ReleaseName, owner)
	envoy := envoyContainer(name, cfg, nil, nil)
	envoy.VolumeMounts = []corev1.VolumeMount{
		{Name: ownerGatewayFilesVolume, MountPath: envoyBootstrapMount, ReadOnly: true},
		{Name: envoyLeafTLSVolume, MountPath: envoyLeafTLSMount, ReadOnly: true},
	}
	envoy.Resources.Requests[corev1.ResourceMemory] = resource.MustParse("96Mi")
	envoy.Lifecycle = &corev1.Lifecycle{PreStop: &corev1.LifecycleHandler{Sleep: &corev1.SleepAction{Seconds: ownerGatewayTerminationGrace - 5}}}
	envoy.ReadinessProbe = &corev1.Probe{
		ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: platformGatewayHealthPath, Port: intstr.FromInt(cfg.EnvoyPort)}},
		PeriodSeconds: 1,
	}
	dns := machineDNSContainer(cfg, "")
	dns.Env = nil
	dns.Ports = nil
	dns.VolumeMounts = []corev1.VolumeMount{{Name: ownerGatewayDNSVolume, MountPath: envoyBootstrapMount, ReadOnly: true}}
	falseVal := false
	grace := ownerGatewayTerminationGrace
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
						{Name: ownerGatewayFilesVolume, VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: name}}},
						{Name: ownerGatewayDNSVolume, VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: name, Items: []corev1.KeyToPath{{Key: machineDNSCorefileKey, Path: machineDNSCorefileKey}}}}},
						{Name: envoyLeafTLSVolume, VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: name + ownerGatewayLeafSuffix}}},
					},
				},
			},
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: everything an owner gateway reads from its files, in one Secret mounted as one volume: the bootstrap, the listener, cluster and leaf-SDS files, the Lua bodies, the resolver's Corefile, and the signing credentials and upstream CAs of the connections its agents' chains name. One volume is the point: the kubelet flips a projected volume once, all its keys together, so a file that names a credential and the credential itself become visible at the same moment. Across two volumes Envoy can read the file that names a credential while the other volume still lacks it, and a credentials provider built then never reads its file again, which is the failure this shape removes.
func buildOwnerGatewaySecret(owner string, cfg *config.Config, rendered ownerGatewayConfig, corefile string, granted [][]corev1.Secret, ownerRefs []metav1.OwnerReference) (*corev1.Secret, []string) {
	data := map[string][]byte{
		ownerGatewayBootstrap:  []byte(rendered.Bootstrap),
		ownerGatewayLDSKey:     []byte(rendered.LDS),
		ownerGatewayCDSKey:     []byte(rendered.CDS),
		ownerGatewayLeafSDSKey: []byte(rendered.LeafSDS),
		machineDNSCorefileKey:  []byte(corefile),
	}
	for name, body := range rendered.Lua {
		data[name] = []byte(body)
	}
	if cfg.GatewayUpstreamTrustBundle != "" {
		data[envoyUpstreamCAKey] = []byte(cfg.GatewayUpstreamTrustBundle)
	}
	byName := map[string]corev1.Secret{}
	for _, secrets := range granted {
		for _, s := range secrets {
			if s.Labels[envoyOwnerLabel] != owner || s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
				continue
			}
			byName[s.Name] = s
		}
	}
	names := slices.Sorted(maps.Keys(byName))
	h := sha256.New()
	var keys []string
	for _, name := range names {
		for _, k := range ownerGatewayDataKeys(byName[name]) {
			key := name + "." + k
			data[key] = byName[name].Data[k]
			keys = append(keys, key)
			fmt.Fprintf(h, "%s\n%x\n", key, sha256.Sum256(byName[name].Data[k]))
		}
	}
	slices.Sort(keys)
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            ownerGatewayName(cfg.ReleaseName, owner),
			Namespace:       cfg.Namespace,
			Labels:          ownerGatewayLabels(cfg.ReleaseName, owner),
			Annotations:     map[string]string{annOwnerCredentialsHash: hex.EncodeToString(h.Sum(nil)[:8])},
			OwnerReferences: ownerRefs,
		},
		Type: corev1.SecretTypeOpaque,
		Data: data,
	}, keys
}

func secretSize(secret *corev1.Secret) int {
	n := 0
	for k, v := range secret.Data {
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

// UNIT_BOUNDARY_DESCRIPTION: one render of an owner gateway: the Secret it writes, the credential files that Secret carries, and the agents its leaf certificate names. `revisions` is what each agent's health path will answer, which the probe compares against.
type ownerRender struct {
	files      *corev1.Secret
	keys       []string
	leafAgents []ownerLeafAgent
	revisions  map[string]string
}

// UNIT_BOUNDARY_DESCRIPTION: renders and applies the owner gateway for every vm Agent of the owner, from an agent's reconcile while it holds the owner's lock. Every agent gets its slot first, recorded on its own gateway Service, so the listeners render on their final ports. The Secret holding the files and the credentials must fit in 1 MiB, the limit of one object, and it is one object so that a file and the credential it names reach the pod together; a larger owner is refused, until an xDS server in the controller replaces the files. A refused owner, or one whose flag is off, renders only the agents still on it, so their grants stay current while each moves back to its own gateway, and the owner gateway goes once none is left on it.
func (r *AgentReconciler) ensureOwnerGateway(ctx context.Context, owner string) (map[string]ownerGatewayMember, error) {
	refs := r.runnerOwnerRef(ctx)
	items, err := r.ownerAgents(ctx, owner)
	if err != nil {
		return nil, err
	}
	ownerSecrets, err := listOwnerCredentialSecrets(ctx, r.client, r.config.Namespace, owner)
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
	var names, onIt []string
	for _, agent := range vmAgents {
		svc, ok := byName[GatewayName(agent.Name)]
		if !ok || svc.Spec.ClusterIP == "" || svc.Spec.ClusterIP == corev1.ClusterIPNone {
			continue
		}
		served := svc.Annotations[annOwnerGatewayServed] == "true"
		if !served && !r.config.VM.Gateway.PerOwner {
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
		secrets := filterByGrants(agent.Name, ownerSecrets, agent.Spec.GrantedSecretIDs, agent.Spec.GrantedConnectionIDs)
		members[agent.Name] = ownerGatewayMember{agent: agent, secrets: secrets, slot: slot, clusterIP: svc.Spec.ClusterIP, served: served}
		names = append(names, agent.Name)
		if served {
			onIt = append(onIt, agent.Name)
		}
	}
	slices.Sort(names)
	slices.Sort(onIt)
	r.seedOwnerGatewayOffers(ctx, owner)
	if !r.ownerGatewaySeeded(owner) {
		return nil, fmt.Errorf("the owner gateway's last files could not be read, so which credential files its pod already has is unknown")
	}
	held := make(map[string][]string, len(names))
	for _, name := range names {
		held[name] = memberCredentialKeys(members[name], owner)
	}
	plan := r.ownerGatewayRepairPlan(owner, held, r.clockNow())
	render := func(names []string, credentialRoot string) (ownerRender, error) {
		var out ownerRender
		var agents []ownerGatewayAgent
		var blocks []ownerResolverBlock
		var granted [][]corev1.Secret
		for _, name := range names {
			m := members[name]
			chains := chainsFromSecrets(m.secrets, m.agent.Spec.L7Hosts)
			for i := range chains {
				chains[i].RequireAddress = m.agent.Spec.RequireConnectionAddress
			}
			agents = append(agents, ownerGatewayAgent{Name: name, AttributionID: m.agent.Spec.TelemetryAttributionID, ProxyPort: ownerGatewayProxyPort(m.slot), Chains: chains})
			blocks = append(blocks, ownerResolverBlock{Port: ownerGatewayResolverPort(m.slot), ClusterIP: m.clusterIP})
			granted = append(granted, m.secrets)
			out.leafAgents = append(out.leafAgents, ownerLeafAgent{Secrets: m.secrets, L7Hosts: m.agent.Spec.L7Hosts})
		}
		rendered, err := renderOwnerGatewayAt(agents, r.config, plan, credentialRoot)
		if err != nil {
			return out, err
		}
		out.files, out.keys = buildOwnerGatewaySecret(owner, r.config, rendered, ownerResolverCorefile(blocks), granted, refs)
		out.revisions = rendered.Revisions
		return out, nil
	}
	current, err := render(names, ownerGatewayCredentialRoot)
	if err != nil {
		return nil, err
	}
	for name, after := range plan.due {
		if r.requeue != nil {
			r.requeue(name, max(after, 50*time.Millisecond))
		}
	}
	budget := cmp.Or(r.ownerGatewayBudget, ownerGatewayConfigBudget) - 4096
	if r.config.VM.Gateway.PerOwner {
		if size := secretSize(current.files); size > budget {
			r.ownerGatewayRefused.Store(owner, true)
			slog.Warn("owner gateway: refused, past the 1 MiB one Secret holds; its agents move back to their own gateways", "owner", owner, "agents", len(names), "KiB", size>>10)
			if current, err = render(onIt, ownerGatewayCredentialRoot); err != nil {
				return nil, err
			}
		} else {
			r.ownerGatewayRefused.Delete(owner)
		}
	}
	if len(onIt) == 0 && !r.ownerGatewayOn(owner) {
		r.deleteOwnerGateway(ctx, owner)
		return nil, nil
	}
	if size := secretSize(current.files); size > budget {
		return nil, fmt.Errorf("the owner gateway's configuration for the %d agents still on it is %d KiB, past the 1 MiB one Secret holds; they keep its last configuration until each moves back", len(onIt), size>>10)
	}
	files, leafAgents := current.files, current.leafAgents
	legacy, legacyKeys, err := r.legacyOwnerGatewayRender(ctx, owner, files.Name, onIt, render)
	if err != nil {
		return nil, err
	}
	files.Annotations[annOwnerRegenerated] = plan.regenerated()
	name := ownerGatewayName(r.config.ReleaseName, owner)
	err = concurrently(
		func() error {
			if err := r.applyOwnerGatewayFiles(ctx, files); err != nil {
				return err
			}
			plan.committed()
			r.refreshOwnerGatewayCredentials(ctx, owner, files.Annotations[annOwnerCredentialsHash], names, r.clockNow())
			return r.settleLegacyOwnerGatewayFiles(ctx, files.Name, legacy, legacyKeys)
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
	for agentName, rev := range current.revisions {
		r.ownerGatewayRevisions.Store(agentName, rev)
	}
	if r.ownerGatewayOn(owner) {
		r.cutOverToOwnerGateway(ctx, owner, members)
	}
	return members, nil
}

// UNIT_BOUNDARY_DESCRIPTION: the owner gateway's credential Secret reaches its pods' mounted files the same way an agent's own gateway's does, so each of its pods is synced twice per content hash of that Secret, as an agent's own gateway pod is per revision. The second sync is due a few seconds after the first, so one of the agents it renders comes back for it, since its reconcile renders the owner gateway again. A failure only logs: the periodic sync still delivers the value.
func (r *AgentReconciler) refreshOwnerGatewayCredentials(ctx context.Context, owner, hash string, members []string, now time.Time) {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent + "," + envoyOwnerLabel + "=" + owner})
	if err != nil {
		slog.Warn("owner gateway: listing its pods to refresh credentials failed; the periodic refresh still applies", "owner", owner, "error", err)
		return
	}
	var recheck time.Duration
	for i := range pods.Items {
		if pods.Items[i].DeletionTimestamp != nil {
			continue
		}
		wait, err := r.nudgeCredentialSync(ctx, &pods.Items[i], hash, now)
		if err != nil {
			slog.Warn("owner gateway: asking the kubelet to refresh credentials failed; the periodic refresh still applies", "owner", owner, "pod", pods.Items[i].Name, "error", err)
		}
		recheck = max(recheck, wait)
	}
	if recheck > 0 && len(members) > 0 && r.requeue != nil {
		r.requeue(members[0], recheck)
	}
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

// UNIT_BOUNDARY_DESCRIPTION: a template change of an owner gateway (its Envoy or resolver image, the install's trust settings) restarts egress for every running agent of the owner, and one controller release would restart every owner at the same moment. The surge keeps the old pod serving until the new one is ready, so each roll costs the owner its open connections only; and a changed template waits for a place in the same roll budget runner rolls use — the roll's width (`rollout.maxConcurrent`, or `rollout.maxConcurrentPercent` of the install's gateways) mid-roll at once — under the same lock. A gateway is mid-roll from its update until its Deployment has rolled out. Listener, resolver, credential and leaf changes never touch the template, so they never roll. A Deployment never deadlocks on a pod stuck on a superseded template the way a StatefulSet does, so it needs no forced eviction: the old pod keeps serving and the stuck new one is replaced by the next template change.
func (r *AgentReconciler) applyOwnerGatewayDeployment(ctx context.Context, desired *appsv1.Deployment) error {
	cli := r.client.AppsV1().Deployments(desired.Namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		hash := templateHash(desired.Spec.Template, desired.Spec.Strategy)
		existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
		if k8serrors.IsNotFound(err) {
			metav1.SetMetaDataAnnotation(&desired.ObjectMeta, annStatefulSetTemplate, hash)
			_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
			if err == nil {
				slog.Info("owner gateway: created", "deployment", desired.Name)
			}
			return err
		}
		if err != nil {
			return err
		}
		if existing.Annotations[annStatefulSetTemplate] == hash {
			return r.settleOwnerGatewayRoll(ctx, existing)
		}
		r.runnerRollMu.Lock()
		defer r.runnerRollMu.Unlock()
		rolling, total, err := r.ownerGatewaysMidRoll(ctx)
		if err != nil {
			return err
		}
		limit := runnerRollWidth(r.config.VM.Runner, total)
		// UNIT_BOUNDARY_DESCRIPTION: a gateway already mid-roll takes a corrective template change in the place it holds: a share of a shrunken fleet can be smaller than the number of gateways on it, and counting those would leave each of them stuck behind the others.
		midRoll := slices.Contains(rolling, existing.Name)
		if others := slices.DeleteFunc(rolling, func(n string) bool { return n == existing.Name }); !midRoll && len(others) >= limit {
			slog.Info("owner gateway: the template changed, waiting for other owner gateways to finish rolling", "deployment", existing.Name, "rolling", others)
			return nil
		}
		metav1.SetMetaDataAnnotation(&existing.ObjectMeta, annRunnerRolledAt, time.Now().UTC().Format(time.RFC3339))
		existing.Spec.Template = desired.Spec.Template
		existing.Spec.Strategy = desired.Spec.Strategy
		existing.Spec.Replicas = desired.Spec.Replicas
		metav1.SetMetaDataAnnotation(&existing.ObjectMeta, annStatefulSetTemplate, hash)
		_, err = cli.Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

func (r *AgentReconciler) ownerGatewaysMidRoll(ctx context.Context) (rolling []string, total int, err error) {
	list, err := r.client.AppsV1().Deployments(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent})
	if err != nil {
		return nil, 0, err
	}
	for _, dep := range list.Items {
		if dep.Annotations[annRunnerRolledAt] != "" && !runnerPodRolledOut(&dep) {
			rolling = append(rolling, dep.Name)
		}
	}
	return rolling, len(list.Items), nil
}

func (r *AgentReconciler) settleOwnerGatewayRoll(ctx context.Context, dep *appsv1.Deployment) error {
	if dep.Annotations[annRunnerRolledAt] == "" || !runnerPodRolledOut(dep) {
		return nil
	}
	delete(dep.Annotations, annRunnerRolledAt)
	_, err := r.client.AppsV1().Deployments(dep.Namespace).Update(ctx, dep, metav1.UpdateOptions{})
	return err
}

// UNIT_BOUNDARY_DESCRIPTION: an owner gateway pod that cannot serve — crash-looping, out of memory, an image that does not pull — is the reason every agent of the owner has no gateway, so each agent's GatewayPodReady carries that pod's own account, the warning the UI already shows for a failed gateway pod.
func (r *AgentReconciler) ownerGatewayFailure(ctx context.Context, owner string) (string, string, bool) {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent + "," + envoyOwnerLabel + "=" + owner})
	if err != nil {
		return "", "", false
	}
	for i := range pods.Items {
		if pods.Items[i].DeletionTimestamp == nil && isPodReady(pods.Items[i]) {
			return "", "", false
		}
	}
	for i := range pods.Items {
		if reason, msg, ok := terminationReason(&pods.Items[i]); ok {
			return reason, msg, true
		}
	}
	return "", "", false
}

// UNIT_BOUNDARY_DESCRIPTION: the layout before one volume kept an owner gateway's files in a ConfigMap of its name and its credentials in a Secret beside it, and the pod of that layout mounts both, so they are destroyed with it.
func (r *AgentReconciler) deleteLegacyOwnerGatewayFiles(ctx context.Context, name string) error {
	ns, opts := r.config.Namespace, metav1.DeleteOptions{}
	var errs []error
	for _, del := range []func() error{
		func() error { return r.client.CoreV1().ConfigMaps(ns).Delete(ctx, name, opts) },
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, name+"-credentials", opts) },
	} {
		if err := del(); err != nil && !k8serrors.IsNotFound(err) {
			slog.Warn("owner gateway: removing the files its previous layout kept apart", "gateway", name, "error", err)
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// UNIT_BOUNDARY_DESCRIPTION: an upgraded owner keeps the two objects its old-layout pod mounts until nothing of that layout is left: the Deployment holds that template while a roll waits for its place in the roll budget, and its pod keeps serving until the new pod is ready, so deleting them then leaves a pod that cannot be replaced and a rotation that never reaches it. So while either still names them they are written, and once neither does they are removed. Only a render that read the layout settles it — a render that never rendered it saw nothing to conclude — and the mark that they are gone is set only when both deletes are confirmed, so a delete that failed is tried again later.
func (r *AgentReconciler) settleLegacyOwnerGatewayFiles(ctx context.Context, name string, legacy *ownerRender, legacyKeys []string) error {
	if name == "" || legacy == nil {
		return nil
	}
	if legacy.files == nil {
		// UNIT_BOUNDARY_DESCRIPTION: nothing is left to write, so this render only asks whether the two objects are still there
		return r.deleteLegacyOwnerGatewayFiles(ctx, name)
	}
	if err := r.applyConfigMap(ctx, ownerGatewayLegacyConfigMap(legacy.files, legacyKeys)); err != nil {
		return err
	}
	return r.applyOwnerGatewayFiles(ctx, ownerGatewayLegacyCredentials(legacy.files, legacyKeys))
}

// UNIT_BOUNDARY_DESCRIPTION: what an upgraded owner's previous layout is written with, or nothing when no pod or Deployment of that layout is left to read it: two objects split out of this render, the ConfigMap of files and the Secret of credentials, each at the root that layout mounted. A pod of that layout mounts the credentials in a Secret of their own under the old root, so the files it reads must name that root; a file naming the new one would fail a provider that worked before the upgrade. One read of the Deployment and one of its pods, and a read that fails keeps them, since a pod that still mounts them cannot be replaced if they go.
func (r *AgentReconciler) legacyOwnerGatewayRender(ctx context.Context, owner, name string, legacyNames []string, render func([]string, string) (ownerRender, error)) (*ownerRender, []string, error) {
	if name == "" || !r.legacyOwnerGatewayInUse(ctx, owner, name) {
		// UNIT_BOUNDARY_DESCRIPTION: nothing of the previous layout is left, so this render decides only whether its two objects are still there, and removes them
		return &ownerRender{}, nil, nil
	}
	out, err := render(legacyNames, envoyCredentialsRoot)
	return &out, out.keys, err
}

// UNIT_BOUNDARY_DESCRIPTION: the previous layout's ConfigMap, carrying every file this render wrote except the credentials, which that layout kept in a Secret of its own.
func ownerGatewayLegacyConfigMap(files *corev1.Secret, keys []string) *corev1.ConfigMap {
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: files.Name, Namespace: files.Namespace, Labels: files.Labels, OwnerReferences: files.OwnerReferences},
		Data:       map[string]string{},
	}
	for k, v := range files.Data {
		if !slices.Contains(keys, k) {
			configMap.Data[k] = string(v)
		}
	}
	return configMap
}

// UNIT_BOUNDARY_DESCRIPTION: and its Secret, carrying the credentials that ConfigMap leaves out, with the credential hash the pod watches so a rotation reaches it.
func ownerGatewayLegacyCredentials(files *corev1.Secret, keys []string) *corev1.Secret {
	data := map[string][]byte{}
	for _, k := range keys {
		data[k] = files.Data[k]
	}
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            files.Name + "-credentials",
			Namespace:       files.Namespace,
			Labels:          files.Labels,
			Annotations:     map[string]string{annOwnerCredentialsHash: files.Annotations[annOwnerCredentialsHash]},
			OwnerReferences: files.OwnerReferences,
		},
		Type: corev1.SecretTypeOpaque,
		Data: data,
	}
}

// UNIT_BOUNDARY_DESCRIPTION: whether a pod or a Deployment of this owner still mounts the two objects the previous layout used.
func (r *AgentReconciler) legacyOwnerGatewayInUse(ctx context.Context, owner, name string) bool {
	dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err == nil && mountsLegacyOwnerGatewayFiles(dep.Spec.Template.Spec, name) {
		return true
	}
	if err != nil && !k8serrors.IsNotFound(err) {
		return true
	}
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent + "," + envoyOwnerLabel + "=" + owner})
	if err != nil {
		return true
	}
	for i := range pods.Items {
		if mountsLegacyOwnerGatewayFiles(pods.Items[i].Spec, name) {
			return true
		}
	}
	return false
}

func mountsLegacyOwnerGatewayFiles(spec corev1.PodSpec, name string) bool {
	for _, v := range spec.Volumes {
		if v.ConfigMap != nil && v.ConfigMap.Name == name {
			return true
		}
		if v.Secret != nil && v.Secret.SecretName == name+"-credentials" {
			return true
		}
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: removes everything an owner gateway is made of, once the owner has no vm Agent left. Its objects all carry the owner gateway's labels and name, so this is one delete each.
func (r *AgentReconciler) deleteOwnerGateway(ctx context.Context, owner string) {
	name, ns := ownerGatewayName(r.config.ReleaseName, owner), r.config.Namespace
	r.ownerGatewayOffers.Delete(owner)
	opts := metav1.DeleteOptions{}
	for _, del := range []func() error{
		func() error { return r.client.AppsV1().Deployments(ns).Delete(ctx, name, opts) },
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, name, opts) },
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
	if err := r.deleteLegacyOwnerGatewayFiles(ctx, name); err != nil {
		slog.Warn("removing the files of an owner gateway's previous layout", "gateway", name, "error", err)
	}
}

const (
	annOwnerGatewayServed = "agent-platform.ai/owner-gateway"
	ownerListenerRecheck  = 2 * time.Second
)

// UNIT_BOUNDARY_DESCRIPTION: the gateway Service of a vm Agent its owner gateway serves: it selects the owner gateway pod and maps each of its ports onto the agent's slot, the proxy, HTTP and TLS ports onto the proxy port and DNS onto the resolver port. Only these ports are declared, and a ClusterIP carries nothing on a port it does not declare (measured on OVN-Kubernetes and k3s), so a guest pinned to its own ClusterIP reaches only its own listener. The Service keeps its ClusterIP, so no machine spec changes. Until the agent is cut over its Service keeps selecting its own gateway pod.
// UNIT_BOUNDARY_DESCRIPTION: with the flag turned off, or its owner refused, a moved agent goes back only once its own gateway pod is ready again, so its traffic is never sent to a pod that does not exist: until then its Service keeps the moved form, and the move back clears the mark, which drops the agent from its owner gateway on the owner's next render.
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
	agent := desired.Labels[LabelAgent]
	if !r.ownerGatewayOn(owner) && r.podCurrentAndReady(ctx, desired.Name) {
		if err := r.clearOwnerGatewayMark(ctx, desired.Name); err != nil {
			return nil, err
		}
		slog.Info("owner gateway: the agent's Service selects its own gateway again", "agent", agent, "owner", owner)
		return desired, nil
	}
	return retargetedGatewayService(desired, owner, slot), nil
}

func (r *AgentReconciler) clearOwnerGatewayMark(ctx context.Context, svcName string) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		svc, err := r.client.CoreV1().Services(r.config.Namespace).Get(ctx, svcName, metav1.GetOptions{})
		if err != nil {
			return err
		}
		delete(svc.Annotations, annOwnerGatewayServed)
		delete(svc.Annotations, annOwnerGatewaySlot)
		delete(svc.Annotations, annDesiredUp)
		_, err = r.client.CoreV1().Services(r.config.Namespace).Update(ctx, svc, metav1.UpdateOptions{})
		return err
	})
}

// UNIT_BOUNDARY_DESCRIPTION: whether the agent's Service selects its owner gateway, whatever the flag says: until the agent has moved back, its policies must keep admitting the owner gateway, or the pod its traffic still reaches is refused at the harness and at ext-authz.
func (r *AgentReconciler) onOwnerGateway(ctx context.Context, spec *apiv1.AgentSpec, name string) (bool, error) {
	if !r.config.VM.Enabled || !spec.IsVM() {
		return false, nil
	}
	_, ok, err := r.servedDesiredUp(ctx, name)
	return ok, err
}

// UNIT_BOUNDARY_DESCRIPTION: removes what an agent's own gateway was made of once its owner gateway serves it. The gateway Service and the ext-authz Service stay: the first is the agent's identity, the second is how the api-server knows the agent. The ServiceAccount goes once the agent's policies no longer name it, which they stop doing on the same reconcile.
func (r *AgentReconciler) deleteOwnGateway(ctx context.Context, name string) {
	ns, opts := r.config.Namespace, metav1.DeleteOptions{}
	for _, del := range []func() error{
		func() error { return r.client.AppsV1().StatefulSets(ns).Delete(ctx, GatewayName(name), opts) },
		func() error { return r.client.CoreV1().ConfigMaps(ns).Delete(ctx, EnvoyBootstrapName(name), opts) },
		func() error {
			return r.dynamic.Resource(certificateGVR).Namespace(ns).Delete(ctx, EnvoyLeafSecretName(name), opts)
		},
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, EnvoyLeafSecretName(name), opts) },
		func() error {
			return r.client.NetworkingV1().NetworkPolicies(ns).Delete(ctx, name+"-gateway-ingress", opts)
		},
		func() error {
			return r.client.NetworkingV1().NetworkPolicies(ns).Delete(ctx, name+"-gateway-egress", opts)
		},
		func() error { return r.client.CoreV1().ServiceAccounts(ns).Delete(ctx, name, opts) },
	} {
		if err := del(); err != nil && !k8serrors.IsNotFound(err) {
			slog.Warn("owner gateway: removing the agent's own gateway", "agent", name, "error", err)
		}
	}
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
const (
	// UNIT_BOUNDARY_DESCRIPTION: two things make an owner rewrite its files, and neither is a guess about how long a volume takes to reach the pod. A pod that answers the revision rendered for an agent has proven it read the files, so the owner offers them once more: everything Envoy refused the first time is offered again with the file that names it and the file itself already on disk. A pod that answers an older revision has not read them, so the owner offers them again on a wait that doubles from four seconds, six times, the last about two minutes after the first; that covers the documented fallback of a projected Secret, a kubelet sync period plus its cache delay. Past it the pod keeps the listener it has and a warning names the agent.
	ownerGatewayOfferWait  = 4 * time.Second
	ownerGatewayOfferTries = 6
	// UNIT_BOUNDARY_DESCRIPTION: one owner's files are one object, so one write carries every agent that is owed an offer, whatever their number, and no two writes land closer than this.
	ownerGatewayWritePace = 2 * time.Second
)

// UNIT_BOUNDARY_DESCRIPTION: what an owner owes one agent: the rendering the pod's answer is matched against, whether the files were offered again since the pod read them, when its next offer is due, how many it has had, and whether giving up has been logged. A new rendering of the agent replaces this with a fresh one, so a file that names a new credential is never repaired on an older episode's leftovers.
type ownerGatewayOffer struct {
	revision  string
	reoffered bool
	next      time.Time
	tries     int
	warned    bool
}

// UNIT_BOUNDARY_DESCRIPTION: one owner's offers, its listener generations and the write clock they share. `published` is the set of credential files the Secret it last wrote carries, read back from that Secret so a restart resumes it rather than guessing. `owed` holds, per credential key, the generation one published render was written for, and `renders` the generation each agent's listener was last written with: a key is owed a generation only while some agent has not yet answered a render that carried it, so an unchanged restart resumes the generation it left instead of spending another. `legacy`/`legacyDone` note the two objects of the previous layout until they are off the cluster.
type ownerGatewayOffers struct {
	owner        string
	mu           sync.Mutex
	next         time.Time
	writes       int
	offers       map[string]*ownerGatewayOffer
	published    []string
	publishedSet bool
	arrivals     int
	owed         map[string]int
	renders      map[string]int
	loaded       bool
}

// UNIT_BOUNDARY_DESCRIPTION: the generations an owner's Secret carries, so a restarted controller knows which credential files are already published and which agents have already had their listener recreated for them.
type ownerGatewayGenerations struct {
	Arrivals int            `json:"arrivals,omitempty"`
	Owed     map[string]int `json:"owed,omitempty"`
	Renders  map[string]int `json:"renders,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: one render's decision. `version` is what the files carry: the template's revision plus one count per write this owner has made, so a write always changes the files the pod reads, and a render that owes nothing is byte-identical to the one before it. `due` holds the agents whose next offer is still ahead, and when. `generations` is what each agent's internal listener carries this render, and `credentialed` the agents whose chains name a credential file this render newly carries, which are the only ones a generation may be owed to.
type ownerGatewayRepairPlan struct {
	now          time.Time
	version      string
	due          map[string]time.Duration
	generations  map[string]int
	credentialed map[string]bool
	keys         []string
	published    []string
	pending      map[string]int
	arrivals     int
	wrote        bool
	set          *ownerGatewayOffers
}

// UNIT_BOUNDARY_DESCRIPTION: an owner's state, one per owner for the controller's life.
func (r *AgentReconciler) ownerGatewayOffersFor(owner string) *ownerGatewayOffers {
	v, _ := r.ownerGatewayOffers.LoadOrStore(owner, &ownerGatewayOffers{owner: owner, offers: map[string]*ownerGatewayOffer{}, owed: map[string]int{}, renders: map[string]int{}})
	return v.(*ownerGatewayOffers)
}

// UNIT_BOUNDARY_DESCRIPTION: seeds an owner's state once per controller run from the Secret it wrote last, so a restart resumes the credential files already published and the generations already spent instead of repeating them. The published set is the Secret's own credential keys, not the note beside them: a Secret written before this state existed still says which files its pod was given, which is what tells a new key from one the pod already had. A read that fails is retried on the next render rather than accepted as an empty baseline, since an empty baseline makes every published key look new; only a Secret that is genuinely absent starts empty, because then nothing has been published.
func (r *AgentReconciler) seedOwnerGatewayOffers(ctx context.Context, owner string) {
	set := r.ownerGatewayOffersFor(owner)
	set.mu.Lock()
	defer set.mu.Unlock()
	if set.loaded {
		return
	}
	secret, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, ownerGatewayName(r.config.ReleaseName, owner), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		set.loaded, set.publishedSet = true, true
		return
	}
	if err != nil {
		slog.Warn("owner gateway: reading the files it wrote last failed; retrying before deciding which credentials are new", "owner", owner, "error", err)
		return
	}
	set.loaded, set.publishedSet = true, true
	set.published = ownerGatewayCredentialKeys(secret)
	var state ownerGatewayGenerations
	if json.Unmarshal([]byte(secret.Annotations[annOwnerRegenerated]), &state) == nil {
		set.arrivals = state.Arrivals
		for key, n := range state.Owed {
			set.owed[key] = n
		}
		for name, n := range state.Renders {
			set.renders[name] = n
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: whether this owner's state has been read from the Secret it wrote last. A read that failed leaves it unread, so the render that follows waits rather than treating an unknown set of published credentials as an empty one.
func (r *AgentReconciler) ownerGatewaySeeded(owner string) bool {
	set := r.ownerGatewayOffersFor(owner)
	set.mu.Lock()
	defer set.mu.Unlock()
	return set.publishedSet
}

// UNIT_BOUNDARY_DESCRIPTION: the credential files one member's chains name: the keys its granted Secrets carry that the files project, which are the only ones a generation for that member can be about.
func memberCredentialKeys(m ownerGatewayMember, owner string) []string {
	var keys []string
	seen := map[string]bool{}
	for _, s := range m.secrets {
		if s.Labels[envoyOwnerLabel] != owner || s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
			continue
		}
		for _, k := range ownerGatewayDataKeys(s) {
			if key := s.Name + "." + k; !seen[key] {
				seen[key] = true
				keys = append(keys, key)
			}
		}
	}
	slices.Sort(keys)
	return keys
}

// UNIT_BOUNDARY_DESCRIPTION: the credential files an owner gateway Secret carries, which are the keys its own file names do not account for.
func ownerGatewayCredentialKeys(files *corev1.Secret) []string {
	var keys []string
	for k := range files.Data {
		if !slices.Contains(ownerGatewayFileKeys(files), k) {
			keys = append(keys, k)
		}
	}
	slices.Sort(keys)
	return keys
}

// UNIT_BOUNDARY_DESCRIPTION: the files an owner gateway writes itself, as opposed to the credential files it projects for its agents' chains.
func ownerGatewayFileKeys(files *corev1.Secret) []string {
	keys := []string{ownerGatewayBootstrap, ownerGatewayLDSKey, ownerGatewayCDSKey, ownerGatewayLeafSDSKey, machineDNSCorefileKey, luaSpendMeterKey, luaConnectionAddressKey, luaSigningGuardKey}
	if _, ok := files.Data[envoyUpstreamCAKey]; ok {
		keys = append(keys, envoyUpstreamCAKey)
	}
	return keys
}

// UNIT_BOUNDARY_DESCRIPTION: what an owner owes the agents it serves, decided before any of them is rendered, because the version the files carry is theirs together and a generation has to be inside the render that publishes the file it repairs. `held` is each agent's credential files, the ones its chains name, so the set this render publishes is known before it is built. A key that set carries and the last *published* one did not is an arrival: this render writes it, and no generation is spent on it yet, because the file's pathname reaches the pod in that same flip and a provider built then is the very failure being repaired. The arrival is recorded only when the write succeeds, so a write that failed leaves it for its retry; from then on every agent whose own chains name it, and which answers, is owed that generation on a later render, by which time the pathname is on disk. An agent with no rendering stored yet is still given the generation its listener already carries, so a restart resumes instead of reverting it. An agent the pod has not answered the rendering of is owed the files again on a doubling wait until it does, which is the only evidence that a read it refused is offered again; an agent that answered is owed them once more, so a resource Envoy refused behind a listener it accepted is offered again with its files on disk.
func (r *AgentReconciler) ownerGatewayRepairPlan(owner string, held map[string][]string, now time.Time) *ownerGatewayRepairPlan {
	set := r.ownerGatewayOffersFor(owner)
	set.mu.Lock()
	defer set.mu.Unlock()
	p := &ownerGatewayRepairPlan{now: now, due: map[string]time.Duration{}, generations: map[string]int{}, credentialed: map[string]bool{}, keys: keysOf(held), pending: map[string]int{}, published: set.published, arrivals: set.arrivals, set: set}
	if set.publishedSet {
		for _, key := range p.keys {
			if !slices.Contains(set.published, key) {
				p.pending[key] = set.arrivals + 1
			}
		}
		if len(p.pending) > 0 {
			p.arrivals = set.arrivals + 1
		}
	}
	var owed []string
	served := make(map[string]bool, len(held))
	for name, keys := range held {
		served[name] = true
		p.generations[name] = set.renders[name]
		loaded, _ := r.ownerGatewayRevisions.Load(name)
		revision, _ := loaded.(string)
		if revision == "" {
			continue
		}
		answer, _ := r.ownerGatewayAnswered.Load(name)
		answered, _ := answer.(string)
		offer := set.offers[name]
		if offer == nil || offer.revision != revision {
			offer = &ownerGatewayOffer{revision: revision, next: now}
			set.offers[name] = offer
		}
		if generation := generationFor(keys, set); generation > set.renders[name] {
			p.generations[name], p.credentialed[name] = generation, true
		}
		regenerate := p.credentialed[name] && answered == revision
		switch {
		case answered != revision && offer.tries < ownerGatewayOfferTries && !now.Before(offer.next):
			owed = append(owed, name)
		case answered == revision && !offer.reoffered:
			owed = append(owed, name)
		case regenerate:
			owed = append(owed, name)
		}
	}
	for name := range set.offers {
		if !served[name] {
			delete(set.offers, name)
		}
	}
	if len(owed) == 0 && len(p.pending) == 0 {
		p.version = ownerGatewayVersion(set.writes)
		return p
	}
	if now.Before(set.next) {
		for _, name := range owed {
			p.due[name] = set.next.Sub(now)
		}
		if len(p.pending) > 0 {
			for _, name := range slices.Sorted(maps.Keys(held)) {
				p.due[name] = max(p.due[name], set.next.Sub(now))
			}
		}
		p.version = ownerGatewayVersion(set.writes)
		return p
	}
	set.next = now.Add(ownerGatewayWritePace)
	set.writes++
	p.wrote = true
	for _, name := range owed {
		offer := set.offers[name]
		answer, _ := r.ownerGatewayAnswered.Load(name)
		if answered, _ := answer.(string); answered != offer.revision {
			offer.tries++
			offer.next = now.Add(ownerGatewayOfferWait << (offer.tries - 1))
			if offer.tries < ownerGatewayOfferTries {
				p.due[name] = max(offer.next.Sub(now), set.next.Sub(now))
				continue
			}
			if !offer.warned {
				offer.warned = true
				slog.Warn("owner gateway: its pod has not loaded the files rendered for its agents; it keeps the listener it has", "agent", name, "owner", set.owner, "tries", offer.tries)
			}
			continue
		}
		offer.reoffered = true
	}
	p.version = ownerGatewayVersion(set.writes)
	return p
}

// UNIT_BOUNDARY_DESCRIPTION: the highest generation any of an agent's own *published* credential files carries, 0 when every one of them predates what its listener holds. A file this render is publishing is deliberately not counted: its pathname reaches the pod in that same flip, so a provider built then is the failure this whole mechanism exists to repair, and the generation belongs to a later render.
func generationFor(keys []string, set *ownerGatewayOffers) int {
	generation := 0
	for _, key := range keys {
		generation = max(generation, set.owed[key])
	}
	return generation
}

// UNIT_BOUNDARY_DESCRIPTION: every credential file the given agents' chains name, which is exactly what their render publishes.
func keysOf(held map[string][]string) []string {
	var keys []string
	for _, held := range held {
		for _, key := range held {
			if !slices.Contains(keys, key) {
				keys = append(keys, key)
			}
		}
	}
	slices.Sort(keys)
	return keys
}

// UNIT_BOUNDARY_DESCRIPTION: the generations the Secret records, as this render leaves them: a credential file published for a generation, and the generation each agent's listener carries, so a controller that restarts between this write and its answer neither repeats nor loses it.
func (p *ownerGatewayRepairPlan) regenerated() string {
	if p == nil {
		return ""
	}
	owed := map[string]int{}
	if p.set != nil {
		owed = maps.Clone(p.set.owed)
	}
	if owed == nil {
		owed = map[string]int{}
	}
	for key := range p.pending {
		owed[key] = p.arrivals
	}
	raw, _ := json.Marshal(ownerGatewayGenerations{Arrivals: p.arrivals, Owed: owed, Renders: p.generations})
	return string(raw)
}

// UNIT_BOUNDARY_DESCRIPTION: records what this write leaves the pod with, once the Secret is written: which credential files it now carries, the generation each of the new ones was published for, and the generation each agent's listener was written with. Nothing here is reached by a write that failed.
func (p *ownerGatewayRepairPlan) committed() {
	if p == nil || p.set == nil || !p.wrote {
		return
	}
	p.set.mu.Lock()
	defer p.set.mu.Unlock()
	p.set.published, p.set.publishedSet = p.keys, true
	if len(p.pending) > 0 {
		p.set.arrivals = p.arrivals
		for key := range p.pending {
			p.set.owed[key] = p.arrivals
		}
	}
	for name, generation := range p.generations {
		p.set.renders[name] = generation
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the generation an agent's internal listener carries this render, 0 for the template's.
func (p *ownerGatewayRepairPlan) generation(name string) int {
	if p == nil {
		return 0
	}
	return p.generations[name]
}

// UNIT_BOUNDARY_DESCRIPTION: the version the owner's files carry: the template's revision, and a count of the writes this owner has made, so every write is a file the pod has not read and a render that owes nothing repeats the last one byte for byte.
func ownerGatewayVersion(writes int) string {
	return fmt.Sprintf("%s-repair-%d", ownerGatewayTemplateRev, writes)
}

func (p *ownerGatewayRepairPlan) xdsVersion() string {
	if p == nil {
		return ""
	}
	return p.version
}

func (r *AgentReconciler) ownerListenerCurrent(ctx context.Context, agent, host string, port int) (bool, string) {
	want, ok := r.ownerGatewayRevisions.Load(agent)
	if !ok {
		return false, "the owner gateway has not rendered this agent's listener yet"
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://%s%s", net.JoinHostPort(host, strconv.Itoa(port)), platformGatewayHealthPath), nil)
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
		r.ownerGatewayAnswered.Delete(agent)
		return false, fmt.Sprintf("the owner gateway still serves an older listener for this agent (has %q, want %q)", body, want)
	}
	r.ownerGatewayAnswered.Store(agent, want.(string))
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

const annDesiredUp = "agent-platform.ai/desired-up"

// UNIT_BOUNDARY_DESCRIPTION: whether a vm Agent served by its owner gateway should be up. Its own gateway pod no longer scales with it, so the decision its reconcile and the idle checker make is kept on its gateway Service instead, which lives as long as the agent. ok is false for an agent its owner gateway does not serve, which keeps reading its gateway's replica count.
func desiredUpRecord(svc *corev1.Service) (up, ok bool) {
	if svc == nil || svc.Annotations[annOwnerGatewayServed] != "true" {
		return false, false
	}
	return svc.Annotations[annDesiredUp] == "true", true
}

func recordDesiredUp(ctx context.Context, kube kubernetes.Interface, namespace, name string, up bool) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		svc, err := kube.CoreV1().Services(namespace).Get(ctx, GatewayName(name), metav1.GetOptions{})
		if k8serrors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, served := desiredUpRecord(svc); !served || svc.Annotations[annDesiredUp] == strconv.FormatBool(up) {
			return nil
		}
		svc.Annotations[annDesiredUp] = strconv.FormatBool(up)
		_, err = kube.CoreV1().Services(namespace).Update(ctx, svc, metav1.UpdateOptions{})
		return err
	})
}

func (r *AgentReconciler) servedDesiredUp(ctx context.Context, name string) (up, ok bool, err error) {
	svc, err := r.client.CoreV1().Services(r.config.Namespace).Get(ctx, GatewayName(name), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	up, ok = desiredUpRecord(svc)
	return up, ok, nil
}

// UNIT_BOUNDARY_DESCRIPTION: an owner whose agents all sleep has no reconcile to carry a new owner gateway template, so the rollout sweep offers every existing owner gateway its turn, in name order, under its owner's lock. It only updates a gateway that exists, so it never brings back one the orphan sweep removed. It renders the gateway rather than only its Deployment: a template that mounts a files Secret the old layout never wrote would leave the new pod waiting for one, and an owner whose combined files are past the limit must be refused here too, so its old pod keeps the objects it mounts while its agents move back. With the flag off the same render removes a gateway none is left on, such as one whose last agent was deleted before it moved back.
func (r *AgentReconciler) rollOwnerGateways(ctx context.Context) {
	if !r.agentCacheReady() {
		slog.Info("owner gateway rollout: waiting for the agent cache before rendering, so a half-read owner is not written as an empty one")
		return
	}
	list, err := r.client.AppsV1().Deployments(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent})
	if err != nil {
		slog.Warn("owner gateway rollout: listing owner gateways failed", "error", err)
		return
	}
	slices.SortFunc(list.Items, func(a, b appsv1.Deployment) int { return strings.Compare(a.Name, b.Name) })
	for _, dep := range list.Items {
		owner := dep.Labels[envoyOwnerLabel]
		if owner == "" || dep.DeletionTimestamp != nil {
			continue
		}
		lock := r.ownerLock(owner)
		lock.Lock()
		var err error
		_, err = r.ensureOwnerGateway(ctx, owner)
		lock.Unlock()
		if err != nil {
			slog.Warn("owner gateway rollout: applying an owner gateway failed", "owner", owner, "error", err)
		}
	}
}
