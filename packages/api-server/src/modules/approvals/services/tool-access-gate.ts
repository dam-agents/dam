import { securityLog } from "../../../core/security-log.js";
import { decodedUtf8 } from "../domain/check-body.js";
import {
  readMcpRequestBody,
  type JsonRpcId,
} from "../domain/mcp-tool-calls.js";
import {
  batchedToolCalls,
  bodyNotCheckedRefusal,
  methodRefusal,
  refusedToolCalls,
  unnamedToolCall,
  unreadableRequestRefusal,
  type LimitingToolMode,
  type ToolAccessRefusal,
} from "../domain/tool-access-refusal.js";
import type { AgentIdentityResolver } from "./ext-authz-gate.js";
import type { ModelCallBody } from "./web-search-gate.js";

export interface ToolAccessConnection {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly templateId: string;
  readonly mode: LimitingToolMode;
  readonly readTools: readonly string[];
}

// UNIT_BOUNDARY_DESCRIPTION: the Connection that limits the tool calls of a request of an Agent to a host, with its tool mode, read from the database on every call, so a change of the owner's mode holds from the next request. `connectionId` is the Connection the gateway says the request names, or null. Null as the answer means nothing limits the request.
export interface ToolAccessConnections {
  limiting(
    agentId: string,
    request: { host: string; connectionId: string | null },
  ): Promise<ToolAccessConnection | null>;
  /* UNIT_BOUNDARY_DESCRIPTION: a limiting Connection the Agent holds, on any host, or null when it holds none. */
  held(agentId: string): Promise<ToolAccessConnection | null>;
}

type EgressIdentity = NonNullable<
  Awaited<ReturnType<AgentIdentityResolver["resolve"]>>
>;

export interface ToolAccessGateInput {
  agentId: string;
  identity: EgressIdentity;
  via: string | undefined;
  host: string;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the request came over TLS. A gateway that checks a body sends the server name with every TLS request of its chains, so a TLS request without one comes from a gateway that has not restarted yet. */
  tls: boolean;
  /* UNIT_BOUNDARY_DESCRIPTION: the server name of the TLS session the request came on, when the gateway sent it. The gateway picks the chain and its credential by that name, and the agent writes the Host header freely, so the limit is looked up for both names. */
  tlsHost: string | null;
  method: string;
  path: string;
  connectionId: string | null;
  body: ModelCallBody | undefined;
}

// UNIT_BOUNDARY_DESCRIPTION: one `tools/call` of a Connection in needs approval, which the gate holds as a tool-call approval. `host` is the host the refusals name, `id` the call's JSON-RPC id, and `arguments` the call's arguments as sent.
export interface HeldToolCall {
  readonly connection: ToolAccessConnection;
  readonly host: string;
  readonly tool: string;
  readonly arguments: unknown;
  readonly id: JsonRpcId | undefined;
}

export type ToolAccessGateOutcome =
  | { readonly kind: "pass" }
  | { readonly kind: "refuse"; readonly response: ToolAccessRefusal }
  | { readonly kind: "hold"; readonly toolCall: HeldToolCall };

export interface ToolAccessGate {
  check(input: ToolAccessGateInput): Promise<ToolAccessGateOutcome>;
}

const PASS: ToolAccessGateOutcome = { kind: "pass" };

const BODILESS_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "DELETE",
]);

const NO_CHAIN_METHODS: ReadonlySet<string> = new Set(["CONNECT", "*"]);

const MAX_LOGGED_NAME = 100;

