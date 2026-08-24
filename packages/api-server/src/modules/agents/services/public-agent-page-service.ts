import type { PublicAgentView } from "api-server-api";
import { match } from "ts-pattern";
import type {
  PublicAgentProfileLookup,
  PublicAgentProfileRow,
} from "../infrastructure/public-agent-profile-repository.js";

export interface PublicAgentPageService {
  get(agentId: string): Promise<PublicAgentView | null>;
}

export interface PublicAgentIdentity {
  name: string;
  ownerSub: string;
}

export interface PublicAgentPageDeps {
  hasAnyBinding: (agentId: string) => Promise<boolean>;
  getProfile: (agentId: string) => Promise<PublicAgentProfileLookup>;
  upsertProfile: (row: PublicAgentProfileRow) => Promise<void>;
  markProfileDeleted: (agentId: string) => Promise<void>;
  readAgent: (agentId: string) => Promise<PublicAgentIdentity | null>;
  resolveOwnerName: (ownerSub: string) => Promise<string | null>;
  log: (message: string) => void;
}

export function createPublicAgentPageService(
  deps: PublicAgentPageDeps,
): PublicAgentPageService {
  async function fillProfile(
    agentId: string,
  ): Promise<PublicAgentProfileRow | null> {
    try {
      const agent = await deps.readAgent(agentId);
      if (!agent) {
        await deps.markProfileDeleted(agentId);
        return null;
      }
      const row = { agentId, name: agent.name, ownerSub: agent.ownerSub };
      await deps.upsertProfile(row);
      return row;
    } catch (err) {
      deps.log(
        `filling the profile for agent ${agentId} failed, answering the generic page: ${String(err)}`,
      );
      return null;
    }
  }

  async function ownerName(ownerSub: string): Promise<string | null> {
    try {
      return await deps.resolveOwnerName(ownerSub);
    } catch (err) {
      deps.log(
        `resolving the owner name failed, omitting the owner line: ${String(err)}`,
      );
      return null;
    }
  }

  return {
    async get(agentId) {
      if (!(await deps.hasAnyBinding(agentId))) return null;
      const row = await match(await deps.getProfile(agentId))
        .with({ status: "live" }, async (lookup) => lookup.row)
        .with({ status: "missing" }, () => fillProfile(agentId))
        .with({ status: "deleted" }, async () => null)
        .exhaustive();
      if (!row) return null;
      return {
        agentId: row.agentId,
        name: row.name,
        ownerName: await ownerName(row.ownerSub),
      };
    },
  };
}
