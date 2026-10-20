import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createExtAuthzGate } from "../../modules/approvals/services/ext-authz-gate.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import type { RedisBus, BusListener } from "../../core/redis-bus.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import {
  events$,
  ofType,
  EventType,
  type ApprovalResolved,
} from "../../events.js";

const noSpend = {
  checkCall: async () => ({ verdict: "allow" as const, rule: anyRule }),
};
const noQuestions = { ask: async () => {} };

interface FakeRepo {
  repo: ApprovalsRepository;
  rows: PendingApprovalRow[];
  inserts: number;
  expirePendingCalls: string[];
  setInitial(row: PendingApprovalRow): void;
  resolve(id: string, verdict: "allow" | "deny"): void;
}

function makeFakeRepo(): FakeRepo {
  const rows: PendingApprovalRow[] = [];
  const expirePendingCalls: string[] = [];
  let inserts = 0;
  const repo: ApprovalsRepository = {
    insertIfAbsent: async () => true,
    insertSettled: async () => true,
    insertPending: async (input) => {
      inserts++;
      rows.push({
        id: input.id,
        type: input.type,
        agentId: input.agentId,
        ownerSub: input.ownerSub,
        sessionId: input.sessionId,
        payload: input.payload,
        createdAt: new Date(),
        expiresAt: input.expiresAt,
        resolvedAt: null,
        verdict: null,
        decidedBy: null,
        status: "pending",
        deliveredAt: null,
      });
      return true;
    },
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    findActivePendingExtAuthz: async ({
      agentId,
      host,
      port,
      method,
      path,
    }) => {
      return (
        rows.find(
          (r) =>
            r.agentId === agentId &&
            r.status === "pending" &&
            r.type === "ext_authz" &&
            r.payload.kind === "ext_authz" &&
            r.payload.host === host &&
            r.payload.port === port &&
            r.payload.method === method &&
            r.payload.path === path,
        ) ?? null
      );
    },
    listPendingForOwner: async () => [],
    listPendingForInstance: async () => [],
    resolvePending: async () => true,
    resolveExpired: async () => false,
    markDelivered: async () => {},
    correctResolvedVerdict: async () => false,
    listResolvedUndelivered: async () => [],
    expirePending: async (id) => {
      expirePendingCalls.push(id);
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      row.status = "expired";
      return true;
    },
    expireOverdue: async () => [],
    deleteForAgent: async () => {},
    listDistinctAgentIds: async () => [],
  };
  return {
    repo,
    rows,
    get inserts() {
      return inserts;
    },
    expirePendingCalls,
    setInitial(row) {
      rows.push(row);
    },
    resolve(id, verdict) {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.status = "resolved";
      row.verdict = verdict === "allow" ? "allow" : "deny";
      row.resolvedAt = new Date();
    },
  } as FakeRepo;
}

interface FakeBus {
  bus: RedisBus;
  publishes: { channel: string; payload: string }[];
  fire(channel: string, payload: string): void;
}

function makeFakeBus(): FakeBus {
  const subs = new Map<string, Set<BusListener>>();
  const publishes: { channel: string; payload: string }[] = [];
  return {
    bus: {
      publish: async (channel, payload) => {
        publishes.push({ channel, payload });
      },
      subscribe: (channel, listener) => {
        let set = subs.get(channel);
        if (!set) {
          set = new Set();
          subs.set(channel, set);
        }
        set.add(listener);
        return () => {
          set!.delete(listener);
        };
      },
      close: async () => {},
    },
    publishes,
    fire(channel, payload) {
      const set = subs.get(channel);
      if (!set) return;
      for (const fn of set) fn(payload);
    },
  };
}

const identityResolver = {
  resolve: async (agentId: string) =>
    agentId === "missing" ? null : { ownerSub: "user-1", agentId: "agent-1" },
};

const noMatchRules = { match: async () => null };

const noProviderScopes = { covers: async () => false };

const anyRule = { host: "api.x", method: "*", pathPattern: "*" };

