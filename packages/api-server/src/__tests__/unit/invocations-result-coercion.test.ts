import { describe, expect, test } from "vitest";

import type {
  InvocationRow,
  InvocationsRepository,
} from "../../modules/invocations/infrastructure/invocations-repository.js";
import { createInvocationsService } from "../../modules/invocations/services/invocations-service.js";

function makeService(row: InvocationRow) {
  const rows = new Map<string, InvocationRow>([[row.id, row]]);
  const repo: InvocationsRepository = {
    insert: async () => {},
    get: async (id) => rows.get(id) ?? null,
    complete: async (id, result) => {
      const r = rows.get(id);
      if (!r || r.status !== "running") return false;
      r.status = "done";
      r.result = result;
      return true;
    },
    fail: async () => {},
    listExpiredRunning: async () => [],
    listRunning: async () => [],
    listRunningByDriver: async () => [],
    listRunningAgentIds: async () => [],
    listAgedTerminal: async () => [],
    listByExperiment: async () => [],
    countRunningByDriver: async () => new Map(),
    failAllRunningByExperiment: async () => [],
    delete: async () => {},
  };
  const service = createInvocationsService({
    owner: "owner-1",
    repo,
    agents: {
      delete: async () => {},
    } as never,
    runtimeMutator: {} as never,
    wakeAgent: async () => {},
  });
  return { rows, service };
}

function runningRow(resultSchema: unknown): InvocationRow {
  return {
    id: "agent-1",
    driverAgentId: "driver-1",
    owner: "owner-1",
    resultSchema,
    result: null,
    status: "running",
    errorReason: null,
    expiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    experimentSpanId: null,
  };
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
    // Schema is string, so the raw "42" validates first — never JSON-parsed.
    expect(rows.get("agent-1")?.result).toBe("42");
  });

  test("a value that can't be made to fit is still rejected", async () => {
    const { service } = makeService(runningRow({ type: "integer" }));
    const outcome = await service.recordResult("agent-1", "not a number");
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toBeTruthy();
  });
});
