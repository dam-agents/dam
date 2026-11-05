import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ApiContext, UserIdentity } from "api-server-api";
import { mountCliRoutes } from "../../apps/harness-api-server/cli.js";
import { verifyAgentOnBehalf } from "../../modules/agent-on-behalf/index.js";
import { agentOnBehalfUser } from "../../modules/agent-on-behalf/index.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createAgentChangeApprovals } from "../../modules/approvals/services/agent-change-approvals.js";

/**
 * TEST_OVERVIEW: the path an assistant's machine drives the platform through.
 * Who the caller is, the transport has already proven, so what the mount must
 * get right is the rest: an Agent that is gone, is not an assistant, whose owner
 * is inactive or whose feature is off gets nothing, a request that names another
 * Agent is refused, and only the app's own tRPC router answers — an operator-only
 * procedure and a credential write are refused as they are for any non-person,
 * a batch is decided call by call, and nothing else (the harness's own runtime
 * router included) is reachable there.
 */

interface World {
  agent: { owner: string | null; kind?: string } | null;
  flagOn: boolean;
  ownerActive: boolean;
}

function world(opts: Partial<World> = {}) {
  const state: World = {
    agent: { owner: "owner-1", kind: "assistant" },
    flagOn: true,
    ownerActive: true,
    ...opts,
  };
  const filed: { procedure: string; input: unknown }[] = [];
  const rows: PendingApprovalRow[] = [];
  const repo = {
    insertPending: async (row) => {
      rows.push({
        ...row,
        createdAt: new Date(),
        resolvedAt: null,
        verdict: null,
        decidedBy: null,
        status: "pending",
        deliveredAt: null,
      });
      return true;
    },
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    setPayload: async () => {},
    resolvePending: async () => false,
    markDelivered: async () => {},
  } as Partial<ApprovalsRepository> as ApprovalsRepository;

  const contextFor = (user: UserIdentity): ApiContext => {
    const agentChanges = createAgentChangeApprovals({
      repo,
      agentId: user.onBehalfAgentId,
      ownerSub: user.sub,
      actor: user.sub,
    });
    const request = agentChanges.request.bind(agentChanges);
    agentChanges.request = async (change) => {
      filed.push(change);
      return request(change);
    };
    return {
      user,
      agentChanges,
      terms: { isAccepted: async () => true },
      agents: {
        list: async () => [],
        create: async (input: { name: string }) => ({
          id: "agent-new",
          ...input,
        }),
      },
    } as unknown as ApiContext;
  };

  const app = new Hono();
  mountCliRoutes(app, {
    verifyAgentOnBehalf: verifyAgentOnBehalf({
      agentOf: async () => state.agent,
      featureOn: async () => state.flagOn,
      ownerActive: async () => state.ownerActive,
    }),
    contextFor: (user) => contextFor(user),
  });
  return { app, filed, rows, state };
}

const BASE = "http://harness/api/agents";

describe("the derived principal", () => {
  it("acts as the assistant's owner over that owner's Agents", async () => {
    let seen: UserIdentity | null = null;
    const app = new Hono();
    mountCliRoutes(app, {
      verifyAgentOnBehalf: verifyAgentOnBehalf({
        agentOf: async () => ({ owner: "owner-1", kind: "assistant" }),
        featureOn: async () => true,
        ownerActive: async () => true,
      }),
      contextFor: (user) => {
        seen = user;
        return {
          agents: { runtimeFleet: async () => ({ agents: [] }) },
          user,
          terms: { isAccepted: async () => true },
        } as unknown as ApiContext;
      },
    });
    const response = await app.request(
      `${BASE}/agent-a/cli/trpc/agents.runtimeFleet`,
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual(
      agentOnBehalfUser({ agentId: "agent-a", ownerSub: "owner-1" }),
    );
    expect(seen!.scopes).toContain("agents:manage");
    expect(seen!.scopes).not.toContain("credentials:manage");
    expect(seen!.isOperator).toBeUndefined();
  });

  for (const [why, opts] of [
    ["is gone", { agent: null }],
    ["is not an assistant", { agent: { owner: "owner-1" } }],
    ["has no owner", { agent: { owner: null, kind: "assistant" } }],
    ["whose owner is inactive", { ownerActive: false }],
    ["whose feature is off", { flagOn: false }],
  ] as const) {
    it(`refuses an Agent that ${why}`, async () => {
      const w = world(opts as Partial<World>);
      const response = await w.app.request(
        `${BASE}/agent-a/cli/trpc/agents.runtimeFleet`,
      );
      expect(response.status).toBe(opts.agent === null ? 404 : 403);
      expect(w.filed).toEqual([]);
    });
  }

  it("refuses a request that names another Agent than the one that reached us", async () => {
    const w = world();
    const response = await w.app.request(
      `${BASE}/agent-a/cli/trpc/agents.runtimeFleet`,
      { headers: { "x-platform-harness-agent": "agent-b" } },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("another Agent"),
    });
  });

  it("serves nothing but the platform API on that path", async () => {
    const w = world();
    // UNIT_BOUNDARY_DESCRIPTION: the CLI's bundle and version live in the image, not on this route, so nothing else answers under the Agent's `cli/` prefix.
    expect((await w.app.request(`${BASE}/agent-a/cli/version`)).status).toBe(
      404,
    );
  });
});

describe("what the mount reaches", () => {
  it("refuses an operator-only procedure", async () => {
    const w = world();
    const response = await w.app.request(
      `${BASE}/agent-a/cli/trpc/spend.ceilings.set`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          json: { email: "someone@example.com", usd: 5 },
        }),
      },
    );
    expect(JSON.stringify(await response.json())).toContain("FORBIDDEN");
  });

  it("refuses a credential write", async () => {
    const w = world();
    const response = await w.app.request(
      `${BASE}/agent-a/cli/trpc/connections.create`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { name: "x", templateId: "t" } }),
      },
    );
    expect(JSON.stringify(await response.json())).toContain("FORBIDDEN");
  });

  it("reaches no runtime router of its own", async () => {
    const w = world();
    const response = await w.app.request(
      `${BASE}/agent-a/cli/trpc/runtime/hello`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      },
    );
    expect(response.ok).toBe(false);
    expect(w.filed).toEqual([]);
  });
});

describe("a batch", () => {
  it("is decided call by call: the create runs and the change waits", async () => {
    const w = world();
    const response = await w.app.request(
      `${BASE}/agent-a/cli/trpc/agents.create,agents.update?batch=1`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          "0": { name: "notes" },
          "1": { id: "agent-1", name: "renamed" },
        }),
      },
    );
    // UNIT_BOUNDARY_DESCRIPTION: tRPC answers a batch it decided with 207 — one call succeeded, one queued.
    expect(response.status).toBe(207);
    const body = (await response.json()) as unknown[];
    // UNIT_BOUNDARY_DESCRIPTION: the create reached its own service (the stub context answers what it can), and never the gate.
    expect(JSON.stringify(body[0])).not.toContain("PRECONDITION_FAILED");
    expect(JSON.stringify(body[1])).toContain("PRECONDITION_FAILED");
    expect(w.filed).toEqual([
      { procedure: "agents.update", input: { id: "agent-1", name: "renamed" } },
    ]);
  });
});
