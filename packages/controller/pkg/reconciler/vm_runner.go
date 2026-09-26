package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"strings"

	cmv1 "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	cmmetav1 "github.com/cert-manager/cert-manager/pkg/apis/meta/v1"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/intstr"
	utilrand "k8s.io/apimachinery/pkg/util/rand"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: one claim, three directories, each its own mount. Two of them live and die with the claim — the machine disks under disks/ are an owner's agents, the bookkeeping under machines/ is rebuilt from the cluster after a pod restart — and what earns images/ a mount of its own is that it is often not on this claim at all: the install may put the cache on a node directory every runner there shares, or on a read-only host directory of staged archives. Mounting it explicitly even when it does fall back here keeps the layout one shape instead of a directory that is sometimes a volume, which is what mounting the parent and nesting the cache inside it would give.
const (
	vmRunnerComponent    = "vm-runner"
	vmRunnerStatePath    = "/var/lib/platform"
	vmRunnerDisksPath    = vmRunnerStatePath + "/disks"
	vmRunnerMachinesPath = vmRunnerStatePath + "/machines"
	vmRunnerImagesPath   = vmRunnerStatePath + "/images"
	vmRunnerPort         = 4600

	// UNIT_BOUNDARY_DESCRIPTION: the runner's scrape port, apart from the machine API because it carries no token, and the component of the one pod its NetworkPolicy admits to it. The collector is the platform's own and scrapes the runners because they cannot push to it: a runner is off the mesh, and the collector admits only mesh identities.
	vmRunnerMetricsPort    = 4601
	vmRunnerMetricsScraper = "clickstack-collector"

	// UNIT_BOUNDARY_DESCRIPTION: the pod ports the runner publishes machines on. The NetworkPolicy opens exactly this range and the runner is told it in its args, so a machine is never published on a port the policy drops.
	vmRunnerPortMin = 31000
	vmRunnerPortMax = 31099

	// UNIT_BOUNDARY_DESCRIPTION: how long kubelet waits between SIGTERM and SIGKILL on a runner pod. The runner answers its waiting status reads at once, then drains the machine API beside its own close, which waits up to thirty seconds for machine actions that cannot be cut short, such as a VMM call. The default thirty seconds would kill it at the end of that wait.
	vmRunnerTerminationGraceSeconds = 45
)

type runnerConn struct {
	client *vmrunner.Client
	token  string
	caPEM  string
}

var errRunnerTLSPending = errors.New("VM runner TLS Secret not yet issued")

// UNIT_BOUNDARY_DESCRIPTION: this suffix is the whole of a runner's identity — it names the Secret, the disk and the Service — so two owners colliding here would silently share one runner's credentials and machines. 64 bits puts that out of reach while leaving a Service name, capped at 63 characters, 36 for the release's own.
func runnerSuffix(owner string) string {
	sum := sha256.Sum256([]byte(owner))
	return hex.EncodeToString(sum[:8])
}

// UNIT_BOUNDARY_DESCRIPTION: runners are per owner, so no single Agent can own them — one agent's deletion would collect a runner still holding another's disk. They are owned instead by the ServiceAccount the chart renders for them, which sits in the same namespace (an owner reference may not cross one) and is removed by uninstall, by rollback and by turning virtualization off — so the runners, their disks and their credentials go with it.
// UNIT_BOUNDARY_DESCRIPTION: the reference is resolved on every call rather than cached for the process: a ServiceAccount that is deleted and recreated — switching virtualization off and on does exactly that — comes back with a new UID, and objects stamped with the old one are collected the moment they are written, which reads as a runner that silently never appears.
func (r *AgentReconciler) runnerOwnerRef(ctx context.Context) []metav1.OwnerReference {
	name := r.config.VM.Runner.ServiceAccountName
	if name == "" {
		slog.Warn("vm runner: no runner ServiceAccount configured, runners will outlive the release")
		return nil
	}
	sa, err := r.client.CoreV1().ServiceAccounts(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		slog.Warn("vm runner: no owner reference, runners will outlive the release", "serviceaccount", name, "error", err)
		return nil
	}
	return []metav1.OwnerReference{{
		APIVersion: "v1", Kind: "ServiceAccount", Name: sa.Name, UID: sa.UID,
	}}
}

