// TEST_OVERVIEW: The attention record's rows for one agent serve a provisional session list while the agent wakes. Only the agent's owner reads them, through the rows filed under that owner; an API key bound to another agent is refused before the service is reached.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";

import type { AttentionRecordRow } from "../../modules/attention/domain/types.js";
import type { AttentionRepository } from "../../modules/attention/infrastructure/attention-repository.js";
import { createAttentionService } from "../../modules/attention/services/attention-service.js";
import { callerContext } from "../helpers/caller-context.js";

const row = (
  agentId: string,
  sessionId: string,
  ownerSub: string,
): AttentionRecordRow => ({
  agentId,
  sessionId,
  ownerSub,
  mode: "chat",
  type: "regular",
  title: `title ${sessionId}`,
  scheduleId: null,
  threadTs: null,
  harness: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  activityAt: new Date("2026-10-02T10:00:00Z"),
  seenAt: null,
  working: true,
});

const rows = [
  row("agent-a", "s1", "owner-1"),
  row("agent-a", "s2", "owner-2"),
  row("agent-b", "s3", "owner-1"),
];

function service(ownerSub: string, owned: readonly string[]) {
  const listForOwnerAgent = vi.fn(
    async (owner: string, agentId: string, limit: number) =>
      rows
        .filter((r) => r.ownerSub === owner && r.agentId === agentId)
        .slice(0, limit),
  );
  const repo = { listForOwnerAgent } as unknown as AttentionRepository;
  return {
    listForOwnerAgent,
    attention: createAttentionService({
      repo,
      ownerSub,
      ownsApproval: async () => false,
      ownsAgent: async (agentId) => owned.includes(agentId),
      defaultModelNotices: async () => [],
      outageAlerts: async () => [],
      log: () => {},
    }),
  };
}

describe("attention.sessionsForAgent service", () => {
  it("reads the caller's own rows for that agent", async () => {
    const { attention, listForOwnerAgent } = service("owner-1", ["agent-a"]);
    expect(await attention.sessionsForAgent("agent-a")).toEqual([
      {
        agentId: "agent-a",
        sessionId: "s1",
        mode: "chat",
        type: "regular",
        title: "title s1",
        scheduleId: null,
        threadTs: null,
        harness: null,
        createdAt: "2026-10-01T10:00:00.000Z",
        activityAt: "2026-10-02T10:00:00.000Z",
        seenAt: null,
        working: true,
      },
    ]);
    expect(listForOwnerAgent.mock.calls[0]?.slice(0, 2)).toEqual([
      "owner-1",
      "agent-a",
    ]);
  });

  it("answers nothing for an agent the caller does not own", async () => {
    const { attention, listForOwnerAgent } = service("owner-1", ["agent-b"]);
    expect(await attention.sessionsForAgent("agent-a")).toEqual([]);
    expect(listForOwnerAgent).not.toHaveBeenCalled();
  });
});

type User = ApiContext["user"];

function caller(user: User) {
  const attention = { sessionsForAgent: vi.fn(async () => []) };
  const ctx = callerContext({ attention, user });
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), attention };
}

const key = (scopes: User["scopes"], agentIds: User["agentIds"]): User => ({
  sub: "owner-1",
  preferredUsername: "test",
  scopes,
  agentIds,
  keyId: "key-1",
});

describe("attention.sessionsForAgent router", () => {
  it("refuses a key bound to another agent", async () => {
    const { caller: c, attention } = caller(key(["agents:read"], ["agent-b"]));
    await expect(
      c.attention.sessionsForAgent({ agentId: "agent-a" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(attention.sessionsForAgent).not.toHaveBeenCalled();
  });

  it("refuses a key without an agent read scope", async () => {
    const { caller: c, attention } = caller(key(["credentials:read"], "*"));
    await expect(
      c.attention.sessionsForAgent({ agentId: "agent-a" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(attention.sessionsForAgent).not.toHaveBeenCalled();
  });

  it("serves the key's own agent", async () => {
    const { caller: c, attention } = caller(key(["agents:read"], ["agent-a"]));
    await c.attention.sessionsForAgent({ agentId: "agent-a" });
    expect(attention.sessionsForAgent).toHaveBeenCalledWith("agent-a");
  });
});
