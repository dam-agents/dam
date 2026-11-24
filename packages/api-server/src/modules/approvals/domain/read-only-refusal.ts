import { PLATFORM_REFUSAL_HEADER } from "api-server-api";
import type { JsonRpcId } from "./mcp-tool-calls.js";

export interface ReadOnlyRefusal {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface ReadOnlyLimit {
  readonly host: string;
  readonly connectionName: string;
  readonly fullAccessLabel: string;
}

const REFUSAL = "read-only-connection";
const READ_ONLY_ERROR_CODE = -32003;
const MAX_SHOWN_NAME = 100;

function shown(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_SHOWN_NAME);
}

function wayOut(limit: ReadOnlyLimit): string {
  return `Only the Connection's owner can allow it, by setting the Connection to "${limit.fullAccessLabel}" in the agent's Connections.`;
}

function plain(status: number, body: string, headers = {}): ReadOnlyRefusal {
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

// UNIT_BOUNDARY_DESCRIPTION: the answer to a tool call that a read-only Connection may not make. It is a JSON-RPC error on a successful HTTP reply, one for each request of the body that has an id, and none for an answer the client sent to the server, so the MCP client hands the text to the agent as the tool's error and the session goes on. The text says that the platform's gateway refused the call, not the server, names the tool and the Connection, and says who can allow it and where.
export function refusedToolCalls(
  limit: ReadOnlyLimit,
  input: {
    refused: readonly (string | null)[];
    ids: readonly JsonRpcId[];
    batch: boolean;
  },
): ReadOnlyRefusal {
  const tools = input.refused
    .map((name) => (name === null ? "a tool with no name" : `"${shown(name)}"`))
    .join(", ");
  const unsent = input.batch ? " No request of this batch was sent." : "";
  const message = `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" is read only, so it did not call ${tools}.${unsent} A read-only Connection calls only the tools that read. ${wayOut(limit)}`;
  const errorFor = (id: JsonRpcId) => ({
    jsonrpc: "2.0",
    id,
    error: { code: READ_ONLY_ERROR_CODE, message },
  });
  const errors = (input.ids.length > 0 ? input.ids : [null]).map(errorFor);
  return {
    status: 200,
    headers: {
      "content-type": "application/json",
      [PLATFORM_REFUSAL_HEADER]: REFUSAL,
    },
    body: JSON.stringify(input.batch ? errors : errors[0]),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a request of a read-only Connection whose body the gateway did not send with the check. That happens only while the gateway restarts onto a Secret that asks for the body, so the answer asks for a retry.
export function bodyNotCheckedRefusal(limit: ReadOnlyLimit): ReadOnlyRefusal {
  return plain(
    503,
    `The platform's egress gateway is restarting to check the requests of the read-only Connection "${limit.connectionName}", so it could not check this request to ${limit.host}. Retry in a few seconds.`,
    { "retry-after": "5" },
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a request of a read-only Connection whose body is not one strict JSON document: the gateway cannot tell whether it calls a tool that changes something, so it is refused rather than passed.
export function unreadableRequestRefusal(
  limit: ReadOnlyLimit,
): ReadOnlyRefusal {
  return plain(
    400,
    `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" is read only, and the gateway reads its requests only as one plain JSON document in UTF-8, with no repeated key and no compression. ${wayOut(limit)}`,
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a request of a read-only Connection that uses a method an MCP client does not need, such as PUT or PATCH. The gateway reads tool calls only in a POST, so it refuses a method that could change something another way.
export function methodRefusal(
  limit: ReadOnlyLimit,
  method: string,
): ReadOnlyRefusal {
  return plain(
    403,
    `Refused by the platform's egress gateway, not by ${limit.host}: the Connection "${limit.connectionName}" is read only, so a ${shown(method)} request is not sent. ${wayOut(limit)}`,
  );
}
