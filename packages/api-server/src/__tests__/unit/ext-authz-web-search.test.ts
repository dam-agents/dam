// TEST_OVERVIEW: web search control at the ext_authz gate. For an agent with control on, a model call that declares a native web search tool waits as a web search approval; allow sends it on, deny answers it with a failed search. The agent's web search rule answers without asking, and only that rule: an egress rule that allows every host does not allow a search. A scheduled or channel run nobody attends refuses the search at once and leaves the approval for the owner. A retry of the same search joins the waiting approval, a different search files its own, and a body the gateway did not read, or cannot read, is refused rather than passed. An agent with control off is gated as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtAuthzGate } from "../../modules/approvals/services/ext-authz-gate.js";
import { createWebSearchGate } from "../../modules/approvals/services/web-search-gate.js";
import type { ModelCallBody } from "../../modules/approvals/services/web-search-gate.js";
import { modelCallBodyOf } from "../../apps/ext-authz/grpc.js";
import {
  makeFakeApprovalsBus,
  makeFakeApprovalsRepo,
} from "../helpers/approvals-fakes.js";

const allowEverything = {
  match: async () => ({
    verdict: "allow" as const,
    rule: { host: "*", method: "*", pathPattern: "*" },
  }),
};

function searchBody(query: string): ModelCallBody {
  return bodyOf({
    model: "claude-sonnet-4-5",
    stream: false,
    messages: [
      { role: "user", content: `Perform a web search for the query: ${query}` },
    ],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
  });
}

function bodyOf(value: unknown): ModelCallBody {
  return {
    sent: true,
    partial: false,
    bytes: new TextEncoder().encode(
      typeof value === "string" ? value : JSON.stringify(value),
    ),
  };
}

const chatTurn = bodyOf({
  model: "m",
  messages: [{ role: "user", content: "hello" }],
  tools: [{ name: "WebSearch", input_schema: {} }],
});

interface WorldOptions {
  control?: boolean;
  rule?: "allow" | "deny" | null;
  channelTurn?: boolean;
  scheduled?: boolean;
  identity?: {
    ownerSub: string;
    agentId: string;
    own?: { mode: "open" | "scoped"; parentAgentId: string };
  };
}

