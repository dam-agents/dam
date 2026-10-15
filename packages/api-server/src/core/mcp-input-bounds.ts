import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { hasOversizedArray, OVERSIZED_ARRAY_MESSAGE } from "api-server-api";
import { getLogger } from "./logger.js";

// UNIT_BOUNDARY_DESCRIPTION: refuses an MCP message that carries an oversized array before a tool's input schema parses it, answering a request with an invalid-params error and dropping anything else. It wraps the handler `connect` installs, so call it after `connect`.
export function rejectOversizedArrays(transport: Transport): void {
  const deliver = transport.onmessage!;
  transport.onmessage = (message, extra) => {
    if (!hasOversizedArray(message)) return deliver(message, extra);
    const method = "method" in message ? message.method : undefined;
    getLogger().warn({ method }, "mcp.oversized_array_refused");
    if (method !== undefined && "id" in message) {
      transport
        .send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: ErrorCode.InvalidParams,
            message: OVERSIZED_ARRAY_MESSAGE,
          },
        })
        .catch((err: unknown) =>
          getLogger().warn(
            { err: err instanceof Error ? err.message : String(err), method },
            "mcp.oversized_array_reply_failed",
          ),
        );
    }
  };
}
