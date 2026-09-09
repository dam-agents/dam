import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentCreated,
  type AgentUpdated,
  type SlackConnected,
  type DomainEvent,
} from "../../../events.js";
import type { PublicAgentProfileRow } from "../infrastructure/public-agent-profile-repository.js";
import type { PublicAgentIdentity } from "../services/public-agent-page-service.js";

export type PersistPublicAgentProfileDeps = {
  hasAnyBinding: (agentId: string) => Promise<boolean>;
  readAgent: (agentId: string) => Promise<PublicAgentIdentity | null>;
  upsertProfile: (row: PublicAgentProfileRow) => Promise<void>;
  tombstoneProfile: (agentId: string) => Promise<void>;
  log: (message: string) => void;
};

const STREAM_CONCURRENCY = 8;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps the public agent profile current as an Agent
 * is created, renamed and bound. Only a bound Agent gets a row: the page never
 * names an unbound one, and every row costs the hourly reconcile one
 * control-plane read, so writing a row per Agent in the install would turn that
 * reconcile into a fleet-wide walk. A bind is the one event that writes without
 * asking, because the binding it announces is the reason the row is wanted.
 * Deletion is not this saga's job: the agent cleanup retires the row on every
 * deletion path, and the deletion event is only a notification here.
 */
export function startPersistPublicAgentProfileSaga(
  deps: PersistPublicAgentProfileDeps,
): Subscription {
  const sub = new Subscription();

  async function refresh(
    agentId: string,
    opts: { requireBinding: boolean },
  ): Promise<void> {
    try {
      if (opts.requireBinding && !(await deps.hasAnyBinding(agentId))) return;
      const agent = await deps.readAgent(agentId);
      if (!agent) {
        await deps.tombstoneProfile(agentId);
        return;
      }
      await deps.upsertProfile({
        agentId,
        name: agent.name,
        ownerSub: agent.ownerSub,
      });
    } catch (err) {
      deps.log(`refresh failed for ${agentId}: ${String(err)}`);
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

  const refreshIfBound = (agentId: string) =>
    refresh(agentId, { requireBinding: true });

  onEvent<AgentCreated>(EventType.AgentCreated, refreshIfBound);
  onEvent<AgentUpdated>(EventType.AgentUpdated, refreshIfBound);
  onEvent<SlackConnected>(EventType.SlackConnected, (agentId) =>
    refresh(agentId, { requireBinding: false }),
  );

  return sub;
}
