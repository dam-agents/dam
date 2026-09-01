import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import { mountInvocationRoutes } from "../../apps/harness-api-server/invocation-endpoints.js";
import { AGENTS_PLURAL } from "../../modules/agents/infrastructure/labels.js";
import {
  createSpawnSizeGate,
  SizeNeverFitsError,
} from "../../modules/budgets/services/budgets-service.js";
import { createTargetAdmission } from "../../modules/invocations/services/target-admission.js";

// TEST_OVERVIEW: A spawn whose effective Size exceeds the owner's budget Ceiling can never be admitted by the controller's 0→1 gate — without a fail-fast it parks OverBudget until the invocation deadline reaps it hours later. The admission check resolves the Size the create would stamp (explicit size, else template limits, else the chart default) and rejects a never-fits spawn at the spawn route with the figures. A spawn that fits the Ceiling passes untouched — queueing for currently-occupied room stays the controller's job.

const gate = (ceiling: { cpu: string; memory: string }) =>
  createSpawnSizeGate({
    readCeilingOverride: async () => null,
    defaultCeiling: ceiling,
  });

const admission = (opts: {
  templateResources?: { limits?: Record<string, string> };
  ceiling: { cpu: string; memory: string };
}) =>
  createTargetAdmission({
    readTemplateResources: async () => opts.templateResources,
    defaultLimits: { cpu: "1", memory: "1Gi" },
    gate: gate(opts.ceiling),
  });

describe("target admission", () => {
  // TEST_SCENARIO: An explicit spawn size larger than the Ceiling in one dimension — the driver asked for a worker that could never start, so the spawn is rejected with both figures in the message.
  test("rejects an explicit size over the ceiling", async () => {
    const a = admission({ ceiling: { cpu: "6", memory: "14Gi" } });

    await expect(
      a.assertCanEverFit({ size: { cpu: "8", memory: "4Gi" } }),
    ).rejects.toThrow(SizeNeverFitsError);
    await expect(
      a.assertCanEverFit({ size: { cpu: "8", memory: "4Gi" } }),
    ).rejects.toThrow(/8\.0 CPU.*6\.0 CPU/);
  });

  // TEST_SCENARIO: No explicit size — the template's limits are what the create would stamp, so they are what admission judges.
  test("judges the template limits when no size is given", async () => {
    const a = admission({
      templateResources: { limits: { cpu: "2", memory: "16Gi" } },
      ceiling: { cpu: "6", memory: "14Gi" },
    });

    await expect(a.assertCanEverFit({ templateId: "nous" })).rejects.toThrow(
      SizeNeverFitsError,
    );
  });

  // TEST_SCENARIO: An explicit size overrides the template's limits — a driver shrinking an oversized template's worker passes.
  test("explicit size wins over template limits", async () => {
    const a = admission({
      templateResources: { limits: { cpu: "2", memory: "16Gi" } },
      ceiling: { cpu: "6", memory: "14Gi" },
    });

    await expect(
      a.assertCanEverFit({ templateId: "nous", size: { memory: "8Gi" } }),
    ).resolves.toBeUndefined();
  });

  // TEST_SCENARIO: No template and no size — the chart default applies and fits any sane ceiling, so the spawn passes.
  test("passes the default size under the ceiling", async () => {
    const a = admission({ ceiling: { cpu: "6", memory: "14Gi" } });

    await expect(a.assertCanEverFit({})).resolves.toBeUndefined();
  });
});

