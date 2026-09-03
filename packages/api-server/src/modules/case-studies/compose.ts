import { Hono } from "hono";
import type { Db } from "db";
import type { CaseStudiesService } from "api-server-api";
import type { ApiVariables } from "../../core/http-context.js";
import { createCaseStudiesRepository } from "./infrastructure/case-studies-repository.js";
import { createCaseStudiesService } from "./services/case-studies-service.js";
import { createCaseStudyInspection } from "./services/inspection-service.js";
import { createCaseStudyRetentionSweeper } from "./services/retention-sweeper.js";
import { createCaseStudySubmissions } from "./services/submissions-service.js";
import { createCaseStudiesRoutes } from "./routes.js";
import type { CaseStudyInspectionService } from "./services/inspection-service.js";
import type { CaseStudySubmissionsService } from "./services/submissions-service.js";
import type { CaseStudyRetentionSweeper } from "./services/retention-sweeper.js";

type AppEnv = { Variables: ApiVariables };

export interface CaseStudiesModuleDeps {
  db: Db;
  inspectorRole: string;
  retentionDays: number;
  graceDays: number;
}

export interface CaseStudiesModule {
  submissions: CaseStudySubmissionsService;
  inspection: CaseStudyInspectionService;
  sweeper: CaseStudyRetentionSweeper;
  mount(app: Hono<AppEnv>): void;
}

export function composeCaseStudiesModule(
  deps: CaseStudiesModuleDeps,
): CaseStudiesModule {
  const repo = createCaseStudiesRepository(deps.db);
  const submissions = createCaseStudySubmissions({
    repo,
    now: () => new Date(),
  });
  const inspection = createCaseStudyInspection({ repo });
  const sweeper = createCaseStudyRetentionSweeper({
    repo,
    retentionDays: deps.retentionDays,
    graceDays: deps.graceDays,
    now: () => new Date(),
  });
  const routes: Hono<AppEnv> = deps.inspectorRole
    ? createCaseStudiesRoutes({ inspection, inspectorRole: deps.inspectorRole })
    : new Hono();

  return {
    submissions,
    inspection,
    sweeper,
    mount(app) {
      app.route("/", routes);
    },
  };
}

export function composeCaseStudiesForOwner(deps: {
  db: Db;
  owner: string;
  listOwnedAgentIds: () => Promise<string[]>;
}): { caseStudies: CaseStudiesService } {
  const repo = createCaseStudiesRepository(deps.db);
  return {
    caseStudies: createCaseStudiesService({
      repo,
      owner: deps.owner,
      listOwnedAgentIds: deps.listOwnedAgentIds,
    }),
  };
}
