import { Hono } from "hono";
import type { Subscription } from "rxjs";
import type { Db } from "db";
import type { UsageService, UserIdentity } from "api-server-api";
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
import type { ApiVariables } from "../../core/http-context.js";

export interface BootAgentRow {
  id: string;
  owner: string;
  starterKit: string | null;
  onboardedAt: string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one Agent row a boot pass writes. Only a row that
 * was soft-deleted is a restore, and only a restore is bound to the seeded
 * Default; an Agent still waiting for its first hello keeps no default, so its
 * conversion can save the model it actually ran.
 */
export async function upsertBootAgent(
  deps: {
    isRestoredAgent?: (agentId: string) => Promise<boolean>;
    upsert: (row: { id: string; ownerSub: string }) => Promise<void>;
    fillKitFacts: (agent: BootAgentRow) => Promise<void>;
    onAgentRestored?: (agentId: string) => Promise<void>;
    log: (message: string) => void;
  },
  agent: BootAgentRow,
): Promise<void> {
  const restored = (await deps.isRestoredAgent?.(agent.id)) ?? false;
  await deps.upsert({ id: agent.id, ownerSub: agent.owner });
  await deps.fillKitFacts(agent);
  if (!restored) return;
  await deps.onAgentRestored?.(agent.id).catch((err: unknown) => {
    deps.log(`[usage/bootstrap-agents] binding ${agent.id} failed: ${err}`);
  });
}

export interface UsageModuleDeps {
  db: Db;
  subPseudonymizer: SubPseudonymizer;
  activityTrackingEnabled: boolean;
  inspectorRole: string;
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
  /** UNIT_BOUNDARY_DESCRIPTION: true when the row this boot pass writes was soft-deleted before it, which is what a restore is. */
  isRestoredAgent?: (agentId: string) => Promise<boolean>;
  /** UNIT_BOUNDARY_DESCRIPTION: called for an Agent whose row a boot pass brings back from deletion, never for one that was merely waiting for its first hello. */
  onAgentRestored?: (agentId: string) => Promise<void>;
}

type AppEnv = {
  Variables: ApiVariables;
};

export interface UsageModule {
  mount(app: Hono<AppEnv>): void;
  start(): void;
  stop(): void;
  retentionTick(): Promise<void>;
}

export function composeUsageForOwner(ownerSub: string): UsageService {
  return {
    entryPointChosen: (choice) => {
      emit({ type: EventType.EntryPointChosen, actorSub: ownerSub, choice });
    },
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
      })
    : new Hono();

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
      for (const a of await deps.listK8sAgents())
        await upsertBootAgent(
          {
            ...(deps.isRestoredAgent && {
              isRestoredAgent: deps.isRestoredAgent,
            }),
            upsert: upsertAgentRow,
            fillKitFacts,
            ...(deps.onAgentRestored && {
              onAgentRestored: deps.onAgentRestored,
            }),
            log: (message) => process.stderr.write(`${message}\n`),
          },
          a,
        );
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

  return { mount, start, stop, retentionTick };
}

export function listUsageAgentIds(db: Db): Promise<string[]> {
  return listLiveAgentIds(db)();
}

export function createUsageAgentsCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  return markAgentDeleted(db);
}