// UNIT_BOUNDARY_DESCRIPTION: the tool access step of the ext_authz gate, which holds an MCP Connection to its tool mode. For a request that a Connection in read only or needs approval limits, it reads the whole body the gateway sent. In read only it refuses the body when a `tools/call` in it names a tool outside the Connection's read tools, also in a batch. In needs approval it answers a body of one `tools/call` that names a tool with a hold, which the gate files as a tool-call approval; a batch that holds a `tools/call`, or a call that names no tool, is refused, since one approval answers one call. A refusal is an error the agent can read, and it answers every request of a batch, since no part of a refused body is sent. The limit is looked up for the TLS server name as well as for the Host header, so a forged Host does not skip it. A gateway that has not yet restarted onto the body check sends no server name, so the Host header alone could hide the Template's host: while the Agent holds a limiting Connection, a TLS request that can carry a body and comes without a server name is refused with the restart's retry. A POST with no body in the check is refused too, even when its headers declare none, because an HTTP/2 request can carry a body without a length header; so is a body read in part or one that is not strict JSON, since a call could hide in it. Every other request passes on to the gate's other checks.
export function createToolAccessGate(deps: {
  connections: ToolAccessConnections;
}): ToolAccessGate {
  function refuse(
    input: ToolAccessGateInput,
    limit: ToolAccessConnection,
    reason: string,
    response: ToolAccessRefusal,
    detail: Record<string, unknown> = {},
  ): ToolAccessGateOutcome {
    securityLog("warn", "egress.decision", {
      category: "egress",
      actor: input.identity.ownerSub,
      actorKind: "agent",
      surface: "ext-authz",
      agentId: input.identity.agentId,
      target: input.host,
      decision: "deny",
      reason,
      detail: {
        method: input.method,
        path: input.path.split("?")[0],
        basis: "tool-access",
        mode: limit.mode,
        connectionId: limit.connectionId,
        status: response.status,
        via: input.via,
        ...detail,
      },
    });
    return { kind: "refuse", response };
  }

  async function limitOf(
    input: ToolAccessGateInput,
  ): Promise<{ limit: ToolAccessConnection; host: string } | null> {
    const hosts = new Set(
      input.tlsHost === null ? [input.host] : [input.tlsHost, input.host],
    );
    for (const host of hosts) {
      const limit = await deps.connections.limiting(input.agentId, {
        host,
        connectionId: input.connectionId,
      });
      if (limit) return { limit, host };
    }
    return null;
  }

  async function gatewayNotRestarted(
    input: ToolAccessGateInput,
  ): Promise<ToolAccessGateOutcome> {
    if (
      input.tlsHost !== null ||
      !input.tls ||
      BODILESS_METHODS.has(input.method) ||
      NO_CHAIN_METHODS.has(input.method)
    )
      return PASS;
    const held = await deps.connections.held(input.agentId);
    if (!held) return PASS;
    return refuse(
      input,
      held,
      "tool-access-server-name-missing",
      bodyNotCheckedRefusal({ ...held, host: input.host }),
    );
  }

  return {
    async check(input) {
      const found = await limitOf(input);
      if (!found) return gatewayNotRestarted(input);
      const { limit } = found;
      const shown = { ...limit, host: found.host };

      if (BODILESS_METHODS.has(input.method)) return PASS;
      if (input.method !== "POST")
        return refuse(
          input,
          limit,
          "tool-access-method",
          methodRefusal(shown, input.method),
        );

      const body = input.body;
      if (!body || !body.sent) {
        return body && !body.declared
          ? refuse(
              input,
              limit,
              "tool-access-body-missing",
              unreadableRequestRefusal(shown),
            )
          : refuse(
              input,
              limit,
              "tool-access-body-not-sent",
              bodyNotCheckedRefusal(shown),
            );
      }
      const text = body.partial ? null : decodedUtf8(body.bytes);
      const request =
        text === null
          ? { kind: "unreadable" as const }
          : readMcpRequestBody(text);
      if (request.kind === "unreadable")
        return refuse(
          input,
          limit,
          "tool-access-body-unreadable",
          unreadableRequestRefusal(shown),
        );

      const calls = request.messages.flatMap((message) =>
        message.toolCall ? [{ ...message.toolCall, id: message.id }] : [],
      );
      if (calls.length === 0) return PASS;
      const ids = request.messages.flatMap((message) =>
        message.request && message.id !== undefined ? [message.id] : [],
      );
      const logged = {
        tools: calls.map(
          (call) => call.name?.slice(0, MAX_LOGGED_NAME) ?? null,
        ),
      };

      if (limit.mode === "needs-approval") {
        if (request.batch)
          return refuse(
            input,
            limit,
            "needs-approval-batch",
            batchedToolCalls(shown, { ids }),
            logged,
          );
        const [call] = calls;
        if (call.name === null)
          return refuse(
            input,
            limit,
            "needs-approval-unnamed",
            unnamedToolCall(shown, { ids }),
            logged,
          );
        return {
          kind: "hold",
          toolCall: {
            connection: limit,
            host: found.host,
            tool: call.name,
            arguments: call.arguments,
            id: call.id,
          },
        };
      }

      const refused = calls.filter(
        (call) => call.name === null || !limit.readTools.includes(call.name),
      );
      if (refused.length === 0) return PASS;
      const tools = refused.map((call) => call.name);
      return refuse(
        input,
        limit,
        "read-only-tool",
        refusedToolCalls(shown, { refused: tools, ids, batch: request.batch }),
        { tools: tools.map((name) => name?.slice(0, MAX_LOGGED_NAME) ?? null) },
      );
    },
  };
}
