package reconciler

import (
	"sort"

	cmv1 "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	cmmetav1 "github.com/cert-manager/cert-manager/pkg/apis/meta/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// Per-instance Envoy leaf certificate, signed by the cluster-wide MITM CA
// (provisioned via the Helm chart's cert-manager templates). Envoy uses the
// resulting Secret to terminate the agent's TLS during credential injection.
//
// The leaf SAN-list is the deduped set of host-patterns from the owner's
// credential Secrets; if no Secrets exist, the Certificate is not rendered.

const (
	envoyLeafSecretSuffix = "-envoy-tls"
)

// EnvoyLeafSecretName returns the per-instance Secret name produced by
// cert-manager.
func EnvoyLeafSecretName(instanceName string) string {
	return instanceName + envoyLeafSecretSuffix
}

// dnsNamesFromChains extracts a sorted list of host-patterns from the
// per-host chains. Chains are already host-unique, but we sort the result
// to keep the Certificate spec stable across reconciles so cert-manager
// doesn't churn renewals.
func dnsNamesFromChains(chains []envoyHostChain) []string {
	out := make([]string, 0, len(chains))
	for _, c := range chains {
		out = append(out, c.Host)
	}
	sort.Strings(out)
	return out
}

// BuildEnvoyLeafCertificate is the desired cert-manager Certificate that
// produces the per-instance Envoy TLS Secret. Returns nil if there are no
// hosts to MITM (no credential Secrets) — the caller should treat that as
// "do not apply".
func BuildEnvoyLeafCertificate(instanceName string, cfg *config.Config, ownerRef metav1.OwnerReference, secrets []corev1.Secret) *cmv1.Certificate {
	hosts := dnsNamesFromChains(chainsFromSecrets(secrets))
	if len(hosts) == 0 {
		return nil
	}
	cert := &cmv1.Certificate{
		ObjectMeta: metav1.ObjectMeta{
			Name:            EnvoyLeafSecretName(instanceName),
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: instanceName},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: cmv1.CertificateSpec{
			SecretName: EnvoyLeafSecretName(instanceName),
			DNSNames:   hosts,
			IssuerRef: cmmetav1.IssuerReference{
				Name:  cfg.EnvoyMitmCAIssuer,
				Kind:  "ClusterIssuer",
				Group: "cert-manager.io",
			},
			PrivateKey: &cmv1.CertificatePrivateKey{
				Algorithm: cmv1.ECDSAKeyAlgorithm,
				Size:      256,
			},
		},
	}
	if cfg.EnvoyMitmLeafDuration > 0 {
		cert.Spec.Duration = &metav1.Duration{Duration: cfg.EnvoyMitmLeafDuration}
	}
	if cfg.EnvoyMitmLeafRenewBefore > 0 {
		cert.Spec.RenewBefore = &metav1.Duration{Duration: cfg.EnvoyMitmLeafRenewBefore}
	}
	return cert
}
