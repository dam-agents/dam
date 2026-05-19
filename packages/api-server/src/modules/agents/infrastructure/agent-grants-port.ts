/**
 * Per-agent grants stored as annotations on the Agent ConfigMap.
 *
 * Per ADR-046, Agent and Instance were merged: each agent has exactly one
 * ConfigMap of type `agent`, which carries the grant annotations directly.
 *
 * The controller reads these annotations on every reconcile and intersects
 * them with the owner's credential Secret list before mounting into the
 * Envoy sidecar — touching annotations is therefore enough to trigger a
 * pod roll on the next reconcile.
 *
 * Both grant lists are always selective: absence of the annotation reads
 * as an empty grant set, never "all granted." New Agent ConfigMaps are
 * initialized with the empty annotation explicitly so the explicit-empty
 * vs. legacy-absent distinction is moot for anything created today.
 */
import type { K8sClient } from "./k8s.js";
import {
  ANN_GRANTED_CONNECTION_IDS,
  ANN_GRANTED_SECRET_IDS,
  ANN_SECRETS_REV,
  LABEL_OWNER,
  LABEL_TYPE,
  TYPE_AGENT,
} from "./labels.js";

export interface AgentGrants {
  grantedSecretIds: string[];
  grantedConnectionIds: string[];
}

/**
 * Per-agent view returned by `listAgentsGrantedSecret` — one entry per
 * agent that has the given secret in its granted set.
 */
export interface GrantedAgentSummary {
  agentId: string;
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
   * Bump the render-affecting `secrets-rev` annotation on the Agent
   * ConfigMap. Forces the controller's ConfigMap watch to refire so the
   * agent pod re-renders with the merged env (ADR-040).
   */
  bumpSecretsRev(agentId: string, hash: string): Promise<void>;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readGrants(
  annotations: Record<string, string> | undefined,
): AgentGrants {
  const ann = annotations ?? {};
  return {
    grantedSecretIds: parseList(ann[ANN_GRANTED_SECRET_IDS]),
    grantedConnectionIds: parseList(ann[ANN_GRANTED_CONNECTION_IDS]),
  };
}

export function createAgentGrantsPort(
  client: K8sClient,
  ownerSub: string,
): AgentGrantsPort {
  async function patchAnnotations(
    name: string,
    annotations: Record<string, string | null>,
  ) {
    // strategic-merge-patch: a null value clears the annotation key.
    await client.patchConfigMap(name, {
      metadata: { annotations },
    });
  }

  return {
    async get(agentId) {
      const cm = await client.getConfigMap(agentId);
      if (
        !cm ||
        cm.metadata?.labels?.[LABEL_TYPE] !== TYPE_AGENT ||
        cm.metadata?.labels?.[LABEL_OWNER] !== ownerSub
      ) {
        return DEFAULT_GRANTS;
      }
      return readGrants(cm.metadata?.annotations);
    },

    async setSecretGrants(agentId, ids) {
      const cm = await client.getConfigMap(agentId);
      if (
        !cm ||
        cm.metadata?.labels?.[LABEL_TYPE] !== TYPE_AGENT ||
        cm.metadata?.labels?.[LABEL_OWNER] !== ownerSub
      ) {
        throw new Error(
          `setSecretGrants: agent ${agentId} not found or not owned`,
        );
      }
      await patchAnnotations(agentId, {
        [ANN_GRANTED_SECRET_IDS]: ids.join(","),
      });
    },

    async setConnectionGrants(agentId, ids) {
      const cm = await client.getConfigMap(agentId);
      if (
        !cm ||
        cm.metadata?.labels?.[LABEL_TYPE] !== TYPE_AGENT ||
        cm.metadata?.labels?.[LABEL_OWNER] !== ownerSub
      ) {
        throw new Error(
          `setConnectionGrants: agent ${agentId} not found or not owned`,
        );
      }
      await patchAnnotations(agentId, {
        [ANN_GRANTED_CONNECTION_IDS]: ids.join(","),
      });
    },

    async listAgentsGrantedSecret(secretId) {
      const cms = await client.listConfigMaps(
        `${LABEL_TYPE}=${TYPE_AGENT},${LABEL_OWNER}=${ownerSub}`,
      );
      const out: GrantedAgentSummary[] = [];
      for (const cm of cms) {
        const ann = cm.metadata?.annotations ?? {};
        const cmName = cm.metadata?.name;
        if (!cmName) continue;
        const grantedSecretIds = parseList(ann[ANN_GRANTED_SECRET_IDS]);
        if (!grantedSecretIds.includes(secretId)) continue;
        out.push({ agentId: cmName, grantedSecretIds });
      }
      return out;
    },

    async bumpSecretsRev(agentId, hash) {
      await patchAnnotations(agentId, { [ANN_SECRETS_REV]: hash });
    },
  };
}
