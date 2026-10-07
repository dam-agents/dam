import { TRPCError } from "@trpc/server";
import type { InvocationsQueryService } from "api-server-api";

import { buildDelegationTree } from "../domain/delegation-tree.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { DelegationFramesPort } from "./delegation-frames.js";

const DELEGATION_TREE_ROW_LIMIT = 2000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's read of the delegations under a
 * driver. Every read resolves the driver's root and answers only for rows of
 * that root the owner holds; the tree reads the root's newest rows, so a
 * long-lived root that outgrows the limit loses its oldest delegations first.
 */
export function createDelegationsQuery(deps: {
  repo: InvocationsRepository;
  owner: string;
  frames: DelegationFramesPort;
}): InvocationsQueryService {
  async function rootOf(driverAgentId: string): Promise<string> {
    const driverRow = await deps.repo.get(driverAgentId);
    return driverRow?.rootDriverId ?? driverAgentId;
  }

  async function ownedRowsOfRoot(driverAgentId: string) {
    const root = await rootOf(driverAgentId);
    const rows = await deps.repo.listByRoot(root, DELEGATION_TREE_ROW_LIMIT);
    if (rows.length === DELEGATION_TREE_ROW_LIMIT) {
      process.stderr.write(
        `[invocations] delegation tree for ${root} hit the ${DELEGATION_TREE_ROW_LIMIT}-row limit\n`,
      );
    }
    return rows.filter((r) => r.owner === deps.owner);
  }

  return {
    listTargets: () => deps.repo.listTargetsByOwner(deps.owner),

    async tree({ driverAgentId, ids }) {
      const owned = await ownedRowsOfRoot(driverAgentId);
      return { nodes: buildDelegationTree(owned, ids) };
    },

    async running({ driverAgentId }) {
      const running = (await deps.repo.listRunningByDriver(driverAgentId))
        .filter((r) => r.owner === deps.owner)
        .map((r) => r.id);
      if (running.length === 0) return { nodes: [] };
      const owned = await ownedRowsOfRoot(driverAgentId);
      return { nodes: buildDelegationTree(owned, running) };
    },

    async transcript({ driverAgentId, id }) {
      const [row, root] = await Promise.all([
        deps.repo.get(id),
        rootOf(driverAgentId),
      ]);
      const owned =
        row !== null && row.owner === deps.owner && row.rootDriverId === root;
      const frames =
        owned && row.transcriptCaptured
          ? await deps.frames.readFromRoot(root, id)
          : null;
      if (row === null || frames === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `no conversation kept for ${id}`,
        });
      }
      return { frames, truncated: row.transcriptTruncated };
    },
  };
}
