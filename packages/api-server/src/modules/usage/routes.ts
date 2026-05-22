import { Hono } from "hono";
import type { UserIdentity } from "api-server-api";
import {
  isViewName,
  REPORTABLE_VIEW_NAMES,
  VIEW_NAMES,
  type ReportService,
  type ViewName,
} from "./services/report-service.js";
import { renderHtmlReport, type ViewResult } from "./html-report.js";

export type UsageRoutesDeps = {
  service: ReportService;
  inspectorRole: string;
};

export function createUsageRoutes(deps: UsageRoutesDeps) {
  const routes = new Hono<{
    Variables: { user: UserIdentity; roles: string[] };
  }>();

  // Inspector-role gate for every route on this router. The /report route
  // returns text/html on failure; everything else returns JSON.
  routes.use("*", async (c, next) => {
    const roles = c.get("roles") ?? [];
    if (!roles.includes(deps.inspectorRole)) {
      if (c.req.path === "/api/usage/report") return c.text("forbidden", 403);
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });

  routes.get("/api/usage/views", (c) => {
    return c.json({ views: VIEW_NAMES });
  });

  routes.get("/api/usage/report", async (c) => {
    const settled = await Promise.allSettled(
      REPORTABLE_VIEW_NAMES.map((name) => deps.service.getReport(name)),
    );
    const results: ReadonlyArray<readonly [ViewName, ViewResult]> =
      REPORTABLE_VIEW_NAMES.map((name, i) => {
        const s = settled[i]!;
        return [
          name,
          s.status === "fulfilled"
            ? { kind: "ok" as const, rows: s.value }
            : {
                kind: "error" as const,
                reason:
                  s.reason instanceof Error
                    ? s.reason.message
                    : String(s.reason),
              },
        ] as const;
      });
    return c.html(renderHtmlReport(new Date(), results));
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
