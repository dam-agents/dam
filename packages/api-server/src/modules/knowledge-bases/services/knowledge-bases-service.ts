import type {
  Agent,
  AgentsService,
  HarnessFamily,
  KnowledgeBaseCreateInput,
  KnowledgeBasesService,
} from "api-server-api";
import {
  createKindedAgent,
  type KindedAgentCreateDeps,
} from "../../agents/services/kinded-agent-create.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { ReadTemplateSpec } from "../../templates/index.js";
import { buildKnowledgeBaseInstallCommand } from "../domain/install-command.js";

export function createKnowledgeBasesService(deps: {
  owner: string;
  surface: string;
  agents: Pick<AgentsService, "create" | "delete">;
  readTemplateSpec: ReadTemplateSpec;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}): KnowledgeBasesService {
  const rail: KindedAgentCreateDeps = deps;

  async function resolveHarnessFamily(
    input: KnowledgeBaseCreateInput,
  ): Promise<HarnessFamily | undefined> {
    if (!input.templateId) return undefined;
    const tmpl = await deps.readTemplateSpec(input.templateId);
    return tmpl?.spec.harness;
  }

  return {
    async create(input: KnowledgeBaseCreateInput): Promise<Agent> {
      const family = await resolveHarnessFamily(input);
      return createKindedAgent(rail, {
        createInput: { ...input, kind: "knowledge-base" },
        installCommand: buildKnowledgeBaseInstallCommand(
          input.kbTemplateId,
          family,
        ),
        eventIdPrefix: "kb-install",
        securityEvent: "knowledge_base.create",
      });
    },
  };
}
