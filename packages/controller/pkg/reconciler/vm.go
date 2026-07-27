package reconciler

import (
	"context"
	"encoding/json"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	ktypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// reconcileAgentVM is the vm-backend counterpart of the agent-StatefulSet
// apply block: explicit workspace PVCs (no volumeClaimTemplates on a VM),
// the cloud-init Secret, and the VirtualMachine itself. Transient waits
// (leaf CA not yet issued) return a plain error so the caller requeues
// without stamping ReconcileError — same standing as the gateway ClusterIP
// wait. Warm-pool claiming and roll-rev are container-backend concepts and
// deliberately don't apply here (a VM picks up template changes on its next
// stop/start cycle).
func (r *AgentReconciler) reconcileAgentVM(ctx context.Context, agent *apiv1.Agent, ownerRef metav1.OwnerReference, gatewayClusterIP string, running bool) error {
	name := agent.Name
	agentSpec := &agent.Spec

	for _, pvc := range BuildVMWorkspacePVCs(name, agentSpec, r.config) {
		_, err := r.client.CoreV1().PersistentVolumeClaims(pvc.Namespace).Get(ctx, pvc.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().PersistentVolumeClaims(pvc.Namespace).Create(ctx, pvc, metav1.CreateOptions{})
		}
		if err != nil {
			return fmt.Errorf("ensuring workspace pvc %s: %w", pvc.Name, err)
		}
	}

	// The guest trusts the MITM CA via cloud-init (the container backend
	// mounts the same key from the leaf Secret). cert-manager may still be
	// issuing on the first pass — requeue quietly.
	leaf, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, EnvoyLeafSecretName(name), metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return fmt.Errorf("leaf CA Secret not yet issued, requeuing")
	}
	if err != nil {
		return fmt.Errorf("reading leaf CA secret: %w", err)
	}
	caCrt := string(leaf.Data["ca.crt"])
	if caCrt == "" {
		return fmt.Errorf("leaf CA Secret has no ca.crt yet, requeuing")
	}

	cloudInit, err := BuildVMCloudInitSecret(name, agentSpec, r.config, ownerRef, gatewayClusterIP, caCrt)
	if err != nil {
		return err
	}
	if err := r.applySecret(ctx, cloudInit); err != nil {
		return fmt.Errorf("applying cloud-init secret: %w", err)
	}

	vm, err := BuildAgentVirtualMachine(name, agentSpec, r.config, ownerRef, gatewayClusterIP)
	if err != nil {
		return err
	}
	return r.applyVirtualMachine(ctx, vm, running)
}

// applyVirtualMachine creates or updates the VM, owning its runStrategy per
// the activity-driven model exactly like applyStatefulSet owns replicas: when
// `running` it sets Always; when not it *preserves* the existing strategy —
// the reconciler wakes but never hibernates (scale-down is the idle checker's
// probe-gated job via haltAgentVMs).
func (r *AgentReconciler) applyVirtualMachine(ctx context.Context, desired *unstructured.Unstructured, running bool) error {
	cli := r.dynamic.Resource(VirtualMachinesGVR).Namespace(desired.GetNamespace())
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := cli.Get(ctx, desired.GetName(), metav1.GetOptions{})
		if errors.IsNotFound(err) {
			if running {
				_ = unstructured.SetNestedField(desired.Object, vmRunStrategyAlways, "spec", "runStrategy")
			}
			_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		strategy := vmRunStrategyAlways
		if !running {
			strategy, _, _ = unstructured.NestedString(existing.Object, "spec", "runStrategy")
			if strategy == "" {
				strategy = vmRunStrategyHalted
			}
		}
		template, _, err := unstructured.NestedMap(desired.Object, "spec", "template")
		if err != nil {
			return err
		}
		if err := unstructured.SetNestedMap(existing.Object, template, "spec", "template"); err != nil {
			return err
		}
		if err := unstructured.SetNestedField(existing.Object, strategy, "spec", "runStrategy"); err != nil {
			return err
		}
		_, err = cli.Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

// haltAgentVMs sets runStrategy=Halted on the agent's VirtualMachines (by
// LabelAgent, mirroring the StatefulSet scale-to-zero). A NotFound CRD means
// no KubeVirt in this install — nothing to halt.
func haltAgentVMs(ctx context.Context, dyn dynamic.Interface, namespace, name string) error {
	if dyn == nil {
		return nil
	}
	vms, err := dyn.Resource(VirtualMachinesGVR).Namespace(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + name,
	})
	if err != nil {
		// A 404 here means the VirtualMachine CRD is absent (KubeVirt not
		// installed) — container-only installs have no VMs to halt.
		if errors.IsNotFound(err) {
			return nil
		}
		return fmt.Errorf("listing virtualmachines for %s: %w", name, err)
	}
	patch, _ := json.Marshal(map[string]any{"spec": map[string]any{"runStrategy": vmRunStrategyHalted}})
	for i := range vms.Items {
		vmName := vms.Items[i].GetName()
		if _, err := dyn.Resource(VirtualMachinesGVR).Namespace(namespace).
			Patch(ctx, vmName, ktypes.MergePatchType, patch, metav1.PatchOptions{}); err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("halting virtualmachine %s: %w", vmName, err)
		}
	}
	return nil
}

// vmCurrentAndReady is podCurrentAndReady's vm-backend counterpart: the
// virt-launcher pod (which carries the pair labels from the VM template) must
// be Ready and not terminating. There is no controller-revision-hash
// analogue — a VM applies template changes on its next stop/start, so
// readiness deliberately reflects the running instance, stale or not.
func (r *AgentReconciler) vmCurrentAndReady(ctx context.Context, name string) bool {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("%s=%s,%s=%s", LabelPair, name, LabelRole, RoleAgent),
	})
	if err != nil {
		return false
	}
	for i := range pods.Items {
		p := &pods.Items[i]
		if p.DeletionTimestamp == nil && isPodReady(*p) {
			return true
		}
	}
	return false
}

// applySecret creates or updates a Secret (StringData replace).
func (r *AgentReconciler) applySecret(ctx context.Context, desired *corev1.Secret) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.CoreV1().Secrets(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().Secrets(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		existing.Data = nil
		existing.StringData = desired.StringData
		existing.Labels = desired.Labels
		existing.OwnerReferences = desired.OwnerReferences
		_, err = r.client.CoreV1().Secrets(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}