func (r *AgentReconciler) runnerName(owner string) string {
	return fmt.Sprintf("%s-vm-runner-%s", r.config.ReleaseName, runnerSuffix(owner))
}

func (r *AgentReconciler) runnerHost(owner string) string {
	return fmt.Sprintf("%s.%s.svc", r.runnerName(owner), r.config.Namespace)
}

func vmRunnerSelector(owner string) map[string]string {
	return map[string]string{
		"app.kubernetes.io/component": vmRunnerComponent,
		envoyOwnerLabel:               owner,
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the Deployment selects its own pods with these, so the selector has to stay a subset of the labels — it is built from it rather than repeated.
func vmRunnerLabels(owner, release string) map[string]string {
	labels := vmRunnerSelector(owner)
	labels["app.kubernetes.io/name"] = "platform"
	labels["app.kubernetes.io/instance"] = release
	return labels
}

// UNIT_BOUNDARY_DESCRIPTION: every vm agent of one owner shares one runner, so a guest escape reaches only that owner's machines. The controller owns those runners: it mints their tokens, asks cert-manager for their serving certificates, renders their objects, and hands the caller a client once the pod reports ready.
func (r *AgentReconciler) ensureRunner(ctx context.Context, owner string, demand runnerDemand) (*vmrunner.Client, bool, error) {
	name := r.runnerName(owner)
	ns := r.config.Namespace

	if err := r.ensureRunnerToken(ctx, owner); err != nil {
		return nil, false, err
	}
	if err := r.applyCertificate(ctx, r.buildRunnerCertificate(owner, r.runnerOwnerRef(ctx))); err != nil {
		return nil, false, fmt.Errorf("applying the runner's certificate: %w", err)
	}
	if err := r.applyRunnerPVC(ctx, owner, demand); err != nil {
		return nil, false, err
	}
	if err := r.applyService(ctx, r.buildRunnerService(owner, r.runnerOwnerRef(ctx))); err != nil {
		return nil, false, err
	}
	np := buildRunnerNetworkPolicy(owner, r.config.ReleaseName, r.config.APIServerInstanceLabel, ns, r.config.ReleaseNamespace, r.config.EnvoyPort, r.config.VM.Runner.EgressCIDRs, r.config.VM.Runner.EgressExceptCIDRs)
	np.OwnerReferences = r.runnerOwnerRef(ctx)
	if err := applyNetworkPolicy(ctx, r.client, np); err != nil {
		return nil, false, err
	}
	if err := r.applyRunnerDeployment(ctx, owner); err != nil {
		return nil, false, err
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return nil, false, err
	}
	for _, ref := range r.runnerOwnerRef(ctx) {
		if err := r.ensureSecretOwnerReference(ctx, r.runnerTLSName(owner), ref); err != nil {
			slog.Warn("vm runner: owning the issued TLS Secret; will retry on next reconcile", "owner", owner, "error", err)
		}
	}
	dep, err := r.client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return client, false, err
	}
	ready := dep.Status.ReadyReplicas > 0
	if ready {
		r.resizeRunnerPod(ctx, owner, demand.memoryMiB)
	}
	return client, ready, nil
}

func (r *AgentReconciler) runnerTLSName(owner string) string {
	return r.runnerName(owner) + "-tls"
}

// UNIT_BOUNDARY_DESCRIPTION: the runner's serving certificate comes from the runners' own CA issuer, so cert-manager holds the only CA key and renews what it issued. It is not the gateways' MITM CA: that one signs leaves for hostnames taken from users' credential hosts, and one naming a runner's Service host would pass for the runner, since the controller trusts whatever that CA signed. It names only the Service host the controller dials, and is good for serving alone. The Secret carries the runner's labels so the sweep's one List of runner Secrets finds it too.
func (r *AgentReconciler) buildRunnerCertificate(owner string, ownerRefs []metav1.OwnerReference) *cmv1.Certificate {
	name := r.runnerTLSName(owner)
	labels := vmRunnerLabels(owner, r.config.ReleaseName)
	return &cmv1.Certificate{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: r.config.Namespace, Labels: labels, OwnerReferences: ownerRefs},
		Spec: cmv1.CertificateSpec{
			SecretName:     name,
			SecretTemplate: &cmv1.CertificateSecretTemplate{Labels: labels},
			DNSNames:       []string{r.runnerHost(owner)},
			Usages:         []cmv1.KeyUsage{cmv1.UsageDigitalSignature, cmv1.UsageServerAuth},
			IssuerRef: cmmetav1.IssuerReference{
				Name:  r.config.VMRunnerCAIssuer,
				Kind:  "ClusterIssuer",
				Group: "cert-manager.io",
			},
			PrivateKey: &cmv1.CertificatePrivateKey{Algorithm: cmv1.ECDSAKeyAlgorithm, Size: 256},
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: every caller reaches an owner's runner the same way — read its token and the CA that issued its certificate, then dial it — so the credential is never handled anywhere but here. A runner whose certificate cert-manager has not issued yet cannot be dialled, and its pod cannot start either, so the caller requeues as it does for a gateway's leaf.
func (r *AgentReconciler) runnerFor(ctx context.Context, owner string) (*vmrunner.Client, error) {
	secrets := r.client.CoreV1().Secrets(r.config.Namespace)
	token, err := secrets.Get(ctx, r.runnerName(owner), metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("reading the runner's token: %w", err)
	}
	tls, err := secrets.Get(ctx, r.runnerTLSName(owner), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return nil, errRunnerTLSPending
	}
	if err != nil {
		return nil, fmt.Errorf("reading the runner's TLS Secret: %w", err)
	}
	return r.runnerClient(owner, string(token.Data["token"]), string(tls.Data["ca.crt"]))
}

// UNIT_BOUNDARY_DESCRIPTION: a client is kept per owner until the token or the CA it was built with changes. An empty CA is refused, because the HTTP client would then trust the system roots, which vouch for any public name.
func (r *AgentReconciler) runnerClient(owner, token, caPEM string) (*vmrunner.Client, error) {
	r.runnerMu.Lock()
	defer r.runnerMu.Unlock()
	if conn, ok := r.runners[owner]; ok && conn.token == token && conn.caPEM == caPEM {
		return conn.client, nil
	}
	endpoint, trust := fmt.Sprintf("https://%s:%d", r.runnerHost(owner), vmRunnerPort), caPEM
	if r.runnerEndpoint != nil {
		endpoint, trust = r.runnerEndpoint(owner), ""
	} else if caPEM == "" {
		return nil, fmt.Errorf("the runner's TLS Secret %s has no ca.crt", r.runnerTLSName(owner))
	}
	client, err := vmrunner.NewClient(endpoint, token, trust)
	if err != nil {
		return nil, err
	}
	if r.runners == nil {
		r.runners = map[string]runnerConn{}
	}
	r.runners[owner] = runnerConn{client: client, token: token, caPEM: caPEM}
	return client, nil
}

func (r *AgentReconciler) ensureRunnerToken(ctx context.Context, owner string) error {
	name, ns := r.runnerName(owner), r.config.Namespace
	_, err := r.client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
	if !k8serrors.IsNotFound(err) {
		return err
	}
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: vmRunnerLabels(owner, r.config.ReleaseName), OwnerReferences: r.runnerOwnerRef(ctx)},
		Data:       map[string][]byte{"token": []byte(utilrand.String(48))},
	}
	if _, err := r.client.CoreV1().Secrets(ns).Create(ctx, sec, metav1.CreateOptions{}); err != nil && !k8serrors.IsAlreadyExists(err) {
		return err
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: what the cached images may occupy. Every cache is bounded by this one number, wherever it lives: a node directory shares its filesystem with everything else the node runs, and the runner's own claim shares one with the machine disks, so neither can be given a share of the filesystem without letting the images eat something that is not theirs. A value the controller cannot read is refused rather than replaced with a guess, because the guess is a cache quietly growing until the node or the disks it shares with run out.
func imageBudgetBytes(spec config.VMRunnerSpec) (int64, error) {
	size, err := resource.ParseQuantity(spec.ImageCacheBudget)
	if err != nil {
		return 0, fmt.Errorf("vm runner image cache budget %q is not a quantity: %w", spec.ImageCacheBudget, err)
	}
	if size.Value() <= 0 {
		return 0, fmt.Errorf("vm runner image cache budget %q leaves the cached images no room at all", spec.ImageCacheBudget)
	}
	return size.Value(), nil
}

// UNIT_BOUNDARY_DESCRIPTION: a claim already bound is grown when its owner's demand outgrows it, which is the same rule the machine disks on it already follow: a size that rises is applied in place, a size that falls is ignored because Kubernetes refuses to shrink a claim at all.
// UNIT_BOUNDARY_DESCRIPTION: a class without volume expansion rejects that update, and a size the install mistyped cannot be worked out at all. Both are reported and reconciliation continues, because the runner serves every one of the owner's agents and works exactly as before at the size it has — a values typo costs a warning, not a fleet that no longer reconciles.
func (r *AgentReconciler) growRunnerPVC(ctx context.Context, owner string, claim *corev1.PersistentVolumeClaim, size resource.Quantity) {
	current := claim.Spec.Resources.Requests[corev1.ResourceStorage]
	if size.Cmp(current) <= 0 {
		return
	}
	if claim.Spec.Resources.Requests == nil {
		claim.Spec.Resources.Requests = corev1.ResourceList{}
	}
	claim.Spec.Resources.Requests[corev1.ResourceStorage] = size
	if _, err := r.client.CoreV1().PersistentVolumeClaims(claim.Namespace).Update(ctx, claim, metav1.UpdateOptions{}); err != nil {
		slog.Warn("vm runner: the claim was not grown, the runner keeps the size it has", "owner", owner, "from", current.String(), "to", size.String(), "error", err)
		return
	}
	slog.Info("vm runner: grew the claim", "owner", owner, "from", current.String(), "to", size.String())
}

func (r *AgentReconciler) applyRunnerPVC(ctx context.Context, owner string, demand runnerDemand) error {
	name, ns := r.runnerName(owner), r.config.Namespace
	size, ceiling, sizeErr := r.runnerClaimSize(demand)
	if existing, err := r.client.CoreV1().PersistentVolumeClaims(ns).Get(ctx, name, metav1.GetOptions{}); err == nil {
		if sizeErr != nil {
			slog.Warn("vm runner: the claim's size cannot be worked out, it keeps the size it has", "owner", owner, "error", sizeErr)
			return nil
		}
		r.growRunnerPVC(ctx, owner, existing, size)
		return nil
	} else if !k8serrors.IsNotFound(err) {
		return err
	}
	if sizeErr != nil {
		return sizeErr
	}
	if size.Cmp(ceiling) < 0 && !r.runnerClassExpands(ctx) {
		size = ceiling
	}
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: vmRunnerLabels(owner, r.config.ReleaseName), OwnerReferences: r.runnerOwnerRef(ctx)},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources:   corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: size}},
		},
	}
	if sc := r.config.VM.Runner.StorageClass; sc != "" {
		pvc.Spec.StorageClassName = &sc
	}
	_, err := r.client.CoreV1().PersistentVolumeClaims(ns).Create(ctx, pvc, metav1.CreateOptions{})
	if k8serrors.IsAlreadyExists(err) {
		return nil
	}
	return err
}

