import { Hono } from "hono";
import type { Subscription } from "rxjs";
import type { Db } from "db";
import type { UserIdentity } from "api-server-api";
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
import { withAdvisoryLock } from "./infrastructure/advisory-lock.js";
import { startPersistActivitySaga } from "./sagas/persist-activity.js";
import { startPersistAgentsSaga } from "./sagas/persist-agents.js";
import { bootstrapAgents } from "./services/bootstrap-agents.js";
import {
  startActivityRetentionJob,
  type ActivityRetentionJob,
} from "./sagas/activity-retention-job.js";
import { createReportService } from "./services/report-service.js";
import { createUsageRoutes } from "./routes.js";

export interface UsageModuleDeps {
  db: Db;
  subPseudonymizer: SubPseudonymizer;
  activityTrackingEnabled: boolean;
  /** Empty string skips route mounting (no inspector role configured). */
  inspectorRole: string;
  listK8sAgents: () => Promise<{ id: string; owner: string }[]>;
}

type AppEnv = { Variables: { user: UserIdentity; roles: string[] } };

export interface UsageModule {
  /** Mounts /api/usage/* handlers on the host app. No-op when no inspector
   *  role is configured (the module still runs persistence/sagas). */
  mount(app: Hono<AppEnv>): void;
  /** Starts the persist-agents saga + bootstrap, and (when activity tracking
   *  is enabled) the persist-activity saga + retention job. */
  start(): void;
  /** Unsubscribes from saga streams and stops the retention timer. */
  stop(): void;
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
  let persistActivitySub: Subscription | null = null;
  let retentionJob: ActivityRetentionJob | null = null;

  function start(): void {
    persistAgentsSub = startPersistAgentsSaga({
      upsertAgent: upsertAgentRow,
      markAgentDeleted: markDeleted,
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
        upsertActorRole: upsertRole,
      });
      retentionJob = startActivityRetentionJob({
        withLock: withAdvisoryLock(deps.db),
        deleteOld: deleteActivityEventsOlderThan(deps.db),
      });
      retentionJob.start();
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
    persistActivitySub?.unsubscribe();
    retentionJob?.stop();
  }

  function mount(app: Hono<AppEnv>): void {
    app.route("/", routes);
  }

  return { mount, start, stop };
}
