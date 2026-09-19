package reconciler

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"log/slog"
	"math/big"
	"net/netip"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/intstr"
	utilrand "k8s.io/apimachinery/pkg/util/rand"
	"k8s.io/utils/ptr"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: one tree, three lifetimes, each its own mount. The machine disks under disks/ are an owner's agents and outlive everything; the per-machine bookkeeping under machines/ is rebuilt from the cluster after a pod restart; the unpacked images under images/ are a cache, and the install may put them on a volume every runner shares or a node directory of read-only archives. Mounting images/ explicitly even when it falls back to this claim keeps the three separable, rather than having one appear inside another depending on configuration.
const (
	vmRunnerComponent    = "vm-runner"
	vmRunnerStatePath    = "/var/lib/platform"
	vmRunnerDisksPath    = vmRunnerStatePath + "/disks"
	vmRunnerMachinesPath = vmRunnerStatePath + "/machines"
	vmRunnerImagesPath   = vmRunnerStatePath + "/images"
	vmRunnerPort         = 4600
	vmRunnerCertYears = 10
)

type runnerConn struct {
	client *vmrunner.Client
	token  string
}

// UNIT_BOUNDARY_DESCRIPTION: this suffix is the whole of a runner's identity — it names the Secret, the disk and the Service — so two owners colliding here would silently share one runner's credentials and machines. 64 bits puts that out of reach while leaving a Service name, capped at 63 characters, 36 for the release's own.
func runnerSuffix(owner string) string {
	sum := sha256.Sum256([]byte(owner))
	return hex.EncodeToString(sum[:8])
}

// UNIT_BOUNDARY_DESCRIPTION: a runner is created by the controller, not by Helm, so nothing would collect it on uninstall or when virtualization is switched off — owning it from the controller's own Deployment makes the cluster do that, and a runner is worthless without the controller anyway.
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

// UNIT_BOUNDARY_DESCRIPTION: the Secret, PVC and Service are created once and never re-applied, so one that predates the owner reference would keep none — and those are exactly the objects holding an owner's disk and credentials.
func (r *AgentReconciler) adoptRunnerObject(ctx context.Context, meta *metav1.ObjectMeta, update func() error) error {
	if len(meta.OwnerReferences) > 0 {
		return nil
	}
	refs := r.runnerOwnerRef(ctx)
	if len(refs) == 0 {
		return nil
	}
	meta.OwnerReferences = refs
	return update()
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

// UNIT_BOUNDARY_DESCRIPTION: every vm agent of one owner shares one runner, so a guest escape reaches only that owner's machines. The controller owns those runners: it mints their credentials, renders their objects, and hands the caller a client once the pod reports ready.
func (r *AgentReconciler) ensureRunner(ctx context.Context, owner string) (*vmrunner.Client, bool, error) {
	name := r.runnerName(owner)
	ns := r.config.Namespace

	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return nil, false, err
	}
	if err := r.applyRunnerPVC(ctx, owner); err != nil {
		return nil, false, err
	}
	if err := r.applyRunnerService(ctx, owner); err != nil {
		return nil, false, err
	}
	np := buildRunnerNetworkPolicy(owner, r.config.ReleaseName, r.config.APIServerInstanceLabel, ns, r.config.ReleaseNamespace, r.config.VM.Runner.EgressCIDRs, r.config.VM.Runner.EgressExceptCIDRs)
	np.OwnerReferences = r.runnerOwnerRef(ctx)
	if err := applyNetworkPolicy(ctx, r.client, np); err != nil {
		return nil, false, err
	}
	if err := r.applyRunnerDeployment(ctx, owner); err != nil {
		return nil, false, err
	}
	dep, err := r.client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return client, false, err
	}
	return client, dep.Status.ReadyReplicas > 0, nil
}

// UNIT_BOUNDARY_DESCRIPTION: every caller reaches an owner's runner the same way — mint or read its credentials, then dial it — so the credential is never handled anywhere but here.
func (r *AgentReconciler) runnerFor(ctx context.Context, owner string) (*vmrunner.Client, error) {
	token, caPEM, err := r.ensureRunnerSecret(ctx, owner)
	if err != nil {
		return nil, err
	}
	return r.runnerClient(owner, token, caPEM)
}

