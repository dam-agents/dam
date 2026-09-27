import type { K8sClient } from "./k8s.js";
import { LABEL_MANAGED_BY, LABEL_OWNER } from "./labels.js";

const LABEL_COMPONENT = "app.kubernetes.io/component";
const RUNNER_COMPONENT = "vm-runner";

export interface AgentSecretRefPort {
  isOwnedBy(secretName: string, owner: string): Promise<boolean>;
}

// UNIT_BOUNDARY_DESCRIPTION: a secretRef names a Secret by name alone, in the namespace that also holds every owner's credentials, the runners' tokens and the gateways' keys, and every key of it becomes the agent's environment. So a Secret counts as the owner's only when it carries their owner label and is not one the platform manages: the api-server's own credential and pull Secrets carry the managed-by label, and a runner's token and certificate its component. The controller applies the same rule when it renders the agent, so a Secret that slipped past here still never reaches one.
export function createAgentSecretRefPort(
  client: K8sClient,
): AgentSecretRefPort {
  return {
    async isOwnedBy(secretName, owner) {
      const secret = await client.getSecret(secretName);
      const labels = secret?.metadata?.labels ?? {};
      return (
        secret !== null &&
        owner !== "" &&
        labels[LABEL_OWNER] === owner &&
        labels[LABEL_MANAGED_BY] === undefined &&
        labels[LABEL_COMPONENT] !== RUNNER_COMPONENT
      );
    },
  };
}
