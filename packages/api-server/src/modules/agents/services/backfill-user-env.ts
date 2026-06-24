import { isProtectedAgentEnvName } from "api-server-api";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";
import type { AgentEnvRepository } from "../infrastructure/agent-env-repository.js";

/** Copy non-protected `spec.env` into `agent_env` (only when empty), then clear
 *  `spec.env`; idempotent and self-disarming. Never throws — per-agent failures
 *  are isolated and counted so the caller can retry. `failed > 0` means a later
 *  pass should run. */
export async function backfillUserEnv(deps: {
  repo: Pick<AgentsRepository, "list" | "patchSpec">;
  agentEnvRepo: Pick<AgentEnvRepository, "list" | "replace">;
  log: (msg: string) => void;
}): Promise<{ migrated: number; failed: number }> {
  let agents;
  try {
    agents = await deps.repo.list();
  } catch (e) {
    deps.log(`user-env backfill: agent list failed, will retry: ${errMsg(e)}`);
    return { migrated: 0, failed: 1 };
  }
  let migrated = 0;
  let failed = 0;
  for (const infra of agents) {
    const userEnv = (infra.spec.env ?? []).filter(
      (e) => !isProtectedAgentEnvName(e.name),
    );
    if (userEnv.length === 0) continue; // nothing to migrate (or already cleared)
    try {
      // Skip the write if rows already exist so a post-migration edit is never clobbered.
      if ((await deps.agentEnvRepo.list(infra.id)).length === 0) {
        await deps.agentEnvRepo.replace(infra.id, userEnv);
        migrated++;
      }
      // Clear the CR values: disarms re-runs and avoids double-delivery with the rail.
      await deps.repo.patchSpec(infra.id, { env: [] });
    } catch (e) {
      failed++;
      deps.log(
        `user-env backfill: agent ${infra.id} failed, will retry: ${errMsg(e)}`,
      );
    }
  }
  deps.log(`user-env backfill: migrated ${migrated}, failed ${failed}`);
  return { migrated, failed };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
