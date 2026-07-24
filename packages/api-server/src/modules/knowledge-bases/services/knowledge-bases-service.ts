import type {
  Agent,
  AgentsService,
  KnowledgeBaseCreateInput,
  KnowledgeBasesService,
} from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { buildKnowledgeBaseInstallPrompt } from "../domain/install-prompt.js";
import { securityLog } from "../../../core/security-log.js";

/** How long the install instruction may wait for the fresh agent to come up.
 *  A created agent starts immediately (create stamps recent activity), so the
 *  TTL only guards the pathological boot — after it, the KB is an empty agent
 *  the user can still drive by hand. */
const INSTALL_EVENT_TTL_MS = 60 * 60 * 1000;

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

      // Deliver the install instruction as the KB's first session over the
      // trigger rail — durable (survives the pod not being up yet), delivered
      // once Ready, deduped by the synthetic schedule id on redelivery.
      const task = buildKnowledgeBaseInstallPrompt();
      await deps.runtimeMutator.bump(agent.id, [
        {
          id: `kb-install:${agent.id}:${now().getTime()}`,
          kind: "trigger",
          payload: {
            scheduleId: `kb-install:${agent.id}`,
            task,
            sessionMode: "fresh",
          },
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
