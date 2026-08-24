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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Names an Agent for a visitor with no login, and
 * turns every failure into the generic page rather than an error. The route in
 * front of it has to answer 200 on every path — a 500 for one id and a 200 for
 * every other one is a status code that tells a prober which Agent ids exist.
 * So a control-plane read that throws is caught here, the same way a failed
 * owner-name lookup only drops the owner line.
 */
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

  async function named(agentId: string): Promise<PublicAgentView | null> {
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
  }

  return {
    async get(agentId) {
      try {
        return await named(agentId);
      } catch (err) {
        deps.log(`naming ${agentId} failed, answering generic: ${String(err)}`);
        return null;
      }
    },
  };
}
