import type {
  Agent,
  AgentsService,
  KnowledgeBaseCreateInput,
  KnowledgeBasesService,
} from "api-server-api";
import {
  createKindedAgent,
  type KindedAgentCreateDeps,
} from "../../agents/services/kinded-agent-create.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { buildKnowledgeBaseInstallCommand } from "../domain/install-command.js";

export function createKnowledgeBasesService(deps: {
  owner: string;
  surface: string;
  agents: Pick<AgentsService, "create" | "delete">;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}): KnowledgeBasesService {
  const rail: KindedAgentCreateDeps = deps;

  return {
    async create(input: KnowledgeBaseCreateInput): Promise<Agent> {
      return createKindedAgent(rail, {
        createInput: { ...input, kind: "knowledge-base" },
        installCommand: buildKnowledgeBaseInstallCommand(input.kbTemplateId),
        eventIdPrefix: "kb-install",
        securityEvent: "knowledge_base.create",
      });
    },
  };
}
