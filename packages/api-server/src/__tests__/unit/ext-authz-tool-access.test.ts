// TEST_OVERVIEW: the tool access of a grant at the ext_authz gate. Each Agent's grant of an MCP Connection gives each tool one rule: allow sends the call, ask holds it as a tool-call approval, and block refuses it. The rule of a tool is its override, else the rule of the read tools for a read tool, else the rule of every other tool, which a tool the read list does not name takes too. A grant that stores no access follows its Connection's tool mode: read only allows the read tools and blocks the rest, needs approval allows the read tools and asks for the rest, and allow all limits nothing. A blocked call is answered with a JSON-RPC error the agent can read that names the Connection and says the tool is blocked for this agent, and it is never sent on, even when an egress rule allows the host. A call that asks waits as a tool-call approval that names the tool and its arguments: approve once sends it, and deny once, the end of the hold window or a channel turn nobody attends answers it with a JSON-RPC error. The same call sent again within the approval's hold window joins it, and a batch with such a call is refused, since one approval answers one call; a batch of allowed calls only passes. A new approval also names the call's target, which the Connection's Template looks up; a lookup that fails or takes more than two seconds files the approval without a name. A held call whose client goes away stops waiting and leaves the approval pending. Each approve once makes exactly one call: the held call it releases, or else the next identical call sent before the hold window ends. The access is read once on every request, and each Agent gets the rules of its own grant. A request that names no Connection, or one the Agent does not hold, gets for each tool the strictest rule among the Agent's grants on the host: block, then ask, then allow. A body the gateway did not send, or that is not one strict JSON document, is refused rather than passed, and so is a TLS request with a body that comes without its server name while the Agent holds a grant that limits tool calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, GrantToolAccess, ToolMode } from "api-server-api";
import { createExtAuthzGate } from "../../modules/approvals/services/ext-authz-gate.js";
import { createToolAccessGate } from "../../modules/approvals/services/tool-access-gate.js";
import type { ModelCallBody } from "../../modules/approvals/services/web-search-gate.js";
import {
  heldToolAccess,
  toolAccessFor,
  type GrantedConnection,
} from "../../modules/connections/domain/tool-access.js";
import type { ToolCallLabels } from "../../modules/approvals/services/tool-call-hold.js";
import {
  makeFakeApprovalsBus,
  makeFakeApprovalsRepo,
  noToolCallLabels,
} from "../helpers/approvals-fakes.js";

const unlinkedReach = { reachOf: async () => "unlinked" as const };

function withTurnKinds<T extends object>(attendance: T) {
  return {
    channelTurnKinds: async () => [],
    hasAddressedTurn: async () => false,
    hasReleasedTurn: async () => false,
    ...attendance,
  };
}

const HOST = "mcp.example.com";

const template = {
  toolAccess: { readTools: ["notes_search", "notes_read"] },
  defaultToolMode: "read-only" as const,
};

function grantOf(
  id: string,
  opts: {
    mode?: ToolMode;
    templateId?: string;
    access?: GrantToolAccess;
  } = {},
): GrantedConnection {
  const connection = {
    id,
    ownerId: "user-1",
    templateId: opts.templateId ?? "notes",
    name: `${id}-name`,
    inputs: {},
    auth: {
      kind: "oauth",
      clientId: "cid",
      scopes: [],
      accessTokenRef: { storeId: "test", path: id, field: "access_token" },
    },
    contributions: [
      {
        kind: "egress-inject",
        host: HOST,
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
      { kind: "mcp-entry", name: id, url: `https://${HOST}/mcp` },
    ],
    ...(opts.mode
      ? {
          toolAccess: {
            mode: opts.mode,
            tools: null,
            listedAt: null,
            listError: null,
          },
        }
      : {}),
  } as unknown as Connection;
  return { connection, toolAccess: opts.access ?? null };
}

function bodyOf(value: unknown): ModelCallBody {
  return {
    sent: true,
    partial: false,
    bytes:
      value instanceof Uint8Array
        ? value
        : new TextEncoder().encode(
            typeof value === "string" ? value : JSON.stringify(value),
          ),
  };
}

function toolCall(
  name: unknown,
  id: number | string = 1,
  args?: Record<string, unknown>,
) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, ...(args ? { arguments: args } : {}) },
  };
}

const templateOf = (templateId: string) =>
  templateId === "notes" ? template : undefined;

