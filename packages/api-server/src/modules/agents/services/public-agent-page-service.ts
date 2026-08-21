import type { PublicAgentProfileRow } from "../infrastructure/public-agent-profile-repository.js";

export interface PublicAgentView {
  agentId: string;
  name: string;
  ownerEmail: string | null;
}

export interface PublicAgentPageService {
  get(agentId: string): Promise<PublicAgentView | null>;
}

export interface PublicAgentIdentity {
  name: string;
  ownerSub: string;
}

export interface PublicAgentPageDeps {
  hasAnyBinding: (agentId: string) => Promise<boolean>;
  getProfile: (agentId: string) => Promise<PublicAgentProfileRow | null>;
  upsertProfile: (row: PublicAgentProfileRow) => Promise<void>;
  markProfileDeleted: (agentId: string) => Promise<void>;
  readAgent: (agentId: string) => Promise<PublicAgentIdentity | null>;
  resolveOwnerEmail: (ownerSub: string) => Promise<string | null>;
}

export function createPublicAgentPageService(
  deps: PublicAgentPageDeps,
): PublicAgentPageService {
  async function fillProfile(
    agentId: string,
  ): Promise<PublicAgentProfileRow | null> {
    const agent = await deps.readAgent(agentId);
    if (!agent) {
      await deps.markProfileDeleted(agentId);
      return null;
    }
    const row = { agentId, name: agent.name, ownerSub: agent.ownerSub };
    await deps.upsertProfile(row);
    return row;
  }

  async function ownerEmail(ownerSub: string): Promise<string | null> {
    try {
      return await deps.resolveOwnerEmail(ownerSub);
    } catch {
      return null;
    }
  }

  return {
    async get(agentId) {
      if (!(await deps.hasAnyBinding(agentId))) return null;
      const row =
        (await deps.getProfile(agentId)) ?? (await fillProfile(agentId));
      if (!row) return null;
      return {
        agentId: row.agentId,
        name: row.name,
        ownerEmail: await ownerEmail(row.ownerSub),
      };
    },
  };
}
