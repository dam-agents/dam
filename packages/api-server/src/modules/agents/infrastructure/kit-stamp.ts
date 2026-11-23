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
 * Version, the Seed Stamp a Kit Update follows, and the knowledge-base share
 * roots the kit declares.
 */
export function createKitStamp(repo: Pick<AgentsRepository, "patchAnnotations">) {
  return (
    agentId: string,
    stamp: { starterKit: string; seed?: SeedStamp; kbShareRoots?: string[] },
  ) =>
    repo.patchAnnotations(agentId, {
      [ANN_STARTER_KIT]: stamp.starterKit,
      ...(stamp.seed
        ? { [ANN_STARTER_KIT_SEED]: JSON.stringify(stamp.seed) }
        : {}),
      ...(stamp.kbShareRoots
        ? { [ANN_KB_SHARE_ROOTS]: stamp.kbShareRoots.join(",") }
        : {}),
    });
}