func (r *AgentReconciler) buildRunnerService(owner string, ownerRefs []metav1.OwnerReference) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: r.runnerName(owner), Namespace: r.config.Namespace, Labels: vmRunnerLabels(owner, r.config.ReleaseName), OwnerReferences: ownerRefs},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  vmRunnerSelector(owner),
			Ports:     []corev1.ServicePort{{Name: "machine-api", Port: vmRunnerPort, TargetPort: intstr.FromInt(vmRunnerPort)}},
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the peers are chart-rendered pods, which carry the Helm release name in app.kubernetes.io/instance — not the chart's fullname, which is what names the runner's own objects. The two are equal only when the release is called `platform`.
func buildRunnerNetworkPolicy(owner, release, instanceLabel, ns, releaseNS string, envoyPort int, egress, exceptCIDRs []string) *networkingv1.NetworkPolicy {
	tcp := corev1.ProtocolTCP
	api := intstr.FromInt(vmRunnerPort)
	scrape := intstr.FromInt(vmRunnerMetricsPort)
	first := intstr.FromInt(vmRunnerPortMin)
	last := int32(vmRunnerPortMax)
	peer := func(component string) networkingv1.NetworkPolicyPeer {
		return networkingv1.NetworkPolicyPeer{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": releaseNS}},
			PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{
				"app.kubernetes.io/component": component,
				"app.kubernetes.io/instance":  instanceLabel,
			}},
		}
	}
	types := []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}
	if len(egress) > 0 {
		types = append(types, networkingv1.PolicyTypeEgress)
	}
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-vm-runner-%s-ingress", release, runnerSuffix(owner)),
			Namespace: ns,
			Labels:    vmRunnerLabels(owner, release),
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)},
			PolicyTypes: types,
			Ingress: []networkingv1.NetworkPolicyIngressRule{{
				From: []networkingv1.NetworkPolicyPeer{peer("apiserver"), peer("controller")},
				Ports: []networkingv1.NetworkPolicyPort{
					{Protocol: &tcp, Port: &api},
					{Protocol: &tcp, Port: &first, EndPort: &last},
				},
			}, {
				From:  []networkingv1.NetworkPolicyPeer{peer(vmRunnerMetricsScraper)},
				Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &scrape}},
			}},
			Egress: runnerEgress(ns, owner, envoyPort, egress, exceptCIDRs),
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: Kubernetes rejects a whole NetworkPolicy whose exception falls outside the block it belongs to, so an install that names a narrow registry alongside the cluster's own ranges would otherwise break every reconcile — each block keeps only the exceptions that actually sit inside it.
func containedIn(cidr string, except []string) []string {
	block, err := netip.ParsePrefix(cidr)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range except {
		sub, err := netip.ParsePrefix(e)
		if err != nil || sub.Bits() <= block.Bits() || !block.Contains(sub.Addr()) {
			continue
		}
		out = append(out, e)
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: a machine's egress allowlist is enforced by smolvm inside the very process an escaped guest would own, so this is the kernel gate behind it — without it such a guest reaches the platform's own datastores. Gateways are admitted by owner and on their proxy port alone, the same pinning each gateway's ingress policy makes from its side. It is only rendered once an install says where the runner may go, because the runner also pulls agent images.
func runnerEgress(agentNS, owner string, envoyPort int, cidrs, except []string) []networkingv1.NetworkPolicyEgressRule {
	if len(cidrs) == 0 {
		return nil
	}
	udp, tcp := corev1.ProtocolUDP, corev1.ProtocolTCP
	dns := intstr.FromInt(53)
	proxy := intstr.FromInt(envoyPort)
	rules := []networkingv1.NetworkPolicyEgressRule{{
		Ports: []networkingv1.NetworkPolicyPort{{Protocol: &udp, Port: &dns}, {Protocol: &tcp, Port: &dns}},
	}, {
		To: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": agentNS}},
			PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{LabelRole: RoleGateway, envoyOwnerLabel: owner}},
		}},
		Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &proxy}},
	}}
	for _, cidr := range cidrs {
		rules = append(rules, networkingv1.NetworkPolicyEgressRule{
			To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: cidr, Except: containedIn(cidr, except)}}},
		})
	}
	return rules
}

