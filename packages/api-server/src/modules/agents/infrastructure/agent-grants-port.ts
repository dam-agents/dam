/**
 * Per-agent grants stored as annotations on the agent's instance ConfigMaps.
 *
 * The contract is keyed by `agentId` (the agent template name). One agent
 * can back multiple instances; reads return the first instance's grants
 * (typically the only one) and writes fan out to every owned instance so
 * the agent's full instance set stays in sync.
 *
 * The controller reads these annotations on every reconcile and intersects
 * them with the owner's credential Secret list before mounting into the
 * Envoy sidecar — touching annotations is therefore enough to trigger a
 * pod roll on the next reconcile.
 *
 * Both grant lists are always selective: absence of the annotation reads
 * as an empty grant set, never "all granted." New instance ConfigMaps are
 * initialized with the empty annotation explicitly so the explicit-empty
 * vs. legacy-absent distinction is moot for anything created today.
 */
import type { K8sClient } from "./k8s.js";
import {
  ANN_GRANTED_CONNECTION_IDS,
  ANN_GRANTED_SECRET_IDS,
  LABEL_AGENT_REF,
  LABEL_OWNER,
  LABEL_TYPE,
  TYPE_INSTANCE,
} from "./labels.js";

export interface AgentGrants {
  grantedSecretIds: string[];
  grantedConnectionIds: string[];
}

const DEFAULT_GRANTS: AgentGrants = {
  grantedSecretIds: [],
  grantedConnectionIds: [],
};

export interface AgentGrantsPort {
  get(agentId: string): Promise<AgentGrants>;
  setSecretGrants(agentId: string, ids: string[]): Promise<void>;
  setConnectionGrants(agentId: string, ids: string[]): Promise<void>;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readGrants(annotations: Record<string, string> | undefined): AgentGrants {
  const ann = annotations ?? {};
  return {
    grantedSecretIds: parseList(ann[ANN_GRANTED_SECRET_IDS]),
    grantedConnectionIds: parseList(ann[ANN_GRANTED_CONNECTION_IDS]),
  };
}

export function createAgentGrantsPort(client: K8sClient, ownerSub: string): AgentGrantsPort {
  async function listInstancesForAgent(agentId: string) {
    const cms = await client.listConfigMaps(
      `${LABEL_TYPE}=${TYPE_INSTANCE},${LABEL_OWNER}=${ownerSub},${LABEL_AGENT_REF}=${agentId}`,
    );
    return cms;
  }

  async function patchAnnotations(name: string, annotations: Record<string, string | null>) {
    // strategic-merge-patch: a null value clears the annotation key.
    await client.patchConfigMap(name, {
      metadata: { annotations },
    });
  }

  return {
    async get(agentId) {
      const cms = await listInstancesForAgent(agentId);
      if (cms.length === 0) return DEFAULT_GRANTS;
      // Multiple instances per agent share the grant set by construction
      // (writes fan out). Read from the first.
      return readGrants(cms[0].metadata?.annotations);
    },

    async setSecretGrants(agentId, ids) {
      const cms = await listInstancesForAgent(agentId);
      // Always-selective: write the literal (possibly empty) value.
      const annotations = { [ANN_GRANTED_SECRET_IDS]: ids.join(",") };
      await Promise.all(
        cms.map((cm) => patchAnnotations(cm.metadata!.name!, annotations)),
      );
    },

    async setConnectionGrants(agentId, ids) {
      const cms = await listInstancesForAgent(agentId);
      const annotations = { [ANN_GRANTED_CONNECTION_IDS]: ids.join(",") };
      await Promise.all(
        cms.map((cm) => patchAnnotations(cm.metadata!.name!, annotations)),
      );
    },
  };
}
