import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentCreated,
  type AgentUpdated,
  type AgentDeleted,
  type SlackConnected,
  type DomainEvent,
} from "../../../events.js";
import type { PublicAgentProfileRow } from "../infrastructure/public-agent-profile-repository.js";
import type { PublicAgentIdentity } from "../services/public-agent-page-service.js";

export type PersistPublicAgentProfileDeps = {
  readAgent: (agentId: string) => Promise<PublicAgentIdentity | null>;
  upsertProfile: (row: PublicAgentProfileRow) => Promise<void>;
  markProfileDeleted: (agentId: string) => Promise<void>;
};

const STREAM_CONCURRENCY = 8;

export function startPersistPublicAgentProfileSaga(
  deps: PersistPublicAgentProfileDeps,
): Subscription {
  const sub = new Subscription();

  async function refresh(agentId: string): Promise<void> {
    try {
      const agent = await deps.readAgent(agentId);
      if (!agent) {
        await deps.markProfileDeleted(agentId);
        return;
      }
      await deps.upsertProfile({
        agentId,
        name: agent.name,
        ownerSub: agent.ownerSub,
      });
    } catch (err) {
      process.stderr.write(
        `[public-agent-profile] refresh failed for ${agentId}: ${err}\n`,
      );
    }
  }

  function onEvent<T extends DomainEvent & { agentId: string }>(
    type: T["type"],
    handle: (agentId: string) => Promise<void>,
  ): void {
    sub.add(
      events$()
        .pipe(
          ofType<T>(type),
          mergeMap((event) => handle(event.agentId), STREAM_CONCURRENCY),
        )
        .subscribe(),
    );
  }

  onEvent<AgentCreated>(EventType.AgentCreated, refresh);
  onEvent<AgentUpdated>(EventType.AgentUpdated, refresh);
  onEvent<SlackConnected>(EventType.SlackConnected, refresh);
  onEvent<AgentDeleted>(EventType.AgentDeleted, async (agentId) => {
    try {
      await deps.markProfileDeleted(agentId);
    } catch (err) {
      process.stderr.write(
        `[public-agent-profile] mark deleted failed for ${agentId}: ${err}\n`,
      );
    }
  });

  return sub;
}
