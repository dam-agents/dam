import { Hono, type Context, type Next } from "hono";
import type { ApiVariables } from "../../core/http-context.js";
import { securityLog } from "../../core/security-log.js";
import type { CaseStudyInspectionService } from "./services/inspection-service.js";

type AppEnv = { Variables: ApiVariables };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    const sinceRaw = c.req.query("since");
    const weekOf = c.req.query("week_of");
    const agentId = c.req.query("agent");
    let since: Date | undefined;
    if (sinceRaw !== undefined) {
      const parsed = new Date(sinceRaw);
      if (Number.isNaN(parsed.getTime())) {
        return c.json({ error: "since must be an ISO date-time" }, 400);
      }
      since = parsed;
    }
    if (weekOf !== undefined && !DATE_RE.test(weekOf)) {
      return c.json({ error: "week_of must be a date, YYYY-MM-DD" }, 400);
    }
    const editions = await deps.inspection.list({
      since,
      weekOf: weekOf === undefined ? undefined : new Date(weekOf),
      agentId,
    });
    return c.json({ editions });
  });

  routes.get("/api/case-studies/:id", async (c) => {
    const edition = await deps.inspection.get(c.req.param("id"));
    if (!edition) return c.json({ error: "not found" }, 404);
    return c.json({ edition });
  });

  return routes;
}
