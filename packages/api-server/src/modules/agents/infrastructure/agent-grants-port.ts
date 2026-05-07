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
  ANN_SECRETS_REV,
  LABEL_AGENT_REF,
  LABEL_OWNER,
  LABEL_TYPE,
  TYPE_INSTANCE,
} from "./labels.js";

export interface AgentGrants {
  grantedSecretIds: string[];
  grantedConnectionIds: string[];
}

/**
 * Per-agent view returned by `listAgentsGrantedSecret` — one entry per
 * unique agent (LABEL_AGENT_REF) with all of its instance ConfigMap names
 * and the agent's full granted-secret list (so callers can rebuild egress
 * grants without an extra read).
 */
export interface GrantedAgentSummary {
  agentId: string;
  instanceCmNames: string[];
  grantedSecretIds: string[];
}

const DEFAULT_GRANTS: AgentGrants = {
  grantedSecretIds: [],
  grantedConnectionIds: [],
};

export interface AgentGrantsPort {
  get(agentId: string): Promise<AgentGrants>;
  setSecretGrants(agentId: string, ids: string[]): Promise<void>;
  setConnectionGrants(agentId: string, ids: string[]): Promise<void>;
  /**
   * List every owned agent that has the given secret in its granted set.
   * Used by `secrets-service.update` to fan out edits to granted agents
   * (ADR-040).
   */
  listAgentsGrantedSecret(secretId: string): Promise<GrantedAgentSummary[]>;
  /**
   * Bump the render-affecting `secrets-rev` annotation on a single
   * instance ConfigMap. Forces the controller's ConfigMap watch to refire
   * so the agent pod re-renders with the merged env (ADR-040).
   */
  bumpSecretsRev(instanceCmName: string, hash: string): Promise<void>;
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

    async listAgentsGrantedSecret(secretId) {
      // Walk every owned instance ConfigMap and pick the ones whose
      // granted-secret-ids annotation contains this id. Group by agentId
      // (one agent backs N instances; writes fan out to all of them).
      const cms = await client.listConfigMaps(
        `${LABEL_TYPE}=${TYPE_INSTANCE},${LABEL_OWNER}=${ownerSub}`,
      );
      const byAgent = new Map<string, GrantedAgentSummary>();
      for (const cm of cms) {
        const ann = cm.metadata?.annotations ?? {};
        const labels = cm.metadata?.labels ?? {};
        const agentId = labels[LABEL_AGENT_REF];
        const cmName = cm.metadata?.name;
        if (!agentId || !cmName) continue;
        const grantedSecretIds = parseList(ann[ANN_GRANTED_SECRET_IDS]);
        if (!grantedSecretIds.includes(secretId)) continue;
        const existing = byAgent.get(agentId);
        if (existing) {
          existing.instanceCmNames.push(cmName);
        } else {
          byAgent.set(agentId, {
            agentId,
            instanceCmNames: [cmName],
            grantedSecretIds,
          });
        }
      }
      return Array.from(byAgent.values());
    },

    async bumpSecretsRev(instanceCmName, hash) {
      await patchAnnotations(instanceCmName, { [ANN_SECRETS_REV]: hash });
    },
  };
}
