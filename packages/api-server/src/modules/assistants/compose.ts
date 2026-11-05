import type { AgentsService, AssistantsService } from "api-server-api";
import type { AvatarCharacter } from "api-server-api/avatar/svg";
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
  /* UNIT_BOUNDARY_DESCRIPTION: the install an assistant's machine is given the CLI of, as its own harness base — the one door it may drive the platform through. */
  cliInstall: { harnessUrl: string };
  admitted: () => Promise<boolean>;
  enabled: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create" | "update">;
  enrolled: () => Promise<void>;
  provisioned: (agent: InfraAgent) => Promise<void>;
  resetChecklist: () => Promise<unknown>;
  recordFirstAgent: (agent: {
    agentId: string;
    character: AvatarCharacter;
  }) => Promise<unknown>;
  withLock: OwnerLock["withLock"];
}): { assistants: AssistantsService; provisioner: AssistantProvisioner } {
  const repo = createAssistantsRepository(deps.db);
  return {
    assistants: createAssistantsService({
      repo,
      owner: deps.owner,
      enabled: deps.enabled,
      resetChecklist: deps.resetChecklist,
      recordFirstAgent: deps.recordFirstAgent,
      agentOf: deps.agentOf,
    }),
    provisioner: createAssistantProvisioner({
      repo,
      ownName: deps.owner,
      assistantName: deps.assistantName,
      brandName: deps.brandName,
      cliInstall: deps.cliInstall,
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
