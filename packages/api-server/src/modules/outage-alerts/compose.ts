import type { Db } from "db";
import type { Subscription } from "rxjs";

import { createOutageAlertsRepository } from "./infrastructure/outage-alerts-repository.js";
import { startAlertOnOutageSaga } from "./sagas/alert-on-outage.js";
import {
  createOutageAlertsService,
  type AgentFacts,
} from "./services/outage-alerts-service.js";

export interface OutageAlertsModule {
  startSaga(): Subscription;
}

export function composeOutageAlerts(deps: {
  db: Db;
  notify: (ownerSub: string, text: string) => Promise<{ sent: number }>;
  describeAgent: (agentId: string) => Promise<AgentFacts | null>;
  uiBaseUrl: string;
  brandName: string;
  delayMs: number;
}): OutageAlertsModule {
  const service = createOutageAlertsService({
    repo: createOutageAlertsRepository(deps.db),
    notify: deps.notify,
    describeAgent: deps.describeAgent,
    homeUrl: deps.uiBaseUrl,
    brandName: deps.brandName,
    delayMs: deps.delayMs,
  });
  return { startSaga: () => startAlertOnOutageSaga({ service }) };
}
