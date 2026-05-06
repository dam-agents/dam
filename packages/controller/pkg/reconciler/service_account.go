package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// BuildInstanceServiceAccount renders the per-instance ServiceAccount whose
// name is the SPIFFE identity the api-server checks on inbound harness-port
// traffic (ADR-039). Both pods of the long-lived pair (agent + gateway) and
// every per-turn fork pair targeting this instance run as this SA, so a
// peer-principal of `cluster.local/ns/<ns>/sa/<name>` proves the caller is
// acting on behalf of the instance whose name equals `<name>`.
//
// `automountServiceAccountToken: false` on every consuming pod keeps the
// agent pod free of a real SA token; ambient workload identity is independent
// of the K8s SA token mount.
func BuildInstanceServiceAccount(name string, cfg *config.Config, ownerCM *corev1.ConfigMap) *corev1.ServiceAccount {
	falseVal := false
	return &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelInstance: name,
			},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		AutomountServiceAccountToken: &falseVal,
	}
}
