import type {
  Agent,
  AgentCreateInput,
  AgentsService,
  HarnessFamily,
  KnowledgeBaseCreateInput,
  KnowledgeBasesService,
  KnowledgeBaseTemplateId,
} from "api-server-api";
import {
  createKindedAgent,
  type KindedAgentCreateDeps,
} from "../../agents/services/kinded-agent-create.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { ReadTemplateSpec } from "../../templates/index.js";
import { spellHarnessCommand } from "../../templates/index.js";
import { buildKnowledgeBaseInstallCommand } from "../domain/install-command.js";

export type CreateKnowledgeBaseAgent = (
  input: AgentCreateInput,
  kbTemplateId: KnowledgeBaseTemplateId,
  initializationTask: string | null,
) => Promise<Agent>;

interface Deps {
  owner: string;
  surface: string;
  agents: Pick<AgentsService, "create" | "delete">;
  readTemplateSpec: ReadTemplateSpec;
  kitOnboardingCommand: (
    kbTemplateId: KnowledgeBaseTemplateId,
  ) => Promise<string | undefined>;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}

async function harnessFamilyOf(
  deps: Pick<Deps, "readTemplateSpec">,
  templateId: string | undefined,
): Promise<HarnessFamily | undefined> {
  if (!templateId) return undefined;
  return (await deps.readTemplateSpec(templateId))?.spec.harness;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Creating a knowledge base — the kind marker plus
 * the template's bootstrap, run once in the workspace, and the initialization
 * turn the caller hands over (null when a starter kit owns it). Exported on
 * its own because a starter kit can declare a knowledge base too, and must
 * reach the same procedure rather than its own copy of the install command.
 */
export function createKnowledgeBaseAgentFactory(
  deps: Deps,
): CreateKnowledgeBaseAgent {
  const rail: KindedAgentCreateDeps = deps;
  return async (input, kbTemplateId, initializationTask) =>
    createKindedAgent(rail, {
      createInput: { ...input, kind: "knowledge-base" },
      installCommand: buildKnowledgeBaseInstallCommand(
        kbTemplateId,
        await harnessFamilyOf(deps, input.templateId),
      ),
      initializationTask,
      eventIdPrefix: "kb-install",
      securityEvent: "knowledge_base.create",
    });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Knowledge Bases form's own create. Its first
 * turn is the onboarding command the built-in kit for the same template
 * declares, spelled for the chosen harness — the kit is the one place that
 * knows it; a template no kit declares opens idle.
 */
export function createKnowledgeBasesService(deps: Deps): KnowledgeBasesService {
  const createAgent = createKnowledgeBaseAgentFactory(deps);
  return {
    async create(input: KnowledgeBaseCreateInput): Promise<Agent> {
      const { kbTemplateId, ...rest } = input;
      const command = await deps.kitOnboardingCommand(kbTemplateId);
      const task = command
        ? spellHarnessCommand(
            command,
            await harnessFamilyOf(deps, rest.templateId),
          )
        : null;
      return createAgent(rest, kbTemplateId, task);
    },
  };
}
