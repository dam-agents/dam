import type { Db } from "db";
import type { Subscription } from "rxjs";

import { createOutageAlertsRepository } from "./infrastructure/outage-alerts-repository.js";
import { startAlertOnOutageSaga } from "./sagas/alert-on-outage.js";
import {
  createOutageAlertsService,
  type AgentFacts,
} from "./services/outage-alerts-service.js";
import {
  createUnattendedAgentsOn,
  type EnabledSchedule,
  type FireKind,
  type UnattendedCandidate,
} from "./services/unattended-agents.js";

export interface OutageAlertsModule {
  startSaga(): Subscription;
}

export function composeOutageAlerts(deps: {
  db: Db;
  notify: (ownerSub: string, text: string) => Promise<{ sent: number }>;
  describeAgent: (agentId: string) => Promise<AgentFacts | null>;
  unattendedCandidates: (templateId: string) => Promise<UnattendedCandidate[]>;
  enabledSchedules: (agentIds: readonly string[]) => Promise<EnabledSchedule[]>;
  fireTemplate: (
    agentId: string,
    kind: FireKind,
    choices: { harness: string | undefined; model: string | undefined },
  ) => Promise<string | null | undefined>;
  uiBaseUrl: string;
  brandName: string;
  delayMs: number;
}): OutageAlertsModule {
  const service = createOutageAlertsService({
    repo: createOutageAlertsRepository(deps.db),
    notify: deps.notify,
    describeAgent: deps.describeAgent,
    unattendedAgentsOn: createUnattendedAgentsOn({
      candidates: deps.unattendedCandidates,
      enabledSchedules: deps.enabledSchedules,
      fireTemplate: deps.fireTemplate,
    }),
    homeUrl: deps.uiBaseUrl,
    brandName: deps.brandName,
    delayMs: deps.delayMs,
  });
  return { startSaga: () => startAlertOnOutageSaga({ service }) };
}
