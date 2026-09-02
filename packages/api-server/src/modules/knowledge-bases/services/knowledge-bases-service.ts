import type {
  Agent,
  AgentsService,
  KbHarnessFamily,
  KnowledgeBaseCreateInput,
  KnowledgeBasesService,
  TemplateSpec,
} from "api-server-api";
import { parseKbHarnessFamily } from "api-server-api";
import {
  createKindedAgent,
  type KindedAgentCreateDeps,
} from "../../agents/services/kinded-agent-create.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { buildKnowledgeBaseInstallCommand } from "../domain/install-command.js";

export type ReadTemplateSpec = (
  id: string,
) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;

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
  ): Promise<KbHarnessFamily | undefined> {
    if (!input.templateId) return undefined;
    const tmpl = await deps.readTemplateSpec(input.templateId);
    return tmpl ? parseKbHarnessFamily(tmpl.spec.harness) : undefined;
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
