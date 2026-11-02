import type { SessionCategory } from "api-server-api";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { SpendWorkStopped } from "../../../events.js";
import {
  countsAllAgents,
  stopMessage,
  type StopNotice,
} from "../domain/messages.js";
import { resetOf, stopKeyOf } from "../domain/stop-key.js";
import type { ToldStops } from "../infrastructure/redis-told-stops.js";

export interface SpendAlertsService {
  handle(event: SpendWorkStopped): Promise<void>;
}

export function createSpendAlertsService(deps: {
  told: ToldStops;
  notify: (ownerSub: string, notice: StopNotice) => Promise<{ sent: number }>;
  agentName: (agentId: string) => Promise<string | null>;
  connectionNames: (ownerSub: string) => Promise<ReadonlyMap<string, string>>;
  sessionCategories: (
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ) => Promise<ReadonlyMap<string, SessionCategory>>;
  uiBaseUrl: string;
  now: () => Date;
}): SpendAlertsService {
  const ownerUnaware = async (event: SpendWorkStopped): Promise<boolean> => {
    const work = event.work;
    if (work.kind !== "call") return true;
    if (!work.sessionId) return false;
    const categories = await deps.sessionCategories(
      [work.agentId],
      [work.sessionId],
    );
    const category = categories.get(work.sessionId);
    return category === "scheduled" || category === "channels";
  };

  return {
    async handle(event) {
      const key = stopKeyOf(event);
      if (await deps.told.told(key)) return;
      if (!(await ownerUnaware(event))) return;
      const agent = await deps.agentName(event.payer);
      if (agent === null && !countsAllAgents(event.level)) return;
      const reset = resetOf(event.day);
      if (!(await deps.told.claim(key, reset, deps.now()))) return;
      const connections = await deps
        .connectionNames(event.ownerSub)
        .catch((err: unknown) => {
          getLogger().warn(
            { ownerSub: event.ownerSub, reason: formatError(err) },
            "spend_alerts.connection_names_unread",
          );
          return new Map<string, string>();
        });
      const { sent } = await deps.notify(
        event.ownerSub,
        stopMessage(
          event,
          {
            agent: agent ?? "An agent",
            connection: (id) => connections.get(id) ?? "provider",
          },
          reset,
          deps.uiBaseUrl,
        ),
      );
      if (sent === 0)
        getLogger().info(
          { ownerSub: event.ownerSub, payer: event.payer },
          "spend_alerts.nobody_reached",
        );
    },
  };
}
