import { Hono, type Context, type Next } from "hono";
import type { UserIdentity } from "api-server-api";

type AppEnv = { Variables: { user: UserIdentity; roles: string[] } };
import {
  isViewName,
  REPORTABLE_VIEW_NAMES,
  VIEW_NAMES,
  type ReportService,
  type ViewName,
} from "./services/report-service.js";
import { renderHtmlReport, type ViewResult } from "./html-report.js";
import { securityLog } from "../../core/security-log.js";

export type UsageRoutesDeps = {
  service: ReportService;
  inspectorRole: string;
};

export function createUsageRoutes(deps: UsageRoutesDeps) {
  const routes = new Hono<{
    Variables: { user: UserIdentity; roles: string[] };
  }>();

  // Inspector-role gate scoped to /api/usage/* — must NOT use a wildcard
  // path here. The router is mounted at "/" so a bare `*` would fire for
  // every request on the parent app and 403 all non-inspector traffic.
  // /report returns text/html on failure; everything else returns JSON.
  const inspectorOnly = async (c: Context<AppEnv>, next: Next) => {
    const roles = c.get("roles") ?? [];
    if (!roles.includes(deps.inspectorRole)) {
      // Attempt to read the most privileged cross-tenant surface without the
      // role.
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
    // Successful privileged read of cross-tenant activity — recorded on STDOUT,
    // distinct from the pseudonymized activity_events it reads.
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
