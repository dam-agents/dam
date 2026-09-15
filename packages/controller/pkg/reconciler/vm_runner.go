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
	"net"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	utilrand "k8s.io/apimachinery/pkg/util/rand"
	"k8s.io/utils/ptr"

	"github.com/kagenti/platform/packages/controller/pkg/vmrunner"
)

const (
	vmRunnerComponent = "vm-runner"
	vmRunnerPort      = 4600
	vmRunnerCertYears = 10
)

type runnerConn struct {
	client *vmrunner.Client
	token  string
}

func runnerSuffix(owner string) string {
	sum := sha256.Sum256([]byte(owner))
	return hex.EncodeToString(sum[:4])
}

func (r *AgentReconciler) runnerName(owner string) string {
	return fmt.Sprintf("%s-vm-runner-%s", r.config.ReleaseName, runnerSuffix(owner))
}

func (r *AgentReconciler) runnerHost(owner string) string {
	return fmt.Sprintf("%s.%s.svc", r.runnerName(owner), r.config.ReleaseNamespace)
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
	ns := r.config.ReleaseNamespace

	if _, _, err := r.ensureRunnerSecret(ctx, owner); err != nil {
		return nil, false, err
	}
	if err := r.applyRunnerPVC(ctx, owner); err != nil {
		return nil, false, err
	}
	if err := r.applyRunnerService(ctx, owner); err != nil {
		return nil, false, err
	}
	if err := applyNetworkPolicy(ctx, r.client, buildRunnerNetworkPolicy(owner, r.config.ReleaseName, ns)); err != nil {
		return nil, false, err
	}
	if err := r.applyRunnerDeployment(ctx, owner); err != nil {
		return nil, false, err
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
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
	name, ns := r.runnerName(owner), r.config.ReleaseNamespace
	existing, err := r.client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
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
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: vmRunnerLabels(owner, r.config.ReleaseName)},
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
	name, ns := r.runnerName(owner), r.config.ReleaseNamespace
	if _, err := r.client.CoreV1().PersistentVolumeClaims(ns).Get(ctx, name, metav1.GetOptions{}); err == nil {
		return nil
	} else if !k8serrors.IsNotFound(err) {
		return err
	}
	size, err := resource.ParseQuantity(r.config.VM.Runner.Storage)
	if err != nil {
		return fmt.Errorf("vm runner storage: %w", err)
	}
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: vmRunnerLabels(owner, r.config.ReleaseName)},
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
	name, ns := r.runnerName(owner), r.config.ReleaseNamespace
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: vmRunnerLabels(owner, r.config.ReleaseName)},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  vmRunnerSelector(owner),
			Ports:     []corev1.ServicePort{{Name: "machine-api", Port: vmRunnerPort, TargetPort: intstr.FromInt(vmRunnerPort)}},
		},
	}
	return r.applyService(ctx, svc)
}

func buildRunnerNetworkPolicy(owner, release, ns string) *networkingv1.NetworkPolicy {
	tcp := corev1.ProtocolTCP
	api := intstr.FromInt(vmRunnerPort)
	first := intstr.FromInt(31000)
	last := int32(31099)
	peer := func(component string) networkingv1.NetworkPolicyPeer {
		return networkingv1.NetworkPolicyPeer{PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{
			"app.kubernetes.io/component": component,
			"app.kubernetes.io/instance":  release,
		}}}
	}
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-vm-runner-%s-ingress", release, runnerSuffix(owner)),
			Namespace: ns,
			Labels:    vmRunnerLabels(owner, release),
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
			Ingress: []networkingv1.NetworkPolicyIngressRule{{
				From: []networkingv1.NetworkPolicyPeer{peer("apiserver"), peer("controller")},
				Ports: []networkingv1.NetworkPolicyPort{
					{Protocol: &tcp, Port: &api},
					{Protocol: &tcp, Port: &first, EndPort: &last},
				},
			}},
		},
	}
}

