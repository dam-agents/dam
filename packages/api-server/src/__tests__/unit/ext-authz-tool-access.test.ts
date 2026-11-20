// TEST_OVERVIEW: the tool mode of a Connection at the ext_authz gate. An Agent that holds an MCP Connection in read only may call only its read tools on the Connection's MCP host: a `tools/call` of any other tool is answered with a JSON-RPC error the agent can read, and is never sent on, even when an egress rule allows the host. In needs approval a `tools/call` waits as a tool-call approval that names the tool and its arguments: approve once sends it, and deny once, the end of the hold window or a channel turn nobody attends answers it with a JSON-RPC error. The same call sent again joins the approval, and a batch with such a call is refused, since one approval answers one call. A Connection in allow all is not limited. The choice is read on every request, and a request that names no Connection, or one the Agent does not hold, gets the strictest choice. A body the gateway did not send, or that is not one strict JSON document, is refused rather than passed, and so is a TLS request with a body that comes without its server name while the Agent holds a read-only Connection.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, ToolMode } from "api-server-api";
import { createExtAuthzGate } from "../../modules/approvals/services/ext-authz-gate.js";
import { createToolAccessGate } from "../../modules/approvals/services/tool-access-gate.js";
import type { ModelCallBody } from "../../modules/approvals/services/web-search-gate.js";
import {
  heldToolAccess,
  toolAccessFor,
} from "../../modules/connections/domain/tool-access.js";
import {
  makeFakeApprovalsBus,
  makeFakeApprovalsRepo,
} from "../helpers/approvals-fakes.js";

const HOST = "mcp.example.com";

const template = {
  toolAccess: {
    readTools: ["notes_search", "notes_read"],
    fullAccessLabel: "Can write as me",
  },
  defaultToolMode: "read-only" as const,
};

