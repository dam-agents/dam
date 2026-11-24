import type { ToolRule } from "api-server-api";
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
  type ToolAccessRefusal,
} from "../domain/tool-access-refusal.js";
import type { AgentIdentityResolver } from "./ext-authz-gate.js";
import type { ModelCallBody } from "./web-search-gate.js";

export interface ToolAccessConnection {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly templateId: string;
}

// UNIT_BOUNDARY_DESCRIPTION: what limits the tool calls of one request. The fields name the Connection a refusal names when it is about no single tool. `ruleOf` answers the rule of one tool for this Agent, and the Connection whose grant gave it.
export interface ToolAccessRules extends ToolAccessConnection {
  ruleOf(tool: string): {
    readonly rule: ToolRule;
    readonly connection: ToolAccessConnection;
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the tool-access limits of one Agent, read from the database once for each request, so a change of the owner's rules holds from the next request and one check never reads twice.
export interface ToolAccessConnections {
  forAgent(agentId: string): Promise<ToolAccessLimits>;
}

// UNIT_BOUNDARY_DESCRIPTION: the Agent's grants as one read saw them. `limiting` answers what limits the tool calls of a request to a host, where `connectionId` is the Connection the gateway says the request names, or null; null as the answer means nothing limits the request. `held` answers a Connection whose grant has a rule other than allow, on any host, or null when the Agent holds none.
export interface ToolAccessLimits {
  limiting(request: {
    host: string;
    connectionId: string | null;
  }): ToolAccessRules | null;
  held(): ToolAccessConnection | null;
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

// UNIT_BOUNDARY_DESCRIPTION: one `tools/call` of a tool whose rule for this Agent is ask, which the gate holds as a tool-call approval. `connection` is the Connection whose grant gave the rule. `host` is the host the refusals name, `id` the call's JSON-RPC id, and `arguments` the call's arguments as sent.
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

// UNIT_BOUNDARY_DESCRIPTION: the tool access step of the ext_authz gate, which holds an Agent to the tool access of its grant of an MCP Connection. Each tool has one rule: allow passes, ask holds the call as a tool-call approval, and block refuses it at once. For a request that a grant limits, it reads the whole body the gateway sent. A body with a `tools/call` of a blocked tool is refused, also in a batch. A body of one `tools/call` of a tool that asks is answered with a hold, which the gate files as a tool-call approval; a batch that holds such a call is refused, since one approval answers one call. A call that names no tool is refused, since its rule cannot be told. A body whose tool calls are all allowed passes, also in a batch. A refusal is an error the agent can read, and it answers every request of a batch, since no part of a refused body is sent. The limit is looked up for the TLS server name as well as for the Host header, so a forged Host does not skip it. A gateway that has not yet restarted onto the body check sends no server name, so the Host header alone could hide the Connection's MCP host: while the Agent holds a limiting grant, a TLS request that can carry a body and comes without a server name is refused with the restart's retry. A POST with no body in the check is refused too, even when its headers declare none, because an HTTP/2 request can carry a body without a length header; so is a body read in part or one that is not strict JSON, since a call could hide in it. Every other request passes on to the gate's other checks.
export function createToolAccessGate(deps: {
  connections: ToolAccessConnections;
}): ToolAccessGate {
  function refuse(
    input: ToolAccessGateInput,
    connection: ToolAccessConnection,
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
        connectionId: connection.connectionId,
        status: response.status,
        via: input.via,
        ...detail,
      },
    });
    return { kind: "refuse", response };
  }

  function limitOf(
    input: ToolAccessGateInput,
    limits: ToolAccessLimits,
  ): { limit: ToolAccessRules; host: string } | null {
    const hosts = new Set(
      input.tlsHost === null ? [input.host] : [input.tlsHost, input.host],
    );
    for (const host of hosts) {
      const limit = limits.limiting({
        host,
        connectionId: input.connectionId,
      });
      if (limit) return { limit, host };
    }
    return null;
  }

  function gatewayNotRestarted(
    input: ToolAccessGateInput,
    limits: ToolAccessLimits,
  ): ToolAccessGateOutcome {
    if (
      input.tlsHost !== null ||
      !input.tls ||
      BODILESS_METHODS.has(input.method) ||
      NO_CHAIN_METHODS.has(input.method)
    )
      return PASS;
    const held = limits.held();
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
      const limits = await deps.connections.forAgent(input.agentId);
      const found = limitOf(input, limits);
      if (!found) return gatewayNotRestarted(input, limits);
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

      const ruled = calls.flatMap((call) =>
        call.name === null
          ? []
          : [{ ...call, name: call.name, ...limit.ruleOf(call.name) }],
      );

      const blocked = ruled.filter((call) => call.rule === "block");
      const [firstBlocked] = blocked;
      if (firstBlocked) {
        const tools = blocked.map((call) => call.name);
        return refuse(
          input,
          firstBlocked.connection,
          "tool-access-blocked",
          refusedToolCalls(
            { ...firstBlocked.connection, host: found.host },
            { refused: tools, ids, batch: request.batch },
          ),
          { tools: tools.map((name) => name.slice(0, MAX_LOGGED_NAME)) },
        );
      }

      if (ruled.length < calls.length)
        return refuse(
          input,
          limit,
          "tool-access-unnamed",
          unnamedToolCall(shown, { ids, batch: request.batch }),
          logged,
        );

      const asked = ruled.find((call) => call.rule === "ask");
      if (!asked) return PASS;
      if (request.batch)
        return refuse(
          input,
          asked.connection,
          "tool-access-ask-batch",
          batchedToolCalls({ ...asked.connection, host: found.host }, { ids }),
          logged,
        );
      return {
        kind: "hold",
        toolCall: {
          connection: asked.connection,
          host: found.host,
          tool: asked.name,
          arguments: asked.arguments,
          id: asked.id,
        },
      };
    },
  };
}
