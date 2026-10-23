import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  GETTING_STARTED_TASKS,
  type GettingStartedTask,
} from "api-server-api";
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
  type GettingStartedReset,
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
      filter((ev) => ev.templateId !== CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID),
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
 * without a database read, because a message is sent on every prompt. A
 * reset forgets the user's tasks on this replica only; another replica skips
 * a task it recorded before the reset until it restarts. The deployment's own
 * CurveBender Connection arrives for every user, so it is no connection the
 * user made and finishes nothing.
 */
export function startUnlockAvatarsSaga(recorder: UnlockRecorder): Subscription {
  const recorded = new Set<string>();
  const resets = events$()
    .pipe(ofType<GettingStartedReset>(EventType.GettingStartedReset))
    .subscribe((ev) => {
      for (const task of GETTING_STARTED_TASKS)
        recorded.delete(`${ev.ownerSub}\n${task}`);
    });
  const unlocks = tasksDone()
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
  unlocks.add(resets);
  return unlocks;
}
