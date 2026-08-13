package reconciler

import (
	"sort"

	cmv1 "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	cmmetav1 "github.com/cert-manager/cert-manager/pkg/apis/meta/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const (
	envoyLeafSecretSuffix = "-envoy-tls"
)

func EnvoyLeafSecretName(instanceName string) string {
	return instanceName + envoyLeafSecretSuffix
}

func dnsNamesFromChains(chains []envoyHostChain) []string {
	out := make([]string, 0, len(chains))
	for _, c := range chains {
		out = append(out, c.Host)
	}
	sort.Strings(out)
	return out
}

func containsHost(hosts []string, host string) bool {
	for _, h := range hosts {
		if h == host {
			return true
		}
	}
	return false
}

func leafPlaceholderDNS(instanceName string) string {
	return instanceName + ".mitm-placeholder.invalid"
}

func BuildEnvoyLeafCertificate(instanceName string, cfg *config.Config, ownerRef metav1.OwnerReference, secrets []corev1.Secret, l7Hosts []string) *cmv1.Certificate {
	hosts := dnsNamesFromChains(chainsFromSecrets(secrets, l7Hosts))
	if cfg.TelemetryEnabled() && !containsHost(hosts, cfg.TelemetryCollectorHost) {
		hosts = append(hosts, cfg.TelemetryCollectorHost)
		sort.Strings(hosts)
	}
	if len(hosts) == 0 {
		hosts = []string{leafPlaceholderDNS(instanceName)}
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
