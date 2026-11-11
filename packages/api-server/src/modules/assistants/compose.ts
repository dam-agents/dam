import type { AgentsService } from "api-server-api";
import { avatarCharacter } from "api-server-api/avatar/svg";
import type { Db } from "db";

import type { InfraAgent } from "../agents/infrastructure/agent-mappers.js";
import type { GettingStartedModule } from "../getting-started/compose.js";
import { createAssistantsRepository } from "./infrastructure/assistants-repository.js";
import {
  type AssistantProvisioning,
  createAssistantsService,
} from "./services/assistants-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the assistant's service for one owner, with the rest
 * of that owner's platform behind it: the checklist it enrols them in and records
 * their first Agent for, and the Agents it makes one of.
 */
export function composeAssistantsForOwner(deps: {
  db: Db;
  owner: string;
  assistantName: string;
  brandName: string;
  enabled: () => Promise<boolean>;
  admitted: () => Promise<boolean>;
  agentOf: (agentId: string) => Promise<InfraAgent | null>;
  agents: Pick<AgentsService, "list" | "create">;
  gettingStarted: GettingStartedModule;
  damConnection: () => Promise<string | null>;
}): AssistantProvisioning {
  return createAssistantsService({
    repo: createAssistantsRepository(deps.db),
    owner: deps.owner,
    assistantName: deps.assistantName,
    brandName: deps.brandName,
    enabled: deps.enabled,
    admitted: deps.admitted,
    agentOf: deps.agentOf,
    agents: deps.agents,
    enrolled: () => deps.gettingStarted.ensureEnrolled(deps.owner),
    provisioned: (agent) =>
      deps.gettingStarted.recordProvisionedAgent(deps.owner, {
        agentId: agent.id,
        character: avatarCharacter(
          agent.avatar ?? undefined,
          deps.owner,
          agent.name,
        ),
      }),
    resetChecklist: () => deps.gettingStarted.forOwner(deps.owner).reset(),
    damConnection: deps.damConnection,
  });
}
