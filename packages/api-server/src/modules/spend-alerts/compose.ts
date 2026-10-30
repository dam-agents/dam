import type { SessionCategory } from "api-server-api";
import type { Redis } from "ioredis";
import type { Subscription } from "rxjs";

import type { StopNotice } from "./domain/messages.js";
import { createRedisToldStops } from "./infrastructure/redis-told-stops.js";
import { startAlertOnStopSaga } from "./sagas/alert-on-stop.js";
import { createSpendAlertsService } from "./services/spend-alerts-service.js";

export function startSpendAlerts(deps: {
  redis: Redis;
  notify: (ownerSub: string, notice: StopNotice) => Promise<{ sent: number }>;
  agentName: (agentId: string) => Promise<string | null>;
  connectionNames: (ownerSub: string) => Promise<ReadonlyMap<string, string>>;
  sessionCategories: (
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ) => Promise<ReadonlyMap<string, SessionCategory>>;
  uiBaseUrl: string;
}): Subscription {
  return startAlertOnStopSaga({
    service: createSpendAlertsService({
      told: createRedisToldStops(deps.redis),
      notify: deps.notify,
      agentName: deps.agentName,
      connectionNames: deps.connectionNames,
      sessionCategories: deps.sessionCategories,
      uiBaseUrl: deps.uiBaseUrl,
      now: () => new Date(),
    }),
  });
}
