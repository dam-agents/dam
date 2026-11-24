import type { SeedStamp } from "api-server-api";
import { kitSeedEventPayload, type EventReportInput } from "agent-runtime-api";

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/**
 * UNIT_BOUNDARY_DESCRIPTION: records the Seed Stamp a `kit-seed` answer
 * carries. The runtime answers the commit the Agent now shares with the
 * kit's branch — the one it checked out, or the one an adopted checkout
 * shares with the branch — and that commit, not the catalog's pin, is where
 * a Kit Update starts. A seed pinned to a commit follows no branch and gets
 * no stamp, as at create.
 */
export function createKitSeedOutcome(deps: {
  stampSeed: (agentId: string, stamp: SeedStamp) => Promise<void>;
}) {
  return async (
    event: { agentId: string; payload: unknown },
    input: Pick<EventReportInput, "outcome" | "detail">,
  ): Promise<void> => {
    if (input.outcome !== "ok" || !COMMIT_SHA.test(input.detail ?? "")) return;
    const seed = kitSeedEventPayload.safeParse(event.payload);
    if (!seed.success || !seed.data.branch) return;
    await deps.stampSeed(event.agentId, {
      url: seed.data.url,
      branch: seed.data.branch,
      commit: input.detail!.toLowerCase(),
    });
  };
}