// UNIT_BOUNDARY_DESCRIPTION: the cluster's DNS is a Service backed by pods, and a confined runner is kept away from Service and pod addresses — so resolving through it is the one thing its own egress policy forbids, and a registry pull dies on the name rather than the fetch. The node's resolver is what such a pod has left, and it costs nothing: the runner is reached by Service DNS rather than reaching one, and it addresses each gateway by the ClusterIP the controller hands it. An install whose registry lives inside the cluster, with its range left reachable, says ClusterFirst instead and resolves Service names.
func runnerDNSPolicy(configured string) corev1.DNSPolicy {
	if corev1.DNSPolicy(configured) == corev1.DNSClusterFirst {
		return corev1.DNSClusterFirst
	}
	return corev1.DNSDefault
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm can give each machine's VMM its own unprivileged uid, and the runner's env turns that off (SMOLVM_VM_UID_DROP=off). A VMM with its own uid reaches the image tree through an idmapped mount that maps on-disk uid 0 to it, so every file the image gives another uid reaches the guest as nobody, and the workload exits as it starts.
// UNIT_BOUNDARY_DESCRIPTION: the capabilities the runner container adds. NET_ADMIN is for the per-machine NAT. DAC_OVERRIDE is for the VMMs: each runs as the runner's uid and serves the image tree to its guest over virtiofs, opening every file with its own credentials, so a file the image keeps from root — a 0000 /etc/shadow, or anything under another uid's 0700 directory — cannot be read without it. CHOWN and FOWNER are only for a runner that unpacks images into its own claim: tar restores each file's owner, then sets a mode on a file it no longer owns. A runner on the node cache or on staged archives unpacks nothing, so it does not get them.
func runnerCapabilities(spec config.VMRunnerSpec) []corev1.Capability {
	caps := []corev1.Capability{"NET_ADMIN", "DAC_OVERRIDE"}
	if runnerOwnsImageCache(spec) {
		caps = append(caps, "CHOWN", "FOWNER")
	}
	return caps
}

// UNIT_BOUNDARY_DESCRIPTION: whether the runner's image directory is a cache on its own claim, with the runner as its only writer. It is not when the node image cache service writes a node directory, or when the install stages read-only archives.
func runnerOwnsImageCache(spec config.VMRunnerSpec) bool {
	return spec.ImageCacheHostPath == "" && spec.ImageArchiveHostPath == ""
}

// UNIT_BOUNDARY_DESCRIPTION: the node image cache service's socket, inside the node directory it shares with the runners. The chart's DaemonSet binds it at this same path in its own mount. A runner mounts the directory read-only, which still lets it connect to the socket but not replace it.
const vmImageCacheSocket = vmRunnerImagesPath + "/.cache.sock"

func (r *AgentReconciler) applyRunnerDeployment(ctx context.Context, owner string) error {
	name, ns := r.runnerName(owner), r.config.Namespace
	spec := r.config.VM.Runner
	imageBudget, err := imageBudgetBytes(spec)
	if err != nil {
		return err
	}
	labels := vmRunnerLabels(owner, r.config.ReleaseName)
	podLabels := map[string]string{"istio.io/dataplane-mode": "none"}
	for k, v := range labels {
		podLabels[k] = v
	}
	replicas := int32(1)
	root := int64(0)
	var resources corev1.ResourceRequirements
	if spec.Resources != nil {
		resources = *spec.Resources.DeepCopy()
	}
	if resources.Limits == nil {
		resources.Limits = corev1.ResourceList{}
	}
	for k, v := range spec.Devices {
		q, err := resource.ParseQuantity(v)
		if err != nil {
			return fmt.Errorf("vm runner device %s: %w", k, err)
		}
		resources.Limits[corev1.ResourceName(k)] = q
	}
	mounts := []corev1.VolumeMount{
		{Name: "state", MountPath: vmRunnerDisksPath, SubPath: "disks"},
		{Name: "state", MountPath: vmRunnerMachinesPath, SubPath: "machines"},
		{Name: "credentials", MountPath: "/etc/vm-runner", ReadOnly: true},
	}
	volumes := []corev1.Volume{
		{Name: "state", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: name}}},
		{Name: "credentials", VolumeSource: corev1.VolumeSource{Projected: &corev1.ProjectedVolumeSource{
			DefaultMode: new(int32(0o400)),
			Sources: []corev1.VolumeProjection{
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: name}, Items: []corev1.KeyToPath{{Key: "token", Path: "token"}}}},
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: r.runnerTLSName(owner)}, Items: []corev1.KeyToPath{{Key: "tls.crt", Path: "tls.crt"}, {Key: "tls.key", Path: "tls.key"}}}},
			},
		}}},
	}
	imageCacheSocket := ""
	switch {
	case spec.ImageCacheHostPath != "":
		dir := corev1.HostPathDirectoryOrCreate
		imageCacheSocket = vmImageCacheSocket
		mounts = append(mounts, corev1.VolumeMount{Name: "image-cache", MountPath: vmRunnerImagesPath, ReadOnly: true})
		volumes = append(volumes, corev1.Volume{Name: "image-cache", VolumeSource: corev1.VolumeSource{
			HostPath: &corev1.HostPathVolumeSource{Path: spec.ImageCacheHostPath, Type: &dir},
		}})
	case spec.ImageArchiveHostPath != "":
		dir := corev1.HostPathDirectoryOrCreate
		mounts = append(mounts, corev1.VolumeMount{Name: "image-archives", MountPath: vmRunnerImagesPath, ReadOnly: true})
		volumes = append(volumes, corev1.Volume{Name: "image-archives", VolumeSource: corev1.VolumeSource{
			HostPath: &corev1.HostPathVolumeSource{Path: spec.ImageArchiveHostPath, Type: &dir},
		}})
	default:
		mounts = append(mounts, corev1.VolumeMount{Name: "state", MountPath: vmRunnerImagesPath, SubPath: "images"})
	}
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: labels, OwnerReferences: r.runnerOwnerRef(ctx)},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RecreateDeploymentStrategyType},
			Selector: &metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: podLabels},
				Spec: corev1.PodSpec{
					DNSPolicy:                     runnerDNSPolicy(spec.DNSPolicy),
					TerminationGracePeriodSeconds: new(int64(vmRunnerTerminationGraceSeconds)),
					ServiceAccountName:            spec.ServiceAccountName,
					AutomountServiceAccountToken:  new(false),
					EnableServiceLinks:            new(false),
					NodeSelector:                  spec.NodeSelector,
					Tolerations:                   spec.Tolerations,
					ImagePullSecrets:              spec.ImagePullSecrets,
					Containers: []corev1.Container{{
						Name:            vmRunnerComponent,
						Image:           spec.Image,
						ImagePullPolicy: corev1.PullPolicy(spec.ImagePullPolicy),
						Args: []string{
							fmt.Sprintf("--listen=:%d", vmRunnerPort),
							fmt.Sprintf("--port-min=%d", vmRunnerPortMin),
							fmt.Sprintf("--port-max=%d", vmRunnerPortMax),
							"--token-file=/etc/vm-runner/token",
							"--state-dir=" + vmRunnerMachinesPath,
							fmt.Sprintf("--metrics-listen=:%d", vmRunnerMetricsPort),
							"--image-dir=" + vmRunnerImagesPath,
							"--image-cache-socket=" + imageCacheSocket,
							fmt.Sprintf("--image-budget-bytes=%d", imageBudget),
							"--memory-mib=$(RUNNER_MEMORY_MIB)",
							fmt.Sprintf("--reserve-mib=%d", spec.ReserveMiB),
							"--tls-cert=/etc/vm-runner/tls.crt",
							"--tls-key=/etc/vm-runner/tls.key",
						},
						Env: []corev1.EnvVar{{
							Name: "SMOLVM_VM_UID_DROP", Value: "off",
						}, {
							Name: "RUST_LOG", Value: "info",
						}, {
							Name: "SMOLVM_LOG_FORMAT", Value: "json",
						}, {
							Name: "RUNNER_MEMORY_MIB",
							ValueFrom: &corev1.EnvVarSource{ResourceFieldRef: &corev1.ResourceFieldSelector{
								ContainerName: vmRunnerComponent, Resource: "limits.memory", Divisor: resource.MustParse("1Mi"),
							}},
						}},
						Ports: []corev1.ContainerPort{
							{Name: "machine-api", ContainerPort: vmRunnerPort},
							{Name: "metrics", ContainerPort: vmRunnerMetricsPort},
						},
						ReadinessProbe: &corev1.Probe{
							ProbeHandler: corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{
								Path:   "/healthz",
								Port:   intstr.FromString("machine-api"),
								Scheme: corev1.URISchemeHTTPS,
							}},
							TimeoutSeconds: 5,
						},
						SecurityContext: &corev1.SecurityContext{
							RunAsUser:       &root,
							Capabilities:    &corev1.Capabilities{Add: runnerCapabilities(spec)},
							AppArmorProfile: &corev1.AppArmorProfile{Type: corev1.AppArmorProfileTypeUnconfined},
						},
						Resources:    resources,
						VolumeMounts: mounts,
					}},
					Volumes: volumes,
				},
			},
		},
	}
	return r.rollRunnerDeployment(ctx, owner, dep)
}