const attended = {
  hasOpenChannelTurn: async () => false,
  hasInteractiveSession: async () => false,
};

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("ext-authz gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the matched verdict without writing a pending row", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: { match: async () => ({ verdict: "allow", rule: anyRule }) },
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });

    const verdict = await gate.gateRequest({
      agentId: "inst-1",
      host: "api.x",
      port: 443,
      tls: true,
      method: "GET",
      path: "/",
    });

    expect(verdict).toBe("allow");
    expect(repo.inserts).toBe(0);
    expect(bus.publishes).toHaveLength(0);
  });

  it("denies when identity can't be resolved", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });

    const verdict = await gate.gateRequest({
      agentId: "missing",
      host: "x",
      port: 443,
      tls: true,
      method: "GET",
      path: "/",
    });

    expect(verdict).toBe("deny");
    expect(repo.inserts).toBe(0);
  });

  it("inserts a pending row, publishes the synth frame, and waits for verdict via bus", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });

    const inflight = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      port: 443,
      tls: true,
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(1);
    expect(bus.publishes[0].channel).toBe("inject:agent-1");

    const id = repo.rows[0].id;
    repo.resolve(id, "allow");
    bus.fire(`approval:${id}`, "");

    expect(await inflight).toBe("allow");
  });

  it("hold-timeout denies the held call and marks the row expired", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });

    const inflight = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      port: 443,
      tls: true,
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(await inflight).toBe("deny");
    expect(repo.expirePendingCalls).toEqual([repo.rows[0].id]);
  });

  it("announces the expiry only when the hold timeout itself expired the row", async () => {
    const resolutions: ApprovalResolved[] = [];
    const sub = events$()
      .pipe(ofType<ApprovalResolved>(EventType.ApprovalResolved))
      .subscribe((e) => resolutions.push(e));

    for (const decidedMeanwhile of [false, true]) {
      const repo = makeFakeRepo();
      if (decidedMeanwhile) repo.repo.expirePending = async () => false;
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: makeFakeBus().bus,
        attendance: attended,
        identityResolver,
        ruleMatcher: noMatchRules,
        providerScopes: noProviderScopes,
        holdSeconds: 30,
        spend: noSpend,
        questions: noQuestions,
        platformAllowedAuthorities: [],
      });
      const inflight = gate.gateRequest({
        agentId: "inst-1",
        host: "h",
        port: 443,
        tls: true,
        method: "GET",
        path: "/p",
      });
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await inflight).toBe("deny");
    }
    sub.unsubscribe();

    expect(resolutions.map((e) => e.resolution)).toEqual(["expired"]);
  });

  it("dedupes retries against an existing pending row of the same shape (#4)", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });

    const first = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      port: 443,
      tls: true,
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();
    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(1);
    const id = repo.rows[0].id;

    const retry = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      port: 443,
      tls: true,
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    expect(repo.inserts).toBe(1);
    expect(bus.publishes).toHaveLength(2);
    expect(bus.publishes[1].payload).toBe(bus.publishes[0].payload);

    repo.resolve(id, "allow");
    bus.fire(`approval:${id}`, "");
    expect(await first).toBe("allow");
    expect(await retry).toBe("allow");
  });

  it("raises the prompt of a hold opened before the current session attached (#4327)", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    repo.setInitial({
      id: "held-earlier",
      type: "ext_authz",
      agentId: "agent-1",
      ownerSub: "user-1",
      sessionId: null,
      payload: { kind: "ext_authz", host: "h", method: "GET", path: "/p" },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 1_800_000),
      resolvedAt: null,
      verdict: null,
      decidedBy: null,
      status: "pending",
      deliveredAt: null,
    });
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      providerScopes: noProviderScopes,
      holdSeconds: 1800,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });

    const inflight = gate.gateRequest({
      agentId: "inst-1",
      host: "h",
      port: 443,
      tls: true,
      method: "GET",
      path: "/p",
    });
    await flushMicrotasks();

    expect(repo.inserts).toBe(0);
    expect(bus.publishes).toHaveLength(1);
    expect(bus.publishes[0].channel).toBe("inject:agent-1");
    expect(JSON.parse(bus.publishes[0].payload)).toMatchObject({
      id: "held-earlier",
      method: "session/request_permission",
      params: { toolCall: { rawInput: { approvalId: "held-earlier" } } },
    });

    repo.resolve("held-earlier", "allow");
    bus.fire("approval:held-earlier", "");
    expect(await inflight).toBe("allow");
  });

  it("allows a platform-provided host without consulting rules or holding", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const ruleMatch = vi.fn(async () => null);
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: { match: ruleMatch },
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [
        "platform-seaweedfs.platform.svc.cluster.local:8333",
      ],
    });

    const verdict = await gate.gateRequest({
      agentId: "inst-1",
      host: "platform-seaweedfs.platform.svc.cluster.local",
      port: 8333,
      tls: false,
      method: "PUT",
      path: "/platform-artifacts/exp/agent/u/c.bin",
    });

    expect(verdict).toBe("allow");
    expect(ruleMatch).not.toHaveBeenCalled();
    expect(repo.inserts).toBe(0);
    expect(bus.publishes).toHaveLength(0);
  });

  it("still fails closed on unresolved identity even for a platform host", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: ["store.internal:443"],
    });

    const verdict = await gate.gateRequest({
      agentId: "missing",
      host: "store.internal",
      port: 443,
      tls: true,
      method: "PUT",
      path: "/b/k",
    });

    expect(verdict).toBe("deny");
  });

  // TEST_SCENARIO: an agent allowed `contents/qa/*` must not read the rest of the repository through a dot segment GitHub resolves, so such a path is denied before the rules are read and never held; dots elsewhere still reach the rules.
  it("denies a path with a dot segment without reading rules or holding", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const ruleMatch = vi.fn(async () => ({
      verdict: "allow" as const,
      rule: anyRule,
    }));
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: { match: ruleMatch },
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });
    const gateContents = (rest: string) =>
      gate.gateRequest({
        agentId: "inst-1",
        host: "api.github.com",
        port: 443,
        tls: true,
        method: "GET",
        path: `/repos/dam-agents/dam/contents/qa${rest}`,
      });

    for (const rest of [
      "/../packages/x",
      "/%2e%2e/x",
      "/%2E%2E/x",
      "/..;x/packages",
      "/./x",
      "/..",
    ]) {
      expect(await gateContents(rest), rest).toBe("deny");
    }
    expect(ruleMatch).not.toHaveBeenCalled();
    expect(repo.inserts).toBe(0);

    for (const rest of [
      "/qi-profile-dam/SKILL.md?ref=0123abc",
      "/.github/..x",
      "?ref=../main",
    ]) {
      expect(await gateContents(rest), rest).toBe("allow");
    }
  });

  // TEST_SCENARIO: the agent writes the Host header, and DNS and GitHub ignore its letter case, so `API.GitHub.com` must meet the rules for api.github.com rather than slip past them to a wildcard allow.
  it("asks the rules with the host in lower case", async () => {
    const repo = makeFakeRepo();
    const ruleMatch = vi.fn(async () => ({
      verdict: "deny" as const,
      rule: anyRule,
    }));
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: makeFakeBus().bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: { match: ruleMatch },
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });

    const verdict = await gate.gateRequest({
      agentId: "inst-1",
      host: "API.GitHub.com",
      port: 443,
      tls: true,
      method: "GET",
      path: "/repos/dam-agents/dam/contents/",
    });

    expect(verdict).toMatchObject({ verdict: "refuse", basis: "rule" });
    expect(ruleMatch).toHaveBeenCalledWith(
      "agent-1",
      "api.github.com",
      443,
      true,
      "GET",
      "/repos/dam-agents/dam/contents/",
    );
  });

  // TEST_SCENARIO: the object store is allowed on its own port only; the same host on another port must reach the rules like any other request.
  it("allows the platform host only on its own port, and asks the rules with port and scheme", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const ruleMatch = vi.fn(async () => ({
      verdict: "deny" as const,
      rule: anyRule,
    }));
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: { match: ruleMatch },
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: ["store.internal:8333"],
    });

    const verdict = await gate.gateRequest({
      agentId: "inst-1",
      host: "store.internal",
      port: 9000,
      tls: false,
      method: "PUT",
      path: "/b/k",
    });

    expect(verdict).toMatchObject({ verdict: "refuse", basis: "rule" });
    expect(ruleMatch).toHaveBeenCalledWith(
      "agent-1",
      "store.internal",
      9000,
      false,
      "PUT",
      "/b/k",
    );
  });

  // TEST_SCENARIO: approving a held request writes a rule from its payload, so a hold on a non-default port must carry that port or the approved rule would never match it.
  it("records a non-default port on the held request, and leaves a default port out", async () => {
    const repo = makeFakeRepo();
    const bus = makeFakeBus();
    const gate = createExtAuthzGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance: attended,
      identityResolver,
      ruleMatcher: noMatchRules,
      providerScopes: noProviderScopes,
      holdSeconds: 30,
      spend: noSpend,
      questions: noQuestions,
      platformAllowedAuthorities: [],
    });

    void gate.gateRequest({
      agentId: "inst-1",
      host: "api.x",
      port: 8080,
      tls: true,
      method: "GET",
      path: "/",
    });
    void gate.gateRequest({
      agentId: "inst-1",
      host: "api.x",
      port: 443,
      tls: true,
      method: "GET",
      path: "/",
    });
    await flushMicrotasks();

    expect(repo.rows.map((r) => r.payload)).toEqual([
      expect.objectContaining({ host: "api.x", port: 8080 }),
      expect.not.objectContaining({ port: expect.anything() }),
    ]);
  });

  describe("model provider hosts", () => {
    const providerHost = {
      agentId: "inst-1",
      host: "api.anthropic.com",
      port: 443,
      tls: true,
      method: "POST",
      path: "/v1/messages",
    };
    const gateWith = (
      ruleMatch: Parameters<
        typeof createExtAuthzGate
      >[0]["ruleMatcher"]["match"],
      covers: Parameters<
        typeof createExtAuthzGate
      >[0]["providerScopes"]["covers"],
      repo = makeFakeRepo(),
    ) =>
      createExtAuthzGate({
        repo: repo.repo,
        bus: makeFakeBus().bus,
        attendance: attended,
        identityResolver,
        ruleMatcher: { match: ruleMatch },
        providerScopes: { covers },
        holdSeconds: 30,
        spend: noSpend,
        questions: noQuestions,
        platformAllowedAuthorities: [],
      });

    // TEST_SCENARIO: a user denies api.anthropic.com while the agent runs on LiteLLM, then switches the agent to the Claude subscription Connection; every model call then hit the deny rule and the session ended on a bare 403. The attached provider's host must pass over the rule.
    it("allows a provider Connection's host over a deny rule, and asks the scopes as the calling agent", async () => {
      const covers = vi.fn(async () => true);
      const gate = gateWith(
        async () => ({
          verdict: "deny",
          rule: { host: "api.anthropic.com", method: "*", pathPattern: "*" },
        }),
        covers,
      );

      expect(await gate.gateRequest(providerHost)).toBe("allow");
      expect(covers).toHaveBeenCalledWith("inst-1", {
        host: "api.anthropic.com",
        port: 443,
        tls: true,
        path: "/v1/messages",
      });
    });

    // TEST_SCENARIO: a user rule on the provider host keeps the connection sync from writing its allow row, so with no rule matching the request the provider host must still pass without a hold.
    it("allows a provider Connection's host that no rule matches, without holding", async () => {
      const repo = makeFakeRepo();
      const gate = gateWith(
        async () => null,
        async () => true,
        repo,
      );

      expect(await gate.gateRequest(providerHost)).toBe("allow");
      expect(repo.inserts).toBe(0);
    });

    it("never reads the provider scopes when a rule allows", async () => {
      const covers = vi.fn(async () => true);
      const gate = gateWith(
        async () => ({ verdict: "allow", rule: anyRule }),
        covers,
      );

      expect(await gate.gateRequest(providerHost)).toBe("allow");
      expect(covers).not.toHaveBeenCalled();
    });

    // TEST_SCENARIO: a request the rules deny used to get a 403 with no body, which the harness shows with no cause; the refusal must name the rule and say the egress gateway refused it, not the upstream.
    it("refuses a host a rule denies with a body that names the rule", async () => {
      const gate = gateWith(
        async () => ({
          verdict: "deny",
          rule: {
            host: "*.anthropic.com",
            port: 8443,
            method: "POST",
            pathPattern: "/v1/*",
          },
        }),
        async () => false,
      );

      const decision = await gate.gateRequest(providerHost);

      expect(decision).toMatchObject({
        verdict: "refuse",
        basis: "rule",
        response: {
          status: 403,
          headers: { "x-platform-refusal": "egress" },
        },
      });
      const body = typeof decision === "object" ? decision.response.body : "";
      expect(body).toContain(
        'Blocked by network rule "deny *.anthropic.com:8443, method POST, path /v1/*"',
      );
      expect(body).toContain("api.anthropic.com");
    });
  });

  describe("unattended channel turns", () => {
    const unattended = {
      hasOpenChannelTurn: async () => true,
      hasInteractiveSession: async () => false,
    };

    it("denies at once instead of holding, and records the row for the inbox", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: unattended,
        identityResolver,
        ruleMatcher: noMatchRules,
        providerScopes: noProviderScopes,
        holdSeconds: 1800,
        spend: noSpend,
        questions: noQuestions,
        platformAllowedAuthorities: [],
      });

      const verdict = await gate.gateRequest({
        agentId: "inst-1",
        host: "h",
        port: 443,
        tls: true,
        method: "GET",
        path: "/p",
      });

      expect(verdict).toBe("deny");
      expect(repo.inserts).toBe(1);
      expect(repo.rows[0].status).toBe("pending");
      expect(repo.expirePendingCalls).toHaveLength(0);
    });

    it("publishes no in-session prompt — nothing is attached to consume it", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: unattended,
        identityResolver,
        ruleMatcher: noMatchRules,
        providerScopes: noProviderScopes,
        holdSeconds: 1800,
        spend: noSpend,
        questions: noQuestions,
        platformAllowedAuthorities: [],
      });

      await gate.gateRequest({
        agentId: "inst-1",
        host: "h",
        port: 443,
        tls: true,
        method: "GET",
        path: "/p",
      });

      expect(bus.publishes).toHaveLength(0);
    });

    it("reuses one row across retries so the inbox gets a single entry", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: unattended,
        identityResolver,
        ruleMatcher: noMatchRules,
        providerScopes: noProviderScopes,
        holdSeconds: 1800,
        spend: noSpend,
        questions: noQuestions,
        platformAllowedAuthorities: [],
      });

      const request = {
        agentId: "inst-1",
        host: "h",
        port: 443,
        tls: true,
        method: "GET",
        path: "/p",
      };
      expect(await gate.gateRequest(request)).toBe("deny");
      expect(await gate.gateRequest(request)).toBe("deny");
      expect(await gate.gateRequest(request)).toBe("deny");

      expect(repo.inserts).toBe(1);
    });

    it("holds as usual when an interactive session is attached alongside", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: {
          hasOpenChannelTurn: async () => true,
          hasInteractiveSession: async () => true,
        },
        identityResolver,
        ruleMatcher: noMatchRules,
        providerScopes: noProviderScopes,
        holdSeconds: 30,
        spend: noSpend,
        questions: noQuestions,
        platformAllowedAuthorities: [],
      });

      const inflight = gate.gateRequest({
        agentId: "inst-1",
        host: "h",
        port: 443,
        tls: true,
        method: "GET",
        path: "/p",
      });
      await flushMicrotasks();

      expect(bus.publishes).toHaveLength(1);

      const id = repo.rows[0].id;
      repo.resolve(id, "allow");
      bus.fire(`approval:${id}`, "");

      expect(await inflight).toBe("allow");
    });

    it("never reaches the attendance check when a rule already decides", async () => {
      const repo = makeFakeRepo();
      const bus = makeFakeBus();
      const hasOpenChannelTurn = vi.fn(async () => true);
      const gate = createExtAuthzGate({
        repo: repo.repo,
        bus: bus.bus,
        attendance: {
          hasOpenChannelTurn,
          hasInteractiveSession: async () => false,
        },
        identityResolver,
        ruleMatcher: {
          match: async () => ({ verdict: "allow", rule: anyRule }),
        },
        providerScopes: noProviderScopes,
        holdSeconds: 1800,
        spend: noSpend,
        questions: noQuestions,
        platformAllowedAuthorities: [],
      });

      expect(
        await gate.gateRequest({
          agentId: "inst-1",
          host: "allowed.example",
          port: 443,
          tls: true,
          method: "GET",
          path: "/",
        }),
      ).toBe("allow");
      expect(hasOpenChannelTurn).not.toHaveBeenCalled();
    });
  });
});
