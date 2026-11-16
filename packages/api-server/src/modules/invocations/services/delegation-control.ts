import { TRPCError } from "@trpc/server";
import type { InvocationsControlService } from "api-server-api";

import { userStopReason } from "../domain/stop-reason.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { DelegationStop } from "./delegation-stop.js";
import type { OwnerQuestions } from "./owner-questions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's hand on a running delegation: a stop
 * of any target under the Driver's root, through the one stop, which takes
 * every target below it down too. The stopped target still reaches its
 * driver as a turn, since that driver did not ask for the stop. A row the
 * owner does not hold under that Driver's root is not found. The owner's
 * answer to a question a target waits on goes the same way, and is refused
 * once the question is no longer open.
 */
export function createDelegationControl(deps: {
  repo: Pick<InvocationsRepository, "get">;
  owner: string;
  stopper: DelegationStop;
  questions: Pick<OwnerQuestions, "answer" | "waitingOf">;
}): InvocationsControlService {
  async function owned(driverAgentId: string, id: string) {
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
    return row;
  }

  return {
    async answer({ driverAgentId, id, answer }) {
      await owned(driverAgentId, id);
      const asking = await deps.questions.waitingOf(id);
      const taken =
        asking !== null &&
        (await deps.questions.answer(asking, { text: answer, by: "owner" }));
      if (!taken)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This question was already answered.",
        });
    },

    async stop({ driverAgentId, id }) {
      const row = await owned(driverAgentId, id);
      await deps.stopper.stop(row, {
        reason: userStopReason(),
        actor: deps.owner,
        actorKind: "user",
        collectTarget: false,
      });
    },
  };
}
