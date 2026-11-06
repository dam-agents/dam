import { Hono } from "hono";
import type { Subscription } from "rxjs";
import type { Db } from "db";
import type { UiTelemetrySettings, UsageService } from "api-server-api";
import { emit, EventType } from "../../events.js";
import type { SubPseudonymizer } from "../../core/sub-pseudonymizer.js";
import {
  deleteActivityEventsOlderThan,
  insertActivityEvent,
  upsertActorRole,
} from "./infrastructure/activity-events-repository.js";
import {
  upsertAgent,
  listLiveAgentIds,
  markAgentDeleted,
  recordAgentStarterKit,
  recordAgentOnboarded,
  recordAgentSpawnedBy,
  fillAgentStarterKitFacts,
} from "./infrastructure/agents-postgres-repository.js";
import { startPersistActivitySaga } from "./sagas/persist-activity.js";
import { startPersistActorRolesSaga } from "./sagas/persist-actor-roles.js";
import { startPersistAgentsSaga } from "./sagas/persist-agents.js";
import { startPersistExternalActorLinksSaga } from "./sagas/persist-external-actor-links.js";
import {
  listIdentityLinks,
  upsertExternalActorLinks,
} from "./infrastructure/external-actor-links-repository.js";
import { ACTIVITY_RETENTION_DAYS } from "./domain/types.js";
import { createReportService } from "./services/report-service.js";
import { createAnalyticsService } from "./services/analytics-service.js";
import { createAnalyticsRepository } from "./infrastructure/analytics-repository.js";
import { toLiveAgentFact } from "./infrastructure/live-agent-facts.js";
import type { AgentSizing } from "./domain/analytics-report.js";
import { createUsageRoutes } from "./routes.js";
import {
  deleteUiEventsOlderThan,
  insertUiEvents,
  readUiSignalsFacts,
} from "./infrastructure/ui-events-repository.js";
import {
  createUiEventsIngest,
  type UiEventsIngest,
} from "./services/ui-events-ingest.js";
import { UI_EVENTS_RETENTION_DAYS } from "./domain/ui-signals-report.js";
import type { ApiVariables } from "../../core/http-context.js";

export interface UsageModuleDeps {
  db: Db;
  subPseudonymizer: SubPseudonymizer;
  activityTrackingEnabled: boolean;
  uiTelemetryEnabled: boolean;
  appVersion: string;
  inspectorRole: string;
  keyOwnerIsInspector: (sub: string) => Promise<boolean>;
  listK8sAgents: () => Promise<
    Array<{
      id: string;
      owner: string;
      starterKit: string | null;
      onboardedAt: string | null;
    }>
  >;
  listLiveAgents: () => Promise<
    Array<{ metadata?: { name?: string }; spec?: unknown }>
  >;
  agentSizing: AgentSizing;
}

type AppEnv = {
  Variables: ApiVariables;
};

export interface UsageModule {
  mount(app: Hono<AppEnv>): void;
  start(): void;
  stop(): void;
  retentionTick(): Promise<void>;
  uiEventsRetentionTick(): Promise<void>;
  uiTelemetry: UiTelemetry;
}

export interface UiTelemetry {
  settings: UiTelemetrySettings;
  ingest: UiEventsIngest;
}

export function composeUsageForOwner(
  ownerSub: string,
  uiTelemetry: UiTelemetry,
): UsageService {
  return {
    entryPointChosen: (choice) => {
      emit({ type: EventType.EntryPointChosen, actorSub: ownerSub, choice });
    },
    uiTelemetry: () => uiTelemetry.settings,
    uiEvents: (input) => uiTelemetry.ingest(ownerSub, input),
  };
}

