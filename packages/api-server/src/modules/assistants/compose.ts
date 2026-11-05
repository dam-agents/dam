import type { AgentsService, AssistantsService } from "api-server-api";
import type { Db, OwnerLock } from "db";

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
  brandName: string;
  admitted: () => Promise<boolean>;
  enabled: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create" | "update">;
  enrolled: () => Promise<void>;
  provisioned: (agent: InfraAgent) => Promise<void>;
  resetChecklist: () => Promise<unknown>;
  withLock: OwnerLock["withLock"];
}): { assistants: AssistantsService; provisioner: AssistantProvisioner } {
  const repo = createAssistantsRepository(deps.db);
  return {
    assistants: createAssistantsService({
      repo,
      owner: deps.owner,
      enabled: deps.enabled,
      resetChecklist: deps.resetChecklist,
    }),
    provisioner: createAssistantProvisioner({
      repo,
      ownName: deps.owner,
      assistantName: deps.assistantName,
      brandName: deps.brandName,
      admitted: deps.admitted,
      enabled: deps.enabled,
      agentOf: deps.agentOf,
      agents: deps.agents,
      enrolled: deps.enrolled,
      provisioned: deps.provisioned,
      withLock: deps.withLock,
    }),
  };
}
