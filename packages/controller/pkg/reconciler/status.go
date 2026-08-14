package reconciler

import (
	"context"
	"fmt"

	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

func updateAgentStatus(ctx context.Context, dyn dynamic.Interface, namespace, name string, mutate func(*apiv1.AgentStatus)) error {
	cli := dyn.Resource(AgentsGVR).Namespace(namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		obj, err := cli.Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("getting agent %s/%s: %w", namespace, name, err)
		}
		var current apiv1.AgentStatus
		if raw, ok, _ := unstructured.NestedMap(obj.Object, "status"); ok && raw != nil {
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &current); err != nil {
				return fmt.Errorf("decoding agent status: %w", err)
			}
		}
		desired := *current.DeepCopy()
		mutate(&desired)
		if apiequality.Semantic.DeepEqual(current, desired) {
			return nil
		}
		statusMap, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&desired)
		if err != nil {
			return fmt.Errorf("encoding agent status: %w", err)
		}
		if err := unstructured.SetNestedMap(obj.Object, statusMap, "status"); err != nil {
			return fmt.Errorf("setting agent status: %w", err)
		}
		_, err = cli.UpdateStatus(ctx, obj, metav1.UpdateOptions{})
		return err
	})
}

func setStatusCondition(s *apiv1.AgentStatus, condType string, ok bool, trueReason, falseReason, message string, generation int64) {
	status := metav1.ConditionFalse
	reason := falseReason
	if ok {
		status = metav1.ConditionTrue
		reason = trueReason
	}
	apimeta.SetStatusCondition(&s.Conditions, metav1.Condition{
		Type:               condType,
		Status:             status,
		Reason:             reason,
		Message:            message,
		ObservedGeneration: generation,
	})
}
