import { TRPCError } from "@trpc/server";
import type { InvocationsControlService } from "api-server-api";

import { userStopReason } from "../domain/stop-reason.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { DelegationStop } from "./delegation-stop.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's hand on a running delegation: a stop
 * of any target under the Driver's root, through the one stop, which takes
 * every target below it down too. The stopped target still reaches its
 * driver as a turn, since that driver did not ask for the stop. A row the
 * owner does not hold under that Driver's root is not found.
 */
export function createDelegationControl(deps: {
  repo: Pick<InvocationsRepository, "get">;
  owner: string;
  stopper: DelegationStop;
}): InvocationsControlService {
  return {
    async stop({ driverAgentId, id }) {
      const [row, driverRow] = await Promise.all([
        deps.repo.get(id),
        deps.repo.get(driverAgentId),
      ]);
      const root = driverRow?.rootDriverId ?? driverAgentId;
      if (!row || row.owner !== deps.owner || row.rootDriverId !== root) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `no delegation ${id} under ${driverAgentId}`,
        });
      }
      await deps.stopper.stop(row, {
        reason: userStopReason(),
        actor: deps.owner,
        actorKind: "user",
        collectTarget: false,
      });
    },
  };
}