func (r *AgentReconciler) applyRunnerDeployment(ctx context.Context, owner string) error {
	name, ns := r.runnerName(owner), r.config.ReleaseNamespace
	spec := r.config.VM.Runner
	labels := vmRunnerLabels(owner, r.config.ReleaseName)
	podLabels := map[string]string{"istio.io/dataplane-mode": "none"}
	for k, v := range labels {
		podLabels[k] = v
	}
	replicas := int32(1)
	root := int64(0)
	resources := corev1.ResourceRequirements{Limits: corev1.ResourceList{}, Requests: corev1.ResourceList{}}
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
		{Name: "state", MountPath: "/var/lib/smolvm", SubPath: "smolvm"},
		{Name: "state", MountPath: "/var/lib/vm-runner", SubPath: "vm-runner"},
		{Name: "credentials", MountPath: "/etc/vm-runner", ReadOnly: true},
	}
	volumes := []corev1.Volume{
		{Name: "state", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: name}}},
		{Name: "credentials", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: name, DefaultMode: ptr.To[int32](0o400)}}},
	}
	if host := spec.ImageArchiveHostPath; host != "" {
		dir := corev1.HostPathDirectoryOrCreate
		mounts = append(mounts, corev1.VolumeMount{Name: "image-archives", MountPath: "/var/lib/vm-runner/images", ReadOnly: true})
		volumes = append(volumes, corev1.Volume{Name: "image-archives", VolumeSource: corev1.VolumeSource{
			HostPath: &corev1.HostPathVolumeSource{Path: host, Type: &dir},
		}})
	}
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: labels},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RecreateDeploymentStrategyType},
			Selector: &metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: podLabels},
				Spec: corev1.PodSpec{
					ServiceAccountName:           spec.ServiceAccountName,
					AutomountServiceAccountToken: ptrBool(false),
					NodeSelector:                 spec.NodeSelector,
					Tolerations:                  spec.Tolerations,
					ImagePullSecrets:             spec.ImagePullSecrets,
					Containers: []corev1.Container{{
						Name:            vmRunnerComponent,
						Image:           spec.Image,
						ImagePullPolicy: corev1.PullPolicy(spec.ImagePullPolicy),
						Args: []string{
							"--memory-mib=$(RUNNER_MEMORY_MIB)",
							fmt.Sprintf("--reserve-mib=%d", spec.ReserveMiB),
							"--tls-cert=/etc/vm-runner/tls.crt",
							"--tls-key=/etc/vm-runner/tls.key",
							fmt.Sprintf("--allow-from=%s", strings.Join(spec.IngressCIDRs, ",")),
						},
						Env: []corev1.EnvVar{{
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
							Capabilities:    &corev1.Capabilities{Add: []corev1.Capability{"NET_ADMIN"}},
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
	list, err := r.client.AppsV1().Deployments(r.config.ReleaseNamespace).List(ctx, metav1.ListOptions{
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
func (r *AgentReconciler) deleteRunner(ctx context.Context, owner string) {
	name, ns := r.runnerName(owner), r.config.ReleaseNamespace
	opts := metav1.DeleteOptions{}
	if err := r.client.AppsV1().Deployments(ns).Delete(ctx, name, opts); err != nil && !k8serrors.IsNotFound(err) {
		slog.Warn("removing idle VM runner: deployment", "owner", owner, "error", err)
		return
	}
	for _, del := range []func() error{
		func() error { return r.client.CoreV1().Services(ns).Delete(ctx, name, opts) },
		func() error {
			return r.client.NetworkingV1().NetworkPolicies(ns).Delete(ctx, name+"-ingress", opts)
		},
		func() error { return r.client.CoreV1().PersistentVolumeClaims(ns).Delete(ctx, name, opts) },
		func() error { return r.client.CoreV1().Secrets(ns).Delete(ctx, name, opts) },
	} {
		if err := del(); err != nil && !k8serrors.IsNotFound(err) {
			slog.Warn("removing idle VM runner", "owner", owner, "error", err)
		}
	}
	r.runnerMu.Lock()
	delete(r.runners, owner)
	r.runnerMu.Unlock()
	slog.Info("removed the VM runner of an owner with no vm agents left", "owner", owner)
}

func (r *AgentReconciler) runnerPodIP(ctx context.Context, owner string) (string, error) {
	if r.runnerIP != nil {
		return r.runnerIP(owner)
	}
	host := r.runnerHost(owner)
	addrs, err := net.DefaultResolver.LookupIP(ctx, "ip4", host)
	if err != nil {
		return "", fmt.Errorf("resolving VM runner %s: %w", host, err)
	}
	if len(addrs) == 0 {
		return "", fmt.Errorf("resolving VM runner %s: no address", host)
	}
	return addrs[0].String(), nil
}
