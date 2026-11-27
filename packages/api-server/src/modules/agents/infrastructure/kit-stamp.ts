import type { SeedStamp } from "api-server-api";
import type { AgentsRepository } from "./agents-repository.js";
import {
  ANN_KB_SHARE_ROOTS,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_SEED,
} from "./labels.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: records on an existing Agent the Starter Kit
 * applied to it, in the annotations a create from a kit writes: the Kit
 * Version and the knowledge-base share roots the kit declares. The Seed
 * Stamp is the runtime's to report, through `createSeedStamp`.
 */
export function createKitStamp(
  repo: Pick<AgentsRepository, "patchAnnotations">,
) {
  return (
    agentId: string,
    stamp: { starterKit: string; kbShareRoots?: string[] },
  ) =>
    repo.patchAnnotations(agentId, {
      [ANN_STARTER_KIT]: stamp.starterKit,
      ...(stamp.kbShareRoots
        ? { [ANN_KB_SHARE_ROOTS]: stamp.kbShareRoots.join(",") }
        : {}),
    });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: holds an existing Agent for one kit apply. The
 * claim writes the Kit Version only while the Agent has none, as one
 * compare-and-set on the store, so of two applies racing on one Agent the
 * second is refused before it reads or changes anything. The release clears
 * the Kit Version only while it is still the one this apply claimed.
 */
export function createKitClaim(repo: Pick<AgentsRepository, "swapStarterKit">) {
  return {
    claim: (agentId: string, starterKit: string) =>
      repo.swapStarterKit(agentId, null, starterKit),
    release: async (agentId: string, starterKit: string) => {
      await repo.swapStarterKit(agentId, starterKit, null);
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: writes the Seed Stamp a Kit Update follows, as
 * the runtime reported it for a kit's repository on an existing Agent.
 */
export function createSeedStamp(
  repo: Pick<AgentsRepository, "patchAnnotations">,
) {
  return (agentId: string, stamp: SeedStamp) =>
    repo.patchAnnotations(agentId, {
      [ANN_STARTER_KIT_SEED]: JSON.stringify(stamp),
    });
}
