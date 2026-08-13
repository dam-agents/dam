package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const npGateInitContainerName = "np-gate"

const npGateUser int64 = 65532

func buildNPGateInitContainer(cfg *config.Config, gatewayClusterIP string) *corev1.Container {
	cfgGate := cfg.AgentBase.NPGateInit
	if cfgGate == nil || !cfgGate.Enabled || cfgGate.Image == "" || gatewayClusterIP == "" {
		return nil
	}

	timeoutSeconds := cfgGate.TimeoutSeconds
	if timeoutSeconds == 0 {
		timeoutSeconds = 30
	}

	script := `set -u
deadline=$(($(date +%s) + ${TIMEOUT_SECONDS}))
echo "np-gate: probing denied=${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT} allowed=${GATEWAY_IP}:${ENVOY_PORT}${HEALTH_PATH}, deadline=${TIMEOUT_SECONDS}s"
# Denied-target probe: handshake completed iff %{time_connect} != 0 (the
# apiserver answers TLS/non-200 when reachable, so status isn't the signal).
reachable() {
    tc=$(curl -s -o /dev/null --connect-timeout 2 -m 3 -w '%{time_connect}' "http://$1:$2" 2>/dev/null)
    [ -n "$tc" ] && [ "$tc" != "0.000000" ]
}
# Gateway probe: 200 on the health path. The health_check filter answers it
# before ext_authz, so this never trips the egress gate (#675).
gateway_ready() {
    code=$(curl -s -o /dev/null --connect-timeout 2 -m 3 -w '%{http_code}' "http://${GATEWAY_IP}:${ENVOY_PORT}${HEALTH_PATH}" 2>/dev/null)
    [ "$code" = "200" ]
}
while [ "$(date +%s)" -lt "${deadline}" ]; do
    if ! reachable "${KUBERNETES_SERVICE_HOST}" "${KUBERNETES_SERVICE_PORT}"; then
        if gateway_ready; then
            echo "np-gate: NetworkPolicy enforced (denied ${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT} blocked, gateway ${GATEWAY_IP}:${ENVOY_PORT} serving ${HEALTH_PATH})"
            exit 0
        fi
    fi
    sleep 0.3
done
echo "np-gate: FATAL — NetworkPolicy did not converge within ${TIMEOUT_SECONDS}s (denied=${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT} allowed=${GATEWAY_IP}:${ENVOY_PORT}${HEALTH_PATH})" >&2
exit 1
`

	env := []corev1.EnvVar{
		{Name: "GATEWAY_IP", Value: gatewayClusterIP},
		{Name: "ENVOY_PORT", Value: fmt.Sprintf("%d", cfg.EnvoyPort)},
		{Name: "TIMEOUT_SECONDS", Value: fmt.Sprintf("%d", timeoutSeconds)},
		{Name: "HEALTH_PATH", Value: platformGatewayHealthPath},
	}

	user := npGateUser
	return &corev1.Container{
		Name:    npGateInitContainerName,
		Image:   cfgGate.Image,
		Command: []string{"/bin/sh", "-c", script},
		Env:     env,
		SecurityContext: &corev1.SecurityContext{
			RunAsNonRoot:             ptrBool(true),
			RunAsUser:                &user,
			AllowPrivilegeEscalation: ptrBool(false),
			ReadOnlyRootFilesystem:   ptrBool(true),
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
			},
		},
	}
}
