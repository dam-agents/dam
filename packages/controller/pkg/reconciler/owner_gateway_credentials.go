package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"sort"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const annOwnerCredentialsHash = "agent-platform.ai/credentials-hash"

func ownerGatewayName(release, owner string) string {
	return fmt.Sprintf("%s-gateway-%s", release, runnerSuffix(owner))
}

func ownerGatewayLabels(release, owner string) map[string]string {
	return map[string]string{
		"app.kubernetes.io/component": ownerGatewayComponent,
		"app.kubernetes.io/name":      "platform",
		"app.kubernetes.io/instance":  release,
		envoyOwnerLabel:               owner,
		LabelRole:                     RoleGateway,
	}
}

const (
	ownerGatewayComponent  = "owner-gateway"
	ownerGatewayLeafSuffix = "-leaf"
)

func ownerGatewayDataKeys(s corev1.Secret) []string {
	keys := gatewayDataKeys(s)
	for _, e := range parseConnectionHosts(s) {
		if e.CAKey != "" && !unsafeDataKey(e.CAKey) && len(s.Data[e.CAKey]) > 0 && !slices.Contains(keys, e.CAKey) {
			keys = append(keys, e.CAKey)
		}
	}
	sort.Strings(keys)
	return keys
}

type ownerLeafAgent struct {
	Secrets []corev1.Secret
	L7Hosts []string
}

// UNIT_BOUNDARY_DESCRIPTION: one leaf certificate for the owner gateway, naming every host any of its agents intercepts. A machine trusts the platform CA for every name anyway, so one leaf per owner gives a guest nothing a per-agent leaf did not. A new host re-issues it, and Envoy reads the new files through its watched directory without a restart.
func buildOwnerLeafCertificate(owner string, cfg *config.Config, agents []ownerLeafAgent, ownerRefs []metav1.OwnerReference) *Certificate {
	name := ownerGatewayName(cfg.ReleaseName, owner)
	var hosts []string
	for _, a := range agents {
		for _, c := range chainsFromSecrets(a.Secrets, a.L7Hosts) {
			if !slices.Contains(hosts, c.Host) {
				hosts = append(hosts, c.Host)
			}
		}
	}
	if cfg.TelemetryEnabled() && !slices.Contains(hosts, cfg.TelemetryCollectorHost) {
		hosts = append(hosts, cfg.TelemetryCollectorHost)
	}
	slices.Sort(hosts)
	if len(hosts) == 0 {
		hosts = []string{name + ".mitm-placeholder.invalid"}
	}
	labels := ownerGatewayLabels(cfg.ReleaseName, owner)
	return &Certificate{
		ObjectMeta: metav1.ObjectMeta{Name: name + ownerGatewayLeafSuffix, Namespace: cfg.Namespace, Labels: labels, OwnerReferences: ownerRefs},
		Spec: CertificateSpec{
			SecretName:     name + ownerGatewayLeafSuffix,
			SecretTemplate: &CertificateSecretTemplate{Labels: labels},
			DNSNames:       hosts,
			IssuerRef:      IssuerReference{Name: cfg.EnvoyMitmCAIssuer, Kind: "ClusterIssuer", Group: "cert-manager.io"},
			PrivateKey:     &CertificatePrivateKey{Algorithm: "ECDSA", Size: 256},
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: writes the owner gateway's files only when what it mounts changed, and logs counts, never a value. Its content hash is an annotation over the credential keys alone, which is what a pod's credential sync is nudged by, so a listener change never asks for one.
func (r *AgentReconciler) applyOwnerGatewayFiles(ctx context.Context, desired *corev1.Secret) error {
	cli := r.client.CoreV1().Secrets(desired.Namespace)
	existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		if _, err = cli.Create(ctx, desired, metav1.CreateOptions{}); err != nil {
			return err
		}
		slog.Info("owner gateway: wrote its files", "secret", desired.Name, "keys", len(desired.Data))
		return nil
	}
	if err != nil {
		return err
	}
	// UNIT_BOUNDARY_DESCRIPTION: the annotations are part of what this object means: the repair state lives in one of them, so a write that changes only that must still reach the cluster, or the state adopted in memory would be a state the Secret never carried.
	if equality.Semantic.DeepEqual(existing.Data, desired.Data) && maps.Equal(existing.Labels, desired.Labels) && maps.Equal(existing.Annotations, desired.Annotations) {
		return nil
	}
	desired.ResourceVersion = existing.ResourceVersion
	if _, err = cli.Update(ctx, desired, metav1.UpdateOptions{}); err != nil {
		return err
	}
	slog.Info("owner gateway: rewrote its files", "secret", desired.Name, "keys", len(desired.Data))
	return nil
}