function world(
  granted: GrantedConnection[],
  opts: {
    channelTurn?: boolean;
    labels?: ToolCallLabels;
    otherAgents?: Record<string, GrantedConnection[]>;
  } = {},
) {
  const reads: string[] = [];
  const repo = makeFakeApprovalsRepo();
  const bus = makeFakeApprovalsBus();
  const gate = createExtAuthzGate({
    repo: repo.repo,
    bus: bus.bus,
    cardReach: unlinkedReach,
    attendance: withTurnKinds({
      hasOpenChannelTurn: async () => opts.channelTurn === true,
      hasInteractiveSession: async () => false,
    }),
    identityResolver: {
      resolve: async (agentId) => ({ ownerSub: "user-1", agentId }),
    },
    ruleMatcher: {
      match: async () => ({
        verdict: "allow" as const,
        rule: { host: "*", method: "*", pathPattern: "*" },
      }),
    },
    providerScopes: { covers: async () => false },
    holdSeconds: 30,
    spend: { checkCall: async () => ({ verdict: "allow" as const }) },
    questions: { ask: async () => {} },
    platformAllowedAuthorities: [],
    waitingRuleSpeaksFor: () => false,
    toolAccess: createToolAccessGate({
      connections: {
        forAgent: async (agentId) => {
          reads.push(agentId);
          const held =
            agentId === "agent-1"
              ? granted
              : (opts.otherAgents?.[agentId] ?? []);
          return {
            limiting: (request) => toolAccessFor(held, templateOf, request),
            held: () => heldToolAccess(held, templateOf),
          };
        },
      },
    }),
    toolCallLabels: opts.labels ?? noToolCallLabels,
  });
  const send = (
    body: ModelCallBody | undefined,
    opts: {
      agentId?: string;
      connectionId?: string | null;
      method?: string;
      path?: string;
      host?: string;
      tlsHost?: string | null;
      tls?: boolean;
      signal?: AbortSignal;
    } = {},
  ) =>
    gate.gateRequest({
      agentId: opts.agentId ?? "agent-1",
      host: opts.host ?? HOST,
      port: 443,
      tls: opts.tls ?? true,
      method: opts.method ?? "POST",
      path: opts.path ?? "/mcp",
      body,
      connectionId: opts.connectionId ?? null,
      tlsHost: opts.tlsHost === undefined ? (opts.host ?? HOST) : opts.tlsHost,
      signal: opts.signal,
    });
  return { send, reads, granted, repo, bus };
}

function refusalOf(
  decision: Awaited<ReturnType<ReturnType<typeof world>["send"]>>,
) {
  if (typeof decision === "string") throw new Error(`not refused: ${decision}`);
  expect(decision.basis).toBe("tool-access");
  return decision.response;
}

