import type { Db } from "db";
import type { AgentSettingsService } from "api-server-api";
import { createAgentSettingsRepository } from "./infrastructure/agent-settings-repository.js";
import { createAgentSettingsService } from "./services/agent-settings-service.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

export function composeAgentSettingsModule(deps: {
  db: Db;
  runtimeMutator: RuntimeMutator;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
}): { service: AgentSettingsService } {
  return {
    service: createAgentSettingsService({
      repo: createAgentSettingsRepository(deps.db),
      runtimeMutator: deps.runtimeMutator,
      isOwnedAgent: deps.isOwnedAgent,
    }),
  };
}
