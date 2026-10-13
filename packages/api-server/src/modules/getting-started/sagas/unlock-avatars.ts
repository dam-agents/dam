import type { GettingStartedTask } from "api-server-api";
import type { AvatarCharacter } from "api-server-api/avatar/svg";
import { concatMap, merge, type Observable, type Subscription } from "rxjs";
import { filter, map } from "rxjs/operators";

import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  type AgentCreated,
  type AgentSkillChanged,
  type ArtifactCreated,
  type ConnectionCreated,
  events$,
  EventType,
  ofType,
  type ScheduleCreated,
  type SessionTurnRelayed,
  type SlackConnected,
  type StarterKitApplied,
} from "../../../events.js";
import type { UnlockRecorder } from "../services/unlock-recorder.js";

interface TaskDone {
  owner: string;
  task: GettingStartedTask;
  created?: { agentId: string; character: AvatarCharacter };
}

function tasksDone(): Observable<TaskDone> {
  const e = events$();
  return merge(
    e.pipe(
      ofType<AgentCreated>(EventType.AgentCreated),
      map((ev) => ({
        owner: ev.ownerSub,
        task: "create-agent" as const,
        created: { agentId: ev.agentId, character: ev.character },
      })),
    ),
    e.pipe(
      ofType<SessionTurnRelayed>(EventType.SessionTurnRelayed),
      map((ev) => ({ owner: ev.actorSub, task: "send-message" as const })),
    ),
    e.pipe(
      ofType<ConnectionCreated>(EventType.ConnectionCreated),
      map((ev) => ({ owner: ev.actorSub, task: "create-connection" as const })),
    ),
    e.pipe(
      ofType<AgentSkillChanged>(EventType.AgentSkillChanged),
      filter((ev) => ev.action === "installed"),
      map((ev) => ({ owner: ev.actorSub, task: "add-skill" as const })),
    ),
    e.pipe(
      ofType<StarterKitApplied>(EventType.StarterKitApplied),
      map((ev) => ({ owner: ev.actorSub, task: "apply-starter-kit" as const })),
    ),
    e.pipe(
      ofType<ScheduleCreated>(EventType.ScheduleCreated),
      map((ev) => ({ owner: ev.ownerSub, task: "create-schedule" as const })),
    ),
    e.pipe(
      ofType<ArtifactCreated>(EventType.ArtifactCreated),
      map((ev) => ({ owner: ev.ownerSub, task: "create-artifact" as const })),
    ),
    e.pipe(
      ofType<SlackConnected>(EventType.SlackConnected),
      filter((ev) => ev.ownerSub !== null),
      map((ev) => ({ owner: ev.ownerSub!, task: "connect-slack" as const })),
    ),
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Each Getting Started task is done when its
 * domain event arrives, so the checklist follows what the user really did,
 * through the UI, the CLI or an Agent's own tools. The events are handled one
 * at a time, so a starter kit that sets up several things at once unlocks
 * them in a stable order. A task this replica already recorded is skipped
 * without a database read, because a message is sent on every prompt.
 */
export function startUnlockAvatarsSaga(recorder: UnlockRecorder): Subscription {
  const recorded = new Set<string>();
  return tasksDone()
    .pipe(
      filter((done) => done.owner !== ""),
      filter((done) => !recorded.has(`${done.owner}\n${done.task}`)),
      concatMap(async (done) => {
        try {
          await recorder.record(done.owner, done.task, done.created);
          recorded.add(`${done.owner}\n${done.task}`);
        } catch (err) {
          getLogger().error(
            { task: done.task, reason: formatError(err) },
            "getting_started.unlock_failed",
          );
        }
      }),
    )
    .subscribe();
}