func (r *AgentReconciler) runnerClient(owner, token, caPEM string) (*vmrunner.Client, error) {
	r.runnerMu.Lock()
	defer r.runnerMu.Unlock()
	if conn, ok := r.runners[owner]; ok && conn.token == token {
		return conn.client, nil
	}
	endpoint := fmt.Sprintf("https://%s:%d", r.runnerHost(owner), vmRunnerPort)
	if r.runnerEndpoint != nil {
		endpoint = r.runnerEndpoint(owner)
		caPEM = ""
	}
	client, err := vmrunner.NewClient(endpoint, token, caPEM)
	if err != nil {
		return nil, err
	}
	if r.runners == nil {
		r.runners = map[string]runnerConn{}
	}
	r.runners[owner] = runnerConn{client: client, token: token}
	return client, nil
}

func (r *AgentReconciler) ensureRunnerSecret(ctx context.Context, owner string) (string, string, error) {
	name, ns := r.runnerName(owner), r.config.Namespace
	existing, err := r.client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		if err := r.adoptRunnerObject(ctx, &existing.ObjectMeta, func() error {
			_, err := r.client.CoreV1().Secrets(ns).Update(ctx, existing, metav1.UpdateOptions{})
			return err
		}); err != nil {
			slog.Warn("vm runner: adopting the existing Secret", "owner", owner, "error", err)
		}
		return string(existing.Data["token"]), string(existing.Data["tls.crt"]), nil
	}
	if !k8serrors.IsNotFound(err) {
		return "", "", err
	}
	certPEM, keyPEM, err := selfSignedCert(name, r.runnerHost(owner))
	if err != nil {
		return "", "", err
	}
	token := utilrand.String(48)
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: vmRunnerLabels(owner, r.config.ReleaseName), OwnerReferences: r.runnerOwnerRef(ctx)},
		Data: map[string][]byte{
			"token":   []byte(token),
			"tls.crt": []byte(certPEM),
			"tls.key": []byte(keyPEM),
		},
	}
	if _, err := r.client.CoreV1().Secrets(ns).Create(ctx, sec, metav1.CreateOptions{}); err != nil {
		if !k8serrors.IsAlreadyExists(err) {
			return "", "", err
		}
		again, err := r.client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", "", err
		}
		return string(again.Data["token"]), string(again.Data["tls.crt"]), nil
	}
	return token, certPEM, nil
}

func selfSignedCert(names ...string) (string, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return "", "", err
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: names[0]},
		DNSNames:              names,
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(vmRunnerCertYears, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return "", "", err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return "", "", err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return string(certPEM), string(keyPEM), nil
}

