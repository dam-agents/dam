package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

func TestBuildIptablesInitContainer_DisabledReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.IptablesInit = nil
	assert.Nil(t, buildIptablesInitContainer(&cfg, "10.96.42.42"))

	cfg.AgentBase.IptablesInit = &config.AgentIptablesInit{Enabled: false, Image: "foo"}
	assert.Nil(t, buildIptablesInitContainer(&cfg, "10.96.42.42"))
}

func TestBuildIptablesInitContainer_EmptyImageReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.IptablesInit = &config.AgentIptablesInit{Enabled: true}
	assert.Nil(t, buildIptablesInitContainer(&cfg, "10.96.42.42"), "missing image must not crash; chart should enforce non-empty")
}

// Without a gateway ClusterIP the allow-list would lock the pod out of its
// own egress path. The controller skips installing the init container until
// the next reconcile picks up the assigned IP — NP still gates egress in
// the meantime.
func TestBuildIptablesInitContainer_NoGatewayIPReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.IptablesInit = &config.AgentIptablesInit{Enabled: true, Image: "registry.k8s.io/build-image/distroless-iptables:v0.9.2"}
	assert.Nil(t, buildIptablesInitContainer(&cfg, ""), "no gateway IP yet — re-attach on next reconcile")
}

func TestBuildIptablesInitContainer_HasCapsAndRunsAsRoot(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.IptablesInit = &config.AgentIptablesInit{Enabled: true, Image: "registry.k8s.io/build-image/distroless-iptables:v0.9.2"}

	ic := buildIptablesInitContainer(&cfg, "10.96.42.42")
	require.NotNil(t, ic)
	assert.Equal(t, "egress-lockdown", ic.Name)
	assert.Equal(t, "registry.k8s.io/build-image/distroless-iptables:v0.9.2", ic.Image)
	require.NotNil(t, ic.SecurityContext)
	// iptables-nft needs CAP_NET_ADMIN in EFFECTIVE — that requires root,
	// because containerd doesn't promote capabilities.add into the
	// ambient set for non-root containers.
	require.NotNil(t, ic.SecurityContext.RunAsUser)
	assert.Equal(t, int64(0), *ic.SecurityContext.RunAsUser, "iptables-nft requires effective CAP_NET_ADMIN; only root has it without ambient caps")
	require.NotNil(t, ic.SecurityContext.RunAsNonRoot)
	assert.False(t, *ic.SecurityContext.RunAsNonRoot, "must override the pod-level runAsNonRoot floor")
	require.NotNil(t, ic.SecurityContext.Capabilities)
	caps := ic.SecurityContext.Capabilities
	assert.Contains(t, caps.Add, corev1.Capability("NET_ADMIN"), "NET_ADMIN required for iptables manipulation")
	assert.Contains(t, caps.Add, corev1.Capability("NET_RAW"))
	assert.Contains(t, caps.Drop, corev1.Capability("ALL"), "drop ALL and only add what we need")

	// GATEWAY_IP + ENVOY_PORT must be plumbed in as env vars so the script
	// references the actual paired-gateway address.
	envMap := map[string]string{}
	for _, e := range ic.Env {
		envMap[e.Name] = e.Value
	}
	assert.Equal(t, "10.96.42.42", envMap["GATEWAY_IP"])
	assert.NotEmpty(t, envMap["ENVOY_PORT"], "ENVOY_PORT must be wired so the script doesn't fall back to a hardcoded default")
}