type runnerRef struct {
	owner  string
	client *vmrunner.Client
}

// UNIT_BOUNDARY_DESCRIPTION: the sweep needs a client for every runner, and each client needs that runner's token and TLS Secrets. Reading them one at a time is two Gets per runner on every sweep, so the runners' Secrets are listed once by their component label, which both carry. A runner whose Secrets are not both in that list, because the list failed or they were written after it, is resolved the ordinary way, which reads them by name.
func (r *AgentReconciler) knownRunners(ctx context.Context) ([]runnerRef, error) {
	selector := metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + vmRunnerComponent}
	list, err := r.client.AppsV1().Deployments(r.config.Namespace).List(ctx, selector)
	if err != nil {
		return nil, err
	}
	secrets := map[string]corev1.Secret{}
	if listed, err := r.client.CoreV1().Secrets(r.config.Namespace).List(ctx, selector); err == nil {
		for _, sec := range listed.Items {
			secrets[sec.Name] = sec
		}
	} else {
		slog.Warn("vm runner: listing runner Secrets failed; reading each one instead", "error", err)
	}
	var out []runnerRef
	for i := range list.Items {
		owner := list.Items[i].Labels[envoyOwnerLabel]
		if owner == "" {
			continue
		}
		var client *vmrunner.Client
		token, tls := secrets[r.runnerName(owner)], secrets[r.runnerTLSName(owner)]
		if len(token.Data["token"]) > 0 && len(tls.Data["ca.crt"]) > 0 {
			client, err = r.runnerClient(owner, string(token.Data["token"]), string(tls.Data["ca.crt"]))
		} else {
			client, err = r.runnerFor(ctx, owner)
		}
		if err != nil {
			continue
		}
		out = append(out, runnerRef{owner: owner, client: client})
	}
	return out, nil
}