export function composeUsageModule(deps: UsageModuleDeps): UsageModule {
  const insert = insertActivityEvent(deps.db, deps.subPseudonymizer);
  const upsertRole = upsertActorRole(deps.db, deps.subPseudonymizer);
  const upsertAgentRow = upsertAgent(deps.db, deps.subPseudonymizer);
  const fillKitFacts = fillAgentStarterKitFacts(deps.db);
  const registerCreatedAgent = upsertAgent(deps.db, deps.subPseudonymizer, {
    resetRuntimeState: true,
  });

  const uiTelemetryOn = deps.activityTrackingEnabled && deps.uiTelemetryEnabled;
  const routes: Hono<AppEnv> = deps.inspectorRole
    ? createUsageRoutes({
        service: createReportService(deps.db),
        analytics: createAnalyticsService({
          repo: createAnalyticsRepository(deps.db),
          listLiveAgents: async () =>
            (await deps.listLiveAgents()).flatMap(
              (obj) => toLiveAgentFact(obj) ?? [],
            ),
          sizing: deps.agentSizing,
        }),
        inspectorRole: deps.inspectorRole,
        uiSignalsFacts: uiTelemetryOn ? readUiSignalsFacts(deps.db) : null,
        keyOwnerIsInspector: deps.keyOwnerIsInspector,
      })
    : new Hono();

  const uiTelemetry: UiTelemetry = {
    settings: { enabled: uiTelemetryOn, build: deps.appVersion },
    ingest: uiTelemetryOn
      ? createUiEventsIngest({
          insert: insertUiEvents(deps.db, deps.subPseudonymizer),
          now: () => new Date(),
        })
      : async () => {},
  };

  let persistAgentsSub: Subscription | null = null;
  let persistActorRolesSub: Subscription | null = null;
  let persistActivitySub: Subscription | null = null;
  let persistExternalActorLinksSub: Subscription | null = null;
  const upsertLinks = upsertExternalActorLinks(deps.db, deps.subPseudonymizer);

  function start(): void {
    persistAgentsSub = startPersistAgentsSaga({
      upsertAgent: registerCreatedAgent,
      recordStarterKit: recordAgentStarterKit(deps.db, deps.subPseudonymizer),
      recordOnboarded: recordAgentOnboarded(deps.db),
      recordSpawnedBy: recordAgentSpawnedBy(deps.db, deps.subPseudonymizer),
    });
    persistActorRolesSub = startPersistActorRolesSaga({
      upsertActorRole: upsertRole,
    });
    (async () => {
      for (const a of await deps.listK8sAgents()) {
        await upsertAgentRow({ id: a.id, ownerSub: a.owner });
        await fillKitFacts(a);
      }
    })().catch((err) => {
      process.stderr.write(
        `[usage/bootstrap-agents] backfill failed: ${err}\n`,
      );
    });
    if (deps.activityTrackingEnabled) {
      persistActivitySub = startPersistActivitySaga({
        insert,
      });
      persistExternalActorLinksSub = startPersistExternalActorLinksSaga({
        upsert: upsertLinks,
      });
      listIdentityLinks(deps.db)()
        .then(upsertLinks)
        .catch((err) => {
          process.stderr.write(
            `[usage/bootstrap-external-actor-links] backfill failed: ${err}\n`,
          );
        });
    } else {
      process.stderr.write(
        "[usage] activityTrackingEnabled=false — activity_events not being written\n",
      );
    }
    if (!deps.inspectorRole) {
      process.stderr.write(
        "[usage] inspectorRole not configured — /api/usage endpoints not mounted\n",
      );
    }
  }

  function stop(): void {
    persistAgentsSub?.unsubscribe();
    persistActorRolesSub?.unsubscribe();
    persistActivitySub?.unsubscribe();
    persistExternalActorLinksSub?.unsubscribe();
  }

  function mount(app: Hono<AppEnv>): void {
    app.route("/", routes);
  }

  const deleteOld = deleteActivityEventsOlderThan(deps.db);
  async function retentionTick(): Promise<void> {
    const n = await deleteOld(ACTIVITY_RETENTION_DAYS);
    if (n > 0) {
      process.stderr.write(
        `[usage/retention] deleted ${n} activity_events older than ${ACTIVITY_RETENTION_DAYS}d\n`,
      );
    }
  }

  const deleteOldUiEvents = deleteUiEventsOlderThan(deps.db);
  async function uiEventsRetentionTick(): Promise<void> {
    const n = await deleteOldUiEvents(UI_EVENTS_RETENTION_DAYS);
    if (n > 0) {
      process.stderr.write(
        `[usage/retention] deleted ${n} ui_events older than ${UI_EVENTS_RETENTION_DAYS}d\n`,
      );
    }
  }

  return {
    mount,
    start,
    stop,
    retentionTick,
    uiEventsRetentionTick,
    uiTelemetry,
  };
}

export function listUsageAgentIds(db: Db): Promise<string[]> {
  return listLiveAgentIds(db)();
}

export function createUsageAgentsCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  return markAgentDeleted(db);
}
