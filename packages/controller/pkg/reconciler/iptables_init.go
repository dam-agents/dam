package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	typedcorev1 "k8s.io/client-go/kubernetes/typed/core/v1"
)

const iptablesInitContainerName = "egress-lockdown"

func ensureGatewayService(ctx context.Context, client kubernetes.Interface, desired *corev1.Service, kind, name string) (*corev1.Service, error) {
	cli := client.CoreV1().Services(desired.Namespace)

	existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
	switch {
	case errors.IsNotFound(err):
	case err != nil:
		return nil, fmt.Errorf("getting gateway Service: %w", err)
	case existing.Spec.ClusterIP != corev1.ClusterIPNone:
		return syncGatewayServicePorts(ctx, cli, existing, desired)
	default:
		slog.Info("migrating legacy headless gateway Service to ClusterIP",
			"service", desired.Name, kind, name)
		if err := cli.Delete(ctx, desired.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return nil, fmt.Errorf("deleting legacy headless Service: %w", err)
		}
		if err := waitForServiceDeleted(ctx, cli, desired.Name, 10*time.Second); err != nil {
			return nil, fmt.Errorf("waiting for legacy Service to delete: %w", err)
		}
	}

	created, err := cli.Create(ctx, desired, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("creating gateway Service: %w", err)
	}
	return created, nil
}

// UNIT_BOUNDARY_DESCRIPTION: an existing gateway Service keeps its ClusterIP, which a machine's allowlist and resolver both name, so only its ports and selector are brought to what is desired — a vm Agent cut over to its owner gateway selects that pod on its own ports — an Agent that moves to the vm Backend, or a gateway created before machines reached it transparently, gains the transparent ports in place.
func syncGatewayServicePorts(ctx context.Context, cli typedcorev1.ServiceInterface, existing, desired *corev1.Service) (*corev1.Service, error) {
	if sameServicePorts(existing.Spec.Ports, desired.Spec.Ports) && maps.Equal(existing.Spec.Selector, desired.Spec.Selector) {
		return existing, nil
	}
	updated := existing.DeepCopy()
	updated.Spec.Ports = desired.Spec.Ports
	updated.Spec.Selector = desired.Spec.Selector
	out, err := cli.Update(ctx, updated, metav1.UpdateOptions{})
	if err != nil {
		return nil, fmt.Errorf("updating gateway Service ports: %w", err)
	}
	return out, nil
}

func sameServicePorts(have, want []corev1.ServicePort) bool {
	if len(have) != len(want) {
		return false
	}
	key := func(p corev1.ServicePort) string {
		proto := p.Protocol
		if proto == "" {
			proto = corev1.ProtocolTCP
		}
		return fmt.Sprintf("%s/%s/%d/%s", p.Name, proto, p.Port, p.TargetPort.String())
	}
	seen := map[string]bool{}
	for _, p := range have {
		seen[key(p)] = true
	}
	for _, p := range want {
		if !seen[key(p)] {
			return false
		}
	}
	return true
}

func waitForServiceDeleted(ctx context.Context, cli corev1ServiceClient, serviceName string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		_, err := cli.Get(ctx, serviceName, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timeout after %s", timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

type corev1ServiceClient interface {
	Get(ctx context.Context, name string, opts metav1.GetOptions) (*corev1.Service, error)
}