// UNIT_BOUNDARY_DESCRIPTION: everything a runner owns is named after it, so this removes the lot — reached only once the sweep has found the runner holding no machine at all, at which point its disk holds nothing either.
func (r *AgentReconciler) deleteRunner(ctx context.Context, owner string) {
	name, ns := r.runnerName(owner), r.config.Namespace
	opts := metav1.DeleteOptions{}
	if err := r.client.AppsV1().Deployments(ns).Delete(ctx, name, opts); err != nil && !k8serrors.IsNotFound(err) {
		slog.Warn("removing a VM runner: deployment", "owner", owner, "error", err)
		return
	}
	for _, del := range []func() error{
		func() error {
			return r.dynamic.Resource(certificateGVR).Namespace(ns).Delete(ctx, r.runnerTLSName(owner), opts)
		},
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, name, opts) },
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, r.runnerTLSName(owner), opts) },
		func() error { return r.client.CoreV1().Services(ns).Delete(ctx, name, opts) },
		func() error {
			return r.client.NetworkingV1().NetworkPolicies(ns).Delete(ctx, name+"-ingress", opts)
		},
		func() error { return r.client.CoreV1().PersistentVolumeClaims(ns).Delete(ctx, name, opts) },
	} {
		if err := del(); err != nil && !k8serrors.IsNotFound(err) {
			slog.Warn("removing a VM runner", "owner", owner, "error", err)
		}
	}
	r.runnerMu.Lock()
	delete(r.runners, owner)
	r.runnerMu.Unlock()
	slog.Info("removed the VM runner of an owner with no vm agents left", "owner", owner)
}

// UNIT_BOUNDARY_DESCRIPTION: an owner whose runner cannot be scheduled waits forever, and the Deployment only reports zero ready replicas — the pod holds the one account of why, so the agent's status carries it rather than "still starting" until someone reads the cluster by hand.
func (r *AgentReconciler) runnerNotReadyMessage(ctx context.Context, owner string) string {
	const starting = "the owner's VM runner is still starting"
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labels.Set(vmRunnerSelector(owner)).String(),
	})
	if err != nil || len(pods.Items) == 0 {
		return starting
	}
	for i := range pods.Items {
		pod := &pods.Items[i]
		for _, c := range pod.Status.Conditions {
			if c.Type == corev1.PodScheduled && c.Status == corev1.ConditionFalse && c.Message != "" {
				return "the owner's VM runner cannot be scheduled: " + c.Message
			}
		}
		for _, cs := range pod.Status.ContainerStatuses {
			if w := cs.State.Waiting; w != nil && w.Reason != "" && w.Reason != "ContainerCreating" {
				return "the owner's VM runner is not starting: " + strings.TrimSpace(w.Reason+": "+w.Message)
			}
		}
	}
	return starting
}
