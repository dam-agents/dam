import type { K8sClient } from "../../agents/infrastructure/k8s.js";

/**
 * Name of the Secret that the controller creates alongside each agent and
 * stores the agent's OneCLI access token in. Must match the format used in
 * packages/controller/pkg/reconciler/agent.go (AgentTokenSecretName).
 */
function tokenSecretName(agentId: string): string {
  return `humr-agent-${agentId}-token`;
}

/**
 * Look up an agent's access token via the K8s Secret controlled by the
 * controller. Used by the api-server to authenticate to agent-runtime.
 */
export function createAgentTokenResolver(k8s: K8sClient) {
  return async function getAgentToken(agentId: string): Promise<string> {
    const secret = await k8s.getSecret(tokenSecretName(agentId));
    if (!secret) throw new Error(`agent token secret for ${agentId} not found`);
    const encoded = secret.data?.["access-token"];
    if (!encoded) throw new Error(`agent token secret for ${agentId} has no access-token`);
    return Buffer.from(encoded, "base64").toString("utf8");
  };
}
