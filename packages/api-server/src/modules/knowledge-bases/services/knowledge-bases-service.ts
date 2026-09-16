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
import { buildKnowledgeBaseInstallCommand } from "../domain/install-command.js";

export type CreateKnowledgeBaseAgent = (
  input: AgentCreateInput,
  kbTemplateId: KnowledgeBaseTemplateId,
) => Promise<Agent>;

interface Deps {
  owner: string;
  surface: string;
  agents: Pick<AgentsService, "create" | "delete">;
  readTemplateSpec: ReadTemplateSpec;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Creating a knowledge base — the kind marker plus
 * the template's bootstrap, run once in the workspace. Exported on its own
 * because a starter kit can declare a knowledge base too, and must reach the
 * same procedure rather than its own copy of the install command.
 */
export function createKnowledgeBaseAgentFactory(
  deps: Deps,
): CreateKnowledgeBaseAgent {
  const rail: KindedAgentCreateDeps = deps;

  async function harnessFamily(
    templateId: string | undefined,
  ): Promise<HarnessFamily | undefined> {
    if (!templateId) return undefined;
    return (await deps.readTemplateSpec(templateId))?.spec.harness;
  }

  return async (input, kbTemplateId) =>
    createKindedAgent(rail, {
      createInput: { ...input, kind: "knowledge-base" },
      installCommand: buildKnowledgeBaseInstallCommand(
        kbTemplateId,
        await harnessFamily(input.templateId),
      ),
      eventIdPrefix: "kb-install",
      securityEvent: "knowledge_base.create",
    });
}

export function createKnowledgeBasesService(deps: Deps): KnowledgeBasesService {
  const createAgent = createKnowledgeBaseAgentFactory(deps);
  return {
    async create(input: KnowledgeBaseCreateInput): Promise<Agent> {
      const { kbTemplateId, ...rest } = input;
      return createAgent(rest, kbTemplateId);
    },
  };
}
