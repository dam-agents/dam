/**
 * Per-agent grants stored as fields on the Agent custom resource spec
 * (`grantedSecretIds` / `grantedConnectionIds`) — ADR-058 moved them off
 * ConfigMap annotations into spec, because they define what the agent can
 * reach and the controller intersects them with the owner's credential
 * Secret list before mounting into the gateway.
 *
 * Both grant lists are always selective: an absent field reads as an empty
 * grant set, never "all granted."
 */
import { type K8sClient, type KubeObject } from "./k8s.js";
import { AGENTS_PLURAL, LABEL_OWNER } from "./labels.js";

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
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function readGrants(spec: unknown): AgentGrants {
  const s = (spec ?? {}) as {
    grantedSecretIds?: unknown;
    grantedConnectionIds?: unknown;
  };
  return {
    grantedSecretIds: toStringArray(s.grantedSecretIds),
    grantedConnectionIds: toStringArray(s.grantedConnectionIds),
  };
}

export function createAgentGrantsPort(
  client: K8sClient,
  ownerSub: string,
): AgentGrantsPort {
  const ownedBy = (obj: KubeObject | null): boolean =>
    obj !== null && obj.metadata?.labels?.[LABEL_OWNER] === ownerSub;

  return {
    async get(agentId) {
      const obj = await client.getCustomObject(AGENTS_PLURAL, agentId);
      if (!ownedBy(obj)) return DEFAULT_GRANTS;
      return readGrants(obj!.spec);
    },

    async setSecretGrants(agentId, ids) {
      const obj = await client.getCustomObject(AGENTS_PLURAL, agentId);
      if (!ownedBy(obj)) {
        throw new Error(
          `setSecretGrants: agent ${agentId} not found or not owned`,
        );
      }
      await client.patchCustomObject(AGENTS_PLURAL, agentId, {
        spec: { grantedSecretIds: ids },
      });
    },

    async setConnectionGrants(agentId, ids) {
      const obj = await client.getCustomObject(AGENTS_PLURAL, agentId);
      if (!ownedBy(obj)) {
        throw new Error(
          `setConnectionGrants: agent ${agentId} not found or not owned`,
        );
      }
      await client.patchCustomObject(AGENTS_PLURAL, agentId, {
        spec: { grantedConnectionIds: ids },
      });
    },

    async listAgentsGrantedSecret(secretId) {
      const objs = await client.listCustomObjects(
        AGENTS_PLURAL,
        `${LABEL_OWNER}=${ownerSub}`,
      );
      const out: GrantedAgentSummary[] = [];
      for (const obj of objs) {
        const agentId = obj.metadata?.name;
        if (!agentId) continue;
        const grantedSecretIds = readGrants(obj.spec).grantedSecretIds;
        if (!grantedSecretIds.includes(secretId)) continue;
        out.push({ agentId, grantedSecretIds });
      }
      return out;
    },
  };
}
