package reconciler

import (
	"context"
	stderrors "errors"
	"fmt"
	"net"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// UNIT_BOUNDARY_DESCRIPTION: the agent home. platform-init, which is Rust and runs inside the guest, bind-mounts the machine's disk here, so the path is stated in the vm runner's contract fixtures and a test here holds this constant to them, because nothing else would notice the two drifting.
const agentHomeDir = "/home/agent"

func portInt32(p int) int32 {
	if p < 0 || p > 65535 {
		panic(fmt.Sprintf("port out of range: %d (must be 0..65535)", p))
	}
	return int32(p)
}

const (
	LabelAgent  = "agent-platform.ai/agent"
	LabelPair   = "agent-platform.ai/pair"
	LabelRole   = "agent-platform.ai/role"
	RoleAgent   = "agent"
	RoleGateway = "gateway"
)

const (
	annRollRev             = "agent-platform.ai/roll-rev"
	annStatefulSetTemplate = "agent-platform.ai/statefulset-template"
)

// UNIT_BOUNDARY_DESCRIPTION: an Agent's secretRef names a Secret by name alone, in the namespace that also holds every other owner's credentials, the runners' tokens and the gateways' keys, and every key of it lands in the machine's environment. So only a Secret carrying the Agent's own owner label is honoured, and never one the platform manages — the credentials a gateway injects and the pull Secrets the api-server writes carry the managed-by label, and a runner's token and certificate its component — because those are meant for everything except the agent. The refusal names the label to add rather than the Secret's contents, so an operator's Secret that predates the rule is one label away from working.
func (r *AgentReconciler) ownedSecretRef(ctx context.Context, agent *apiv1.Agent) (*corev1.Secret, error) {
	name := agent.Spec.SecretRef
	if name == "" {
		return nil, nil
	}
	sec, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("reading secretRef %s: %w", name, err)
	}
	owner := agent.Labels[envoyOwnerLabel]
	if owner == "" || sec.Labels[envoyOwnerLabel] != owner {
		return nil, secretRefRefused(fmt.Sprintf("secretRef %s does not carry this agent's owner label (%s), so its keys are not given to the agent; label the Secret with its owner to use it", name, envoyOwnerLabel))
	}
	if sec.Labels[envoyManagedByLabel] != "" || sec.Labels["app.kubernetes.io/component"] == vmRunnerComponent {
		return nil, secretRefRefused(fmt.Sprintf("secretRef %s is a Secret the platform manages, which is never given to an agent", name))
	}
	return sec, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a secretRef the agent may not have, as against one that could not be read. A refusal is final for the Secret as it stands, so the agent is rendered without it — which also takes it off an agent that already had it — and the reconcile reports it; a read that failed is retried instead.
type secretRefRefused string

func (e secretRefRefused) Error() string { return string(e) }

// UNIT_BOUNDARY_DESCRIPTION: the agent's spec as its workload is rendered: the stored spec, less a secretRef the check refused, and the refusal to report once the rest of the reconcile is done.
func (r *AgentReconciler) renderedSpec(ctx context.Context, agent *apiv1.Agent) (*apiv1.AgentSpec, string, error) {
	_, err := r.ownedSecretRef(ctx, agent)
	var refused secretRefRefused
	switch {
	case stderrors.As(err, &refused):
		spec := agent.Spec
		spec.SecretRef = ""
		return &spec, refused.Error(), nil
	case err != nil:
		return nil, "", err
	}
	return &agent.Spec, "", nil
}

func agentProxyAddr(cfg *config.Config, gatewayClusterIP string) string {
	return fmt.Sprintf("http://%s:%d", gatewayClusterIP, cfg.EnvoyPort)
}

func agentPlatformEnv(name string, cfg *config.Config, agentHome, proxyAddr string) []corev1.EnvVar {
	proxyHost, proxyPort := strings.TrimPrefix(proxyAddr, "http://"), "80"
	if h, p, err := net.SplitHostPort(proxyHost); err == nil {
		proxyHost, proxyPort = h, p
	}
	javaToolOptions := fmt.Sprintf(
		"-Duser.home=%s -Dhttp.proxyHost=%s -Dhttp.proxyPort=%s -Dhttps.proxyHost=%s -Dhttps.proxyPort=%s",
		agentHome, proxyHost, proxyPort, proxyHost, proxyPort,
	)
	return []corev1.EnvVar{
		{Name: "JAVA_TOOL_OPTIONS", Value: javaToolOptions},
		{Name: "HTTPS_PROXY", Value: proxyAddr},
		{Name: "HTTP_PROXY", Value: proxyAddr},
		{Name: "https_proxy", Value: proxyAddr},
		{Name: "http_proxy", Value: proxyAddr},
		{Name: "NODE_EXTRA_CA_CERTS", Value: "/etc/platform/ca/ca.crt"},
		{Name: "NODE_USE_SYSTEM_CA", Value: "1"},
		{Name: "SSL_CERT_DIR", Value: "/etc/platform/ca"},
		{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		{Name: "NO_PROXY", Value: "localhost,127.0.0.1,::1"},
		{Name: "no_proxy", Value: "localhost,127.0.0.1,::1"},
		{Name: "PLATFORM_AGENT_ID", Value: name},
		{Name: "API_SERVER_URL", Value: fmt.Sprintf("http://%s:%d", cfg.HarnessHost(), cfg.HarnessServerPort)},
		{Name: "HOME", Value: agentHome},
		{Name: "PLATFORM_MCP_URL", Value: fmt.Sprintf("%s/api/agents/%s/mcp", cfg.HarnessServerURL, name)},
	}
}

const (
	requireConnectionAddressEnv = "PLATFORM_REQUIRE_CONNECTION_ADDRESS"
	environmentOfEnv            = "PLATFORM_ENVIRONMENT_OF"
)

func requireConnectionAddressValue(spec *apiv1.AgentSpec) string {
	if spec.RequireConnectionAddress {
		return "true"
	}
	return "false"
}
func resolveSpecMounts(agentSpec *apiv1.AgentSpec, defaults config.HarnessTemplateDefaults) []apiv1.Mount {
	if len(agentSpec.Mounts) > 0 {
		return agentSpec.Mounts
	}
	var out []apiv1.Mount
	for _, m := range defaults.Mounts {
		out = append(out, apiv1.Mount{Path: m.Path, Persist: m.Persist, Size: m.Size})
	}
	return out
}
func BuildAgentService(name string, cfg *config.Config, ownerRef metav1.OwnerReference) *corev1.Service {
	selector := map[string]string{LabelPair: name, LabelRole: RoleAgent}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: name, LabelPair: name, LabelRole: RoleAgent},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  selector,
			Ports: []corev1.ServicePort{{
				Name: "acp", Port: 8080, TargetPort: intstr.FromInt32(8080),
			}},
		},
	}
}
