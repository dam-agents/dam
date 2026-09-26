package reconciler

import (
	"slices"

	cmv1 "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	cmmetav1 "github.com/cert-manager/cert-manager/pkg/apis/meta/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	envoyLeafSecretSuffix = "-envoy-tls"
)

func EnvoyLeafSecretName(instanceName string) string {
	return instanceName + envoyLeafSecretSuffix
}

func BuildEnvoyLeafCertificate(instanceName string, cfg *config.Config, ownerRef metav1.OwnerReference, secrets []corev1.Secret, l7Hosts []string) *cmv1.Certificate {
	var hosts []string
	for _, c := range chainsFromSecrets(secrets, l7Hosts) {
		hosts = append(hosts, c.Host)
	}
	if cfg.TelemetryEnabled() && !slices.Contains(hosts, cfg.TelemetryCollectorHost) {
		hosts = append(hosts, cfg.TelemetryCollectorHost)
	}
	slices.Sort(hosts)
	if len(hosts) == 0 {
		hosts = []string{instanceName + ".mitm-placeholder.invalid"}
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
	return cert
}
