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
	render := func(names []string, credentialRoot string, plan *ownerGatewayRepairPlan) (ownerRender, error) {
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
	// UNIT_BOUNDARY_DESCRIPTION: the answer a repair waits on is taken here, before the render that would act on it, and only from the pod that is serving now: a rollout leaves a second pod that may have mounted before the arrival and would receive the arrival and its repair in one flip, so a repair waits until exactly one pod is left and that pod answers the revision that encodes the arrival. The receipts are this plan's own input; nothing a previous readiness probe saw is consulted, so a probe that could not be made leaves the debt owed.
	receipts := map[string]string{}
	if owing := r.ownerGatewayOwesRepair(owner, held, names); len(owing) > 0 {
		receipts = r.probeOwnerGatewayForRepair(ctx, owner, members, owing)
	}
	// UNIT_BOUNDARY_DESCRIPTION: the plan is built from the membership the owner keeps, never from a wider render it may refuse, so a discarded render cannot record a credential as published.
	planFor := func(names []string) *ownerGatewayRepairPlan {
		plan := r.ownerGatewayRepairPlan(owner, memberKeys(held, names), credentialKeysFor(held, names), receipts, r.clockNow())
		for name, after := range plan.due {
			if r.requeue != nil {
				r.requeue(name, max(after, 50*time.Millisecond))
			}
		}
		return plan
	}
	plan := planFor(names)
	current, err := render(names, ownerGatewayCredentialRoot, plan)
	if err != nil {
		return nil, err
	}
	budget := cmp.Or(r.ownerGatewayBudget, ownerGatewayConfigBudget) - 4096
	if r.config.VM.Gateway.PerOwner {
		if size := secretSize(current.files); size > budget {
			r.ownerGatewayRefused.Store(owner, true)
			slog.Warn("owner gateway: refused, past the 1 MiB one Secret holds; its agents move back to their own gateways", "owner", owner, "agents", len(names), "KiB", size>>10)
			plan = planFor(onIt)
			if current, err = render(onIt, ownerGatewayCredentialRoot, plan); err != nil {
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
	legacy, legacyKeys, err := r.legacyOwnerGatewayRender(ctx, owner, files.Name, onIt, func(names []string, root string) (ownerRender, error) {
		return render(names, root, plan)
	})
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
			// UNIT_BOUNDARY_DESCRIPTION: what was applied is the new truth, adopted before anything else can fail: the Secret is the file the pod reads, so a later ServiceAccount or cleanup failure must not make this publication unrecorded. The revision goes in first, because the answer a repair is gated on is only ever recorded against the revision the owner has published.
			for agentName, rev := range current.revisions {
				r.ownerGatewayRevisions.Store(agentName, rev)
				r.ownerGatewayEpochs.Store(agentName, plan.arrivedOf(agentName))
			}
			plan.adopt(r.ownerGatewayOffersFor(owner), files)
			r.refreshOwnerGatewayCredentials(ctx, owner, files.Annotations[annOwnerCredentialsHash], names, r.clockNow())
			return r.settleLegacyOwnerGatewayFiles(ctx, files.Name, legacy, legacyKeys, onIt)
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
func (r *AgentReconciler) settleLegacyOwnerGatewayFiles(ctx context.Context, name string, legacy *ownerRender, legacyKeys, members []string) error {
	if name == "" || legacy == nil {
		return nil
	}
	if legacy.files == nil {
		// UNIT_BOUNDARY_DESCRIPTION: nothing is left to write, so this render only asks whether the two objects are still there
		if err := r.deleteLegacyOwnerGatewayFiles(ctx, name); err != nil {
			return err
		}
		r.forgetLegacyOwnerGatewayRevisions(members, nil)
		return nil
	}
	if err := r.applyConfigMap(ctx, ownerGatewayLegacyConfigMap(legacy.files, legacyKeys)); err != nil {
		return err
	}
	if err := r.applyOwnerGatewayFiles(ctx, ownerGatewayLegacyCredentials(legacy.files, legacyKeys)); err != nil {
		return err
	}
	r.forgetLegacyOwnerGatewayRevisions(members, legacy.revisions)
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: the health revisions the layout just applied answers for, registered so a live pod on it reads as ready. A pod of that layout hashes its resources against the old credential root, so its answer is a different string from the canonical one; the two layouts publish separately and a canonical write proves nothing about a legacy pod's credential volume, which is why this only ever answers readiness and never a repair. Only this owner's members are touched: an owner without a legacy layout retires its own registrations and leaves every other owner's alone, since another owner's old pod may still be the one serving.
func (r *AgentReconciler) forgetLegacyOwnerGatewayRevisions(members []string, revisions map[string]string) {
	for _, name := range members {
		if _, ok := revisions[name]; !ok {
			r.ownerGatewayLegacyRevisions.Delete(name)
		}
	}
	for agentName, rev := range revisions {
		r.ownerGatewayLegacyRevisions.Store(agentName, rev)
	}
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

// UNIT_BOUNDARY_DESCRIPTION: an owner gateway's repair state: one entry per agent that names a credential, and the sequence its arrivals draw from. The debt is `repaired < arrived`, always stored as two explicit numbers, so "published and awaiting its repair" is a value that survives a restart rather than an absence that a restart cannot tell from a settled baseline. `arrived` also goes into that agent's health revision, so the answer a repair is gated on belongs to the epoch the arrival began, and a content hash that comes back after a revoke and a regrant is a different revision.
type ownerGatewayOffers struct {
	owner string
	mu    sync.Mutex
	next  time.Time
	// UNIT_BOUNDARY_DESCRIPTION: the files the last *applied* render wrote, and their key set. Both are only ever replaced by an adopted write, so a render the owner discards or refuses can never become the state a later arrival is measured against.
	files     *corev1.Secret
	published []string
	seeded    bool
	seq       int
	baseline  bool
	agents    map[string]*ownerGatewayRepair
	offers    map[string]*ownerGatewayOffer
	writes    int
}

// UNIT_BOUNDARY_DESCRIPTION: what one agent's listener owes: the epoch its credential key set last changed at, the epoch its internal listener was last rebuilt for, and a hash of the key set that epoch was taken at. The hash is what decides the next arrival, so it is the agent's *own* referenced keys and not the Secret's: a key a sibling already published is still new to the agent just granted it, and the pod can deliver both writes in one flip. A repair is owed exactly when `repaired < arrived`.
type ownerGatewayRepair struct {
	Arrived  int    `json:"arrived,omitempty"`
	Repaired int    `json:"repaired,omitempty"`
	Keys     string `json:"keys,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: that state as the Secret carries it, so a restart resumes the debt instead of inferring it from key sets. It holds one small entry per member that names a credential, and the map is pruned to the members the applied render serves, so it is the size of the live state.
type ownerGatewayGenerations struct {
	Seq    int                            `json:"seq,omitempty"`
	Agents map[string]*ownerGatewayRepair `json:"agents,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: one render's decision, computed without touching shared state: adopting a plan is what makes it true, so planning a render the owner goes on to discard changes nothing. `version` is what the files carry, one count per write this owner has made. `due` holds the agents whose next offer is still ahead, and when. `generations` is what each agent's internal listener carries this render, and `arrived` the epoch its health revision encodes.
type ownerGatewayRepairPlan struct {
	now         time.Time
	version     string
	due         map[string]time.Duration
	generations map[string]int
	arrived     map[string]int
	members     []string
	keys        []string
	seq         int
	agents      map[string]*ownerGatewayRepair
	offers      map[string]*ownerGatewayOffer
	next        time.Time
	writes      int
	wrote       bool
	arrivals    bool
	// UNIT_BOUNDARY_DESCRIPTION: which members took an arrival in this plan. A repair and an arrival must never share a write: the write that publishes a key is the flip whose gap builds the broken provider, so a member that arrived is owed its rebuild in a later write, however good its receipt is.
	newArrival map[string]bool
}

// UNIT_BOUNDARY_DESCRIPTION: an owner's state, one per owner for the controller's life.
func (r *AgentReconciler) ownerGatewayOffersFor(owner string) *ownerGatewayOffers {
	v, _ := r.ownerGatewayOffers.LoadOrStore(owner, &ownerGatewayOffers{owner: owner, offers: map[string]*ownerGatewayOffer{}, agents: map[string]*ownerGatewayRepair{}})
	return v.(*ownerGatewayOffers)
}

// UNIT_BOUNDARY_DESCRIPTION: reads the owner's state once per controller run from the Secret it last applied. The repair debt is that annotation verbatim, so a restart resumes a pending repair instead of losing it; a Secret without the annotation — a fresh owner, or one upgraded from the single-volume layout, whose pods roll onto fresh mounts anyway — is a baseline with no arrivals. A read that failed is retried, never accepted as an empty baseline.
func (r *AgentReconciler) seedOwnerGatewayOffers(ctx context.Context, owner string) {
	set := r.ownerGatewayOffersFor(owner)
	set.mu.Lock()
	defer set.mu.Unlock()
	if set.seeded {
		return
	}
	secret, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, ownerGatewayName(r.config.ReleaseName, owner), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		set.seeded = true
		return
	}
	if err != nil {
		slog.Warn("owner gateway: reading the state it wrote last failed; retrying before deciding which credentials are new", "owner", owner, "error", err)
		return
	}
	set.files, set.published, set.seeded = secret, ownerGatewayCredentialKeys(secret), true
	var state ownerGatewayGenerations
	// UNIT_BOUNDARY_DESCRIPTION: a Secret without this note is a baseline, not an arrival: a fresh owner, or one upgraded from the single-volume layout, whose pods roll onto fresh mounts anyway and read every file they start with. The baseline is written on the next apply, which is what makes the owner's *next* key set change an arrival; an owner that already carries the note and gains a member is where an absent entry means one.
	if json.Unmarshal([]byte(secret.Annotations[annOwnerRegenerated]), &state) != nil {
		return
	}
	set.seq, set.baseline = state.Seq, true
	maps.Copy(set.agents, state.Agents)
}

// UNIT_BOUNDARY_DESCRIPTION: whether this owner's state has been read from the Secret it wrote last. A read that failed leaves it unread, so the render that follows waits rather than treating an unknown state as an empty one.
func (r *AgentReconciler) ownerGatewaySeeded(owner string) bool {
	set := r.ownerGatewayOffersFor(owner)
	set.mu.Lock()
	defer set.mu.Unlock()
	return set.seeded
}

// UNIT_BOUNDARY_DESCRIPTION: the credential files one member's chains name: the keys its granted Secrets carry that the files project, which are the only ones a repair for that member can be about.
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

// UNIT_BOUNDARY_DESCRIPTION: every credential file the given members' chains name, which is exactly the set their render projects.
func credentialKeysFor(members map[string][]string, names []string) []string {
	var keys []string
	for _, name := range names {
		for _, key := range members[name] {
			if !slices.Contains(keys, key) {
				keys = append(keys, key)
			}
		}
	}
	slices.Sort(keys)
	return keys
}

// UNIT_BOUNDARY_DESCRIPTION: the credential files an owner gateway Secret carries: every key that is not one of the files the controller writes itself. An empty result is a real answer — an applied Secret with no credentials — and is never read as "there is no Secret", which is what `files == nil` says.
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

// UNIT_BOUNDARY_DESCRIPTION: a fixed-size digest of one member's sorted credential files, which is all the state needs to recognise that member's key set moving. Storing the names themselves would put every credential path into an annotation beside a Secret already near its own budget, and Kubernetes bounds all annotations of an object at 256 KiB.
func ownerGatewayKeyDigest(keys []string) string {
	if len(keys) == 0 {
		return ""
	}
	sum := sha256.Sum256([]byte(strings.Join(keys, "\x00")))
	return hex.EncodeToString(sum[:8])
}

// UNIT_BOUNDARY_DESCRIPTION: each retained agent's own credential files, restricted to the agents this render serves. The plan is built from this and not from the wider map, so a render the owner refused leaves no member state behind: an agent whose files were discarded has no arrival and keeps no repair entry, because nothing was rendered for it to repair.
func memberKeys(held map[string][]string, names []string) map[string][]string {
	out := make(map[string][]string, len(names))
	for _, name := range names {
		if keys, ok := held[name]; ok {
			out[name] = keys
		}
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: what an owner owes the members of the render it is about to write, decided from that render's own membership and key sets so a wider render the owner then refuses can never enter it. `members` is each agent's own credential files and `keys` the set the render publishes. An arrival is decided from the member's *own* key set, not the Secret's: a key a sibling already published is still new to a member that has just been granted it, and the pod may deliver both writes in one flip, so that member needs its own rebuild. Every arrival takes the next sequence number, which also enters that agent's health revision, so the answer a later repair is gated on cannot be an answer from before the arrival — not even when a revoke and a regrant have returned the rendering to the same content hash. `repaired` catches up only on an answer to that arrival's own revision, and only when the member had no arrival in this plan: a repair that shared a write with an arrival would stay in the flip it was meant to repair. This function mutates nothing; `adopt` is what makes a plan true.
func (r *AgentReconciler) ownerGatewayRepairPlan(owner string, members map[string][]string, keys []string, receipts map[string]string, now time.Time) *ownerGatewayRepairPlan {
	set := r.ownerGatewayOffersFor(owner)
	set.mu.Lock()
	defer set.mu.Unlock()
	p := &ownerGatewayRepairPlan{now: now, due: map[string]time.Duration{}, generations: map[string]int{}, arrived: map[string]int{}, newArrival: map[string]bool{}, keys: keys, seq: set.seq, agents: map[string]*ownerGatewayRepair{}, offers: map[string]*ownerGatewayOffer{}, next: set.next, writes: set.writes}
	for name, offer := range set.offers {
		copied := *offer
		p.offers[name] = &copied
	}
	for name, repair := range set.agents {
		copied := *repair
		p.agents[name] = &copied
	}
	p.members = slices.Sorted(maps.Keys(members))
	for _, name := range p.members {
		if len(members[name]) == 0 {
			delete(p.agents, name)
			continue
		}
		repair := p.agents[name]
		own := ownerGatewayKeyDigest(members[name])
		// UNIT_BOUNDARY_DESCRIPTION: an owner whose state has never been written records this render's key sets as its baseline, at epoch zero, so nothing rebuilds for a set the pod read at startup. From the next write on, an entry that is absent or whose digest moved is an arrival.
		if !set.baseline && repair == nil {
			p.agents[name] = &ownerGatewayRepair{Keys: own}
			p.arrived[name] = 0
			continue
		}
		// UNIT_BOUNDARY_DESCRIPTION: an arrival is this agent's own key set differing from the one its last state was taken at, an absent entry included — and it is decided by the hash, not by whether the Secret gained a key, so an agent granted a key a sibling already published still gets its own rebuild. A removal is an arrival too, which costs one rebuild and keeps the rule to a single comparison.
		if repair == nil || repair.Keys != own {
			p.seq++
			arrived, repaired := p.seq, 0
			if repair != nil {
				repaired = repair.Repaired
			}
			repair = &ownerGatewayRepair{Arrived: arrived, Repaired: repaired, Keys: own}
			p.agents[name] = repair
			p.arrivals, p.newArrival[name] = true, true
		}
		p.arrived[name] = repair.Arrived
		p.generations[name] = repair.Repaired
	}
	for name := range p.agents {
		if !slices.Contains(p.members, name) {
			delete(p.agents, name)
		}
	}
	for _, name := range p.members {
		repair := p.agents[name]
		revision := r.ownerGatewayRevisionOf(name)
		// UNIT_BOUNDARY_DESCRIPTION: a member whose rendering the controller has not recorded yet — one that just joined, or the first render after a restart — has nothing that can prove it loaded anything, so it owes no offer; the render that writes its files records the revision, and the offers start from there.
		if revision == "" || repair == nil {
			continue
		}
		offer := p.offers[name]
		if offer == nil || offer.revision != revision {
			offer = &ownerGatewayOffer{revision: revision, next: now}
			p.offers[name] = offer
		}
		// UNIT_BOUNDARY_DESCRIPTION: three things must hold together, and each rules out a different way to spend a repair it has not earned. The receipt was taken by *this* plan, from the sole pod that is serving now: a cached answer proves only that some pod answered at some time, and a surged pod that mounted before the arrival would still take the arrival and its repair in one flip. The receipt answers the stored revision, which is the write that published this arrival — the arrival's own write is the one that failed if it is not. And that stored revision encodes the current arrival epoch, so an answer kept from before the arrival cannot match a rendering that has since returned to the same content hash. An arrival taken in this plan cannot pass the last of these: it draws a sequence past every applied one, so the epoch stored beside the revision is never its own, which is also what keeps a repair out of the write that publishes the key.
		if repair.Repaired >= repair.Arrived {
			continue
		}
		if receipts[name] != revision || receipts[name] == "" || r.ownerGatewayEpochOf(name) != repair.Arrived {
			continue
		}
		repair.Repaired = repair.Arrived
		p.generations[name] = repair.Repaired
	}
	for name := range p.offers {
		if !slices.Contains(p.members, name) {
			delete(p.offers, name)
		}
	}
	var owed []string
	for _, name := range p.members {
		offer := p.offers[name]
		if offer == nil {
			continue
		}
		answered := r.ownerGatewayAnswerOf(name)
		switch {
		case answered != offer.revision && offer.tries < ownerGatewayOfferTries && !now.Before(offer.next):
			owed = append(owed, name)
		case answered == offer.revision && !offer.reoffered:
			owed = append(owed, name)
		}
	}
	// UNIT_BOUNDARY_DESCRIPTION: a write that publishes a key or repairs a listener is not paced, because the pace bounds offers and a credential is what an agent needs; anything else waits its turn so a large owner is not written once per agent.
	if len(owed) > 0 && now.Before(p.next) && !p.arrivals && p.seq == set.seq {
		for _, name := range owed {
			p.due[name] = p.next.Sub(now)
		}
		p.version = ownerGatewayVersion(set.writes)
		return p
	}
	if len(owed) > 0 || p.arrivals || p.seq != set.seq {
		p.next, p.writes, p.wrote = now.Add(ownerGatewayWritePace), set.writes+1, true
	}
	p.version = ownerGatewayVersion(p.writes)
	for _, name := range owed {
		offer := p.offers[name]
		if r.ownerGatewayAnswerOf(name) != offer.revision {
			offer.tries++
			offer.next = now.Add(ownerGatewayOfferWait << (offer.tries - 1))
			if offer.tries < ownerGatewayOfferTries {
				p.due[name] = max(offer.next.Sub(now), p.next.Sub(now))
				continue
			}
			if !offer.warned {
				offer.warned = true
				slog.Warn("owner gateway: its pod has not loaded the files rendered for its agents; it keeps the listener it has", "agent", name, "owner", owner, "tries", offer.tries)
			}
			continue
		}
		offer.reoffered = true
	}
	return p
}

// UNIT_BOUNDARY_DESCRIPTION: the epoch an agent's health revision encodes this render, which is the epoch its own key set last changed at.
func (p *ownerGatewayRepairPlan) arrivedOf(name string) int {
	if p == nil {
		return 0
	}
	return p.arrived[name]
}

// UNIT_BOUNDARY_DESCRIPTION: whether this agent still owes its owner gateway a repair, which readiness reports while the rollout that blocks it is pending: an answer to the arrival's own revision proves the pod read the files, not that the provider it could not build has been rebuilt, so a gateway carrying that debt is not ready for the agent however current its listener looks.
func (r *AgentReconciler) ownerGatewayOwesThisRepair(owner, name string) bool {
	set := r.ownerGatewayOffersFor(owner)
	set.mu.Lock()
	defer set.mu.Unlock()
	if !set.seeded {
		return false
	}
	repair := set.agents[name]
	return repair != nil && repair.Repaired < repair.Arrived
}

// UNIT_BOUNDARY_DESCRIPTION: the members of this render that owe a repair, which is exactly the set to be probed before the plan is made, once each on its own port.
func (r *AgentReconciler) ownerGatewayOwesRepair(owner string, held map[string][]string, names []string) []string {
	set := r.ownerGatewayOffersFor(owner)
	set.mu.Lock()
	defer set.mu.Unlock()
	var owing []string
	if !set.seeded {
		return owing
	}
	for _, name := range names {
		if len(held[name]) == 0 {
			continue
		}
		repair := set.agents[name]
		if repair == nil {
			continue
		}
		// UNIT_BOUNDARY_DESCRIPTION: a member whose own key set has moved already owes a fresh arrival, which this render will assign; its repair belongs to a later write whatever the pod says now.
		if repair.Keys != ownerGatewayKeyDigest(held[name]) {
			continue
		}
		if repair.Repaired < repair.Arrived {
			owing = append(owing, name)
		}
	}
	return owing
}

// UNIT_BOUNDARY_DESCRIPTION: takes the answer a repair is gated on, and returns it keyed by agent: only an answer obtained here, from the sole owner gateway pod that is not terminating, can settle a repair. While a rollout has two pods the newer one may have mounted before the arrival and would receive the arrival and its repair in one flip, so nothing is returned and every owing member is requeued; a list, address or transport failure is the same, because an unanswered debt must stay owed rather than be settled on evidence this plan did not gather. Each owing member is asked once, on its own proxy port, and no settled sibling is probed.
func (r *AgentReconciler) probeOwnerGatewayForRepair(ctx context.Context, owner string, members map[string]ownerGatewayMember, owing []string) map[string]string {
	receipts := map[string]string{}
	hold := func() map[string]string {
		for _, name := range owing {
			if r.requeue != nil {
				r.requeue(name, ownerListenerRecheck)
			}
		}
		return receipts
	}
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent + "," + envoyOwnerLabel + "=" + owner})
	if err != nil {
		return hold()
	}
	serving, pods_ := "", 0
	for _, pod := range pods.Items {
		if pod.DeletionTimestamp != nil {
			continue
		}
		if pods_++; pods_ > 1 {
			return hold()
		}
		serving = pod.Status.PodIP
	}
	if serving == "" {
		return hold()
	}
	for _, name := range owing {
		m, ok := members[name]
		if !ok {
			continue
		}
		if revision, ok := r.ownerListenerAnswers(ctx, name, serving, ownerGatewayProxyPort(m.slot)); ok {
			receipts[name] = revision
			continue
		}
		if r.requeue != nil {
			r.requeue(name, ownerListenerRecheck)
		}
	}
	return receipts
}

// UNIT_BOUNDARY_DESCRIPTION: the epoch the revision the owner last published for this agent encodes. It is recorded beside that revision, so a probe answer can only be spent on a repair when the write that produced the revision being answered is the write that carried the arrival; an arrival whose write failed left the older revision and its older epoch in place, so the debt stays.
func (r *AgentReconciler) ownerGatewayEpochOf(name string) int {
	v, _ := r.ownerGatewayEpochs.Load(name)
	n, _ := v.(int)
	return n
}

func (r *AgentReconciler) ownerGatewayRevisionOf(name string) string {
	v, _ := r.ownerGatewayRevisions.Load(name)
	s, _ := v.(string)
	return s
}

func (r *AgentReconciler) ownerGatewayAnswerOf(name string) string {
	v, _ := r.ownerGatewayAnswered.Load(name)
	s, _ := v.(string)
	return s
}

// UNIT_BOUNDARY_DESCRIPTION: that state as the Secret records it, pruned to the members this render serves, so nothing retired is carried forward. A member that owes a repair is written with both numbers, which is what lets a restart tell it from a settled one.
func (p *ownerGatewayRepairPlan) regenerated() string {
	if p == nil {
		return ""
	}
	raw, _ := json.Marshal(ownerGatewayGenerations{Seq: p.seq, Agents: p.agents})
	return string(raw)
}

// UNIT_BOUNDARY_DESCRIPTION: adopts this render's state once the Secret carrying it is written, wholesale: what was applied is the new truth, whether the write was an offer, a rotation, a revocation or a grant. `published` becomes exactly the keys that write carried, so an empty set is recorded as empty and never as "no Secret", and a revocation's key leaves with it so its return is a new arrival.
func (p *ownerGatewayRepairPlan) adopt(set *ownerGatewayOffers, files *corev1.Secret) {
	if p == nil || set == nil {
		return
	}
	set.mu.Lock()
	defer set.mu.Unlock()
	set.files, set.published, set.seq = files, p.keys, p.seq
	set.agents, set.offers, set.next, set.writes = p.agents, p.offers, p.next, p.writes
	// UNIT_BOUNDARY_DESCRIPTION: an applied write is when the owner's baseline becomes real, so a member that joins later is an arrival rather than another baseline entry.
	set.baseline, set.seeded = true, true
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

// UNIT_BOUNDARY_DESCRIPTION: the canonical receipt this gateway gives for this agent, if it gives one. A repair accepts only the canonical revision, because a repair is a change to the canonical rendering: a pod still on the previous two-volume layout hashes its resources against a different credential root, so nothing about it can prove what a canonical pod has read.
func (r *AgentReconciler) ownerListenerAnswers(ctx context.Context, agent, host string, port int) (string, bool) {
	want, ok := r.ownerGatewayRevisions.Load(agent)
	if !ok {
		return "", false
	}
	serving, ok := r.ownerListenerRaw(ctx, host, port)
	if !ok || serving != want.(string) {
		return "", false
	}
	return want.(string), true
}

// UNIT_BOUNDARY_DESCRIPTION: whether the gateway at this address serves this agent's current listener, for readiness, and the record that it read the files, which is what lets the owner stop offering them. Either layout's own revision is current, since a retained old-layout pod really is serving its layout's current configuration, but only a canonical answer is recorded: a repair is a change to the canonical rendering, and that record is offer bookkeeping, never the receipt a repair is spent on.
func (r *AgentReconciler) ownerListenerCurrent(ctx context.Context, agent, host string, port int) (bool, string) {
	want, ok := r.ownerGatewayRevisions.Load(agent)
	if !ok {
		return false, "the owner gateway has not rendered this agent's listener yet"
	}
	serving, ok := r.ownerListenerRaw(ctx, host, port)
	if !ok {
		return false, "the owner gateway does not answer on this agent's listener"
	}
	if serving == want.(string) {
		r.ownerGatewayAnswered.Store(agent, want.(string))
		return true, ""
	}
	// UNIT_BOUNDARY_DESCRIPTION: an answer that matches no revision this owner publishes is evidence about neither layout, so it clears the record rather than leaving a stale one for a later render to read as "the pod has the files".
	r.ownerGatewayAnswered.Delete(agent)
	if legacy := r.ownerGatewayLegacyRevisionOf(agent); legacy != "" && serving == legacy {
		return true, ""
	}
	return false, fmt.Sprintf("the owner gateway still serves an older listener for this agent (has %q, want %q)", serving, want)
}

// UNIT_BOUNDARY_DESCRIPTION: the body this gateway answers on this listener, whatever it is, and whether the gateway answered at all.
func (r *AgentReconciler) ownerListenerRaw(ctx context.Context, host string, port int) (string, bool) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://%s%s", net.JoinHostPort(host, strconv.Itoa(port)), platformGatewayHealthPath), nil)
	if err != nil {
		return "", false
	}
	resp, err := r.ownerGatewayProbe().Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
	if resp.StatusCode != http.StatusOK {
		return "", false
	}
	return string(body), true
}

func (r *AgentReconciler) ownerGatewayLegacyRevisionOf(name string) string {
	v, _ := r.ownerGatewayLegacyRevisions.Load(name)
	s, _ := v.(string)
	return s
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