function world(options: WorldOptions = {}) {
  const repo = makeFakeApprovalsRepo();
  const bus = makeFakeApprovalsBus();
  const attendance = {
    hasOpenChannelTurn: async () => options.channelTurn === true,
    hasInteractiveSession: async () => false,
  };
  const controlReads: string[] = [];
  const ruleReads: string[] = [];
  const gate = createExtAuthzGate({
    repo: repo.repo,
    bus: bus.bus,
    attendance,
    identityResolver: {
      resolve: async () =>
        options.identity ?? { ownerSub: "user-1", agentId: "agent-1" },
    },
    ruleMatcher: allowEverything,
    providerScopes: { covers: async () => true },
    holdSeconds: 30,
    spend: { checkCall: async () => ({ verdict: "allow" as const }) },
    questions: { ask: async () => {} },
    platformAllowedAuthorities: [],
    webSearch: createWebSearchGate({
      repo: repo.repo,
      bus: bus.bus,
      attendance,
      holdSeconds: 30,
      control: {
        isOn: async (agentId) => {
          controlReads.push(agentId);
          return options.control ?? true;
        },
      },
      rules: {
        verdictOf: async (agentId) => {
          ruleReads.push(agentId);
          return options.rule ?? null;
        },
      },
      sessions: { isScheduled: async () => options.scheduled === true },
    }),
  });
  const call = (body: ModelCallBody | undefined, path = "/v1/messages") =>
    gate.gateRequest({
      agentId: "agent-1",
      host: "llm.example.com",
      port: 443,
      tls: true,
      method: "POST",
      path,
      body,
      modelCall: { sessionId: "session-1" },
      spendCall: {
        callId: "call-1",
        payer: "agent-1",
        connectionId: "conn-1",
        providers: ["ibm-litellm"],
        sessionId: "session-1",
        routerCallId: null,
        dialect: "anthropic-messages",
      },
    });
  const uncounted = (body: ModelCallBody, path: string, metered: boolean) =>
    gate.gateRequest({
      agentId: "agent-1",
      host: "llm.example.com",
      port: 443,
      tls: true,
      method: "POST",
      path,
      body,
      ...(metered ? { modelCall: { sessionId: null } } : {}),
    });
  return { repo, bus, call, uncounted, controlReads, ruleReads };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function refusedText(decision: unknown): string {
  const response = (decision as { response: { status: number; body: string } })
    .response;
  expect(response.status).toBe(200);
  const message = JSON.parse(response.body) as {
    content: { type: string; text?: string }[];
  };
  return message.content.find((block) => block.type === "text")?.text ?? "";
}

describe("web search control at the gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // TEST_SCENARIO: with control off, a search goes on to the gate's other checks as it did before, and no approval is filed.
  it("passes a search on an agent with control off", async () => {
    const w = world({ control: false });
    expect(await w.call(searchBody("news"))).toBe("allow");
    expect(w.repo.inserts).toBe(0);
    expect(w.ruleReads).toEqual([]);
  });

  // TEST_SCENARIO: a model call that declares no web search tool passes with no approval and no rule read.
  it("passes a model call that declares no search", async () => {
    const w = world();
    expect(await w.call(chatTurn)).toBe("allow");
    expect(w.repo.inserts).toBe(0);
  });

  // TEST_SCENARIO: a search is held as a web search approval that names its query, its in-session prompt goes to attached clients, and the owner's allow sends it on, even though an egress rule already allows every host.
  it("holds a search and sends it on when allowed", async () => {
    const w = world();
    const inflight = w.call(searchBody("dam agents"));
    await flushMicrotasks();

    expect(w.repo.rows).toHaveLength(1);
    const row = w.repo.rows[0]!;
    expect(row.type).toBe("web_search");
    expect(row.payload).toMatchObject({
      kind: "web_search",
      query: "dam agents",
    });
    expect(w.bus.publishes[0]!.channel).toBe("inject:agent-1");
    expect(w.bus.publishes[0]!.payload).toContain("Web search: dam agents");

    w.repo.resolve(row.id, "allow");
    w.bus.fire(`approval:${row.id}`, "");
    expect(await inflight).toBe("allow");
  });

  // TEST_SCENARIO: a denied search is answered as a failed search, so the agent keeps working, and the text says the owner denied it.
  it("answers a denied search with a failed search", async () => {
    const w = world();
    const inflight = w.call(searchBody("dam agents"));
    await flushMicrotasks();
    const row = w.repo.rows[0]!;
    w.repo.resolve(row.id, "deny");
    w.bus.fire(`approval:${row.id}`, "");

    const decision = await inflight;
    expect(decision).toMatchObject({ verdict: "refuse", basis: "web-search" });
    expect(refusedText(decision)).toContain("owner denied this search");
  });

  // TEST_SCENARIO: a search nobody answers in time is refused when its hold expires, as a failed search.
  it("refuses a search whose hold expires", async () => {
    const w = world();
    const inflight = w.call(searchBody("dam agents"));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refusedText(await inflight)).toContain("in time");
  });

  // TEST_SCENARIO: a retry of the same search joins the approval already waiting, and a search for another query files one of its own.
  it("joins a retry and files a different search apart", async () => {
    const w = world();
    void w.call(searchBody("first"));
    await flushMicrotasks();
    void w.call(searchBody("first"));
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);

    void w.call(searchBody("second"));
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(2);
  });

  // TEST_SCENARIO: the model's own search names no query, so a retry is the same body, and the body decides what joins.
  it("joins a search with no query by its body", async () => {
    const w = world();
    const body = bodyOf({
      messages: [{ role: "user", content: "what's new" }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });
    void w.call(body);
    await flushMicrotasks();
    void w.call(body);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);
    expect(w.repo.rows[0]!.payload).toMatchObject({ query: null });
  });

  // TEST_SCENARIO: the agent's web search rule answers every search without an approval: allow sends it on and deny refuses it as a failed search that says a rule denied it.
  it("answers by the agent's web search rule", async () => {
    const allowed = world({ rule: "allow" });
    expect(await allowed.call(searchBody("q"))).toBe("allow");
    expect(allowed.repo.inserts).toBe(0);

    const denied = world({ rule: "deny" });
    expect(refusedText(await denied.call(searchBody("q")))).toContain(
      "rule denies",
    );
    expect(denied.repo.inserts).toBe(0);
  });

  // TEST_SCENARIO: a channel turn with nobody attached cannot get a verdict, so the search is refused at once with how to allow search in such runs, and the approval stays for the owner to answer with a rule.
  it("refuses a search in an unattended channel turn and records it", async () => {
    const w = world({ channelTurn: true });
    const text = refusedText(await w.call(searchBody("q")));
    expect(text).toContain("Always allow");
    expect(w.repo.inserts).toBe(1);
    expect(w.bus.publishes).toHaveLength(0);
  });

  // TEST_SCENARIO: a scheduled run is unattended too, told by the Session the call names.
  it("refuses a search in a scheduled run", async () => {
    const w = world({ scheduled: true });
    expect(refusedText(await w.call(searchBody("q")))).toContain("scheduled");
  });

  // TEST_SCENARIO: an open child's network allows only what is listed for it, so with no rule its search is refused without a hold.
  it("refuses an open child's search without a hold", async () => {
    const w = world({
      identity: {
        ownerSub: "user-1",
        agentId: "child-1",
        own: { mode: "open", parentAgentId: "agent-1" },
      },
    });
    expect(refusedText(await w.call(searchBody("q")))).toContain("sub-agent");
    expect(w.repo.inserts).toBe(0);
    expect(w.ruleReads).toEqual(["child-1"]);
  });

  // TEST_SCENARIO: while the agent's gateway still restarts onto control, a call that has a body arrives without it; it is refused with a retryable answer instead of passing unchecked, and a call with no body passes.
  it("refuses a call whose body the gateway did not read", async () => {
    const w = world();
    const decision = await w.call({ sent: false, declared: true });
    expect(decision).toMatchObject({
      verdict: "refuse",
      response: { status: 503 },
    });
    expect(await w.call({ sent: false, declared: false })).toBe("allow");
  });

  // TEST_SCENARIO: a Messages body that is not strict JSON is refused, since a provider might read a tool in it; on another endpoint, such as a file upload, it passes; a body read only in part is refused like an unreadable one.
  it("refuses an unreadable Messages body", async () => {
    const w = world();
    const unreadable = bodyOf('{"tools":[],"tools":[]}');
    expect(await w.call(unreadable)).toMatchObject({
      response: { status: 400 },
    });
    expect(await w.call(unreadable, "/v1/files")).toBe("allow");
    expect(
      await w.call({
        ...(searchBody("q") as { bytes: Uint8Array }),
        sent: true,
        partial: true,
      }),
    ).toMatchObject({ response: { status: 400 } });
  });

  // TEST_SCENARIO: a path the spend meter does not count, such as an escaped spelling of the Messages path, still came over a model-provider chain, so its search is held all the same; a request over any other chain is not read.
  it("reads a model call the meter did not count", async () => {
    const w = world();
    void w.uncounted(searchBody("q"), "/v1/messag%65s", true);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);

    expect(await w.uncounted(searchBody("q"), "/repos", false)).toBe("allow");
    expect(w.controlReads).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: token counting runs no tool, so a search tool on it asks nothing.
  it("passes token counting", async () => {
    const w = world();
    expect(await w.call(searchBody("q"), "/v1/messages/count_tokens")).toBe(
      "allow",
    );
    expect(w.repo.inserts).toBe(0);
  });
});