function connection(
  id: string,
  opts: { mode?: ToolMode; templateId?: string } = {},
): Connection {
  return {
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

function world(granted: Connection[], opts: { channelTurn?: boolean } = {}) {
  const reads: string[] = [];
  const repo = makeFakeApprovalsRepo();
  const bus = makeFakeApprovalsBus();
  const gate = createExtAuthzGate({
    repo: repo.repo,
    bus: bus.bus,
    attendance: {
      hasOpenChannelTurn: async () => opts.channelTurn === true,
      hasInteractiveSession: async () => false,
    },
    identityResolver: {
      resolve: async () => ({ ownerSub: "user-1", agentId: "agent-1" }),
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
          return {
            limiting: (request) => toolAccessFor(granted, templateOf, request),
            held: () => heldToolAccess(granted, templateOf),
          };
        },
      },
    }),
  });
  const send = (
    body: ModelCallBody | undefined,
    opts: {
      connectionId?: string | null;
      method?: string;
      path?: string;
      host?: string;
      tlsHost?: string | null;
      tls?: boolean;
    } = {},
  ) =>
    gate.gateRequest({
      agentId: "agent-1",
      host: opts.host ?? HOST,
      port: 443,
      tls: opts.tls ?? true,
      method: opts.method ?? "POST",
      path: opts.path ?? "/mcp",
      body,
      connectionId: opts.connectionId ?? null,
      tlsHost: opts.tlsHost === undefined ? (opts.host ?? HOST) : opts.tlsHost,
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

describe("a read-only Connection at the gate", () => {
  // TEST_SCENARIO: the owner left the Connection read only. Reading must still work, so a call of a tool on the Template's read list goes on to the gate's other checks, where the egress rule allows it.
  it("passes a call of a read tool", async () => {
    const { send } = world([connection("conn-a")]);
    expect(
      await send(bodyOf(toolCall("notes_search")), { connectionId: "conn-a" }),
    ).toBe("allow");
  });

  // TEST_SCENARIO: the agent tries to write through a read-only Connection. The call must not leave, and the agent must be able to explain why: the answer is a JSON-RPC error for the same request id, on a successful HTTP reply, that names the tool, the Connection and the setting the owner changes.
  it("answers a call of a write tool with an error the agent can read", async () => {
    const { send } = world([connection("conn-a")]);
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
    expect(answer.error.message).toContain('"notes_write"');
    expect(answer.error.message).toContain('"conn-a-name" is read only');
    expect(answer.error.message).toContain("changing the Connection's access");
    expect(answer.error.message).toContain("egress gateway");
  });

  // TEST_SCENARIO: the server adds a tool after the read list was written. Nobody decided that it only reads, so a read-only Connection cannot call it.
  it("refuses a tool the read list does not name", async () => {
    const { send } = world([connection("conn-a")]);
    refusalOf(
      await send(bodyOf(toolCall("notes_new_tool")), {
        connectionId: "conn-a",
      }),
    );
  });

  // TEST_SCENARIO: the owner set the Connection to allow all. Nothing is limited, so a write tool passes.
  it("passes a write tool of a Connection that allows all", async () => {
    const { send } = world([connection("conn-a", { mode: "allow-all" })]);
    expect(
      await send(bodyOf(toolCall("notes_write")), { connectionId: "conn-a" }),
    ).toBe("allow");
  });

  // TEST_SCENARIO: the owner switches the Connection to read only while the agent runs. The gate reads the mode on every request, so the next call is refused with no restart.
  it("applies a changed choice to the next request", async () => {
    const { send, granted } = world([
      connection("conn-a", { mode: "allow-all" }),
    ]);
    const call = () =>
      send(bodyOf(toolCall("notes_write")), { connectionId: "conn-a" });
    expect(await call()).toBe("allow");
    granted[0] = connection("conn-a");
    refusalOf(await call());
  });

  // TEST_SCENARIO: the gateway adds a credential to a request that names no Connection when nothing contests the host. Such a request could carry the read-only Connection's credential, so it gets the strictest mode, and so does a request that names a Connection the Agent does not hold.
  it("limits a request that names no Connection, or an unknown one", async () => {
    const { send } = world([
      connection("conn-full", { mode: "allow-all" }),
      connection("conn-read"),
    ]);
    const write = bodyOf(toolCall("notes_write"));
    refusalOf(await send(write, { connectionId: null }));
    refusalOf(await send(write, { connectionId: "conn-unknown" }));
    expect(await send(write, { connectionId: "conn-full" })).toBe("allow");
    refusalOf(await send(write, { connectionId: "conn-read" }));
  });

  // TEST_SCENARIO: one POST carries several JSON-RPC messages and one of them calls a write tool. No part of the body is sent, so every request of the batch that has an id gets the error, as an array.
  it("refuses a whole batch that holds one write call", async () => {
    const { send } = world([connection("conn-a")]);
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
    const { send } = world([connection("conn-a")]);
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
    const { send } = world([connection("conn-a")]);
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
    const { send } = world([connection("conn-a")]);
    const response = refusalOf(
      await send({ sent: false, declared: true }, { connectionId: "conn-a" }),
    );
    expect(response.status).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
  });

  // TEST_SCENARIO: a POST that declares no body is still refused, because an HTTP/2 request can carry one without a length header. A retry would never pass, so the answer is a final 400, not the restart's 503.
  it("refuses a POST with no body for good", async () => {
    const { send } = world([connection("conn-a")]);
    const response = refusalOf(
      await send({ sent: false, declared: false }, { connectionId: "conn-a" }),
    );
    expect(response.status).toBe(400);
    expect(response.headers).not.toHaveProperty("retry-after");
  });

  // TEST_SCENARIO: the gateway picks the chain and its credential by the TLS server name, and the agent writes the Host header. A request to the MCP host with a Host header of another host is still limited, because the gate also looks up the server name.
  it("limits a request whose Host header names another host", async () => {
    const { send } = world([connection("conn-a")]);
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
    const { send, reads } = world([connection("conn-a")]);
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
    const { send } = world([connection("conn-a")]);
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
    const limited = world([connection("conn-a")]);
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
    const full = world([connection("conn-a", { mode: "allow-all" })]);
    expect(await full.send(bodyOf(toolCall("notes_write")), elsewhere)).toBe(
      "allow",
    );
  });

  // TEST_SCENARIO: a server may match JSON keys in any letter case. A method under the key "Method", or a second tool name under "Name" next to "name", must not slip past the gate.
  it("reads keys in any letter case", async () => {
    const { send } = world([connection("conn-a")]);
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
    const { send } = world([connection("conn-a")]);
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
    const { send } = world([connection("conn-a")]);
    expect(
      refusalOf(
        await send(bodyOf({}), { connectionId: "conn-a", method: "PUT" }),
      ).status,
    ).toBe(403);
  });

  // TEST_SCENARIO: an unnamed request on a host where the Agent holds one Connection in needs approval and one in read only gets read only, which refuses at once and never asks a person for an approval they did not expect: its read tools pass, and only a request that names the other Connection is held.
  it("picks read only over needs approval for an unnamed request", async () => {
    const { send, repo } = world([
      connection("conn-ask", { mode: "needs-approval" }),
      connection("conn-read", { mode: "read-only" }),
    ]);
    expect(
      await send(bodyOf(toolCall("notes_read")), { connectionId: null }),
    ).toBe("allow");
    expect(repo.inserts).toBe(0);
    void send(bodyOf(toolCall("notes_read")), { connectionId: "conn-ask" });
    await flushMicrotasks();
    expect(repo.inserts).toBe(1);
  });

  // TEST_SCENARIO: the limit belongs to the Connection's MCP host and to a Connection that does not allow all. A request to another host, or of an Agent whose Connection there allows all, is gated as before, body or not.
  it("leaves other hosts and other Connections alone", async () => {
    const limited = world([connection("conn-a")]);
    expect(
      await limited.send(bodyOf(toolCall("notes_write")), {
        host: "api.example.com",
      }),
    ).toBe("allow");
    const other = world([connection("conn-b", { templateId: "other" })]);
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

  const asking = () =>
    world([connection("conn-a", { mode: "needs-approval" })]);
  const named = { connectionId: "conn-a" };

  // TEST_SCENARIO: the agent calls a tool, a read tool too, on a Connection that needs approval. One tool-call approval is filed with the Connection, the tool and the arguments, the in-session prompt goes to attached clients, and approve once sends the call on, even past the egress rules.
  it("holds a tool call and sends it on when approved", async () => {
    const w = asking();
    const inflight = w.send(
      bodyOf(toolCall("notes_read", 3, { query: "q" })),
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
      tool: "notes_read",
      arguments: { query: "q" },
      argumentsBytes: JSON.stringify({ query: "q" }).length,
    });
    expect(w.bus.publishes[0]!.channel).toBe("inject:agent-1");
    expect(w.bus.publishes[0]!.payload).toContain("notes_read on conn-a-name");

    w.repo.resolve(row.id, "allow");
    w.bus.fire(`approval:${row.id}`, "");
    expect(await inflight).toBe("allow");
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
    const w = world([connection("conn-a", { mode: "needs-approval" })], {
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

  // TEST_SCENARIO: one POST carries several messages and one calls a tool. One approval answers one call, so nothing is held or sent: every request of the batch gets an error that asks for the calls one by one.
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
