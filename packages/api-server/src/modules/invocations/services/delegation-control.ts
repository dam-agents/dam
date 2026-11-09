import { TRPCError } from "@trpc/server";
import type { InvocationsControlService } from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's hand on a running delegation. A stop
 * fails every run of the target that is running, with its reason, and reaps
 * the target through the one reap path, which ends a kept target's runs on
 * their own instead, so the Driver reads it like any other failure and the
 * target's conversation is kept. A row the owner does not hold under that
 * Driver's root is not found; one with nothing running is left as it is.
 */
export function createDelegationControl(deps: {
  repo: InvocationsRepository;
  owner: string;
  reaper: TargetReaper;
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
      const running = await deps.repo.listRunningRuns(id);
      if (running.length === 0) return;
      for (const run of running)
        await deps.repo.fail(run.runId!, "stopped by the user");
      securityLog("info", "invocation.stopped", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        agentId: id,
        result: "success",
        detail: { driverAgentId },
      });
      for (const run of running) await deps.reaper.reap(run);
    },
  };
}
