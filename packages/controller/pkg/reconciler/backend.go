package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	apiequality "k8s.io/apimachinery/pkg/api/equality"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: AgentBackend is where an Agent and its observations come from, and the
// UNIT_BOUNDARY_DESCRIPTION: controller has two: the custom resources while they are authoritative, and
// UNIT_BOUNDARY_DESCRIPTION: the control schema after the switch. Everything above it works on the Agent
// UNIT_BOUNDARY_DESCRIPTION: object either way.
type AgentBackend interface {
	Get(ctx context.Context, name string) (*unstructured.Unstructured, error)
	List(ctx context.Context, selector labels.Selector) ([]unstructured.Unstructured, error)
	UpdateStatus(ctx context.Context, name string, mutate func(*apiv1.AgentStatus)) error
	PatchAgent(ctx context.Context, name string, ann map[string]*string) error
	StampReclaim(ctx context.Context, name, stamp, revision string) error
	GetBudget(ctx context.Context, owner string) (*unstructured.Unstructured, error)
	// UNIT_BOUNDARY_DESCRIPTION: SpecWritable is false once the rows own the definition: the controller
	// UNIT_BOUNDARY_DESCRIPTION: resolves no default of its own into a definition it only renders.
	SpecWritable() bool
	// UNIT_BOUNDARY_DESCRIPTION: Healthy is the store's answer on whether decisions may be made at all.
	// UNIT_BOUNDARY_DESCRIPTION: A store that could not read lately answers an error, and hibernation,
	// UNIT_BOUNDARY_DESCRIPTION: reclaim and collection wait rather than act on a stale fleet.
	Healthy() error
}

// UNIT_BOUNDARY_DESCRIPTION: crAgentBackend is the custom-resource authority: the same calls the
// UNIT_BOUNDARY_DESCRIPTION: controller made before the rows existed.
type crAgentBackend struct {
	dynamic   dynamic.Interface
	namespace string
}

func (b crAgentBackend) Get(ctx context.Context, name string) (*unstructured.Unstructured, error) {
	return b.dynamic.Resource(AgentsGVR).Namespace(b.namespace).Get(ctx, name, metav1.GetOptions{})
}

func (b crAgentBackend) List(ctx context.Context, selector labels.Selector) ([]unstructured.Unstructured, error) {
	list, err := b.dynamic.Resource(AgentsGVR).Namespace(b.namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func (b crAgentBackend) UpdateStatus(ctx context.Context, name string, mutate func(*apiv1.AgentStatus)) error {
	_, err := updateAgentStatusWhile(ctx, b.dynamic, b.namespace, name, nil, mutate)
	return err
}

func (b crAgentBackend) PatchAgent(ctx context.Context, name string, ann map[string]*string) error {
	return patchAgentAnnotations(ctx, b.dynamic, b.namespace, name, ann)
}

func (b crAgentBackend) StampReclaim(ctx context.Context, name, stamp, revision string) error {
	return stampAnnotation(ctx, b.dynamic, b.namespace, name, annReclaimedAt, stamp, revision)
}

func (b crAgentBackend) GetBudget(ctx context.Context, owner string) (*unstructured.Unstructured, error) {
	return b.dynamic.Resource(UserBudgetsGVR).Namespace(b.namespace).Get(ctx, "budget-"+owner, metav1.GetOptions{})
}

func (crAgentBackend) SpecWritable() bool { return true }

func (crAgentBackend) Healthy() error { return nil }

func updateAgentStatus(ctx context.Context, dyn dynamic.Interface, namespace, name string, mutate func(*apiv1.AgentStatus)) error {
	_, err := updateAgentStatusWhile(ctx, dyn, namespace, name, nil, mutate)
	return err
}

// UNIT_BOUNDARY_DESCRIPTION: a status update that applies only while `guard` holds for the Agent as read. The update carries the version it read, so a write to the Agent in between — its annotations included — makes it conflict and read again, and the guard is asked again of what changed. Reports whether the update was applied, or was already in place.
func updateAgentStatusWhile(ctx context.Context, dyn dynamic.Interface, namespace, name string, guard func(*unstructured.Unstructured) bool, mutate func(*apiv1.AgentStatus)) (bool, error) {
	cli := dyn.Resource(AgentsGVR).Namespace(namespace)
	applied := false
	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
		applied = false
		obj, err := cli.Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("getting agent %s/%s: %w", namespace, name, err)
		}
		if guard != nil && !guard(obj) {
			return nil
		}
		applied = true
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
	return applied, err
}

// UNIT_BOUNDARY_DESCRIPTION: a nil value removes the annotation. Entries are sorted so one change always renders as one patch.
func patchAgentAnnotations(ctx context.Context, dyn dynamic.Interface, namespace, name string, ann map[string]*string) error {
	entries := make([]string, 0, len(ann))
	for k, v := range ann {
		if v == nil {
			entries = append(entries, fmt.Sprintf("%q:null", k))
		} else {
			entries = append(entries, fmt.Sprintf("%q:%q", k, *v))
		}
	}
	sort.Strings(entries)
	patch := fmt.Sprintf(`{"metadata":{"annotations":{%s}}}`, strings.Join(entries, ","))
	_, err := dyn.Resource(AgentsGVR).Namespace(namespace).
		Patch(ctx, name, types.MergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}

func stampAnnotation(ctx context.Context, dyn dynamic.Interface, namespace, name, key, value, resourceVersion string) error {
	meta := map[string]any{"annotations": map[string]string{key: value}}
	if resourceVersion != "" {
		meta["resourceVersion"] = resourceVersion
	}
	raw, err := json.Marshal(map[string]any{"metadata": meta})
	if err != nil {
		return fmt.Errorf("encoding the %s stamp: %w", key, err)
	}
	if _, err := dyn.Resource(AgentsGVR).Namespace(namespace).
		Patch(ctx, name, types.MergePatchType, raw, metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("stamping %s on agent %s: %w", key, name, err)
	}
	return nil
}