// PoC allow-list shape: loopback + conntrack return traffic + ONE accept rule
// pinned to the gateway + terminal DROP. Verified at the script-text level —
// the actual netfilter behavior is tested out-of-band (see cluster smoke
// test). DNS-specific rules are gone; DNS is just one of the many "everything
// else" destinations DROPped by the catch-all.
//
// Rule application uses $IPT / $IP6T because the script probes nft first
// and falls back to iptables-legacy (Kata guest kernels often ship legacy
// xtables but not nf_tables).
func TestBuildIptablesInitContainer_AllowListScript(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.IptablesInit = &config.AgentIptablesInit{Enabled: true, Image: "registry.k8s.io/build-image/distroless-iptables:v0.9.2"}
	ic := buildIptablesInitContainer(&cfg, "10.96.42.42")
	require.NotNil(t, ic)
	require.GreaterOrEqual(t, len(ic.Command), 3)
	script := ic.Command[2]

	// Backend probe: nft first, then legacy, fail-closed if neither works.
	assert.Contains(t, script, "iptables-nft -nL OUTPUT", "must probe nft backend")
	assert.Contains(t, script, "IPT=iptables-nft", "nft is the preferred backend")
	assert.Contains(t, script, "iptables-legacy -nL OUTPUT", "must probe legacy backend as fallback")
	assert.Contains(t, script, "IPT=iptables-legacy", "legacy is the Kata fallback")
	assert.Contains(t, script, "exit 1", "must fail-closed when no backend works — NetworkPolicy alone is not enough")

	assert.Contains(t, script, `"$IPT" -A OUTPUT -o lo -j ACCEPT`, "loopback must be admitted (in-pod localhost)")
	assert.Contains(t, script, `"$IPT" -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`, "return traffic must match conntrack")
	assert.Contains(t, script, `"$IPT" -A OUTPUT -d "$GATEWAY_IP" -p tcp --dport "$ENVOY_PORT" -j ACCEPT`,
		"single ACCEPT rule pinned to the gateway IP+Envoy port")
	assert.Contains(t, script, `"$IPT" -A OUTPUT -j DROP`, "terminal catch-all DROP")

	// IPv6 must be locked down too — gateway is IPv4-only so v6 gets
	// loopback + ESTABLISHED + DROP, no gateway ACCEPT.
	assert.Contains(t, script, `"$IP6T" -A OUTPUT -o lo -j ACCEPT`, "IPv6 loopback must be admitted")
	assert.Contains(t, script, `"$IP6T" -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`)
	assert.Contains(t, script, `"$IP6T" -A OUTPUT -j DROP`, "IPv6 terminal catch-all DROP")
}

// PoC: with `iptablesInit.enabled: true` the egress-lockdown init container
// MUST be the first init container in the pod, before any user init script
// runs (so the allow-list is in place when the user init starts).
func TestBuildAgentStatefulSet_IptablesInitRunsFirst(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.IptablesInit = &config.AgentIptablesInit{Enabled: true, Image: "registry.k8s.io/build-image/distroless-iptables:v0.9.2"}
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, &cfg, testOwnerCM, nil, "10.96.42.42")

	ics := ss.Spec.Template.Spec.InitContainers
	require.Len(t, ics, 2, "egress-lockdown + user init")
	assert.Equal(t, "egress-lockdown", ics[0].Name, "lockdown must run before the user init")
	assert.Equal(t, "init", ics[1].Name)

	// The agent container itself remains unprivileged — caps only live on
	// the egress-lockdown init container, which has already exited.
	agent := ss.Spec.Template.Spec.Containers[0]
	require.NotNil(t, agent.SecurityContext)
	if agent.SecurityContext.Capabilities != nil {
		assert.NotContains(t, agent.SecurityContext.Capabilities.Add, corev1.Capability("NET_ADMIN"),
			"the runtime agent container must NOT carry NET_ADMIN")
	}
}

// Without the gateway IP the init container is skipped (see
// TestBuildIptablesInitContainer_NoGatewayIPReturnsNil) — the pod renders
// with only the user init, and the next reconcile re-attaches lockdown.
func TestBuildAgentStatefulSet_IptablesInitSkippedWithoutGatewayIP(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.IptablesInit = &config.AgentIptablesInit{Enabled: true, Image: "registry.k8s.io/build-image/distroless-iptables:v0.9.2"}
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, &cfg, testOwnerCM, nil, "")

	for _, ic := range ss.Spec.Template.Spec.InitContainers {
		assert.NotEqual(t, "egress-lockdown", ic.Name, "lockdown must skip until gateway IP is known")
	}
}

// hostAliases is no longer used — HTTPS_PROXY is IP-direct so there's no
// hostname to override. Pod render must not carry stale hostAliases under
// any code path.
func TestBuildAgentStatefulSet_NoHostAliases(t *testing.T) {
	cfg := *testConfig
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, &cfg, testOwnerCM, nil, "10.96.42.42")
	assert.Empty(t, ss.Spec.Template.Spec.HostAliases, "no hostAliases — proxy URL is IP-direct")
}
