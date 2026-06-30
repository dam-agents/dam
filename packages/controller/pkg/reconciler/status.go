package reconciler

import (
	"context"
	"fmt"

	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
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

// writeConditionlessStatus overwrites a CR's status subresource as a
// whole-status replace (no condition merging) with a no-op guard that keeps an
// unchanged observation from re-triggering reconcile (the controller watches
// these CRs). Used for Forks and Runs, which carry no conditions; `kind` names
// the resource in errors.
func writeConditionlessStatus[T any](ctx context.Context, dyn dynamic.Interface, gvr schema.GroupVersionResource, kind, namespace, name string, desired T) error {
	cli := dyn.Resource(gvr).Namespace(namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		obj, err := cli.Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("getting %s %s/%s: %w", kind, namespace, name, err)
		}
		var current T
		if raw, ok, _ := unstructured.NestedMap(obj.Object, "status"); ok && raw != nil {
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &current); err != nil {
				return fmt.Errorf("decoding %s status: %w", kind, err)
			}
		}
		if apiequality.Semantic.DeepEqual(current, desired) {
			return nil
		}
		statusMap, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&desired)
		if err != nil {
			return fmt.Errorf("encoding %s status: %w", kind, err)
		}
		if err := unstructured.SetNestedMap(obj.Object, statusMap, "status"); err != nil {
			return fmt.Errorf("setting %s status: %w", kind, err)
		}
		_, err = cli.UpdateStatus(ctx, obj, metav1.UpdateOptions{})
		return err
	})
}

func writeForkStatus(ctx context.Context, dyn dynamic.Interface, namespace, name string, desired apiv1.ForkStatus) error {
	return writeConditionlessStatus(ctx, dyn, ForksGVR, "fork", namespace, name, desired)
}

func writeRunStatus(ctx context.Context, dyn dynamic.Interface, namespace, name string, desired apiv1.RunStatus) error {
	return writeConditionlessStatus(ctx, dyn, RunsGVR, "run", namespace, name, desired)
}
