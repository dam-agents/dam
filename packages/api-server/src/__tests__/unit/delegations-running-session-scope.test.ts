import { describe, expect, test } from "vitest";

import type {
  InvocationRow,
  InvocationsRepository,
} from "../../modules/invocations/infrastructure/invocations-repository.js";
import type { DelegationFramesPort } from "../../modules/invocations/services/delegation-frames.js";
import { createDelegationsQuery } from "../../modules/invocations/services/delegations-query.js";

// TEST_OVERVIEW: the running read a Driver's chat polls shows the running sub-agents that chat's Session spawned, plus every one with no recorded Session, and never one another Session of the same Driver spawned.

function row(
  id: string,
  overrides: Partial<InvocationRow> = {},
): InvocationRow {
  return {
    id,
    driverAgentId: "driver-1",
    rootDriverId: "driver-1",
    owner: "owner-1",
    label: null,
    prompt: "",
    templateId: null,
    image: null,
    connections: [],
    ttlMs: null,
    resultSchema: {},
    result: null,
    status: "running",
    errorReason: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    reapedAt: null,
    transcriptCaptured: false,
    transcriptTruncated: false,
    script: null,
    exitCode: null,
    output: null,
    outputExpiresAt: null,
    harnessConfig: null,
    driverSessionId: null,
    ...overrides,
  };
}

function query(rows: InvocationRow[]) {
  const repo = {
    get: async (id: string) => rows.find((r) => r.id === id) ?? null,
    listRunningByDriver: async (driver: string) =>
      rows.filter((r) => r.driverAgentId === driver && r.status === "running"),
    listByRoot: async (root: string) =>
      rows.filter((r) => r.rootDriverId === root),
  } as unknown as InvocationsRepository;
  return createDelegationsQuery({
    repo,
    owner: "owner-1",
    frames: {} as DelegationFramesPort,
  });
}

const rows = [
  row("agent-fromb", { driverSessionId: "session-b" }),
  row("agent-old"),
  row("agent-grandchild", {
    driverAgentId: "agent-fromb",
    driverSessionId: "session-of-child",
  }),
];

async function shownIn(sessionId: string | null | undefined) {
  const { nodes } = await query(rows).running({
    driverAgentId: "driver-1",
    ...(sessionId !== undefined ? { sessionId } : {}),
  });
  return nodes.map((n) => n.id);
}

describe("running delegations scoped to a session", () => {
  // TEST_SCENARIO: the bug report: session B spawned a sub-agent, and session A of the same Driver spawned nothing, so A must not show B's child, while the row with no recorded Session still shows in A as it did before.
  test("a child of session B does not show in session A", async () => {
    expect(await shownIn("session-a")).toEqual(["agent-old"]);
  });

  // TEST_SCENARIO: the spawning session shows its own child with the child's whole subtree, since a grandchild belongs to the child and not to any Session of the Driver.
  test("session B shows its child with its nested sub-agents", async () => {
    const { nodes } = await query(rows).running({
      driverAgentId: "driver-1",
      sessionId: "session-b",
    });
    expect(nodes.map((n) => n.id)).toEqual(["agent-fromb", "agent-old"]);
    expect(nodes[0]!.children.map((n) => n.id)).toEqual(["agent-grandchild"]);
  });

  // TEST_SCENARIO: a chat with no Session yet spawned nothing, so it shows only the children with no recorded Session.
  test("a chat with no session yet shows only unrecorded children", async () => {
    expect(await shownIn(null)).toEqual(["agent-old"]);
  });

  // TEST_SCENARIO: a caller that names no session keeps the old read of every running child of the Driver.
  test("a read without a session shows every running child", async () => {
    expect(await shownIn(undefined)).toEqual(["agent-fromb", "agent-old"]);
  });
});
