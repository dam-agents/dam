package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const iptablesInitContainerName = "egress-lockdown"

// buildIptablesInitContainer pins the agent pod's OUTPUT chain to
// "loopback + ESTABLISHED + paired gateway only". Returns nil when the
// feature is off, the image is unset, or the gateway IP isn't known yet.
//
// Targets the SIG Release `registry.k8s.io/build-image/distroless-iptables`
// image, which ships both `iptables-nft` and `iptables-legacy`. We
// invoke the backend binary directly rather than the wrapped `iptables`
// entrypoint — the wrapper auto-detects nft vs legacy by writing
// symlinks at runtime, which the container's `readOnlyRootFilesystem:
// true` blocks. The script probes nft first and falls back to legacy:
// Kata Containers guest kernels (used by OpenShift Sandboxed Containers
// and others) commonly ship `CONFIG_IP_NF_IPTABLES_LEGACY=y` but not
// `CONFIG_NF_TABLES`, so `iptables-nft` fails with
// "Failed to initialize nft: Protocol not supported" while
// `iptables-legacy` works against the same kernel.
func buildIptablesInitContainer(cfg *config.Config, gatewayClusterIP string) *corev1.Container {
	cfgInit := cfg.AgentBase.IptablesInit
	if cfgInit == nil || !cfgInit.Enabled || cfgInit.Image == "" || gatewayClusterIP == "" {
		return nil
	}

	// IPv6: loopback only, then DROP. The gateway Service is IPv4 (no
	// dual-stack ClusterIP), so there's no IPv6 ACCEPT for it. Without
	// this, an agent could exfil over IPv6 if the node has v6
	// connectivity — our IPv4 rules wouldn't see those packets at all.
	//
	// Probe by listing the default OUTPUT chain — if the backend's
	// netlink subsystem isn't compiled into the running kernel, the list
	// itself errors out before any rule application. Fail-closed when
	// both backends are unusable: defense-in-depth is the whole point of
	// this container, so the pod must not silently fall back to
	// NetworkPolicy-only.
	script := `set -eu
echo "egress-lockdown: gateway=$GATEWAY_IP:$ENVOY_PORT"
if iptables-nft -nL OUTPUT >/dev/null 2>&1; then
    IPT=iptables-nft
    IP6T=ip6tables-nft
elif iptables-legacy -nL OUTPUT >/dev/null 2>&1; then
    IPT=iptables-legacy
    IP6T=ip6tables-legacy
else
    echo "egress-lockdown: FATAL — neither iptables-nft nor iptables-legacy works against this kernel (CONFIG_NF_TABLES and CONFIG_IP_NF_IPTABLES both absent?)" >&2
    exit 1
fi
echo "egress-lockdown: backend=$IPT"
"$IPT" -A OUTPUT -o lo -j ACCEPT
"$IPT" -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
"$IPT" -A OUTPUT -d "$GATEWAY_IP" -p tcp --dport "$ENVOY_PORT" -j ACCEPT
"$IPT" -A OUTPUT -j DROP
"$IP6T" -A OUTPUT -o lo -j ACCEPT
"$IP6T" -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
"$IP6T" -A OUTPUT -j DROP
echo "egress-lockdown: gateway-only IPv4 + IPv6 drop applied"
`

	// Needs root + NET_ADMIN/NET_RAW for the netfilter ops. K8s/containerd
	// don't promote capabilities.add into the ambient set, so a non-root
	// process can't actually USE the granted caps at exec time (Effective
	// is cleared). Container-scoped runAsUser: 0 + runAsNonRoot: false
	// override the pod-level non-root floor; the runtime agent container
	// stays unprivileged (these caps live only on this short-lived init
	// container).
	runAsRoot := int64(0)
	return &corev1.Container{
		Name:    iptablesInitContainerName,
		Image:   cfgInit.Image,
		Command: []string{"/bin/sh", "-c", script},
		Env: []corev1.EnvVar{
			{Name: "GATEWAY_IP", Value: gatewayClusterIP},
			{Name: "ENVOY_PORT", Value: fmt.Sprintf("%d", cfg.EnvoyPort)},
		},
		SecurityContext: &corev1.SecurityContext{
			RunAsUser:                &runAsRoot,
			RunAsNonRoot:             ptrBool(false),
			AllowPrivilegeEscalation: ptrBool(false),
			ReadOnlyRootFilesystem:   ptrBool(true),
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
				Add:  []corev1.Capability{"NET_ADMIN", "NET_RAW"},
			},
		},
	}
}

// ensureGatewayService applies the paired gateway Service and returns the
// live object (with assigned ClusterIP) in one call — avoids the
// reconcile-N/N+1 race where a follow-up Get may not see the just-assigned
// IP. Handles the legacy headless → ClusterIP migration: `.spec.clusterIP`
// is immutable, so the old object must be deleted before recreating.
func ensureGatewayService(ctx context.Context, client kubernetes.Interface, desired *corev1.Service, kind, name string) (*corev1.Service, error) {
	cli := client.CoreV1().Services(desired.Namespace)

	existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
	switch {
	case errors.IsNotFound(err):
		// fall through to Create
	case err != nil:
		return nil, fmt.Errorf("getting gateway Service: %w", err)
	case existing.Spec.ClusterIP != corev1.ClusterIPNone:
		return existing, nil
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

// waitForServiceDeleted polls until Get returns NotFound or the timeout
// expires — bridges the async window between Delete returning and the
// object actually disappearing.
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

// corev1ServiceClient narrows the typed Services interface to just what
// waitForServiceDeleted needs, so we don't pull in the typed client package.
type corev1ServiceClient interface {
	Get(ctx context.Context, name string, opts metav1.GetOptions) (*corev1.Service, error)
}
