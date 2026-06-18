package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// configMapOwnerRef builds a controller owner reference to a ConfigMap. Used
// only by the builder unit tests: production renders Agent/Fork-owned children
// via agentOwnerRef / forkOwnerRef (the resources are custom resources now),
// but the builders take a metav1.OwnerReference so a ConfigMap-owned
// fixture is a valid stand-in for asserting builder output.
func configMapOwnerRef(cm *corev1.ConfigMap) metav1.OwnerReference {
	return *metav1.NewControllerRef(cm, corev1.SchemeGroupVersion.WithKind("ConfigMap"))
}
