package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"sort"

	corev1 "k8s.io/api/core/v1"
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

// UNIT_BOUNDARY_DESCRIPTION: the one Secret an owner gateway mounts for credentials. It holds only the keys the gateway reads (SDS files, signing credentials and upstream CAs) of the Secrets granted to at least one of the owner's vm Agents, and only Secrets that carry the owner's own label: each agent's grants are already resolved against the owner's Secrets, and a Secret of another owner never matches that list. Each key is prefixed with its Secret's name, so two Connections never write the same file. The Secret carries the owner gateway's labels and no owner reference to an Agent, so it lives and goes with the owner gateway. Its content hash is an annotation, so an unchanged set is never written again.
func buildOwnerCredentialSecret(owner string, cfg *config.Config, granted [][]corev1.Secret, ownerRefs []metav1.OwnerReference) *corev1.Secret {
	byName := map[string]corev1.Secret{}
	for _, secrets := range granted {
		for _, s := range secrets {
			if s.Labels[envoyOwnerLabel] != owner || s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
				continue
			}
			byName[s.Name] = s
		}
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	data := map[string][]byte{}
	h := sha256.New()
	for _, name := range names {
		s := byName[name]
		for _, k := range ownerGatewayDataKeys(s) {
			key := name + "." + k
			data[key] = s.Data[k]
			fmt.Fprintf(h, "%s\n%x\n", key, sha256.Sum256(s.Data[k]))
		}
	}
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            ownerGatewayName(cfg.ReleaseName, owner) + "-credentials",
			Namespace:       cfg.Namespace,
			Labels:          ownerGatewayLabels(cfg.ReleaseName, owner),
			Annotations:     map[string]string{annOwnerCredentialsHash: hex.EncodeToString(h.Sum(nil)[:8])},
			OwnerReferences: ownerRefs,
		},
		Type: corev1.SecretTypeOpaque,
		Data: data,
	}
}

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

// UNIT_BOUNDARY_DESCRIPTION: writes the owner's credential Secret only when its content hash changed, and logs names and counts, never a value.
func (r *AgentReconciler) applyOwnerCredentialSecret(ctx context.Context, desired *corev1.Secret) (bool, error) {
	cli := r.client.CoreV1().Secrets(desired.Namespace)
	existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
		slog.Info("owner gateway: wrote the credential Secret", "secret", desired.Name, "keys", len(desired.Data))
		return err == nil, err
	}
	if err != nil {
		return false, err
	}
	if existing.Annotations[annOwnerCredentialsHash] == desired.Annotations[annOwnerCredentialsHash] && maps.Equal(existing.Labels, desired.Labels) {
		return false, nil
	}
	desired.ResourceVersion = existing.ResourceVersion
	_, err = cli.Update(ctx, desired, metav1.UpdateOptions{})
	if err == nil {
		slog.Info("owner gateway: rewrote the credential Secret", "secret", desired.Name, "keys", len(desired.Data))
	}
	return err == nil, err
}
