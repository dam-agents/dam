import type { Agent, AgentCreateInput, AgentsService } from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import {
  initializationEvent,
  type RuntimeMutator,
  workspaceCommandEvent,
} from "../../runtime-delivery/index.js";

export interface KindedAgentCreateDeps {
  owner: string;
  surface: string;
  agents: Pick<AgentsService, "create" | "delete">;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}

export interface KindedAgentCreateArgs {
  createInput: AgentCreateInput;
  installCommand: string;
  initializationTask: string | null;
  eventIdPrefix: string;
  securityEvent: string;
}

export async function createKindedAgent(
  deps: KindedAgentCreateDeps,
  args: KindedAgentCreateArgs,
): Promise<Agent> {
  const now = deps.now ?? (() => new Date());

  const agent = await deps.agents.create(args.createInput);

  try {
    const at = now();
    await deps.runtimeMutator.bump(agent.id, [
      workspaceCommandEvent(
        args.eventIdPrefix,
        agent.id,
        args.installCommand,
        at,
      ),
      ...(args.initializationTask !== null
        ? [initializationEvent(agent.id, args.initializationTask, at)]
        : []),
    ]);
    await deps.runtimeMutator.enqueueAfterCommit(agent.id);
  } catch (err) {
    await deps.agents.delete(agent.id).catch(() => {});
    throw err;
  }
  await deps.wakeAgent(agent.id);

  securityLog("info", args.securityEvent, {
    category: "resource",
    actor: deps.owner,
    actorKind: "user",
    agentId: agent.id,
    result: "success",
  });
  emit({
    type: EventType.KindedAgentCreated,
    agentId: agent.id,
    actorSub: deps.owner,
    surface: deps.surface,
    kind: args.createInput.kind ?? "unknown",
  });
  return agent;
}
