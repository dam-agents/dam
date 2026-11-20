// TEST_OVERVIEW: a read-only Connection at the ext_authz gate. An Agent that holds a Connection whose Template declares read tools, without full access, may call only those tools on the Template's host: a `tools/call` of any other tool is answered with a JSON-RPC error the agent can read, and is never sent on, even when an egress rule allows the host. A Connection with full access is not limited. The choice is read on every request, and a request that names no Connection, or one the Agent does not hold, gets the strictest choice. A body the gateway did not send, or that is not one strict JSON document, is refused rather than passed.
import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";
import { createExtAuthzGate } from "../../modules/approvals/services/ext-authz-gate.js";
import { createReadOnlyGate } from "../../modules/approvals/services/read-only-gate.js";
import type { ModelCallBody } from "../../modules/approvals/services/web-search-gate.js";
import { readOnlyAccessFor } from "../../modules/connections/domain/read-only-access.js";
import {
  makeFakeApprovalsBus,
  makeFakeApprovalsRepo,
} from "../helpers/approvals-fakes.js";

const HOST = "mcp.example.com";

const toolAccess = {
  host: HOST,
  readTools: ["notes_search", "notes_read"],
  fullAccessLabel: "Can write as me",
};

function connection(
  id: string,
  opts: { fullAccess?: boolean; templateId?: string } = {},
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
      ...(opts.fullAccess ? { fullAccess: true as const } : {}),
    },
    contributions: [],
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

function toolCall(name: unknown, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name } };
}

function world(granted: Connection[]) {
  const reads: (string | null)[] = [];
  const gate = createExtAuthzGate({
    repo: makeFakeApprovalsRepo().repo,
    bus: makeFakeApprovalsBus().bus,
    attendance: {
      hasOpenChannelTurn: async () => false,
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
    readOnly: createReadOnlyGate({
      connections: {
        limiting: async (_agentId, request) => {
          reads.push(request.connectionId);
          return readOnlyAccessFor(
            granted,
            (templateId) => (templateId === "notes" ? toolAccess : undefined),
            request,
          );
        },
      },
    }),
  });
  const send = (
    body: ModelCallBody | undefined,
    opts: {
      connectionId?: string | null;
      method?: string;
      host?: string;
      tlsHost?: string;
    } = {},
  ) =>
    gate.gateRequest({
      agentId: "agent-1",
      host: opts.host ?? HOST,
      port: 443,
      tls: true,
      method: opts.method ?? "POST",
      path: "/mcp",
      body,
      connectionId: opts.connectionId ?? null,
      tlsHost: opts.tlsHost ?? null,
    });
  return { send, reads, granted };
}

function refusalOf(
  decision: Awaited<ReturnType<ReturnType<typeof world>["send"]>>,
) {
  if (typeof decision === "string") throw new Error(`not refused: ${decision}`);
  expect(decision.basis).toBe("read-only");
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
    expect(response.headers["x-platform-refusal"]).toBe("read-only-connection");
    const answer = JSON.parse(response.body);
    expect(answer).toMatchObject({ jsonrpc: "2.0", id: 7 });
    expect(answer.error.message).toContain('"notes_write"');
    expect(answer.error.message).toContain('"conn-a-name" is read only');
    expect(answer.error.message).toContain('"Can write as me"');
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

  // TEST_SCENARIO: the owner gave the Connection full access. Nothing is limited, so a write tool passes.
  it("passes a write tool of a Connection with full access", async () => {
    const { send } = world([connection("conn-a", { fullAccess: true })]);
    expect(
      await send(bodyOf(toolCall("notes_write")), { connectionId: "conn-a" }),
    ).toBe("allow");
  });

  // TEST_SCENARIO: the owner switches the Connection to read only while the agent runs. The gate reads the choice on every request, so the next call is refused with no restart.
  it("applies a changed choice to the next request", async () => {
    const { send, granted } = world([
      connection("conn-a", { fullAccess: true }),
    ]);
    const call = () =>
      send(bodyOf(toolCall("notes_write")), { connectionId: "conn-a" });
    expect(await call()).toBe("allow");
    granted[0] = connection("conn-a");
    refusalOf(await call());
  });

  // TEST_SCENARIO: the gateway adds a credential to a request that names no Connection when nothing contests the host. Such a request could carry the read-only Connection's credential, so it gets the strictest choice, and so does a request that names a Connection the Agent does not hold.
  it("limits a request that names no Connection, or an unknown one", async () => {
    const { send } = world([
      connection("conn-full", { fullAccess: true }),
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

  // TEST_SCENARIO: the gateway picks the chain and its credential by the TLS server name, and the agent writes the Host header. A request to the Template's host with a Host header of another host is still limited, because the gate also looks up the server name.
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

  // TEST_SCENARIO: the limit belongs to the Template's host and to the Connections that declare read tools. A request to another host, or of an Agent that holds no such Connection, is gated as before, body or not.
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
