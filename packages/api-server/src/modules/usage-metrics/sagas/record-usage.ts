import { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type AgentRelayAttached,
  type AgentSkillChanged,
  type ChannelTurnRelayed,
  type ConnectionCreated,
  type ConnectionRemoved,
  type DomainEvent,
  type EntryPointChosen,
  type ExperimentChanged,
  type FilesImported,
  type InvocationSpawned,
  type ScheduleFired,
  type SessionTurnRelayed,
  type UserAuthenticated,
} from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import type { ActorDayLedger } from "../domain/actor-days.js";
import type { TemplateOf } from "../domain/template.js";
import {
  createBoundedValues,
  toRelayKind,
  toUsageSurface,
} from "../domain/vocabulary.js";
import type { UsageRecorder } from "../infrastructure/usage-recorder.js";

export interface UsageMetricsSagaDeps {
  recorder: UsageRecorder;
  templateOf: TemplateOf;
  actorDays: ActorDayLedger;
}

const PROVIDER_LIMIT = 64;

export function startUsageMetricsSaga(
  deps: UsageMetricsSagaDeps,
): Subscription {
  const sub = new Subscription();
  const provider = createBoundedValues(PROVIDER_LIMIT);

  function on<T extends DomainEvent>(
    type: T["type"],
    handler: (event: T) => void,
  ): void {
    sub.add(
      events$()
        .pipe(ofType<T>(type))
        .subscribe((event) => {
          try {
            handler(event);
          } catch (err) {
            getLogger().error(
              { sourceEvent: type, reason: formatError(err) },
              "usage_metrics.saga_error",
            );
          }
        }),
    );
  }

  on<SessionTurnRelayed>(EventType.SessionTurnRelayed, (e) =>
    deps.recorder.turn({
      surface: toUsageSurface(e.surface),
      template: deps.templateOf(e.agentId),
    }),
  );

  on<ChannelTurnRelayed>(EventType.ChannelTurnRelayed, (e) =>
    deps.recorder.turn({
      surface: toUsageSurface(e.channel),
      template: deps.templateOf(e.agentId),
    }),
  );

  on<UserAuthenticated>(EventType.UserAuthenticated, (e) => {
    const surface = toUsageSurface(e.surface);
    if (deps.actorDays.firstToday(e.userSub, surface))
      deps.recorder.actorDay({ surface });
  });

  on<ScheduleFired>(EventType.ScheduleFired, (e) =>
    deps.recorder.scheduleFire({
      mode: e.mode,
      outcome: e.outcome,
      template: deps.templateOf(e.agentId),
    }),
  );

  on<ConnectionCreated>(EventType.ConnectionCreated, (e) =>
    deps.recorder.connectionChange({
      action: "added",
      kind: e.kind,
      provider: provider(e.templateId),
    }),
  );

  on<ConnectionRemoved>(EventType.ConnectionRemoved, (e) =>
    deps.recorder.connectionChange({
      action: "removed",
      kind: e.kind,
      provider: provider(e.templateId),
    }),
  );

  on<FilesImported>(EventType.FilesImported, (e) =>
    deps.recorder.fileImport({
      surface: toUsageSurface(e.surface),
      outcome: e.outcome,
      bytes: e.bytes,
    }),
  );

  on<AgentSkillChanged>(EventType.AgentSkillChanged, (e) =>
    deps.recorder.skillChange({ action: e.action, origin: e.origin }),
  );

  on<AgentRelayAttached>(EventType.AgentRelayAttached, (e) =>
    deps.recorder.relayAttach({
      relay: toRelayKind(e.relay),
      surface: toUsageSurface(e.surface),
    }),
  );

  on<ExperimentChanged>(EventType.ExperimentChanged, (e) => {
    if (!e.action || !e.actorSub) return;
    deps.recorder.experimentChange({ action: e.action });
  });

  on<InvocationSpawned>(EventType.InvocationSpawned, () =>
    deps.recorder.invocationSpawn(),
  );

  on<EntryPointChosen>(EventType.EntryPointChosen, (e) =>
    deps.recorder.entryPointChoice({ choice: e.choice }),
  );

  return sub;
}
