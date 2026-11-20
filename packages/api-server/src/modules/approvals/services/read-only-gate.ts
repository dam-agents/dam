import { securityLog } from "../../../core/security-log.js";
import { decodedUtf8 } from "../domain/check-body.js";
import { readMcpRequestBody } from "../domain/mcp-tool-calls.js";
import {
  bodyNotCheckedRefusal,
  methodRefusal,
  refusedToolCalls,
  unreadableRequestRefusal,
  type ReadOnlyRefusal,
} from "../domain/read-only-refusal.js";
import type { AgentIdentityResolver } from "./ext-authz-gate.js";
import type { ModelCallBody } from "./web-search-gate.js";

export interface ReadOnlyConnection {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly readTools: readonly string[];
  readonly fullAccessLabel: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the read-only Connection that limits a request of an Agent to a host, read from the database on every call, so a change of the owner's choice holds from the next request. `connectionId` is the Connection the gateway says the request names, or null. Null as the answer means nothing limits the request.
export interface ReadOnlyConnections {
  limiting(
    agentId: string,
    request: { host: string; connectionId: string | null },
  ): Promise<ReadOnlyConnection | null>;
}

type EgressIdentity = NonNullable<
  Awaited<ReturnType<AgentIdentityResolver["resolve"]>>
>;

export interface ReadOnlyGateInput {
  agentId: string;
  identity: EgressIdentity;
  via: string | undefined;
  host: string;
  /* UNIT_BOUNDARY_DESCRIPTION: the server name of the TLS session the request came on, when the gateway sent it. The gateway picks the chain and its credential by that name, and the agent writes the Host header freely, so the limit is looked up for both names. */
  tlsHost: string | null;
  method: string;
  path: string;
  connectionId: string | null;
  body: ModelCallBody | undefined;
}

export type ReadOnlyGateOutcome =
  | { readonly pass: true }
  | { readonly pass: false; readonly response: ReadOnlyRefusal };

export interface ReadOnlyGate {
  check(input: ReadOnlyGateInput): Promise<ReadOnlyGateOutcome>;
}

const PASS: ReadOnlyGateOutcome = { pass: true };

const BODILESS_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "DELETE",
]);

const MAX_LOGGED_NAME = 100;

// UNIT_BOUNDARY_DESCRIPTION: the step of the ext_authz gate that keeps a read-only Connection to reading. For a request that such a Connection limits, it reads the whole body the gateway sent and refuses it when a `tools/call` in it names a tool outside the Connection's read tools, also in a batch. The refusal is an error the agent can read, and it answers every request of a batch, since no part of a refused body is sent. The limit is looked up for the TLS server name as well as for the Host header, so a forged Host does not skip it. A POST with no body in the check is refused too, even when its headers declare none, because an HTTP/2 request can carry a body without a length header; so is a body read in part or one that is not strict JSON, since a call could hide in it. Every other request passes on to the gate's other checks.
export function createReadOnlyGate(deps: {
  connections: ReadOnlyConnections;
}): ReadOnlyGate {
  function refuse(
    input: ReadOnlyGateInput,
    limit: ReadOnlyConnection,
    reason: string,
    response: ReadOnlyRefusal,
    detail: Record<string, unknown> = {},
  ): ReadOnlyGateOutcome {
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
        basis: "read-only-connection",
        connectionId: limit.connectionId,
        status: response.status,
        via: input.via,
        ...detail,
      },
    });
    return { pass: false, response };
  }

  async function limitOf(
    input: ReadOnlyGateInput,
  ): Promise<{ limit: ReadOnlyConnection; host: string } | null> {
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

  return {
    async check(input) {
      const found = await limitOf(input);
      if (!found) return PASS;
      const { limit } = found;
      const shown = { ...limit, host: found.host };

      if (BODILESS_METHODS.has(input.method)) return PASS;
      if (input.method !== "POST")
        return refuse(
          input,
          limit,
          "read-only-method",
          methodRefusal(shown, input.method),
        );

      const body = input.body;
      if (!body || !body.sent) {
        return body && !body.declared
          ? refuse(
              input,
              limit,
              "read-only-body-missing",
              unreadableRequestRefusal(shown),
            )
          : refuse(
              input,
              limit,
              "read-only-body-not-sent",
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
          "read-only-body-unreadable",
          unreadableRequestRefusal(shown),
        );

      const refused = request.messages.filter(
        (message) =>
          message.toolCall &&
          (message.toolCall.name === null ||
            !limit.readTools.includes(message.toolCall.name)),
      );
      if (refused.length === 0) return PASS;
      const tools = refused.map((message) => message.toolCall?.name ?? null);
      return refuse(
        input,
        limit,
        "read-only-tool",
        refusedToolCalls(shown, {
          refused: tools,
          ids: request.messages.flatMap((message) =>
            message.request && message.id !== undefined ? [message.id] : [],
          ),
          batch: request.batch,
        }),
        { tools: tools.map((name) => name?.slice(0, MAX_LOGGED_NAME) ?? null) },
      );
    },
  };
}