func (r *AgentReconciler) applyRunnerPVC(ctx context.Context, owner string) error {
	name, ns := r.runnerName(owner), r.config.Namespace
	if existing, err := r.client.CoreV1().PersistentVolumeClaims(ns).Get(ctx, name, metav1.GetOptions{}); err == nil {
		return r.adoptRunnerObject(ctx, &existing.ObjectMeta, func() error {
			_, err := r.client.CoreV1().PersistentVolumeClaims(ns).Update(ctx, existing, metav1.UpdateOptions{})
			return err
		})
	} else if !k8serrors.IsNotFound(err) {
		return err
	}
	size, err := resource.ParseQuantity(r.config.VM.Runner.Storage)
	if err != nil {
		return fmt.Errorf("vm runner storage: %w", err)
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
	_, err = r.client.CoreV1().PersistentVolumeClaims(ns).Create(ctx, pvc, metav1.CreateOptions{})
	if k8serrors.IsAlreadyExists(err) {
		return nil
	}
	return err
}

func (r *AgentReconciler) applyRunnerService(ctx context.Context, owner string) error {
	name, ns := r.runnerName(owner), r.config.Namespace
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: vmRunnerLabels(owner, r.config.ReleaseName), OwnerReferences: r.runnerOwnerRef(ctx)},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  vmRunnerSelector(owner),
			Ports:     []corev1.ServicePort{{Name: "machine-api", Port: vmRunnerPort, TargetPort: intstr.FromInt(vmRunnerPort)}},
		},
	}
	cli := r.client.CoreV1().Services(ns)
	existing, err := cli.Get(ctx, name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		_, err = cli.Create(ctx, svc, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	return r.adoptRunnerObject(ctx, &existing.ObjectMeta, func() error {
		_, err := cli.Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

// UNIT_BOUNDARY_DESCRIPTION: the peers are chart-rendered pods, which carry the Helm release name in app.kubernetes.io/instance — not the chart's fullname, which is what names the runner's own objects. The two are equal only when the release is called `platform`.
func buildRunnerNetworkPolicy(owner, release, instanceLabel, ns, releaseNS string, egress, exceptCIDRs []string) *networkingv1.NetworkPolicy {
	tcp := corev1.ProtocolTCP
	api := intstr.FromInt(vmRunnerPort)
	first := intstr.FromInt(31000)
	last := int32(31099)
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
			}},
			Egress: runnerEgress(ns, egress, exceptCIDRs),
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a machine's egress allowlist is enforced by smolvm inside the very process an escaped guest would own, so this is the kernel gate behind it — without it such a guest reaches the platform's own datastores and every other owner's gateway. It is only rendered once an install says where the runner may go, because the runner also pulls agent images.
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

func runnerEgress(agentNS string, cidrs, except []string) []networkingv1.NetworkPolicyEgressRule {
	if len(cidrs) == 0 {
		return nil
	}
	udp, tcp := corev1.ProtocolUDP, corev1.ProtocolTCP
	dns := intstr.FromInt(53)
	rules := []networkingv1.NetworkPolicyEgressRule{{
		Ports: []networkingv1.NetworkPolicyPort{{Protocol: &udp, Port: &dns}, {Protocol: &tcp, Port: &dns}},
	}, {
		To: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": agentNS}},
			PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{LabelRole: RoleGateway}},
		}},
	}}
	for _, cidr := range cidrs {
		rules = append(rules, networkingv1.NetworkPolicyEgressRule{
			To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: cidr, Except: containedIn(cidr, except)}}},
		})
	}
	return rules
}

// UNIT_BOUNDARY_DESCRIPTION: smolvm can give each machine's VMM its own unprivileged uid, and this runner turns that off, because a VMM that takes one cannot then read what the runner shares with it. It reaches the image cache through an idmapped mount of one entry, on-disk uid 0, so every file the image gives another uid arrives in the guest as nobody — 27,374 of this image's 35,430, whose workload then exits the moment it starts. Measured both ways on one store: with the drop the guest boots in 150 ms and dies; without it the same tree presents those files as the user the image named, and the machine runs. Machines whose rootfs came from a per-machine archive failed to finish starting under the drop as well, by a route not traced here — so this is the mechanism that was isolated, not the whole of what the drop costs.
// UNIT_BOUNDARY_DESCRIPTION: the runner unpacks each image once for every machine of it to share, and a rootfs restored faithfully carries the ownership and modes its files were built with — so tar chowns each entry (CHOWN), sets a mode on a file it has just given away (FOWNER), and goes on writing into directories it no longer owns or that are read-only, which permission bits forbid even to root (DAC_OVERRIDE). All three are load-bearing: without them an image that is not already cached cannot be unpacked at all. DAC_OVERRIDE earns its place twice over, because a release that briefly gave each machine's VMM its own uid chowned those machines' directories away from the runner, which must still manage them.
// UNIT_BOUNDARY_DESCRIPTION: the cluster's DNS is a Service backed by pods, and a confined runner is kept away from Service and pod addresses — so resolving through it is the one thing its own egress policy forbids, and a registry pull dies on the name rather than the fetch. The node's resolver is what such a pod has left, and it costs nothing: the runner is reached by Service DNS rather than reaching one, and it addresses each gateway by the ClusterIP the controller hands it. An install whose registry lives inside the cluster, with its range left reachable, says ClusterFirst instead and resolves Service names.
func runnerDNSPolicy(configured string) corev1.DNSPolicy {
	if corev1.DNSPolicy(configured) == corev1.DNSClusterFirst {
		return corev1.DNSClusterFirst
	}
	return corev1.DNSDefault
}

