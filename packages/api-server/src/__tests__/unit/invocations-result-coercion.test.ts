import { describe, expect, test } from "vitest";

import type { InvocationRow } from "../../modules/invocations/infrastructure/invocations-repository.js";
import { createInvocationsService } from "../../modules/invocations/services/invocations-service.js";
import {
  fakeInvocationsRepo,
  invocationRow,
} from "../helpers/invocations-repo.js";

function makeService(row: InvocationRow) {
  const rows = new Map<string, InvocationRow>([[row.id, row]]);
  const repo = fakeInvocationsRepo({
    get: async (id) => rows.get(id) ?? null,
    getRun: async (runId) =>
      [...rows.values()].find((r) => r.runId === runId) ?? null,
    complete: async (runId, result) => {
      const r = [...rows.values()].find((x) => x.runId === runId);
      if (!r || r.status !== "running") return false;
      r.status = "done";
      r.result = result;
      return true;
    },
  });
  const service = createInvocationsService({
    owner: "owner-1",
    repo,
    agents: {
      delete: async () => {},
    } as never,
    driverResolution: { resolveRoot: async (id: string) => id },
    reaper: { reap: async () => {} },
    stopper: {
      stop: async () => ({ stopped: false }),
      running: async () => false,
    },
    reportedReap: { afterReport: () => {} },
    cancel: { settled: async () => true },
    runtimeMutator: {} as never,
    wakeAgent: async () => {},
    readHarnessConfigSupport: async () => null,
    scriptOutputsAvailable: true,
  });
  return { rows, service };
}

function runningRow(resultSchema: unknown): InvocationRow {
  return invocationRow({ resultSchema });
}

describe("recordResult tolerates stringified report_result payloads", () => {
  test('an integer delivered as the string "42" validates and stores 42', async () => {
    const { rows, service } = makeService(runningRow({ type: "integer" }));
    const outcome = await service.recordResult("agent-1", "42");
    expect(outcome.ok).toBe(true);
    expect(rows.get("agent-1")?.result).toBe(42);
  });

  test("a native integer still validates and stores unchanged", async () => {
    const { rows, service } = makeService(runningRow({ type: "integer" }));
    const outcome = await service.recordResult("agent-1", 42);
    expect(outcome.ok).toBe(true);
    expect(rows.get("agent-1")?.result).toBe(42);
  });

  test("an object delivered as JSON text validates and stores the parsed object", async () => {
    const schema = {
      type: "object",
      properties: { pass: { type: "boolean" }, note: { type: "string" } },
      required: ["pass", "note"],
      additionalProperties: false,
    };
    const { rows, service } = makeService(runningRow(schema));
    const outcome = await service.recordResult(
      "agent-1",
      '{"pass":true,"note":"ok"}',
    );
    expect(outcome.ok).toBe(true);
    expect(rows.get("agent-1")?.result).toEqual({ pass: true, note: "ok" });
  });

  test("a genuine string result is stored as-is, not parsed", async () => {
    const { rows, service } = makeService(runningRow({ type: "string" }));
    const outcome = await service.recordResult("agent-1", "42");
    expect(outcome.ok).toBe(true);
    expect(rows.get("agent-1")?.result).toBe("42");
  });

  test("a value that can't be made to fit is still rejected", async () => {
    const { service } = makeService(runningRow({ type: "integer" }));
    const outcome = await service.recordResult("agent-1", "not a number");
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toBeTruthy();
  });
});
