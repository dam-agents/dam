import { randomUUID } from "node:crypto";
import { err, ok, type Result } from "../../../core/result.js";
import { emit, EventType } from "../../../events.js";
import type { ApiKeyRow, NewApiKey } from "../domain/types.js";

export const AGENT_KEY_SCOPES = ["agents:read"] as const;

export type AgentKeyRefusal = "not-owned";

export interface IssuedAgentKey {
  id: string;
  plaintext: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Issues and revokes the API keys that belong to an
 * Agent. Only the platform calls it, when a scoped grant of the platform
 * Connection needs its derived credential; nothing a person or a key can call
 * reaches it, so no key is ever made on an Agent's behalf by hand. A key is
 * bound to its Agent alone and reads that Agent and nothing else in this
 * step; what more it may do comes with the platform's reach (#6882).
 */
export function createAgentKeyIssuer(deps: {
  insert: (row: NewApiKey) => Promise<ApiKeyRow>;
  revoke: (id: string, ownerSub: string) => Promise<boolean>;
  mintToken: () => { token: string; hash: string };
  isAgentOwnedBy: (agentId: string, ownerSub: string) => Promise<boolean>;
}): {
  issue(input: {
    ownerSub: string;
    agentId: string;
    name: string;
  }): Promise<Result<IssuedAgentKey, AgentKeyRefusal>>;
  revoke(input: { ownerSub: string; id: string }): Promise<void>;
} {
  return {
    async issue({ ownerSub, agentId, name }) {
      if (!(await deps.isAgentOwnedBy(agentId, ownerSub)))
        return err("not-owned");
      const { token, hash } = deps.mintToken();
      const row = await deps.insert({
        id: `key-${randomUUID()}`,
        ownerSub,
        name,
        hash,
        scopes: [...AGENT_KEY_SCOPES],
        agentIds: [agentId],
        agentId,
        expiresAt: null,
      });
      emit({
        type: EventType.ApiKeyChanged,
        action: "created",
        actorSub: ownerSub,
        surface: "platform",
      });
      return ok({ id: row.id, plaintext: token });
    },

    async revoke({ ownerSub, id }) {
      if (!(await deps.revoke(id, ownerSub))) return;
      emit({
        type: EventType.ApiKeyChanged,
        action: "revoked",
        actorSub: ownerSub,
        surface: "platform",
      });
    },
  };
}
