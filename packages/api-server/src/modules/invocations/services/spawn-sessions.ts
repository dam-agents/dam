import type { InvocationLinks } from "../infrastructure/invocation-links.js";
import type { DriverResolution } from "./driver-resolution.js";

const MAX_TREE_LINKS = 10_000;
const MAX_CHAIN_DEPTH = 16;

export interface SpawnSessions {
  spawnSessions(agentId: string): Promise<ReadonlyMap<string, string | null>>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: each sub-agent below an agent, at any depth,
 * with the Session of that agent its branch was spawned from: the spawning
 * Session recorded on the link whose driver is the agent, or null when that
 * spawn recorded none. Deeper links do not change it, since a grandchild is
 * part of its parent's work.
 */
export function createSpawnSessions(deps: {
  driverResolution: DriverResolution;
  links: InvocationLinks;
}): SpawnSessions {
  return {
    async spawnSessions(agentId) {
      const root =
        (await deps.driverResolution.resolveRoot(agentId)) ?? agentId;
      const links = await deps.links.listByRoot(root, MAX_TREE_LINKS);
      const byId = new Map(links.map((link) => [link.id, link]));
      const sessions = new Map<string, string | null>();
      for (const link of links) {
        let current: typeof link | undefined = link;
        for (let depth = 0; current && depth < MAX_CHAIN_DEPTH; depth++) {
          if (current.driverAgentId === agentId) {
            sessions.set(link.id, current.driverSessionId);
            break;
          }
          current = byId.get(current.driverAgentId);
        }
      }
      return sessions;
    },
  };
}
