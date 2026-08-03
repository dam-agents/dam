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
  agents: Pick<AgentsService, "create" | "delete">;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}): KnowledgeBasesService {
  const rail: KindedAgentCreateDeps = deps;

  return {
    async create(input: KnowledgeBaseCreateInput): Promise<Agent> {
      // The Kind marker is what makes this agent a Knowledge Base; the install
      // command bootstraps its knowledge tooling from an external installer.
      // Everything else — provider, size, egress, connections — is a plain
      // agent create, and the delivery mechanics are the shared kinded rail.
      return createKindedAgent(rail, {
        createInput: { ...input, kind: "knowledge-base" },
        installCommand: buildKnowledgeBaseInstallCommand(input.kbTemplateId),
        eventIdPrefix: "kb-install",
        securityEvent: "knowledge_base.create",
      });
    },
  };
}
