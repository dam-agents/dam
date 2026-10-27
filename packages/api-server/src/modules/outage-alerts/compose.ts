import type { SessionCategory } from "api-server-api";
import type { Db } from "db";
import type { Redis } from "ioredis";
import type { Subscription } from "rxjs";

import type { AlertNotice } from "./domain/messages.js";
import { createOutageAlertsRepository } from "./infrastructure/outage-alerts-repository.js";
import { createRedisFailedWork } from "./infrastructure/redis-failed-work.js";
import { startAlertOnOutageSaga } from "./sagas/alert-on-outage.js";
import { startRecordFailedWorkSaga } from "./sagas/record-failed-work.js";
import {
  createOutageAlertsService,
  type AgentFacts,
  type OutageAlertsService,
} from "./services/outage-alerts-service.js";

export type OutageAlertNotices = Pick<OutageAlertsService, "noticesFor">;

export interface OutageAlertsModule {
  notices: OutageAlertNotices;
  startSaga(): Subscription;
}

export function composeOutageAlerts(deps: {
  db: Db;
  redis: Redis;
  notify: (ownerSub: string, notice: AlertNotice) => Promise<{ sent: number }>;
  describeAgent: (agentId: string) => Promise<AgentFacts | null>;
  sessionCategories: (
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ) => Promise<ReadonlyMap<string, SessionCategory>>;
  uiBaseUrl: string;
  delayMs: number;
}): OutageAlertsModule {
  const failedWork = createRedisFailedWork(deps.redis);
  const service = createOutageAlertsService({
    repo: createOutageAlertsRepository(deps.db),
    notify: deps.notify,
    describeAgent: deps.describeAgent,
    failedWork,
    sessionCategories: deps.sessionCategories,
    homeUrl: deps.uiBaseUrl,
    delayMs: deps.delayMs,
  });
  return {
    notices: service,
    startSaga: () => {
      const sagas = startAlertOnOutageSaga({ service });
      sagas.add(startRecordFailedWorkSaga({ failedWork }));
      return sagas;
    },
  };
}