describe("a grant that follows a read-only Connection at the gate", () => {
  // TEST_SCENARIO: the owner left the Connection read only. Reading must still work, so a call of a tool on the Template's read list goes on to the gate's other checks, where the egress rule allows it.
  it("passes a call of a read tool", async () => {
    const { send } = world([grantOf("conn-a")]);
    expect(
      await send(bodyOf(toolCall("notes_search")), { connectionId: "conn-a" }),
    ).toBe("allow");
  });

  // TEST_SCENARIO: the agent tries to write through a read-only Connection. The call must not leave, and the agent must be able to explain why: the answer is a JSON-RPC error for the same request id, on a successful HTTP reply, that names the tool, the Connection and the setting the owner changes.
  it("answers a call of a write tool with an error the agent can read", async () => {
    const { send } = world([grantOf("conn-a")]);
    const response = refusalOf(
      await send(bodyOf(toolCall("notes_write", 7)), {
        connectionId: "conn-a",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(response.headers["x-platform-refusal"]).toBe(
      "connection-tool-access",
    );
    const answer = JSON.parse(response.body);
    expect(answer).toMatchObject({ jsonrpc: "2.0", id: 7 });
    expect(answer.error.message).toContain(
      'the tool "notes_write" is blocked for this agent on the Connection "conn-a-name"',
    );
    expect(answer.error.message).toContain("tool access for the Connection");
    expect(answer.error.message).not.toContain("read only");
    expect(answer.error.message).toContain("egress gateway");
  });

  // TEST_SCENARIO: the server adds a tool after the read list was written. Nobody decided that it only reads, so a read-only Connection cannot call it.
  it("refuses a tool the read list does not name", async () => {
    const { send } = world([grantOf("conn-a")]);
    refusalOf(
      await send(bodyOf(toolCall("notes_new_tool")), {
        connectionId: "conn-a",
      }),
    );
  });

  // TEST_SCENARIO: the owner set the Connection to allow all. Nothing is limited, so a write tool passes.
  it("passes a write tool of a Connection that allows all", async () => {
    const { send } = world([grantOf("conn-a", { mode: "allow-all" })]);
    expect(
      await send(bodyOf(toolCall("notes_write")), { connectionId: "conn-a" }),
    ).toBe("allow");
  });

  // TEST_SCENARIO: the owner switches the Connection to read only while the agent runs. The gate reads the mode on every request, so the next call is refused with no restart.
  it("applies a changed choice to the next request", async () => {
    const { send, granted } = world([grantOf("conn-a", { mode: "allow-all" })]);
    const call = () =>
      send(bodyOf(toolCall("notes_write")), { connectionId: "conn-a" });
    expect(await call()).toBe("allow");
    granted[0] = grantOf("conn-a");
    refusalOf(await call());
  });

  // TEST_SCENARIO: the gateway adds a credential to a request that names no Connection when nothing contests the host. Such a request could carry the read-only Connection's credential, so it gets the strictest mode, and so does a request that names a Connection the Agent does not hold.
  it("limits a request that names no Connection, or an unknown one", async () => {
    const { send } = world([
      grantOf("conn-full", { mode: "allow-all" }),
      grantOf("conn-read"),
    ]);
    const write = bodyOf(toolCall("notes_write"));
    refusalOf(await send(write, { connectionId: null }));
    refusalOf(await send(write, { connectionId: "conn-unknown" }));
    expect(await send(write, { connectionId: "conn-full" })).toBe("allow");
    refusalOf(await send(write, { connectionId: "conn-read" }));
  });

  // TEST_SCENARIO: one POST carries several JSON-RPC messages and one of them calls a write tool. No part of the body is sent, so every request of the batch that has an id gets the error, as an array.
  it("refuses a whole batch that holds one write call", async () => {
    const { send } = world([grantOf("conn-a")]);
    const response = refusalOf(
      await send(
        bodyOf([
          toolCall("notes_read", 1),
          toolCall("notes_write", 2),
          { jsonrpc: "2.0", method: "notifications/initialized" },
        ]),
        { connectionId: "conn-a" },
      ),
    );
    const answers = JSON.parse(response.body);
    expect(answers.map((a: { id: number }) => a.id)).toEqual([1, 2]);
    expect(answers[0].error.message).toContain('"notes_write"');
    expect(answers[0].error.message).not.toContain('"notes_read"');
  });

  // TEST_SCENARIO: an MCP client also lists tools, opens its event stream and ends its session. None of these calls a tool, so a read-only Connection sends them all.
  it("passes the requests that call no tool", async () => {
    const { send } = world([grantOf("conn-a")]);
    const named = { connectionId: "conn-a" };
    for (const method of ["initialize", "tools/list", "ping"]) {
      expect(await send(bodyOf({ jsonrpc: "2.0", id: 1, method }), named)).toBe(
        "allow",
      );
    }
    expect(await send(undefined, { ...named, method: "GET" })).toBe("allow");
    expect(await send(undefined, { ...named, method: "DELETE" })).toBe("allow");
  });

  // TEST_SCENARIO: a body the gate cannot be sure about could hide a write call: a method spelled in another letter case, a call that names no tool, a repeated key that a server may read the other way, bytes that are not JSON. Each is refused rather than passed.
  it("refuses a body that could hide a write call", async () => {
    const { send } = world([grantOf("conn-a")]);
    const named = { connectionId: "conn-a" };
    refusalOf(
      await send(
        bodyOf({ ...toolCall("notes_write"), method: " Tools/Call " }),
        named,
      ),
    );
    refusalOf(await send(bodyOf(toolCall(undefined)), named));
    const repeated = refusalOf(
      await send(
        bodyOf(
          '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"notes_read","name" :"notes_write"}}',
        ),
        named,
      ),
    );
    expect(repeated.status).toBe(400);
    expect(
      refusalOf(await send(bodyOf(new Uint8Array([0xff, 0xfe])), named)).status,
    ).toBe(400);
    expect(refusalOf(await send(bodyOf('"tools/call"'), named)).status).toBe(
      400,
    );
    expect(
      refusalOf(
        await send(
          { ...bodyOf(toolCall("notes_read")), partial: true } as ModelCallBody,
          named,
        ),
      ).status,
    ).toBe(400);
  });

  // TEST_SCENARIO: the gateway sends bodies only once its Secret asks for them. A POST whose headers declare a body that did not come with the check is never passed: the answer asks for a retry, which reaches the restarted gateway.
  it("asks for a retry when the gateway sent no body", async () => {
    const { send } = world([grantOf("conn-a")]);
    const response = refusalOf(
      await send({ sent: false, declared: true }, { connectionId: "conn-a" }),
    );
    expect(response.status).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
  });

  // TEST_SCENARIO: a POST that declares no body is still refused, because an HTTP/2 request can carry one without a length header. A retry would never pass, so the answer is a final 400, not the restart's 503.
  it("refuses a POST with no body for good", async () => {
    const { send } = world([grantOf("conn-a")]);
    const response = refusalOf(
      await send({ sent: false, declared: false }, { connectionId: "conn-a" }),
    );
    expect(response.status).toBe(400);
    expect(response.headers).not.toHaveProperty("retry-after");
  });

  // TEST_SCENARIO: the gateway picks the chain and its credential by the TLS server name, and the agent writes the Host header. A request to the MCP host with a Host header of another host is still limited, because the gate also looks up the server name.
  it("limits a request whose Host header names another host", async () => {
    const { send } = world([grantOf("conn-a")]);
    const response = refusalOf(
      await send(bodyOf(toolCall("notes_write")), {
        connectionId: "conn-a",
        host: "api.example.com",
        tlsHost: HOST,
      }),
    );
    expect(JSON.parse(response.body).error.message).toContain(`not by ${HOST}`);
  });

  // TEST_SCENARIO: one check looks up the limit for the server name and for the Host header, and for a gateway that sent no server name it also asks whether the Agent holds a limit on any host. The Agent's granted Connections are read from the database once for the whole check, not once for each of these questions.
  it("reads the Agent's Connections once for each request", async () => {
    const { send, reads } = world([grantOf("conn-a")]);
    const write = bodyOf(toolCall("notes_write"));
    await send(write, {
      host: "api.example.com",
      tlsHost: "other.example.com",
    });
    expect(reads).toEqual(["agent-1"]);
    await send(write, { host: "api.example.com", tlsHost: null });
    expect(reads).toEqual(["agent-1", "agent-1"]);
  });

  // TEST_SCENARIO: the owner made the Connection read only, and its gateway has not restarted yet, so it sends neither the body nor the TLS server name. A POST with the Template's credential and a Host header of another host must not slip through in that window: the gate cannot see the real host, so it asks for a retry, which reaches the restarted gateway.
  it("asks for a retry when the gateway sent no server name", async () => {
    const { send } = world([grantOf("conn-a")]);
    const response = refusalOf(
      await send(bodyOf(toolCall("notes_write")), {
        host: "api.example.com",
        tlsHost: null,
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.body).toContain("conn-a-name");
  });

  // TEST_SCENARIO: without a server name only a request that could change something is refused. Reads, a CONNECT that opens a tunnel, plain HTTP, which reaches no chain, and an Agent with no read-only Connection go on as before.
  it("refuses only a TLS request with a body when the server name is missing", async () => {
    const limited = world([grantOf("conn-a")]);
    const elsewhere = { host: "api.example.com", tlsHost: null };
    expect(await limited.send(undefined, { ...elsewhere, method: "GET" })).toBe(
      "allow",
    );
    expect(
      await limited.send(undefined, { ...elsewhere, method: "CONNECT" }),
    ).toBe("allow");
    expect(
      await limited.send(bodyOf(toolCall("notes_write")), {
        ...elsewhere,
        tls: false,
      }),
    ).toBe("allow");
    const full = world([grantOf("conn-a", { mode: "allow-all" })]);
    expect(await full.send(bodyOf(toolCall("notes_write")), elsewhere)).toBe(
      "allow",
    );
  });

  // TEST_SCENARIO: a server may match JSON keys in any letter case. A method under the key "Method", or a second tool name under "Name" next to "name", must not slip past the gate.
  it("reads keys in any letter case", async () => {
    const { send } = world([grantOf("conn-a")]);
    const named = { connectionId: "conn-a" };
    refusalOf(
      await send(
        bodyOf({
          jsonrpc: "2.0",
          id: 1,
          Method: "tools/call",
          Params: { NAME: "notes_write" },
        }),
        named,
      ),
    );
    const twoNames = refusalOf(
      await send(
        bodyOf({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "notes_read", Name: "notes_write" },
        }),
        named,
      ),
    );
    expect(twoNames.status).toBe(400);
  });

  // TEST_SCENARIO: a batch can also carry the client's answer to a request of the server. The refusal answers only the client's own requests, since an error for an id the client never asked about breaks a strict MCP client.
  it("answers no message that is the client's answer to the server", async () => {
    const { send } = world([grantOf("conn-a")]);
    const response = refusalOf(
      await send(
        bodyOf([
          { jsonrpc: "2.0", id: 5, result: {} },
          toolCall("notes_write", 6),
        ]),
        { connectionId: "conn-a" },
      ),
    );
    expect(JSON.parse(response.body).map((a: { id: number }) => a.id)).toEqual([
      6,
    ]);
  });

  // TEST_SCENARIO: an MCP client needs no PUT or PATCH. On a read-only Connection such a method could change something without a tool call the gate can read, so it is refused.
  it("refuses a method an MCP client does not use", async () => {
    const { send } = world([grantOf("conn-a")]);
    expect(
      refusalOf(
        await send(bodyOf({}), { connectionId: "conn-a", method: "PUT" }),
      ).status,
    ).toBe(403);
  });

  // TEST_SCENARIO: an unnamed request on a host where the Agent holds one Connection in needs approval and one in read only gets block for a write tool, which refuses at once and never asks a person for an approval they did not expect: its write call is refused, and only a write call that names the other Connection is held.
  it("picks block over ask for an unnamed request", async () => {
    const { send, repo } = world([
      grantOf("conn-ask", { mode: "needs-approval" }),
      grantOf("conn-read", { mode: "read-only" }),
    ]);
    refusalOf(
      await send(bodyOf(toolCall("notes_write")), { connectionId: null }),
    );
    expect(repo.inserts).toBe(0);
    void send(bodyOf(toolCall("notes_write")), { connectionId: "conn-ask" });
    await flushMicrotasks();
    expect(repo.inserts).toBe(1);
  });

  // TEST_SCENARIO: the limit belongs to the Connection's MCP host and to a Connection that does not allow all. A request to another host, or of an Agent whose Connection there allows all, is gated as before, body or not.
  it("leaves other hosts and other Connections alone", async () => {
    const limited = world([grantOf("conn-a")]);
    expect(
      await limited.send(bodyOf(toolCall("notes_write")), {
        host: "api.example.com",
      }),
    ).toBe("allow");
    const other = world([grantOf("conn-b", { templateId: "other" })]);
    expect(
      await other.send(
        { sent: false, declared: true },
        { connectionId: "conn-b" },
      ),
    ).toBe("allow");
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("a Connection that needs approval at the gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const asking = () => world([grantOf("conn-a", { mode: "needs-approval" })]);
  const named = { connectionId: "conn-a" };

  const payloadOf = (w: ReturnType<typeof world>) => {
    const payload = w.repo.rows[0]!.payload;
    if (payload.kind !== "mcp_tool_call") throw new Error("not a tool call");
    return payload;
  };

  // TEST_SCENARIO: the agent calls a write tool on a Connection that needs approval. One tool-call approval is filed with the Connection, the tool and the arguments, the in-session prompt goes to attached clients, and approve once sends the call on, even past the egress rules.
  it("holds a write call and sends it on when approved", async () => {
    const w = asking();
    const inflight = w.send(
      bodyOf(toolCall("notes_write", 3, { query: "q" })),
      named,
    );
    await flushMicrotasks();

    expect(w.repo.rows).toHaveLength(1);
    const row = w.repo.rows[0]!;
    expect(row.type).toBe("mcp_tool_call");
    expect(row.payload).toMatchObject({
      kind: "mcp_tool_call",
      connectionId: "conn-a",
      connectionName: "conn-a-name",
      templateId: "notes",
      tool: "notes_write",
      arguments: { query: "q" },
      argumentsBytes: JSON.stringify({ query: "q" }).length,
    });
    expect(w.bus.publishes[0]!.channel).toBe("inject:agent-1");
    expect(w.bus.publishes[0]!.payload).toContain("notes_write on conn-a-name");

    w.repo.resolve(row.id, "allow_once");
    w.bus.fire(`approval:${row.id}`, "");
    expect(await inflight).toBe("allow");
  });

  // TEST_SCENARIO: reading needs no answer from anyone. On a Connection that needs approval, a call of a tool on the Template's read list passes at once with no approval, and a call of a write tool on the same Connection is held.
  it("passes a read call at once and holds a write call", async () => {
    const w = asking();
    expect(await w.send(bodyOf(toolCall("notes_read", 1)), named)).toBe(
      "allow",
    );
    expect(w.repo.inserts).toBe(0);
    void w.send(bodyOf(toolCall("notes_write", 2)), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);
    expect(payloadOf(w).tool).toBe("notes_write");
  });

  // TEST_SCENARIO: the server adds a tool after the read list was written. Nobody decided that it only reads, so a Connection that needs approval holds its call like a write call.
  it("holds a tool the read list does not name", async () => {
    const w = asking();
    void w.send(bodyOf(toolCall("notes_purge")), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);
    expect(payloadOf(w).tool).toBe("notes_purge");
  });

  // TEST_SCENARIO: a tool call is POSTed to a path with a `..` segment, which the server may read as another path than the one the approval would show. The gate denies it before it files an approval, as it denies such a path for every other request, so an approve once can never send it.
  it("denies a tool call on a path with a dot segment without filing an approval", async () => {
    const w = asking();
    expect(
      await w.send(bodyOf(toolCall("notes_write")), {
        ...named,
        path: "/mcp/../other",
      }),
    ).toBe("deny");
    expect(w.repo.inserts).toBe(0);
  });

  // TEST_SCENARIO: the owner denies the call. The agent gets a JSON-RPC error for the call's id on a successful HTTP reply, marked as the platform's refusal, so it can say why and its session goes on.
  it("answers a denied call with an error the agent can read", async () => {
    const w = asking();
    const inflight = w.send(bodyOf(toolCall("notes_write", 4)), named);
    await flushMicrotasks();
    const row = w.repo.rows[0]!;
    w.repo.resolve(row.id, "deny");
    w.bus.fire(`approval:${row.id}`, "");

    const response = refusalOf(await inflight);
    expect(response.status).toBe(200);
    expect(response.headers["x-platform-refusal"]).toBe(
      "connection-tool-access",
    );
    const answer = JSON.parse(response.body);
    expect(answer).toMatchObject({ jsonrpc: "2.0", id: 4 });
    expect(answer.error.message).toContain("the owner denied this call");
  });

  // TEST_SCENARIO: nobody answers within the hold window. The call is not made, and the error says so.
  it("refuses a call nobody answered in time", async () => {
    const w = asking();
    const inflight = w.send(bodyOf(toolCall("notes_write")), named);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(30_000);
    const answer = JSON.parse(refusalOf(await inflight).body);
    expect(answer.error.message).toContain("nobody answered within 30 seconds");
    expect(w.repo.rows[0]!.status).toBe("expired");
  });

  // TEST_SCENARIO: the client sends the same call again while the first waits, with another JSON-RPC id and its arguments' keys in another order. It joins the same approval. A call with other arguments is another call, so it files its own.
  it("joins the same call and files another call apart", async () => {
    const w = asking();
    void w.send(bodyOf(toolCall("notes_write", 1, { a: 1, b: 2 })), named);
    await flushMicrotasks();
    void w.send(bodyOf(toolCall("notes_write", 2, { b: 2, a: 1 })), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);

    void w.send(bodyOf(toolCall("notes_write", 3, { a: 1, b: 3 })), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(2);
  });

  const approveOnce = (w: ReturnType<typeof world>, id: string) => {
    w.repo.resolve(id, "allow_once");
    w.bus.fire(`approval:${id}`, "");
  };

  const abandoned = async (w: ReturnType<typeof world>) => {
    const client = new AbortController();
    const inflight = w.send(bodyOf(toolCall("notes_write", 1, { a: 1 })), {
      ...named,
      signal: client.signal,
    });
    await flushMicrotasks();
    client.abort();
    expect(await inflight).toBe("deny");
    return w.repo.rows[0]!;
  };

  // TEST_SCENARIO: the client gives up on a held call before the owner answers and closes its request. The wait stops at once, the approval stays pending for the owner, and the same call sent again joins it rather than filing another.
  it("leaves the approval pending when the client goes away, and a retry joins it", async () => {
    const w = asking();
    const row = await abandoned(w);
    expect(row.status).toBe("pending");
    expect(w.repo.expirePendingCalls).toEqual([]);

    const retry = w.send(bodyOf(toolCall("notes_write", 2, { a: 1 })), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);
    approveOnce(w, row.id);
    expect(await retry).toBe("allow");
  });

  // TEST_SCENARIO: the owner approves once while no request waits, because the client gave up. The next identical call is made at once, and the call after it files a new approval, since one approve once makes one call.
  it("makes the next identical call with an approve once nobody waited for, and only that one", async () => {
    const w = asking();
    const row = await abandoned(w);
    approveOnce(w, row.id);

    expect(
      await w.send(bodyOf(toolCall("notes_write", 2, { a: 1 })), named),
    ).toBe("allow");
    expect(w.repo.inserts).toBe(1);

    void w.send(bodyOf(toolCall("notes_write", 3, { a: 1 })), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(2);
  });

  // TEST_SCENARIO: an approve once lasts only until the hold window ends. An identical call sent after that files a new approval instead of using the old one.
  it("files a new approval for a retry after the hold window", async () => {
    const w = asking();
    const row = await abandoned(w);
    approveOnce(w, row.id);
    await vi.advanceTimersByTimeAsync(30_000);

    void w.send(bodyOf(toolCall("notes_write", 2, { a: 1 })), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(2);
  });

  // TEST_SCENARIO: two identical calls arrive at the same time after one approve once that no request waited for. Exactly one of them is made; the other is held as a new approval.
  it("makes exactly one of two identical calls racing on one approve once", async () => {
    const w = asking();
    const row = await abandoned(w);
    approveOnce(w, row.id);

    const outcomes: unknown[] = [];
    for (const id of [2, 3])
      void w
        .send(bodyOf(toolCall("notes_write", id, { a: 1 })), named)
        .then((d) => outcomes.push(d));
    await flushMicrotasks();
    expect(outcomes).toEqual(["allow"]);
    expect(w.repo.inserts).toBe(2);
  });

  // TEST_SCENARIO: approve once releases a held call, and an identical request waits on the same approval. The released call uses the approval up, so only one of the two is made, the other gets an error that says why, and an identical retry right after files a new approval.
  it("uses up the approval with the call it releases", async () => {
    const w = asking();
    const first = w.send(bodyOf(toolCall("notes_write", 1, { a: 1 })), named);
    await flushMicrotasks();
    const twin = w.send(bodyOf(toolCall("notes_write", 2, { a: 1 })), named);
    await flushMicrotasks();
    approveOnce(w, w.repo.rows[0]!.id);

    const decisions = await Promise.all([first, twin]);
    expect(decisions.filter((d) => d === "allow")).toHaveLength(1);
    const refused = decisions.find((d) => d !== "allow")!;
    const answer = JSON.parse(refusalOf(refused).body);
    expect(answer.error.message).toContain("was made with that approval");

    void w.send(bodyOf(toolCall("notes_write", 3, { a: 1 })), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(2);
  });

  // TEST_SCENARIO: an approval the client gave up on stays pending, but nobody can approve it once its hold window ends. A call sent again near the end of the window joins it and waits only until the window ends, not a whole new window; a call sent after the window files a new approval.
  it("joins an approval only within its window, and waits only until it ends", async () => {
    const w = asking();
    await abandoned(w);
    await vi.advanceTimersByTimeAsync(29_000);
    const late = w.send(bodyOf(toolCall("notes_write", 2, { a: 1 })), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    const answer = JSON.parse(refusalOf(await late).body);
    expect(answer.error.message).toContain("nobody answered");

    const other = asking();
    await abandoned(other);
    await vi.advanceTimersByTimeAsync(30_000);
    void other.send(bodyOf(toolCall("notes_write", 2, { a: 1 })), named);
    await flushMicrotasks();
    expect(other.repo.inserts).toBe(2);
  });

  // TEST_SCENARIO: the Template can name the call's target, such as the Slack conversation a post goes to. The new approval stores that name, so the person who answers sees it and not a raw id. The same call sent again joins the approval as it is and asks for no second name.
  it("names the target on a new approval and asks once", async () => {
    const asked: unknown[] = [];
    const w = world([grantOf("conn-a", { mode: "needs-approval" })], {
      labels: {
        targetLabel: async (call) => {
          asked.push(call);
          return "#general";
        },
      },
    });
    void w.send(bodyOf(toolCall("notes_write", 1, { a: 1 })), named);
    await flushMicrotasks();
    void w.send(bodyOf(toolCall("notes_write", 2, { a: 1 })), named);
    await flushMicrotasks();

    expect(w.repo.inserts).toBe(1);
    expect(payloadOf(w).targetLabel).toBe("#general");
    expect(asked).toEqual([
      {
        connectionId: "conn-a",
        templateId: "notes",
        tool: "notes_write",
        arguments: { a: 1 },
      },
    ]);
  });

  // TEST_SCENARIO: the name comes from the Template's server, so the approval keeps at most 200 characters of it.
  it("cuts a long target name", async () => {
    const w = world([grantOf("conn-a", { mode: "needs-approval" })], {
      labels: { targetLabel: async () => "n".repeat(500) },
    });
    void w.send(bodyOf(toolCall("notes_write")), named);
    await flushMicrotasks();
    expect(payloadOf(w).targetLabel).toBe("n".repeat(200));
  });

  // TEST_SCENARIO: the lookup of the name fails. The name only helps the person who answers, so the approval is filed without one and the call is held as usual.
  it("files the approval without a name when the lookup fails", async () => {
    const w = world([grantOf("conn-a", { mode: "needs-approval" })], {
      labels: {
        targetLabel: async () => {
          throw new Error("slack is down");
        },
      },
    });
    void w.send(bodyOf(toolCall("notes_write")), named);
    await flushMicrotasks();
    expect(w.repo.inserts).toBe(1);
    expect(payloadOf(w)).not.toHaveProperty("targetLabel");
    expect(w.bus.publishes).toHaveLength(1);
  });

  // TEST_SCENARIO: the lookup of the name hangs. The hold waits for it at most two seconds, then stops the lookup and files the approval without a name, so a slow server never keeps the owner from being asked.
  it("files the approval without a name when the lookup is slow", async () => {
    let lookup: AbortSignal | undefined;
    const w = world([grantOf("conn-a", { mode: "needs-approval" })], {
      labels: {
        targetLabel: (_call, signal) => {
          lookup = signal;
          return new Promise(() => {});
        },
      },
    });
    void w.send(bodyOf(toolCall("notes_write")), named);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(w.repo.inserts).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(w.repo.inserts).toBe(1);
    expect(payloadOf(w)).not.toHaveProperty("targetLabel");
    expect(lookup?.aborted).toBe(true);
  });

  // TEST_SCENARIO: the arguments are larger than the approval keeps. The payload keeps only the first part of their JSON, as text, and says how large the whole arguments are.
  it("cuts arguments over 64 KiB", async () => {
    const w = asking();
    const text = "x".repeat(70 * 1024);
    void w.send(bodyOf(toolCall("notes_write", 1, { text })), named);
    await flushMicrotasks();
    const payload = w.repo.rows[0]!.payload;
    if (payload.kind !== "mcp_tool_call") throw new Error("not a tool call");
    const whole = JSON.stringify({ text }).length;
    expect(payload.argumentsBytes).toBe(whole);
    expect(payload.arguments).toBe(
      JSON.stringify({ text }).slice(0, 64 * 1024),
    );
  });

  // TEST_SCENARIO: a channel turn with nobody attached cannot get an answer in time. The call is refused at once with an error that says it waits for the owner, the approval stays for the owner, and no in-session prompt is sent.
  it("refuses a call in an unattended channel turn and files the approval", async () => {
    const w = world([grantOf("conn-a", { mode: "needs-approval" })], {
      channelTurn: true,
    });
    const answer = JSON.parse(
      refusalOf(await w.send(bodyOf(toolCall("notes_write", 9)), named)).body,
    );
    expect(answer).toMatchObject({ id: 9 });
    expect(answer.error.message).toContain("was not made");
    expect(answer.error.message).toContain("The owner was asked");
    expect(w.repo.inserts).toBe(1);
    expect(w.repo.rows[0]!.status).toBe("pending");
    expect(w.bus.publishes).toHaveLength(0);
  });

  // TEST_SCENARIO: one POST carries several messages and one calls a write tool. One approval answers one call, so nothing is held or sent: every request of the batch gets an error that asks for the calls one by one.
  it("refuses a batch with a tool call, one error per request id", async () => {
    const w = asking();
    const response = refusalOf(
      await w.send(
        bodyOf([
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          toolCall("notes_write", 2),
          { jsonrpc: "2.0", method: "notifications/initialized" },
        ]),
        named,
      ),
    );
    const answers = JSON.parse(response.body);
    expect(answers.map((a: { id: number }) => a.id)).toEqual([1, 2]);
    expect(answers[0].error.message).toContain("one call at a time");
    expect(w.repo.inserts).toBe(0);
  });

  // TEST_SCENARIO: one POST carries several messages, and every tool it calls is a read tool. Nothing needs an answer, so the whole batch passes with no approval.
  it("passes a batch whose tool calls all read", async () => {
    const w = asking();
    expect(
      await w.send(
        bodyOf([
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          toolCall("notes_search", 2),
          toolCall("notes_read", 3),
        ]),
        named,
      ),
    ).toBe("allow");
    expect(w.repo.inserts).toBe(0);
  });

  // TEST_SCENARIO: requests that call no tool, such as listing the tools, pass without an approval.
  it("passes a request that calls no tool", async () => {
    const w = asking();
    expect(
      await w.send(
        bodyOf({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        named,
      ),
    ).toBe("allow");
    expect(w.repo.inserts).toBe(0);
  });
});

describe("tool access on the grant at the gate", () => {
  const named = { connectionId: "conn-a" };
  const write = bodyOf(toolCall("notes_write"));

  // TEST_SCENARIO: two Agents hold the same Connection, and the owner blocked writes for one of them only. Each Agent's call is decided by its own grant, so one write is refused and the other passes.
  it("answers each Agent from its own grant", async () => {
    const { send } = world(
      [
        grantOf("conn-a", {
          access: { read: "allow", write: "block", overrides: {} },
        }),
      ],
      {
        otherAgents: {
          "agent-2": [
            grantOf("conn-a", {
              access: { read: "allow", write: "allow", overrides: {} },
            }),
          ],
        },
      },
    );
    refusalOf(await send(write, named));
    expect(await send(write, { ...named, agentId: "agent-2" })).toBe("allow");
  });

  // TEST_SCENARIO: the grant stores access of its own. It wins over the Connection's mode in both directions: a read-only Connection lets a write pass for a grant that allows all, and a Connection that allows all refuses a write for a grant that blocks writes.
  it("reads the grant's own access over the Connection's mode", async () => {
    const open = world([
      grantOf("conn-a", {
        mode: "read-only",
        access: { read: "allow", write: "allow", overrides: {} },
      }),
    ]);
    expect(await open.send(write, named)).toBe("allow");
    const closed = world([
      grantOf("conn-a", {
        mode: "allow-all",
        access: { read: "allow", write: "block", overrides: {} },
      }),
    ]);
    refusalOf(await closed.send(write, named));
  });

  // TEST_SCENARIO: the owner blocks writes but lets one write tool through, and allows reads but blocks one read tool. An override beats the rule of its group in both directions.
  it("lets an override beat its group in both directions", async () => {
    const { send } = world([
      grantOf("conn-a", {
        access: {
          read: "allow",
          write: "block",
          overrides: { notes_write: "allow", notes_search: "block" },
        },
      }),
    ]);
    expect(await send(write, named)).toBe("allow");
    expect(await send(bodyOf(toolCall("notes_read")), named)).toBe("allow");
    const response = refusalOf(
      await send(bodyOf(toolCall("notes_search")), named),
    );
    expect(JSON.parse(response.body).error.message).toContain(
      'the tool "notes_search" is blocked for this agent',
    );
    refusalOf(await send(bodyOf(toolCall("notes_purge")), named));
  });

  // TEST_SCENARIO: the owner allows every tool but asks for one read tool. A call of that tool is held as a tool-call approval, while a write passes at once.
  it("holds a read tool whose override asks", async () => {
    const { send, repo } = world([
      grantOf("conn-a", {
        access: {
          read: "allow",
          write: "allow",
          overrides: { notes_read: "ask" },
        },
      }),
    ]);
    expect(await send(write, named)).toBe("allow");
    void send(bodyOf(toolCall("notes_read")), named);
    await flushMicrotasks();
    expect(repo.inserts).toBe(1);
  });

  // TEST_SCENARIO: the server adds a tool after the list was read. Nobody decided that it only reads, so it takes the rule of every other tool: it passes where writes are allowed, and is held where writes ask.
  it("gives a tool the list does not name the rule of the other tools", async () => {
    const allowing = world([
      grantOf("conn-a", {
        access: { read: "block", write: "allow", overrides: {} },
      }),
    ]);
    expect(await allowing.send(bodyOf(toolCall("notes_purge")), named)).toBe(
      "allow",
    );
    const asking = world([
      grantOf("conn-a", {
        access: { read: "allow", write: "ask", overrides: {} },
      }),
    ]);
    void asking.send(bodyOf(toolCall("notes_purge")), named);
    await flushMicrotasks();
    expect(asking.repo.inserts).toBe(1);
  });

  // TEST_SCENARIO: a request names no Connection, and the Agent holds two Connections on the host. Each tool gets the strictest rule of the two grants: a tool one grant blocks is refused and names that Connection, a tool one grant asks for is held on that Connection, and a tool both allow passes.
  it("gives each tool of an unnamed request the strictest rule on the host", async () => {
    const { send, repo } = world([
      grantOf("conn-a", {
        access: {
          read: "allow",
          write: "allow",
          overrides: { notes_write: "block" },
        },
      }),
      grantOf("conn-b", {
        access: { read: "allow", write: "ask", overrides: {} },
      }),
    ]);
    const unnamed = { connectionId: null };
    const response = refusalOf(await send(write, unnamed));
    expect(JSON.parse(response.body).error.message).toContain(
      'Connection "conn-a-name"',
    );
    expect(await send(bodyOf(toolCall("notes_read")), unnamed)).toBe("allow");
    void send(bodyOf(toolCall("notes_purge")), unnamed);
    await flushMicrotasks();
    expect(repo.inserts).toBe(1);
    const payload = repo.rows[0]!.payload;
    if (payload.kind !== "mcp_tool_call") throw new Error("not a tool call");
    expect(payload.connectionId).toBe("conn-b");
  });

  // TEST_SCENARIO: one POST carries a call the grant allows and a call it blocks. No part of the body is sent, and the error lists only the blocked tool.
  it("refuses a batch for its blocked call only", async () => {
    const { send } = world([
      grantOf("conn-a", {
        access: {
          read: "allow",
          write: "allow",
          overrides: { notes_purge: "block" },
        },
      }),
    ]);
    const response = refusalOf(
      await send(
        bodyOf([toolCall("notes_write", 1), toolCall("notes_purge", 2)]),
        named,
      ),
    );
    const [first] = JSON.parse(response.body);
    expect(first.error.message).toContain('the tool "notes_purge" is blocked');
    expect(first.error.message).not.toContain('"notes_write"');
  });

  // TEST_SCENARIO: the Agent's grant allows every tool on a read-only Connection, so nothing limits it. A request with no server name passes, as for a Connection that allows all, while a grant that limits anything asks for the retry.
  it("asks for no retry when no grant limits a tool", async () => {
    const elsewhere = { host: "api.example.com", tlsHost: null };
    const open = world([
      grantOf("conn-a", {
        access: { read: "allow", write: "allow", overrides: {} },
      }),
    ]);
    expect(await open.send(write, elsewhere)).toBe("allow");
    const limited = world([
      grantOf("conn-a", {
        mode: "allow-all",
        access: {
          read: "allow",
          write: "allow",
          overrides: { notes_write: "ask" },
        },
      }),
    ]);
    expect(refusalOf(await limited.send(write, elsewhere)).status).toBe(503);
  });
});
