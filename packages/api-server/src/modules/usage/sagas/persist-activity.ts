import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type UserAuthenticated,
  type ChannelTurnRelayed,
  type ScheduleFired,
  type ConnectionCreated,
  type ConnectionRemoved,
  type FilesImported,
  type ContributionApplyFailed,
  type ContributionRecovered,
  type ContributionApplyGaveUp,
} from "../../../events.js";
import type { ActivityEventRow } from "../domain/types.js";

export type PersistActivityDeps = {
  insert: (row: ActivityEventRow) => Promise<void>;
  upsertActorRole: (actorSub: string, isCore: boolean) => Promise<void>;
};

/** Bound per-stream concurrency for DB writes — defaults to Infinity in
 *  rxjs, which would let an auth burst (api-server restart, silent renew
 *  storm) saturate the pg pool. */
const STREAM_CONCURRENCY = 8;

export function startPersistActivitySaga(
  deps: PersistActivityDeps,
): Subscription {
  const sub = new Subscription();

  sub.add(
    events$()
      .pipe(
        ofType<UserAuthenticated>(EventType.UserAuthenticated),
        mergeMap(async (event) => {
          try {
            // `upsertActorRole` is a no-op after the first call per UTC day
            // (setWhere on updated_at < CURRENT_DATE), so this stays cheap
            // under heavy auth traffic while still picking up role flips
            // within a day.
            await deps.upsertActorRole(event.userSub, event.isCore);
            await deps.insert({
              type: "auth",
              actorSub: event.userSub,
              agentId: null,
              surface: event.surface,
              outcome: "success",
              payload: {},
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] auth insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ChannelTurnRelayed>(EventType.ChannelTurnRelayed),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "channel_turn",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.channel,
              outcome: event.outcome,
              payload: event.forkId ? { forkId: event.forkId } : {},
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] channel insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ScheduleFired>(EventType.ScheduleFired),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "schedule_fire",
              actorSub: event.ownerSub,
              agentId: event.agentId,
              surface: "scheduler",
              outcome: event.outcome,
              payload: {
                scheduleId: event.scheduleId,
                mode: event.mode,
                sessionId: event.sessionId,
              },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] schedule_fire insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ConnectionCreated>(EventType.ConnectionCreated),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "connection_added",
              actorSub: event.actorSub,
              agentId: null,
              surface: event.kind,
              outcome: "success",
              payload: { connectionKey: event.connectionKey },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] connection_added insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ConnectionRemoved>(EventType.ConnectionRemoved),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "connection_removed",
              actorSub: event.actorSub,
              agentId: null,
              surface: event.kind,
              outcome: "success",
              payload: { connectionKey: event.connectionKey },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] connection_removed insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<FilesImported>(EventType.FilesImported),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "files_imported",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: null,
              outcome: event.outcome,
              payload: { bytes: event.bytes },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] files_imported insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ContributionApplyFailed>(EventType.ContributionApplyFailed),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "contribution_apply_failed",
              actorSub: null,
              agentId: event.agentId,
              surface: null,
              outcome: "failure",
              payload: { kind: event.kind, message: event.message },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] contribution_apply_failed insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ContributionRecovered>(EventType.ContributionRecovered),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "contribution_recovered",
              actorSub: null,
              agentId: event.agentId,
              surface: null,
              outcome: "success",
              payload: { kind: event.kind },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] contribution_recovered insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ContributionApplyGaveUp>(EventType.ContributionApplyGaveUp),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "contribution_apply_gave_up",
              actorSub: null,
              agentId: event.agentId,
              surface: null,
              outcome: "failure",
              payload: { kind: event.kind, message: event.message },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] contribution_apply_gave_up insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  return sub;
}
