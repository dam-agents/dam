package reconciler

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"
	"gopkg.in/yaml.v3"

	"github.com/kagenti/platform/packages/controller/pkg/types"
)

func WriteInstanceStatus(ctx context.Context, client kubernetes.Interface, namespace, name string, status *types.InstanceStatus) error {
	return writeStatus(ctx, client, namespace, name, status)
}

func WriteScheduleStatus(ctx context.Context, client kubernetes.Interface, namespace, name string, status *types.ScheduleStatus) error {
	return writeStatus(ctx, client, namespace, name, status)
}

func WriteForkStatus(ctx context.Context, client kubernetes.Interface, namespace, name string, status *types.ForkStatus) error {
	return writeStatus(ctx, client, namespace, name, status)
}

func writeStatus(ctx context.Context, client kubernetes.Interface, namespace, name string, status any) error {
	statusYAML, err := yaml.Marshal(status)
	if err != nil {
		return fmt.Errorf("marshaling status: %w", err)
	}
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		cm, err := client.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("getting configmap %s/%s: %w", namespace, name, err)
		}
		if cm.Data == nil {
			cm.Data = make(map[string]string)
		}
		cm.Data["status.yaml"] = string(statusYAML)
		_, err = client.CoreV1().ConfigMaps(namespace).Update(ctx, cm, metav1.UpdateOptions{})
		return err
	})
}
