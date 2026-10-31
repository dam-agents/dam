import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
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
import {
  buildUiSignalsReport,
  type UiPeriod,
  type UiSignalsFacts,
} from "./domain/ui-signals-report.js";
import { securityLog } from "../../core/security-log.js";
import type { ApiVariables } from "../../core/http-context.js";

type AppEnv = {
  Variables: ApiVariables;
};

export type UsageRoutesDeps = {
  service: ReportService;
  analytics: AnalyticsService;
  inspectorRole: string;
  uiSignalsFacts: ((period: UiPeriod) => Promise<UiSignalsFacts>) | null;
  keyOwnerIsInspector: (sub: string) => Promise<boolean>;
};

export const UI_SIGNALS_PATH = "/api/usage/ui/signals";
const UI_SIGNALS_MAX_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

const uiPeriodSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .transform(({ from, to }) => ({ from: new Date(from), to: new Date(to) }))
  .refine(
    ({ from, to }) =>
      from < to && to.getTime() - from.getTime() <= UI_SIGNALS_MAX_SPAN_MS,
  );

export function createUsageRoutes(deps: UsageRoutesDeps) {
  const routes = new Hono<AppEnv>();

  const isInspector = async (c: Context<AppEnv>) => {
    if ((c.get("roles") ?? []).includes(deps.inspectorRole)) return true;
    const user = c.get("user");
    return (
      user?.keyId !== undefined &&
      c.req.path === UI_SIGNALS_PATH &&
      (await deps.keyOwnerIsInspector(user.sub))
    );
  };

  const inspectorOnly = async (c: Context<AppEnv>, next: Next) => {
    if (!(await isInspector(c))) {
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
  routes.get("/api/usage/inspect/status", (c) =>
    c.json({
      canInspect: (c.get("roles") ?? []).includes(deps.inspectorRole),
    }),
  );
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
        renderAnalyticsErrorPage(
          err instanceof Error ? err.message : String(err),
        ),
        500,
      );
    }
  });

  const uiSignalsFacts = deps.uiSignalsFacts;
  if (uiSignalsFacts) {
    routes.get(UI_SIGNALS_PATH, async (c) => {
      const period = uiPeriodSchema.safeParse(c.req.query());
      if (!period.success) {
        return c.json(
          {
            error:
              "from and to must be ISO date-times, from before to, at most 31 days apart",
          },
          400,
        );
      }
      return c.json(
        buildUiSignalsReport(period.data, await uiSignalsFacts(period.data)),
      );
    });
  }

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
