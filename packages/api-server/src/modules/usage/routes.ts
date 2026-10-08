import { Hono, type Context, type Next } from "hono";
import {
  isViewName,
  VIEW_NAMES,
  type ReportService,
} from "./services/report-service.js";
import {
  renderAnalyticsErrorPage,
  renderAnalyticsPage,
} from "./analytics-page.js";
import type { AnalyticsService } from "./services/analytics-service.js";
import { securityLog } from "../../core/security-log.js";
import type { ApiVariables } from "../../core/http-context.js";

type AppEnv = {
  Variables: ApiVariables;
};

export type UsageRoutesDeps = {
  service: ReportService;
  analytics: AnalyticsService;
  inspectorRole: string;
};

export function createUsageRoutes(deps: UsageRoutesDeps) {
  const routes = new Hono<AppEnv>();

  const inspectorOnly = async (c: Context<AppEnv>, next: Next) => {
    const roles = c.get("roles") ?? [];
    if (!roles.includes(deps.inspectorRole)) {
      securityLog("warn", "usage.inspect.deny", {
        category: "privileged",
        actor: c.get("user")?.sub ?? null,
        actorKind: "user",
        decision: "deny",
        reason: "missing-inspector-role",
        target: c.req.path,
      });
      if (c.req.path === "/api/usage/report") return c.text("forbidden", 403);
      return c.json({ error: "forbidden" }, 403);
    }
    securityLog("info", "usage.inspect", {
      category: "privileged",
      actor: c.get("user")?.sub ?? null,
      actorKind: "user",
      result: "success",
      target: c.req.path,
      ...(c.req.query("view") ? { detail: { view: c.req.query("view") } } : {}),
    });
    await next();
  };
  routes.use("/api/usage", inspectorOnly);
  routes.use("/api/usage/*", inspectorOnly);

  routes.get("/api/usage/views", (c) => {
    return c.json({ views: VIEW_NAMES });
  });

  routes.get("/api/usage/analytics", async (c) => {
    return c.json(await deps.analytics.report());
  });

  routes.get("/api/usage/report", async (c) => {
    try {
      return c.html(renderAnalyticsPage(await deps.analytics.report()));
    } catch (err) {
      return c.html(
        renderAnalyticsErrorPage(err instanceof Error ? err.message : String(err)),
        500,
      );
    }
  });

  routes.get("/api/usage", async (c) => {
    const view = c.req.query("view");
    if (!view || !isViewName(view)) {
      return c.json({ error: "unknown view", view: view ?? null }, 404);
    }

    const rows = await deps.service.getReport(view);
    return c.json({ view, rows });
  });

  return routes;
}
