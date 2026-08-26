import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type UserAuthenticated,
  type ChannelTurnRelayed,
  type SessionTurnRelayed,
  type AgentRelayAttached,
  type ScheduleFired,
  type ConnectionCreated,
  type ConnectionRemoved,
  type FilesImported,
  type ContributionApplyFailed,
  type ContributionRecovered,
  type ContributionApplyGaveUp,
  type ArtifactPublished,
  type ArtifactShared,
  type ArtifactDeleted,
  type ArtifactViewed,
  type ArtifactRequestSettled,
  type AgentSkillChanged,
  type SkillPublished,
  type SkillSetSaved,
  type SkillSetDeleted,
  type KindedAgentCreated,
  type ExperimentChanged,
  type InvocationSpawned,
  type FeatureFlagChanged,
  type HarnessConfigChanged,
  type ApiKeyChanged,
  type EntryPointChosen,
} from "../../../events.js";
import type { ActivityEventRow } from "../domain/types.js";

export type PersistActivityDeps = {
  insert: (row: ActivityEventRow) => Promise<void>;
  upsertActorRole: (actorSub: string, isCore: boolean) => Promise<void>;
};

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
              ...(event.externalActorId
                ? { externalActorId: event.externalActorId }
                : {}),
              payload: {
                ...(event.reason ? { reason: event.reason } : {}),
              },
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
        ofType<SessionTurnRelayed>(EventType.SessionTurnRelayed),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "session_turn",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.surface,
              outcome: "success",
              payload: {},
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] session_turn insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<AgentRelayAttached>(EventType.AgentRelayAttached),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "relay_attached",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.surface,
              outcome: "success",
              payload: { relay: event.relay },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] relay_attached insert failed: ${err}\n`,
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
              payload: {
                connectionKey: event.connectionKey,
                templateId: event.templateId,
              },
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
              payload: {
                connectionKey: event.connectionKey,
                templateId: event.templateId,
              },
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
              surface: event.surface,
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

  sub.add(
    events$()
      .pipe(
        ofType<ArtifactPublished>(EventType.ArtifactPublished),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "artifact_published",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.surface,
              outcome: "success",
              payload: {
                artifactId: event.artifactId,
                kind: event.kind,
                visibility: event.visibility,
              },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] artifact_published insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ArtifactShared>(EventType.ArtifactShared),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "artifact_shared",
              actorSub: event.actorSub,
              agentId: null,
              surface: event.surface,
              outcome: "success",
              payload: {
                artifactId: event.artifactId,
                visibility: event.visibility,
              },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] artifact_shared insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ArtifactDeleted>(EventType.ArtifactDeleted),
        mergeMap(async (event) => {
          if (!event.actorSub) return;
          try {
            await deps.insert({
              type: "artifact_deleted",
              actorSub: event.actorSub,
              agentId: event.agentId ?? null,
              surface: event.surface ?? null,
              outcome: "success",
              payload: { artifactId: event.artifactId },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] artifact_deleted insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ArtifactViewed>(EventType.ArtifactViewed),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "artifact_viewed",
              actorSub: null,
              agentId: null,
              surface: "share-host",
              outcome: "success",
              ownerSub: event.ownerSub,
              payload: { artifactId: event.artifactId },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] artifact_viewed insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ArtifactRequestSettled>(EventType.ArtifactRequestSettled),
        mergeMap(async (event) => {
          if (!event.actorSub) return;
          try {
            await deps.insert({
              type: "artifact_request",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.surface ?? null,
              outcome: event.state === "answered" ? "success" : "failure",
              payload: {
                artifactId: event.artifactId,
                requestId: event.requestId,
                action: event.action,
                seq: event.seq,
                ...(event.failureReason
                  ? { failureReason: event.failureReason }
                  : {}),
              },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] artifact_request insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<AgentSkillChanged>(EventType.AgentSkillChanged),
        mergeMap(async (event) => {
          const type =
            event.action === "installed"
              ? "skill_installed"
              : "skill_uninstalled";
          try {
            await deps.insert({
              type,
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.surface,
              outcome: "success",
              payload: {
                name: event.name,
                origin: event.origin,
                ...(event.source ? { source: event.source } : {}),
              },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] ${type} insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<SkillPublished>(EventType.SkillPublished),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "skill_published",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.surface,
              outcome: "success",
              payload: { name: event.name },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] skill_published insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<SkillSetSaved>(EventType.SkillSetSaved),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "skill_set_saved",
              actorSub: event.actorSub,
              agentId: null,
              surface: event.surface,
              outcome: "success",
              payload: { skillCount: event.skillCount },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] skill_set_saved insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<SkillSetDeleted>(EventType.SkillSetDeleted),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "skill_set_deleted",
              actorSub: event.actorSub,
              agentId: null,
              surface: event.surface,
              outcome: "success",
              payload: {},
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] skill_set_deleted insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<KindedAgentCreated>(EventType.KindedAgentCreated),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "kinded_agent_created",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.surface,
              outcome: "success",
              payload: { kind: event.kind },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] kinded_agent_created insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ExperimentChanged>(EventType.ExperimentChanged),
        mergeMap(async (event) => {
          if (!event.action || !event.actorSub) return;
          const type = `experiment_${event.action}`;
          try {
            await deps.insert({
              type,
              actorSub: event.actorSub,
              agentId: null,
              surface: event.surface ?? null,
              outcome: "success",
              payload: { experimentId: event.experimentId },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] ${type} insert failed: ${err}\n`,
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
            await deps.insert({
              type: "invocation_spawned",
              actorSub: event.ownerSub,
              agentId: event.driverAgentId,
              surface: "mcp",
              outcome: "success",
              payload: { targetAgentId: event.targetAgentId },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] invocation_spawned insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<FeatureFlagChanged>(EventType.FeatureFlagChanged),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "feature_flag_changed",
              actorSub: event.actorSub,
              agentId: null,
              surface: event.surface,
              outcome: "success",
              payload: { feature: event.feature, enabled: event.enabled },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] feature_flag_changed insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<HarnessConfigChanged>(EventType.HarnessConfigChanged),
        mergeMap(async (event) => {
          if (!event.actorSub) return;
          try {
            await deps.insert({
              type: "harness_config_changed",
              actorSub: event.actorSub,
              agentId: event.agentId,
              surface: event.surface ?? null,
              outcome: "success",
              payload: {},
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] harness_config_changed insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<ApiKeyChanged>(EventType.ApiKeyChanged),
        mergeMap(async (event) => {
          const type = `api_key_${event.action}`;
          try {
            await deps.insert({
              type,
              actorSub: event.actorSub,
              agentId: null,
              surface: event.surface,
              outcome: "success",
              payload: {},
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] ${type} insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  sub.add(
    events$()
      .pipe(
        ofType<EntryPointChosen>(EventType.EntryPointChosen),
        mergeMap(async (event) => {
          try {
            await deps.insert({
              type: "entry_point_chosen",
              actorSub: event.actorSub,
              agentId: null,
              surface: "ui",
              outcome: "success",
              payload: { choice: event.choice },
            });
          } catch (err) {
            process.stderr.write(
              `[usage/persist-activity] entry_point_chosen insert failed: ${err}\n`,
            );
          }
        }, STREAM_CONCURRENCY),
      )
      .subscribe(),
  );

  return sub;
}
