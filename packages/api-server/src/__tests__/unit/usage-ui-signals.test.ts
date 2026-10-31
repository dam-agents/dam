import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { ApiVariables } from "../../core/http-context.js";
import {
  buildUiSignalsReport,
  type UiSignalsFacts,
} from "../../modules/usage/domain/ui-signals-report.js";
import { createUsageRoutes } from "../../modules/usage/routes.js";
import type { AnalyticsService } from "../../modules/usage/services/analytics-service.js";
import type { ReportService } from "../../modules/usage/services/report-service.js";

// TEST_OVERVIEW: the UI signals endpoint gives the QA agent friction, funnels and trails from UI telemetry.
// TEST_OVERVIEW: No row may describe fewer than 3 users, and only an inspector, by session or API key, may read it.

const PERIOD = {
  from: new Date("2026-10-24T00:00:00Z"),
  to: new Date("2026-10-31T00:00:00Z"),
};

const NO_FACTS: UiSignalsFacts = {
  builds: [],
  features: [],
  friction: [],
  flowSteps: [],
  trails: [],
};

function appFor(
  caller: { roles: string[]; keyId?: string; sub: string },
  inspectors: Set<string>,
) {
  const app = new Hono<{ Variables: ApiVariables }>();
  app.use("*", async (c, next) => {
    c.set("roles", caller.roles);
    c.set("user", {
      sub: caller.sub,
      preferredUsername: caller.sub,
      scopes: [],
      agentIds: "*",
      ...(caller.keyId ? { keyId: caller.keyId } : {}),
    });
    await next();
  });
  app.route(
    "/",
    createUsageRoutes({
      service: {} as ReportService,
      analytics: {} as AnalyticsService,
      inspectorRole: "platform-inspector",
      uiSignalsFacts: async () => NO_FACTS,
      keyOwnerIsInspector: async (sub) => inspectors.has(sub),
    }),
  );
  return app;
}

const signalsUrl =
  "/api/usage/ui/signals?from=2026-10-24T00:00:00Z&to=2026-10-31T00:00:00Z";

describe("UI signals", () => {
  // TEST_SCENARIO: a friction row seen by 2 users would point at one person, so it is dropped; kept rows get their rate against the route's views.
  it("drops rows under 3 users and rates friction against views", () => {
    const report = buildUiSignalsReport(PERIOD, {
      ...NO_FACTS,
      friction: [
        {
          signal: "rage_click",
          route: "/settings/connections",
          element: "catalog-add-:id",
          build: "1.2.0",
          users: 4,
          events: 10,
          views: 40,
          prevEvents: 2,
          prevViews: 20,
        },
        {
          signal: "dead_click",
          route: "/",
          element: "home-start",
          build: "1.2.0",
          users: 2,
          events: 9,
          views: 30,
          prevEvents: 0,
          prevViews: 0,
        },
      ],
      flowSteps: [
        {
          flow: "create_schedule",
          step: "done",
          users: 3,
          medianMsFromStart: 42_000,
        },
        {
          flow: "create_schedule",
          step: "open",
          users: 5,
          medianMsFromStart: 0,
        },
        {
          flow: "create_schedule",
          step: "submit",
          users: 2,
          medianMsFromStart: 30_000,
        },
      ],
    });

    expect(report.friction).toEqual([
      {
        signal: "rage_click",
        route: "/settings/connections",
        element: "catalog-add-:id",
        build: "1.2.0",
        users: 4,
        events: 10,
        views: 40,
        rate: 0.25,
        prevRate: 0.1,
      },
    ]);
    expect(report.funnels).toEqual([
      {
        flow: "create_schedule",
        steps: [
          { step: "open", users: 5, medianMsFromStart: 0 },
          { step: "done", users: 3, medianMsFromStart: 42_000 },
        ],
      },
    ]);
    expect(report.period).toEqual({
      from: "2026-10-24T00:00:00.000Z",
      to: "2026-10-31T00:00:00.000Z",
    });
  });

  // TEST_SCENARIO: an API key carries no realm roles, so the endpoint asks whether the key's owner holds the inspector role; that answer opens this endpoint only.
  it("admits an API key only when its owner is an inspector, and only for signals", async () => {
    const inspectors = new Set(["inspector-sub"]);
    const inspectorKey = appFor(
      { roles: [], keyId: "k1", sub: "inspector-sub" },
      inspectors,
    );
    const otherKey = appFor(
      { roles: [], keyId: "k2", sub: "someone" },
      inspectors,
    );

    expect((await inspectorKey.request(signalsUrl)).status).toBe(200);
    expect((await inspectorKey.request("/api/usage/views")).status).toBe(403);
    expect((await otherKey.request(signalsUrl)).status).toBe(403);
    expect(
      (
        await inspectorKey.request(
          "/api/usage/ui/signals?from=2026-10-31T00:00:00Z&to=2026-10-24T00:00:00Z",
        )
      ).status,
    ).toBe(400);
  });
});
