import type { AgentsService, AssistantsService } from "api-server-api";
import type { Db } from "db";

import type { InfraAgent } from "../agents/infrastructure/agent-mappers.js";
import { createAssistantsRepository } from "./infrastructure/assistants-repository.js";
import {
  type AssistantProvisioner,
  createAssistantProvisioner,
} from "./services/assistant-provisioner.js";
import { createAssistantsService } from "./services/assistants-service.js";

export function composeAssistantsForOwner(deps: {
  db: Db;
  owner: string;
  assistantName: string;
  admitted: () => Promise<boolean>;
  enabled: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create" | "update">;
  enrolled: () => Promise<void>;
}): { assistants: AssistantsService; provisioner: AssistantProvisioner } {
  const repo = createAssistantsRepository(deps.db);
  return {
    assistants: createAssistantsService({ repo, owner: deps.owner }),
    provisioner: createAssistantProvisioner({
      repo,
      ownName: deps.owner,
      assistantName: deps.assistantName,
      admitted: deps.admitted,
      enabled: deps.enabled,
      agentOf: deps.agentOf,
      agents: deps.agents,
      enrolled: deps.enrolled,
    }),
  };
}
