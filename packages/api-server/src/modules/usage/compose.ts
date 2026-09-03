import { Hono } from "hono";
import type { Subscription } from "rxjs";
import type { Db } from "db";
import type { UsageService, UserIdentity } from "api-server-api";
import { emit, EventType } from "../../events.js";
import type { SubPseudonymizer } from "../../core/sub-pseudonymizer.js";
import {
  insertActivityEvent,
  upsertActorRole,
} from "./infrastructure/activity-events-repository.js";
import {
  upsertAgent,
  markAgentDeleted,
} from "./infrastructure/agents-postgres-repository.js";
import { deleteActivityEventsOlderThan } from "./infrastructure/activity-retention.js";
import { startPersistActivitySaga } from "./sagas/persist-activity.js";
import { startPersistActorRolesSaga } from "./sagas/persist-actor-roles.js";
import { startPersistAgentsSaga } from "./sagas/persist-agents.js";
import { bootstrapAgents } from "./services/bootstrap-agents.js";
import { ACTIVITY_RETENTION_DAYS } from "./domain/types.js";
import { createReportService } from "./services/report-service.js";
import { createUsageRoutes } from "./routes.js";
import type { ApiVariables } from "../../core/http-context.js";

export interface UsageModuleDeps {
  db: Db;
  subPseudonymizer: SubPseudonymizer;
  activityTrackingEnabled: boolean;
  inspectorRole: string;
  listK8sAgents: () => Promise<{ id: string; owner: string }[]>;
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
  const markDeleted = markAgentDeleted(deps.db);

  const routes: Hono<AppEnv> = deps.inspectorRole
    ? createUsageRoutes({
        service: createReportService(deps.db),
        inspectorRole: deps.inspectorRole,
      })
    : new Hono();

  let persistAgentsSub: Subscription | null = null;
  let persistActorRolesSub: Subscription | null = null;
  let persistActivitySub: Subscription | null = null;

  function start(): void {
    persistAgentsSub = startPersistAgentsSaga({
      upsertAgent: upsertAgentRow,
      markAgentDeleted: markDeleted,
    });
    persistActorRolesSub = startPersistActorRolesSaga({
      upsertActorRole: upsertRole,
    });
    bootstrapAgents({
      listIdentities: deps.listK8sAgents,
      upsertAgent: upsertAgentRow,
    }).catch((err) => {
      process.stderr.write(
        `[usage/bootstrap-agents] backfill failed: ${err}\n`,
      );
    });
    if (deps.activityTrackingEnabled) {
      persistActivitySub = startPersistActivitySaga({
        insert,
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
