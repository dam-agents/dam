// TEST_OVERVIEW: `dam approval wait` is how an assistant that was told "waiting for your owner's approval" learns the verdict. It polls until the row settles and reports what became of the change, distinguishing approved-and-ran, approved-but-refused-by-the-server, declined and expired; it never re-runs anything, and it gives up rather than hanging forever.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalView } from "api-server-api";
import { buildWaitCommand } from "../modules/approval/commands/wait.js";
import type { ApprovalService } from "../modules/approval/services/approval-service.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_SUCCESS,
} from "../modules/shared/exit-codes.js";

const ok = <T>(value: T) => ({ ok: true as const, value });

const deps = (svc: Partial<ApprovalService>) => ({
  compatService: {
    check: async () =>
      ok({
        kind: "ok" as const,
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: undefined,
      }),
  },
  configService: {
    getResolved: async () => ok({ server: "http://localhost:4444" }),
    set: vi.fn(),
  },
  createApprovalService: () => svc as ApprovalService,
});

let stdout = "";

async function run(svc: Partial<ApprovalService>, args: string[]) {
  stdout = "";
  const outcome = buildWaitCommand(deps(svc))
    .parseAsync(args, { from: "user" })
    .then(() => "finished" as const)
    .catch((err: Error) => err.message);
  return { outcome: await outcome, stdout: () => stdout };
}

function changePayload(outcome: {
  procedure: string;
  status: "ran" | "failed";
  error: string | null;
}): ApprovalView["payload"] {
  return {
    kind: "agent_change",
    procedure: "agents.update",
    title: "Change an Agent's settings",
    detail: '{"id":"agent-1","name":"renamed"}',
    input: { id: "agent-1", name: "renamed" },
    outcome,
  };
}

function approval(overrides: Partial<ApprovalView>): ApprovalView {
  return {
    id: "agentchange:1",
    type: "agent_change",
    agentId: "agent-assistant",
    sessionId: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "pending",
    payload: {
      kind: "agent_change",
      procedure: "agents.update",
      title: "Change an Agent's settings",
      detail: '{"id":"agent-1","name":"renamed"}',
      input: { id: "agent-1", name: "renamed" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${String(code)}`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dam approval wait", () => {
  it("reports an approved change that ran", async () => {
    const svc: Partial<ApprovalService> = {
      get: async () =>
        ok(
          approval({
            status: "resolved",
            verdict: "allow_once",
            resolvedAt: new Date().toISOString(),
            payload: changePayload({
              procedure: "agents.update",
              status: "ran",
              error: null,
            }),
          }),
        ),
    };
    const { outcome, stdout } = await run(svc, ["agentchange:1"]);
    expect(outcome).toBe(`exit ${String(EXIT_SUCCESS)}`);
    expect(stdout()).toContain("Approved");
    expect(stdout()).toContain("ran");
  });

  it("says a refused change ran nothing", async () => {
    const svc: Partial<ApprovalService> = {
      get: async () =>
        ok(
          approval({
            status: "resolved",
            verdict: "deny_once",
            resolvedAt: new Date().toISOString(),
          }),
        ),
    };
    const { stdout } = await run(svc, ["agentchange:1"]);
    expect(stdout()).toContain("Declined");
    expect(stdout()).toContain("Nothing ran");
  });

  it("reports a change the server refused after the owner approved it", async () => {
    const svc: Partial<ApprovalService> = {
      get: async () =>
        ok(
          approval({
            status: "resolved",
            verdict: "allow",
            resolvedAt: new Date().toISOString(),
            payload: changePayload({
              procedure: "agents.update",
              status: "failed",
              error: "the agent is gone",
            }),
          }),
        ),
    };
    const { stdout } = await run(svc, ["agentchange:1"]);
    expect(stdout()).toContain("the agent is gone");
  });

  it("says an expired request never ran", async () => {
    const svc: Partial<ApprovalService> = {
      get: async () => ok(approval({ status: "expired" })),
    };
    const { stdout } = await run(svc, ["agentchange:1"]);
    expect(stdout()).toContain("Expired");
    expect(stdout()).toContain("Nothing ran");
  });

  it("refuses a timeout that is not a whole number of seconds", async () => {
    const svc: Partial<ApprovalService> = {
      get: async () => ok(approval({})),
    };
    const { outcome } = await run(svc, ["agentchange:1", "--timeout", "0.01"]);
    expect(outcome).toBe(`exit ${String(EXIT_INVALID_INPUT)}`);
  });

  it("refuses an id the server does not know", async () => {
    const svc: Partial<ApprovalService> = { get: async () => ok(null) };
    const { outcome } = await run(svc, ["nope"]);
    expect(outcome).toBe(`exit ${String(EXIT_INVALID_INPUT)}`);
  });
});
