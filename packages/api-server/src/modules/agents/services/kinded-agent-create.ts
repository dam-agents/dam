import type { Agent, AgentCreateInput, AgentsService } from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";

/** Generous: a fresh agent parked over budget (#1900) waits far beyond boot. */
const INSTALL_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface KindedAgentCreateDeps {
  owner: string;
  agents: Pick<AgentsService, "create">;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
}

export interface KindedAgentCreateArgs {
  /** Create input with `kind` already set. */
  createInput: AgentCreateInput;
  installCommand: string;
  /** Install event id prefix, e.g. `kb-install`. */
  eventIdPrefix: string;
  /** securityLog event name, e.g. `knowledge_base.create`. */
  securityEvent: string;
}

/** Create an Agent carrying an Agent Kind and run its Install Command: durable
 *  delivery (survives a pod that isn't up), once in-pod via the plugin's
 *  sentinel, retried each wake until the TTL lapses. No agent turn.
 *
 *  Not transactional — the marker is stamped by the create while the event is
 *  enqueued after, so a throw between them leaves a marked agent whose setup
 *  never ran, indistinguishable from a healthy one (#2946). */
export async function createKindedAgent(
  deps: KindedAgentCreateDeps,
  args: KindedAgentCreateArgs,
): Promise<Agent> {
  const now = deps.now ?? (() => new Date());

  const agent = await deps.agents.create(args.createInput);

  await deps.runtimeMutator.bump(agent.id, [
    {
      id: `${args.eventIdPrefix}:${agent.id}:${now().getTime()}`,
      kind: "workspace-command",
      payload: { command: args.installCommand },
      expiresAt: new Date(now().getTime() + INSTALL_EVENT_TTL_MS),
    },
  ]);
  await deps.runtimeMutator.enqueueAfterCommit(agent.id);
  await deps.wakeAgent(agent.id);

  securityLog("info", args.securityEvent, {
    category: "resource",
    actor: deps.owner,
    actorKind: "user",
    agentId: agent.id,
    result: "success",
  });
  return agent;
}
