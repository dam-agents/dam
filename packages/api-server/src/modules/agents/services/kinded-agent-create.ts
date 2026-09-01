import type { Agent, AgentCreateInput, AgentsService } from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";

const INSTALL_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    await deps.runtimeMutator.bump(agent.id, [
      {
        id: `${args.eventIdPrefix}:${agent.id}:${now().getTime()}`,
        kind: "workspace-command",
        payload: { command: args.installCommand },
        expiresAt: new Date(now().getTime() + INSTALL_EVENT_TTL_MS),
      },
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
