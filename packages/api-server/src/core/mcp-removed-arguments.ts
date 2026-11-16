import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  JSONRPCMessage,
  RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { getLogger } from "./logger.js";

export type RemovedArguments = Record<string, Record<string, string>>;

function refusal(
  message: JSONRPCMessage,
  removed: RemovedArguments,
): { id: RequestId; text: string } | null {
  if (
    !("method" in message) ||
    message.method !== "tools/call" ||
    !("id" in message)
  )
    return null;
  const params = message.params as
    { name?: unknown; arguments?: unknown } | undefined;
  const byArgument =
    typeof params?.name === "string" ? removed[params.name] : undefined;
  if (
    !byArgument ||
    typeof params?.arguments !== "object" ||
    params.arguments === null
  )
    return null;
  const sent = params.arguments as Record<string, unknown>;
  const argument = Object.keys(byArgument).find(
    (name) => sent[name] !== undefined,
  );
  return argument ? { id: message.id, text: byArgument[argument]! } : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A tool's input schema drops an argument it does
 * not declare, so a call that still sends a removed argument would run
 * without it, and the Agent would never learn that part of its message was
 * lost. This answers such a `tools/call` with a tool error that says what
 * replaced the argument, before the tool runs, and keeps the removed name out
 * of the tool list. It wraps the handler `connect` installs, so call it after
 * `connect`.
 */
export function refuseRemovedArguments(
  transport: Transport,
  removed: RemovedArguments,
): void {
  const deliver = transport.onmessage!;
  transport.onmessage = (message, extra) => {
    const refused = refusal(message, removed);
    if (!refused) return deliver(message, extra);
    getLogger().warn({ id: refused.id }, "mcp.removed_argument_refused");
    transport
      .send({
        jsonrpc: "2.0",
        id: refused.id,
        result: {
          content: [{ type: "text", text: refused.text }],
          isError: true,
        },
      })
      .catch((err: unknown) =>
        getLogger().warn(
          { err: err instanceof Error ? err.message : String(err) },
          "mcp.removed_argument_reply_failed",
        ),
      );
  };
}