describe("spawn size admission over the route", () => {
  // TEST_SCENARIO: The spawn route translates a never-fits refusal into a 400 naming the figures, so the driver's first spawn fails at once instead of its invocation dying at the deadline hours later.
  test("maps SizeNeverFitsError to a 400 with the figures", async () => {
    const app = new Hono();
    mountInvocationRoutes(app, {
      k8s: {
        getCustomObject: async (plural: string, id: string) =>
          plural === AGENTS_PLURAL && id === "driver-1"
            ? {
                metadata: {
                  uid: "uid-1",
                  labels: { "agent-platform.ai/owner": "owner-1" },
                },
                spec: {},
              }
            : null,
      } as never,
      invocationsServiceFor: () =>
        ({
          spawn: async () => {
            await gate({ cpu: "6", memory: "14Gi" }).assertCanEverFit({
              cpu: "8",
              memory: "4Gi",
            });
            return { id: "unreachable" };
          },
        }) as never,
      connectionsServiceFor: () =>
        ({
          listConnections: async () => [],
          getAgentConnections: async () => ({ connections: [] }),
        }) as never,
      templates: { list: async () => [], get: async () => null } as never,
      budgetsFor: () =>
        ({
          reserved: async () => ({
            cpu: { reservedMilli: 0, ceilingMilli: 6000 },
            memory: { reservedBytes: 0, ceilingBytes: 14 * 1024 ** 3 },
          }),
        }) as never,
      defaultLimits: { cpu: "1", memory: "1Gi" },
    });

    const res = await app.request("/api/agents/driver-1/invocations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "go",
        schema: { type: "object" },
        image: "example/worker:latest",
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("exceeds your budget ceiling");
    expect(json.error).toContain("6.0 CPU");
  });
});

describe("budget visibility over the route", () => {
  const makeApp = () => {
    const app = new Hono();
    mountInvocationRoutes(app, {
      k8s: {
        getCustomObject: async (plural: string, id: string) =>
          plural === AGENTS_PLURAL && id === "driver-1"
            ? {
                metadata: {
                  uid: "uid-1",
                  labels: { "agent-platform.ai/owner": "owner-1" },
                },
                spec: {},
              }
            : null,
      } as never,
      invocationsServiceFor: () => ({}) as never,
      connectionsServiceFor: () => ({}) as never,
      templates: {
        list: async () => [
          {
            id: "nous",
            name: "NOUS",
            spec: { resources: { limits: { cpu: "2", memory: "8Gi" } } },
          },
          { id: "claude-code", name: "Claude Code", spec: {} },
        ],
        get: async () => null,
      } as never,
      budgetsFor: () =>
        ({
          reserved: async () => ({
            cpu: { reservedMilli: 3000, ceilingMilli: 6000 },
            memory: {
              reservedBytes: 4 * 1024 ** 3,
              ceilingBytes: 14 * 1024 ** 3,
            },
          }),
        }) as never,
      defaultLimits: { cpu: "1", memory: "1Gi" },
    });
    return app;
  };

  // TEST_SCENARIO: A driver designing a loop reads its owner's ceiling and current reservation so it can size fan-out before the human approves the envelope — the same figures the controller enforces with.
  test("GET /budget serves the ceiling, the reservation, and the default worker size", async () => {
    const res = await makeApp().request("/api/agents/driver-1/budget");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cpu: { reservedMilli: 3000, ceilingMilli: 6000 },
      memory: {
        reservedBytes: 4 * 1024 ** 3,
        ceilingBytes: 14 * 1024 ** 3,
      },
      defaultWorkerSize: { cpu: "1", memory: "1Gi" },
    });
  });

  // TEST_SCENARIO: The catalogue names what each worker costs — template limits where declared, the chart default filled where not — so budget arithmetic needs no second source.
  test("GET /images carries each worker's effective size", async () => {
    const res = await makeApp().request("/api/agents/driver-1/images");

    expect(res.status).toBe(200);
    const { images } = (await res.json()) as {
      images: Array<{ id: string; size: { cpu: string; memory: string } }>;
    };
    expect(images.find((i) => i.id === "nous")?.size).toEqual({
      cpu: "2",
      memory: "8Gi",
    });
    expect(images.find((i) => i.id === "claude-code")?.size).toEqual({
      cpu: "1",
      memory: "1Gi",
    });
  });
});
