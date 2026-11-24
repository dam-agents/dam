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

const NOT_READ_CALLS = "for every tool call except the tools that read";

function modeOf(limit: ToolAccessLimit): string {
  return limit.mode === "read-only"
    ? "is read only"
    : `needs approval ${NOT_READ_CALLS}`;
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

// UNIT_BOUNDARY_DESCRIPTION: the answer to a batch that holds a call of a tool that does not read, on a Connection that needs approval. The gateway holds one call at a time, as one approval, so it sends no part of the batch and asks the agent to send each call in a request of its own. It answers every request of the batch, in the same shape as a read-only refusal.
export function batchedToolCalls(
  limit: ToolAccessLimit,
  input: { ids: readonly JsonRpcId[] },
): ToolAccessRefusal {
  const message = `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" needs approval ${NOT_READ_CALLS}, and the gateway asks for approval of one call at a time, so no request of this batch was sent. Send each tools/call in a request of its own.`;
  return jsonRpcErrors(message, input.ids, true);
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a tool call of a Connection that needs approval when the call names no tool: nobody could tell what they approve, so it is not held and not sent.
export function unnamedToolCall(
  limit: ToolAccessLimit,
  input: { ids: readonly JsonRpcId[] },
): ToolAccessRefusal {
  const message = `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" needs approval ${NOT_READ_CALLS}, and this call names no tool, so it was not sent.`;
  return jsonRpcErrors(message, input.ids, false);
}

export type HeldToolCallEnd =
  "unattended" | "denied" | "expired" | "child" | "used-up";

function holdWindow(seconds: number): string {
  if (seconds % 60 !== 0) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a held tool call that will not be made: nobody attends the run to approve it now, the owner denied it, nobody answered within the hold window, it came from a sub-agent with network access of its own, which cannot ask the owner, or the owner approved it once and the same call, sent again, used that approval first. It is a JSON-RPC error for the call's id on a successful HTTP reply, so the agent reads why and its session goes on.
export function heldToolCallRefusal(
  limit: ToolAccessLimit,
  call: { tool: string; id: JsonRpcId | undefined },
  end: HeldToolCallEnd,
  holdSeconds: number,
): ToolAccessRefusal {
  const tool = `"${shown(call.tool)}"`;
  const gateway = `Refused by the platform's egress gateway, not by ${limit.host}:`;
  const message = {
    unattended: `${gateway} the Connection "${limit.connectionName}" needs approval to call ${tool}, and nobody is in the app to approve the call now, so it was not made. The owner was asked to approve it in the app.`,
    denied: `${gateway} the owner denied this call of ${tool} on the Connection "${limit.connectionName}", so it was not made.`,
    expired: `${gateway} the Connection "${limit.connectionName}" needs approval to call ${tool}, and nobody answered within ${holdWindow(holdSeconds)}, so the call was not made.`,
    child: `${gateway} the Connection "${limit.connectionName}" needs approval to call ${tool}, and an agent with network access of its own cannot ask the owner for one, so the call was not made.`,
    "used-up": `${gateway} the owner approved one call of ${tool} on the Connection "${limit.connectionName}", and the same call, sent again, was made with that approval, so this one was not made.`,
  }[end];
  return jsonRpcErrors(message, call.id === undefined ? [] : [call.id], false);
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
