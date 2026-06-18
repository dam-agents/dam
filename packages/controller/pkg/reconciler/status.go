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

// updateAgentStatus read-modify-writes the Agent's status subresource.
// `mutate` receives the current observed status and adjusts it in
// place — typically via setStatusCondition for conditions plus direct Phase /
// ObservedGeneration assignment. The write is skipped when the mutation is a
// no-op, which is load-bearing: the controller watches Agents, so an
// unconditional status write would re-trigger reconcile and hot-loop.
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
			return nil // no-op — avoid status churn re-triggering reconcile
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

// setStatusCondition stamps a condition onto the status, managing
// LastTransitionTime (preserved when the status value is unchanged) so repeated
// reconciles with the same observation produce a no-op.
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

// writeForkStatus overwrites the Fork's status subresource. Forks
// carry no conditions, so this is a whole-status replace; the no-op guard keeps
// an unchanged observation from re-triggering reconcile (the controller watches
// Forks).
func writeForkStatus(ctx context.Context, dyn dynamic.Interface, namespace, name string, desired apiv1.ForkStatus) error {
	cli := dyn.Resource(ForksGVR).Namespace(namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		obj, err := cli.Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("getting fork %s/%s: %w", namespace, name, err)
		}
		var current apiv1.ForkStatus
		if raw, ok, _ := unstructured.NestedMap(obj.Object, "status"); ok && raw != nil {
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &current); err != nil {
				return fmt.Errorf("decoding fork status: %w", err)
			}
		}
		if apiequality.Semantic.DeepEqual(current, desired) {
			return nil
		}
		statusMap, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&desired)
		if err != nil {
			return fmt.Errorf("encoding fork status: %w", err)
		}
		if err := unstructured.SetNestedMap(obj.Object, statusMap, "status"); err != nil {
			return fmt.Errorf("setting fork status: %w", err)
		}
		_, err = cli.UpdateStatus(ctx, obj, metav1.UpdateOptions{})
		return err
	})
}
