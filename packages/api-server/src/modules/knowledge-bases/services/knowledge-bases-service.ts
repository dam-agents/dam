import type {
  Agent,
  AgentsService,
  KnowledgeBaseCreateInput,
  KnowledgeBasesService,
} from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { buildKnowledgeBaseInstallCommand } from "../domain/install-command.js";
import { securityLog } from "../../../core/security-log.js";

/** How long the install command may wait for the fresh agent to come up.
 *  Generous (matching the workspace-seed clone TTL) because a fresh agent can
 *  legitimately wait far beyond boot time — parked over budget (#1900) until
 *  the owner frees room. Redelivery before the command has succeeded is
 *  deduped in-pod by the workspace-command plugin's sentinel. */
const INSTALL_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createKnowledgeBasesService(deps: {
  owner: string;
  agents: Pick<AgentsService, "create">;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}): KnowledgeBasesService {
  const now = deps.now ?? (() => new Date());

  return {
    async create(input: KnowledgeBaseCreateInput): Promise<Agent> {
      // The Kind marker is what makes this agent a Knowledge Base; everything
      // else is a plain agent create (provider, size, egress all standard).
      const agent = await deps.agents.create({
        ...input,
        kind: "knowledge-base",
      });

      // Deliver the install command over the workspace-command rail — durable
      // (survives the pod not being up yet), delivered once Ready, run once
      // in-pod (sentinel-guarded). No agent turn: the command bootstraps the
      // knowledge tooling in the workspace, then the user chats with the KB.
      const command = buildKnowledgeBaseInstallCommand();
      await deps.runtimeMutator.bump(agent.id, [
        {
          id: `kb-install:${agent.id}:${now().getTime()}`,
          kind: "workspace-command",
          payload: { command },
          expiresAt: new Date(now().getTime() + INSTALL_EVENT_TTL_MS),
        },
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(agent.id);
      await deps.wakeAgent(agent.id);

      securityLog("info", "knowledge_base.create", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        agentId: agent.id,
        result: "success",
      });
      return agent;
    },
  };
}
