import { PLATFORM_REFUSAL_HEADER } from "api-server-api";
import type { JsonRpcId } from "./mcp-tool-calls.js";

export interface ToolAccessRefusal {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type LimitingToolMode = "read-only" | "needs-approval";

export interface ToolAccessLimit {
  readonly host: string;
  readonly connectionName: string;
  readonly mode: LimitingToolMode;
}

const REFUSAL = "connection-tool-access";
const TOOL_ACCESS_ERROR_CODE = -32003;
const MAX_SHOWN_NAME = 100;

function shown(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_SHOWN_NAME);
}

function modeOf(limit: ToolAccessLimit): string {
  return limit.mode === "read-only"
    ? "is read only"
    : "needs approval for every tool call";
}

function wayOut(): string {
  return "Only the Connection's owner can change that, by changing the Connection's access in the agent's Connections.";
}

function plain(status: number, body: string, headers = {}): ToolAccessRefusal {
  return {
    status,
    headers: {
      "content-type": "text/plain",
      [PLATFORM_REFUSAL_HEADER]: REFUSAL,
      ...headers,
    },
    body,
  };
}

function jsonRpcErrors(
  message: string,
  ids: readonly JsonRpcId[],
  batch: boolean,
): ToolAccessRefusal {
  const errorFor = (id: JsonRpcId) => ({
    jsonrpc: "2.0",
    id,
    error: { code: TOOL_ACCESS_ERROR_CODE, message },
  });
  const errors = (ids.length > 0 ? ids : [null]).map(errorFor);
  return {
    status: 200,
    headers: {
      "content-type": "application/json",
      [PLATFORM_REFUSAL_HEADER]: REFUSAL,
    },
    body: JSON.stringify(batch ? errors : errors[0]),
  };
}

function toolList(refused: readonly (string | null)[]): string {
  return refused
    .map((name) => (name === null ? "a tool with no name" : `"${shown(name)}"`))
    .join(", ");
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a tool call that a read-only Connection may not make. It is a JSON-RPC error on a successful HTTP reply, one for each request of the body that has an id, and none for an answer the client sent to the server, so the MCP client hands the text to the agent as the tool's error and the session goes on. The text says that the platform's gateway refused the call, not the server, names the tool, the Connection and its mode, and says who can allow it and where.
export function refusedToolCalls(
  limit: ToolAccessLimit,
  input: {
    refused: readonly (string | null)[];
    ids: readonly JsonRpcId[];
    batch: boolean;
  },
): ToolAccessRefusal {
  const unsent = input.batch ? " No request of this batch was sent." : "";
  const message = `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" is read only, so it did not call ${toolList(input.refused)}.${unsent} A read-only Connection calls only the tools that read. ${wayOut()}`;
  return jsonRpcErrors(message, input.ids, input.batch);
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a tool call of a Connection that needs approval for every tool call, while the gateway cannot ask anyone for one yet. It fails closed: no call is sent, as a JSON-RPC error the agent can read, in the same shape as a read-only refusal.
export function approvalUnavailableToolCalls(
  limit: ToolAccessLimit,
  input: {
    refused: readonly (string | null)[];
    ids: readonly JsonRpcId[];
    batch: boolean;
  },
): ToolAccessRefusal {
  const unsent = input.batch ? " No request of this batch was sent." : "";
  const message = `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" needs approval for every tool call, and approvals of tool calls are not available yet, so it did not call ${toolList(input.refused)}.${unsent} ${wayOut()}`;
  return jsonRpcErrors(message, input.ids, input.batch);
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a request of a limited Connection whose body the gateway did not send with the check. That happens only while the gateway restarts onto a Secret that asks for the body, so the answer asks for a retry.
export function bodyNotCheckedRefusal(
  limit: ToolAccessLimit,
): ToolAccessRefusal {
  return plain(
    503,
    `The platform's egress gateway is restarting to check the requests of the Connection "${limit.connectionName}", which ${modeOf(limit)}, so it could not check this request to ${limit.host}. Retry in a few seconds.`,
    { "retry-after": "5" },
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a request of a limited Connection whose body is not one strict JSON document: the gateway cannot tell which tool it calls, so it is refused rather than passed.
export function unreadableRequestRefusal(
  limit: ToolAccessLimit,
): ToolAccessRefusal {
  return plain(
    400,
    `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" ${modeOf(limit)}, and the gateway reads its requests only as one plain JSON document in UTF-8, with no repeated key and no compression. ${wayOut()}`,
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a request of a limited Connection that uses a method an MCP client does not need, such as PUT or PATCH. The gateway reads tool calls only in a POST, so it refuses a method that could change something another way.
export function methodRefusal(
  limit: ToolAccessLimit,
  method: string,
): ToolAccessRefusal {
  return plain(
    403,
    `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" ${modeOf(limit)}, so a ${shown(method)} request is not sent. ${wayOut()}`,
  );
}
