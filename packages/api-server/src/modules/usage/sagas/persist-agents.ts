import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentCreated,
  type StarterKitApplied,
  type StarterKitOnboarded,
  type InvocationSpawned,
} from "../../../events.js";
import type { AgentRegistryRow } from "../domain/types.js";

export type PersistAgentsDeps = {
  upsertAgent: (row: AgentRegistryRow) => Promise<void>;
  recordStarterKit: (
    row: AgentRegistryRow & { starterKit: string },
  ) => Promise<void>;
  recordOnboarded: (id: string, at: Date) => Promise<void>;
  recordSpawnedBy: (
    row: AgentRegistryRow & { spawnedByAgentId: string },
  ) => Promise<void>;
};

const STREAM_CONCURRENCY = 8;

export function startPersistAgentsSaga(deps: PersistAgentsDeps): Subscription {
  const sub = new Subscription();

  sub.add(
    events$()
      .pipe(
        ofType<AgentCreated>(EventType.AgentCreated),
        mergeMap(async (event) => {
          try {
            await deps.upsertAgent({
              id: event.agentId,
              ownerSub: event.ownerSub,
            });
          } catch (err) {
            process.stderr.write(`[agents/persist] upsert failed: ${err}\n`);
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<StarterKitApplied>(EventType.StarterKitApplied),
        mergeMap(async (event) => {
          try {
            await deps.recordStarterKit({
              id: event.agentId,
              ownerSub: event.actorSub,
              starterKit: event.kitId,
            });
          } catch (err) {
            process.stderr.write(
              `[agents/persist] starter kit record failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<StarterKitOnboarded>(EventType.StarterKitOnboarded),
        mergeMap(async (event) => {
          try {
            await deps.recordOnboarded(event.agentId, new Date());
          } catch (err) {
            process.stderr.write(
              `[agents/persist] onboarding record failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<InvocationSpawned>(EventType.InvocationSpawned),
        mergeMap(async (event) => {
          try {
            await deps.recordSpawnedBy({
              id: event.targetAgentId,
              ownerSub: event.ownerSub,
              spawnedByAgentId: event.driverAgentId,
            });
          } catch (err) {
            process.stderr.write(
              `[agents/persist] spawned-by record failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  return sub;
}
