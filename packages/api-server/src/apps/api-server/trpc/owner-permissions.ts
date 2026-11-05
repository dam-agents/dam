import { TRPCError } from "@trpc/server";
import type { AgentPermission } from "api-server-api";

import { getLogger } from "../../../core/logger.js";
import { permissionsOf } from "../../../modules/agents/domain/agent-permissions.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the caller, as an Agent's owner, may do to it:
 * its Agent Permissions for that Agent's kind. The Agent is read from the store
 * rather than from the informer, because this answer decides destructive writes:
 * a cache that has not yet observed an Agent another replica made must never
 * read as "no such Agent, so nothing to refuse". A record that cannot be read at
 * all is refused too, since an inconclusive read is not permission either.
 * Null means the caller is not its owner, which leaves the procedure answering
 * as it always did; a stranger cannot act on it through any of these.
 */
export function createOwnerPermissions(deps: {
  repo: Pick<AgentsRepository, "getLive">;
}): (agentId: string, sub: string) => Promise<AgentPermission[] | null> {
  return async (agentId, sub) => {
    let infra;
    try {
      infra = await deps.repo.getLive(agentId, sub);
    } catch (err) {
      getLogger().error({ err, agentId }, "agent.owner_permissions_unreadable");
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message:
          "This agent's record could not be read, so the change was refused. Try again.",
      });
    }
    if (!infra || infra.owner !== sub) return null;
    return permissionsOf("owner", infra.kind);
  };
}
