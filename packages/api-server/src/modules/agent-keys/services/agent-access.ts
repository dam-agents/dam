import { randomUUID } from "node:crypto";
import {
  PLATFORM_ENVIRONMENTS_SOURCE,
  type PlatformRuleState,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { EgressRuleRow } from "../../egress-rules/domain/types.js";
import type { NewEgressRule } from "../../egress-rules/infrastructure/egress-rules-repository.js";
import {
  environmentsWildcard,
  type AgentKeyCodec,
} from "../domain/agent-key.js";
import type { AgentKeySecretPort } from "../infrastructure/agent-key-secret-port.js";
import type { AgentKeysRepository } from "../infrastructure/agent-keys-repository.js";

// UNIT_BOUNDARY_DESCRIPTION: the egress-rule store as Agent access reads it: an Agent's platform rule, active or removed, and the write that adds one.
export interface PlatformRuleStore {
  platformRule(
    agentId: string,
  ): Promise<{ active: EgressRuleRow | null; everHeld: boolean }>;
  insert(row: NewEgressRule): Promise<EgressRuleRow>;
}

export interface AgentAccessDeps {
  domain: string | null;
  // UNIT_BOUNDARY_DESCRIPTION: the port the install's Environment addresses name, when it is not the scheme's own, so the rule covers it.
  port: number | null;
  codec: AgentKeyCodec;
  keys: AgentKeysRepository;
  secrets: AgentKeySecretPort;
  rules: PlatformRuleStore;
}

export interface AgentAccess {
  // UNIT_BOUNDARY_DESCRIPTION: gives a new Agent the platform's Environments rule and its key, once; an Agent that held the rule before keeps its owner's choice.
  issue(agentId: string, ownerSub: string): Promise<void>;
  // UNIT_BOUNDARY_DESCRIPTION: the owner put the rule back: a new rule row and a new key.
  restore(agentId: string, ownerSub: string): Promise<EgressRuleRow | null>;
  // UNIT_BOUNDARY_DESCRIPTION: the owner removed the rule: the key and its Secret go with it, so the gateway stops sending it.
  withdraw(agentId: string): Promise<void>;
  state(agentId: string): Promise<PlatformRuleState>;
  // UNIT_BOUNDARY_DESCRIPTION: the Agent a key names, or null; a key whose Agent's rule was removed names nobody, as its row went with the rule.
  resolve(key: string): Promise<{ agentId: string; ownerSub: string } | null>;
  forget(agentId: string): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Agent access to Environments, from the Agent's
 * side: the visible egress rule its owner can remove and restore, and the
 * Agent Key that follows it. The key exists exactly while the rule does: its
 * hash in the database, its plaintext in a Secret only the Agent's gateway
 * mounts. On an install with no environments domain there is neither.
 */
export function createAgentAccess(deps: AgentAccessDeps): AgentAccess {
  async function writeKey(agentId: string, ownerSub: string) {
    const { key, hash } = deps.codec.mint();
    await deps.secrets.write(
      agentId,
      ownerSub,
      environmentsWildcard(deps.domain!),
      key,
    );
    await deps.keys.put(agentId, ownerSub, hash);
  }

  async function addRule(agentId: string, ownerSub: string) {
    return deps.rules.insert({
      id: randomUUID(),
      agentId,
      host: environmentsWildcard(deps.domain!),
      ...(deps.port ? { port: deps.port } : {}),
      method: "*",
      pathPattern: "*",
      verdict: "allow",
      decidedBy: ownerSub,
      source: PLATFORM_ENVIRONMENTS_SOURCE,
    });
  }

  return {
    async issue(agentId, ownerSub) {
      if (deps.domain === null) return;
      const { active, everHeld } = await deps.rules.platformRule(agentId);
      if (everHeld && !active) return;
      if (!active) await addRule(agentId, ownerSub);
      if (!(await deps.keys.has(agentId))) await writeKey(agentId, ownerSub);
    },

    async restore(agentId, ownerSub) {
      if (deps.domain === null) return null;
      const { active } = await deps.rules.platformRule(agentId);
      const row = active ?? (await addRule(agentId, ownerSub));
      await writeKey(agentId, ownerSub);
      securityLog("info", "agent_key.issue", {
        category: "authz-list",
        actor: ownerSub,
        actorKind: "user",
        agentId,
        result: "success",
        detail: { reason: "rule-restored" },
      });
      return row;
    },

    async withdraw(agentId) {
      await deps.secrets.delete(agentId);
      await deps.keys.delete(agentId);
    },

    async state(agentId) {
      if (deps.domain === null) return { state: "unavailable" };
      const host = environmentsWildcard(deps.domain);
      const { active } = await deps.rules.platformRule(agentId);
      return { state: active ? "active" : "removed", host };
    },

    async resolve(key) {
      return deps.keys.findByHash(deps.codec.hash(key));
    },

    async forget(agentId) {
      await deps.secrets.delete(agentId);
      await deps.keys.delete(agentId);
    },
  };
}
