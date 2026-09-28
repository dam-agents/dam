import { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type DomainEvent,
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
  type AgentSkillChanged,
  type SkillPublished,
  type SkillSetSaved,
  type SkillSetDeleted,
  type KindedAgentCreated,
  type StarterKitApplied,
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
};

const STREAM_CONCURRENCY = 8;

export function startPersistActivitySaga(
  deps: PersistActivityDeps,
): Subscription {
  const sub = new Subscription();

  function persist<T extends DomainEvent>(
    type: T["type"],
    toRow: (event: T) => ActivityEventRow | null,
    label?: string,
  ): void {
    sub.add(
      events$()
        .pipe(
          ofType<T>(type),
          mergeMap(async (event) => {
            const row = toRow(event);
            if (!row) return;
            try {
              await deps.insert(row);
            } catch (err) {
              process.stderr.write(
                `[usage/persist-activity] ${label ?? row.type} insert failed: ${err}\n`,
              );
            }
          }, STREAM_CONCURRENCY),
        )
        .subscribe(),
    );
  }

  persist<UserAuthenticated>(EventType.UserAuthenticated, (event) => ({
    type: "auth",
    actorSub: event.userSub,
    agentId: null,
    surface: event.surface,
    outcome: "success",
    payload: {},
  }));

  persist<ChannelTurnRelayed>(
    EventType.ChannelTurnRelayed,
    (event) => ({
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
    }),
    "channel",
  );

  persist<SessionTurnRelayed>(EventType.SessionTurnRelayed, (event) => ({
    type: "session_turn",
    actorSub: event.actorSub,
    agentId: event.agentId,
    surface: event.surface,
    outcome: "success",
    payload: {},
  }));

  persist<AgentRelayAttached>(EventType.AgentRelayAttached, (event) => ({
    type: "relay_attached",
    actorSub: event.actorSub,
    agentId: event.agentId,
    surface: event.surface,
    outcome: "success",
    payload: { relay: event.relay },
  }));

  persist<ScheduleFired>(EventType.ScheduleFired, (event) => ({
    type: "schedule_fire",
    actorSub: event.ownerSub,
    agentId: event.agentId,
    surface: "scheduler",
    outcome: event.outcome,
    payload: {
      scheduleId: event.scheduleId,
      mode: event.mode,
    },
  }));

  persist<ConnectionCreated>(EventType.ConnectionCreated, (event) => ({
    type: "connection_added",
    actorSub: event.actorSub,
    agentId: null,
    surface: event.kind,
    outcome: "success",
    payload: {
      connectionKey: event.connectionKey,
      templateId: event.templateId,
    },
  }));

  persist<ConnectionRemoved>(EventType.ConnectionRemoved, (event) => ({
    type: "connection_removed",
    actorSub: event.actorSub,
    agentId: null,
    surface: event.kind,
    outcome: "success",
    payload: {
      connectionKey: event.connectionKey,
      templateId: event.templateId,
    },
  }));

  persist<FilesImported>(EventType.FilesImported, (event) => ({
    type: "files_imported",
    actorSub: event.actorSub,
    agentId: event.agentId,
    surface: event.surface,
    outcome: event.outcome,
    payload: { bytes: event.bytes },
  }));

  persist<ContributionApplyFailed>(
    EventType.ContributionApplyFailed,
    (event) => ({
      type: "contribution_apply_failed",
      actorSub: null,
      agentId: event.agentId,
      surface: null,
      outcome: "failure",
      payload: { kind: event.kind, message: event.message },
    }),
  );

  persist<ContributionRecovered>(EventType.ContributionRecovered, (event) => ({
    type: "contribution_recovered",
    actorSub: null,
    agentId: event.agentId,
    surface: null,
    outcome: "success",
    payload: { kind: event.kind },
  }));

  persist<ContributionApplyGaveUp>(
    EventType.ContributionApplyGaveUp,
    (event) => ({
      type: "contribution_apply_gave_up",
      actorSub: null,
      agentId: event.agentId,
      surface: null,
      outcome: "failure",
      payload: { kind: event.kind, message: event.message },
    }),
  );

  persist<ArtifactPublished>(EventType.ArtifactPublished, (event) => ({
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
  }));

  persist<ArtifactShared>(EventType.ArtifactShared, (event) => ({
    type: "artifact_shared",
    actorSub: event.actorSub,
    agentId: null,
    surface: event.surface,
    outcome: "success",
    payload: {
      artifactId: event.artifactId,
      visibility: event.visibility,
    },
  }));

  persist<ArtifactDeleted>(EventType.ArtifactDeleted, (event) => {
    if (!event.actorSub) return null;
    return {
      type: "artifact_deleted",
      actorSub: event.actorSub,
      agentId: event.agentId ?? null,
      surface: event.surface ?? null,
      outcome: "success",
      payload: { artifactId: event.artifactId },
    };
  });

  persist<ArtifactViewed>(EventType.ArtifactViewed, (event) => ({
    type: "artifact_viewed",
    actorSub: null,
    agentId: null,
    surface: "share-host",
    outcome: "success",
    ownerSub: event.ownerSub,
    payload: { artifactId: event.artifactId },
  }));

  persist<AgentSkillChanged>(EventType.AgentSkillChanged, (event) => ({
    type:
      event.action === "installed" ? "skill_installed" : "skill_uninstalled",
    actorSub: event.actorSub,
    agentId: event.agentId,
    surface: event.surface,
    outcome: "success",
    payload: {
      name: event.name,
      origin: event.origin,
      ...(event.source ? { source: event.source } : {}),
    },
  }));

  persist<SkillPublished>(EventType.SkillPublished, (event) => ({
    type: "skill_published",
    actorSub: event.actorSub,
    agentId: event.agentId,
    surface: event.surface,
    outcome: "success",
    payload: { name: event.name },
  }));

  persist<SkillSetSaved>(EventType.SkillSetSaved, (event) => ({
    type: "skill_set_saved",
    actorSub: event.actorSub,
    agentId: null,
    surface: event.surface,
    outcome: "success",
    payload: { skillCount: event.skillCount },
  }));

  persist<SkillSetDeleted>(EventType.SkillSetDeleted, (event) => ({
    type: "skill_set_deleted",
    actorSub: event.actorSub,
    agentId: null,
    surface: event.surface,
    outcome: "success",
    payload: {},
  }));

  persist<KindedAgentCreated>(EventType.KindedAgentCreated, (event) => ({
    type: "kinded_agent_created",
    actorSub: event.actorSub,
    agentId: event.agentId,
    surface: event.surface,
    outcome: "success",
    payload: { kind: event.kind },
  }));

  persist<StarterKitApplied>(EventType.StarterKitApplied, (event) => ({
    type: "starter_kit_applied",
    actorSub: event.actorSub,
    agentId: event.agentId,
    surface: event.surface,
    outcome: "success",
    payload: {
      catalog: event.catalog,
      kitId: event.kitId,
      version: event.version,
    },
  }));

  persist<ExperimentChanged>(EventType.ExperimentChanged, (event) => {
    if (!event.action || !event.actorSub) return null;
    return {
      type: `experiment_${event.action}`,
      actorSub: event.actorSub,
      agentId: null,
      surface: event.surface ?? null,
      outcome: "success",
      payload: { experimentId: event.experimentId },
    };
  });

  persist<InvocationSpawned>(EventType.InvocationSpawned, (event) => ({
    type: "invocation_spawned",
    actorSub: event.ownerSub,
    agentId: event.driverAgentId,
    surface: "mcp",
    outcome: "success",
    payload: { targetAgentId: event.targetAgentId },
  }));

  persist<FeatureFlagChanged>(EventType.FeatureFlagChanged, (event) => ({
    type: "feature_flag_changed",
    actorSub: event.actorSub,
    agentId: null,
    surface: event.surface,
    outcome: "success",
    payload: { feature: event.feature, enabled: event.enabled },
  }));

  persist<HarnessConfigChanged>(EventType.HarnessConfigChanged, (event) => {
    if (!event.actorSub) return null;
    return {
      type: "harness_config_changed",
      actorSub: event.actorSub,
      agentId: event.agentId,
      surface: event.surface ?? null,
      outcome: "success",
      payload: {},
    };
  });

  persist<ApiKeyChanged>(EventType.ApiKeyChanged, (event) => ({
    type: `api_key_${event.action}`,
    actorSub: event.actorSub,
    agentId: null,
    surface: event.surface,
    outcome: "success",
    payload: {},
  }));

  persist<EntryPointChosen>(EventType.EntryPointChosen, (event) => ({
    type: "entry_point_chosen",
    actorSub: event.actorSub,
    agentId: null,
    surface: "ui",
    outcome: "success",
    payload: { choice: event.choice },
  }));

  return sub;
}