func (r *AgentReconciler) applyRunnerDeployment(ctx context.Context, owner string) error {
	name, ns := r.runnerName(owner), r.config.Namespace
	spec := r.config.VM.Runner
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
		{Name: "credentials", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: name, DefaultMode: ptr.To[int32](0o400)}}},
	}
	switch {
	case spec.ImageCacheClaim != "":
		mounts = append(mounts, corev1.VolumeMount{Name: "image-cache", MountPath: vmRunnerImagesPath})
		volumes = append(volumes, corev1.Volume{Name: "image-cache", VolumeSource: corev1.VolumeSource{
			PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: spec.ImageCacheClaim},
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
					DNSPolicy:                    runnerDNSPolicy(spec.DNSPolicy),
					ServiceAccountName:           spec.ServiceAccountName,
					AutomountServiceAccountToken: ptrBool(false),
					EnableServiceLinks:           ptrBool(false),
					NodeSelector:                 spec.NodeSelector,
					Tolerations:                  spec.Tolerations,
					ImagePullSecrets:             spec.ImagePullSecrets,
					Containers: []corev1.Container{{
						Name:            vmRunnerComponent,
						Image:           spec.Image,
						ImagePullPolicy: corev1.PullPolicy(spec.ImagePullPolicy),
						Args: []string{
							"--state-dir=" + vmRunnerMachinesPath,
							"--image-dir=" + vmRunnerImagesPath,
							"--memory-mib=$(RUNNER_MEMORY_MIB)",
							fmt.Sprintf("--reserve-mib=%d", spec.ReserveMiB),
							"--tls-cert=/etc/vm-runner/tls.crt",
							"--tls-key=/etc/vm-runner/tls.key",
							fmt.Sprintf("--allow-from=%s", strings.Join(spec.IngressCIDRs, ",")),
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
						Ports: []corev1.ContainerPort{{Name: "machine-api", ContainerPort: vmRunnerPort}},
						ReadinessProbe: &corev1.Probe{
							ProbeHandler: corev1.ProbeHandler{Exec: &corev1.ExecAction{
								Command: []string{"curl", "-skf", "-m", "3", fmt.Sprintf("https://127.0.0.1:%d/healthz", vmRunnerPort)},
							}},
							TimeoutSeconds: 5,
						},
						SecurityContext: &corev1.SecurityContext{
							RunAsUser:       &root,
							Capabilities:    &corev1.Capabilities{Add: []corev1.Capability{"NET_ADMIN", "CHOWN", "FOWNER", "DAC_OVERRIDE"}},
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
	cli := r.client.AppsV1().Deployments(ns)
	existing, err := cli.Get(ctx, name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		_, err = cli.Create(ctx, dep, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	dep.ResourceVersion, dep.Status = existing.ResourceVersion, existing.Status
	_, err = cli.Update(ctx, dep, metav1.UpdateOptions{})
	return err
}

type runnerRef struct {
	owner  string
	client *vmrunner.Client
}

func (r *AgentReconciler) knownRunners(ctx context.Context) ([]runnerRef, error) {
	list, err := r.client.AppsV1().Deployments(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/component=" + vmRunnerComponent,
	})
	if err != nil {
		return nil, err
	}
	var out []runnerRef
	for i := range list.Items {
		owner := list.Items[i].Labels[envoyOwnerLabel]
		if owner == "" {
			continue
		}
		client, err := r.runnerFor(ctx, owner)
		if err != nil {
			continue
		}
		out = append(out, runnerRef{owner: owner, client: client})
	}
	return out, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a runner outlives the agents that made it, so it is torn down only once the sweep finds it holding no machine at all — at which point its disk holds nothing either.
// UNIT_BOUNDARY_DESCRIPTION: everything a runner owns is named after it, so this removes the lot — reached only once the sweep has found the runner holding no machine at all, at which point its disk holds nothing either.
func (r *AgentReconciler) deleteRunner(ctx context.Context, owner string) {
	name, ns := r.runnerName(owner), r.config.Namespace
	opts := metav1.DeleteOptions{}
	if err := r.client.AppsV1().Deployments(ns).Delete(ctx, name, opts); err != nil && !k8serrors.IsNotFound(err) {
		slog.Warn("removing a VM runner: deployment", "owner", owner, "error", err)
		return
	}
	for _, del := range []func() error{
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, name, opts) },
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
