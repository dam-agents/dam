import { Hono, type Context, type Next } from "hono";
import {
  caseStudyInspectionFilterSchema,
  toCaseStudyInspectionFilter,
} from "api-server-api";
import type { ApiVariables } from "../../core/http-context.js";
import { securityLog } from "../../core/security-log.js";
import type { CaseStudyInspectionService } from "./services/inspection-service.js";

type AppEnv = { Variables: ApiVariables };

export type CaseStudiesRoutesDeps = {
  inspection: CaseStudyInspectionService;
  inspectorRole: string;
};

export function createCaseStudiesRoutes(deps: CaseStudiesRoutesDeps) {
  const routes = new Hono<AppEnv>();

  const inspectorOnly = async (c: Context<AppEnv>, next: Next) => {
    const roles = c.get("roles") ?? [];
    if (!roles.includes(deps.inspectorRole)) {
      securityLog("warn", "case_study.inspect.deny", {
        category: "privileged",
        actor: c.get("user")?.sub ?? null,
        actorKind: "user",
        decision: "deny",
        reason: "missing-inspector-role",
        target: c.req.path,
      });
      return c.json({ error: "forbidden" }, 403);
    }
    securityLog("info", "case_study.inspect", {
      category: "privileged",
      actor: c.get("user")?.sub ?? null,
      actorKind: "user",
      result: "success",
      target: c.req.path,
    });
    await next();
  };
  routes.use("/api/case-studies", inspectorOnly);
  routes.use("/api/case-studies/*", inspectorOnly);

  routes.get("/api/case-studies", async (c) => {
    const parsed = caseStudyInspectionFilterSchema.safeParse({
      since: c.req.query("since"),
      week_of: c.req.query("week_of"),
      agent_id: c.req.query("agent"),
    });
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "bad filter" },
        400,
      );
    }
    const editions = await deps.inspection.list(
      toCaseStudyInspectionFilter(parsed.data),
    );
    return c.json({ editions });
  });

  routes.get("/api/case-studies/:id", async (c) => {
    const edition = await deps.inspection.get(c.req.param("id"));
    if (!edition) return c.json({ error: "not found" }, 404);
    return c.json({ edition });
  });

  return routes;
}
