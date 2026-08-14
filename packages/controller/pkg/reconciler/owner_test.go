package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func configMapOwnerRef(cm *corev1.ConfigMap) metav1.OwnerReference {
	return *metav1.NewControllerRef(cm, corev1.SchemeGroupVersion.WithKind("ConfigMap"))
}