describe("the body a Check carries", () => {
  const bytes = new TextEncoder().encode("{}");

  // TEST_SCENARIO: only the gateway fills the body field, so the body's own length decides: a filled body is sent whole when its length matches, in part when it is shorter or Envoy marks it partial.
  it("reads a sent body", () => {
    expect(
      modelCallBodyOf({ headers: { "content-length": "2" }, rawBody: bytes }),
    ).toEqual({ sent: true, partial: false, bytes });
    expect(
      modelCallBodyOf({ headers: { "content-length": "9" }, rawBody: bytes }),
    ).toMatchObject({ partial: true });
    expect(
      modelCallBodyOf({
        headers: { "x-envoy-auth-partial-body": "true" },
        rawBody: bytes,
      }),
    ).toMatchObject({ partial: true });
  });

  // TEST_SCENARIO: an empty body field on a request whose length headers say it has a body is a body the gateway did not read, whatever partial-body header the agent set.
  it("tells a body the gateway did not read from no body", () => {
    const empty = new Uint8Array(0);
    expect(
      modelCallBodyOf({
        headers: {
          "content-length": "10",
          "x-envoy-auth-partial-body": "false",
        },
        rawBody: empty,
      }),
    ).toEqual({ sent: false, declared: true });
    expect(
      modelCallBodyOf({
        headers: { "transfer-encoding": "chunked" },
        rawBody: empty,
      }),
    ).toEqual({ sent: false, declared: true });
    expect(modelCallBodyOf({ headers: {}, rawBody: empty })).toEqual({
      sent: false,
      declared: false,
    });
  });
});
