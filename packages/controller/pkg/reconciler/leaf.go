package reconciler

import (
	"slices"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	envoyLeafSecretSuffix = "-envoy-tls"
)

type Certificate struct {
	metav1.ObjectMeta `json:"metadata,omitempty"`
	Spec              CertificateSpec `json:"spec"`
	Status            struct{}        `json:"status"`
}

type CertificateSpec struct {
	DNSNames       []string                   `json:"dnsNames,omitempty"`
	SecretName     string                     `json:"secretName"`
	SecretTemplate *CertificateSecretTemplate `json:"secretTemplate,omitempty"`
	IssuerRef      IssuerReference            `json:"issuerRef"`
	Usages         []string                   `json:"usages,omitempty"`
	PrivateKey     *CertificatePrivateKey     `json:"privateKey,omitempty"`
}

type CertificateSecretTemplate struct {
	Labels map[string]string `json:"labels,omitempty"`
}

type IssuerReference struct {
	Name  string `json:"name"`
	Kind  string `json:"kind,omitempty"`
	Group string `json:"group,omitempty"`
}

type CertificatePrivateKey struct {
	Algorithm string `json:"algorithm,omitempty"`
	Size      int    `json:"size,omitempty"`
}

func EnvoyLeafSecretName(instanceName string) string {
	return instanceName + envoyLeafSecretSuffix
}

func BuildEnvoyLeafCertificate(instanceName string, cfg *config.Config, ownerRef metav1.OwnerReference, secrets []corev1.Secret, l7Hosts []string) *Certificate {
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
	cert := &Certificate{
		ObjectMeta: metav1.ObjectMeta{
			Name:            EnvoyLeafSecretName(instanceName),
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: instanceName},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: CertificateSpec{
			SecretName: EnvoyLeafSecretName(instanceName),
			DNSNames:   hosts,
			IssuerRef: IssuerReference{
				Name:  cfg.EnvoyMitmCAIssuer,
				Kind:  "ClusterIssuer",
				Group: "cert-manager.io",
			},
			PrivateKey: &CertificatePrivateKey{
				Algorithm: "ECDSA",
				Size:      256,
			},
		},
	}
	return cert
}
