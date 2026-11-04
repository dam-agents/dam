import type { AgentsService, AssistantsService } from "api-server-api";
import type { Db } from "db";

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
  enabled: () => Promise<boolean>;
  agentExists: (agentId: string) => Promise<boolean>;
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
      enabled: deps.enabled,
      agentExists: deps.agentExists,
      agents: deps.agents,
      enrolled: deps.enrolled,
    }),
  };
}
