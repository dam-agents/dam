import type { Db } from "db";

import type { InfraAgent } from "../agents/infrastructure/agent-mappers.js";
import { createResourceAlertsRepository } from "./infrastructure/resource-alerts-repository.js";
import {
  createResourceAlertsService,
  type OwnerStorage,
  type ResourceAlertsService,
} from "./services/resource-alerts-service.js";

export function composeResourceAlerts(deps: {
  db: Db;
  notify: (ownerSub: string, text: string) => Promise<{ sent: number }>;
  listStorageOwners: () => Promise<string[]>;
  readStorage: (ownerSub: string) => Promise<OwnerStorage | null>;
  listOwnerAgents: (ownerSub: string) => Promise<InfraAgent[]>;
  uiBaseUrl: string;
  log: (message: string) => void;
}): ResourceAlertsService {
  return createResourceAlertsService({
    repo: createResourceAlertsRepository(deps.db),
    notify: deps.notify,
    listStorageOwners: deps.listStorageOwners,
    readStorage: deps.readStorage,
    listOwnerAgents: deps.listOwnerAgents,
    homeUrl: deps.uiBaseUrl,
    log: deps.log,
  });
}
