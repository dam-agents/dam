import type { KitSeedEventPayload } from "agent-runtime-api";

import {
  kitSeedEvent,
  type RuntimeMutator,
} from "../../runtime-delivery/index.js";
import type {
  KitSeedAnswer,
  KitSeedDelivery,
} from "../services/kit-apply-existing.js";

const KIND = "kit-seed";

function advertises(capabilities: unknown): boolean | null {
  if (capabilities === null || capabilities === undefined) return null;
  const events = (capabilities as { events?: unknown }).events;
  return Array.isArray(events) && events.includes(KIND);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: sends a Starter Kit's repository to an existing
 * Agent as a `kit-seed` event, and reads the runtime's answer back from the
 * event's report. Whether the runtime takes the event at all is what it
 * advertised at its last hello: an older runtime does not, and would
 * otherwise never answer.
 */
export function createKitSeedDelivery(deps: {
  capabilities: (agentId: string) => Promise<unknown>;
  runtimeMutator: Pick<
    RuntimeMutator,
    "bump" | "supersede" | "enqueueAfterCommit"
  >;
  readEventReport: (
    agentId: string,
    eventId: string,
  ) => Promise<{ reportedAt: Date | null; error: string | null } | null>;
}): KitSeedDelivery {
  return {
    supports: async (agentId) => advertises(await deps.capabilities(agentId)),
    async send(agentId, seed: KitSeedEventPayload) {
      await deps.runtimeMutator.supersede(agentId, KIND);
      const event = kitSeedEvent(agentId, seed, new Date());
      await deps.runtimeMutator.bump(agentId, [event]);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
      return event.id;
    },
    async answer(agentId, eventId): Promise<KitSeedAnswer> {
      const report = await deps.readEventReport(agentId, eventId);
      if (!report || report.reportedAt === null) return { state: "pending" };
      return report.error === null
        ? { state: "seeded" }
        : { state: "refused", reason: report.error };
    },
    abandon: (agentId) => deps.runtimeMutator.supersede(agentId, KIND),
  };
}
