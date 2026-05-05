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

// dnsNamesFromRoutes extracts a sorted, deduplicated list of host-patterns
// from the per-Secret routes. Sort keeps Certificate spec stable across
// reconciles so cert-manager doesn't churn renewals.
func dnsNamesFromRoutes(routes []envoyRoute) []string {
	seen := make(map[string]struct{}, len(routes))
	out := make([]string, 0, len(routes))
	for _, r := range routes {
		if _, dup := seen[r.Host]; dup {
			continue
		}
		seen[r.Host] = struct{}{}
		out = append(out, r.Host)
	}
	sort.Strings(out)
	return out
}

// BuildEnvoyLeafCertificate is the desired cert-manager Certificate that
// produces the per-instance Envoy TLS Secret. Returns nil if there are no
// hosts to MITM (no credential Secrets) — the caller should treat that as
// "do not apply".
func BuildEnvoyLeafCertificate(instanceName string, cfg *config.Config, ownerCM *corev1.ConfigMap, secrets []corev1.Secret) *cmv1.Certificate {
	hosts := dnsNamesFromRoutes(routesFromSecrets(secrets))
	if len(hosts) == 0 {
		return nil
	}
	cert := &cmv1.Certificate{
		ObjectMeta: metav1.ObjectMeta{
			Name:      EnvoyLeafSecretName(instanceName),
			Namespace: cfg.Namespace,
			Labels:    map[string]string{"agent-platform.ai/instance": instanceName},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: cmv1.CertificateSpec{
			SecretName: EnvoyLeafSecretName(instanceName),
			DNSNames:   hosts,
			IssuerRef: cmmetav1.ObjectReference{
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
