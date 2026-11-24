import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionTool } from "api-server-api";
import type {
  McpToolLister,
  McpToolListOutcome,
} from "../domain/tool-access.js";

const TIMEOUT_MS = 15_000;
const MAX_TOOLS = 1000;
const MAX_REASON = 200;
const CLIENT_INFO = { name: "platform-tool-list", version: "1" };

function shortened(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
}

function reasonOf(err: unknown, deadline: AbortSignal): string {
  if (deadline.aborted) return `timed out after ${TIMEOUT_MS / 1000} s`;
  if (err instanceof StreamableHTTPError && err.code !== undefined) {
    return err.code > 0
      ? `the server answered HTTP ${err.code}`
      : `the server answered in a form an MCP client cannot read: ${shortened(err.message)}`;
  }
  if (err instanceof McpError) {
    return err.code === ErrorCode.RequestTimeout
      ? `timed out after ${TIMEOUT_MS / 1000} s`
      : `the server answered an MCP error: ${shortened(err.message)}`;
  }
  if (err instanceof TypeError) {
    const cause = (err as { cause?: { code?: unknown } }).cause?.code;
    return typeof cause === "string"
      ? `the server could not be reached (${cause})`
      : "the server could not be reached";
  }
  return err instanceof Error
    ? shortened(err.message)
    : "the tool list could not be read";
}

// UNIT_BOUNDARY_DESCRIPTION: reads the tool list of an MCP server from the api-server, as an MCP client, with the credential the caller hands over in `headers`. It pages through `nextCursor` up to 1000 tools and gives up after 15 s in all. A tool is `readOnly` only when the server sets `readOnlyHint` to true. A redirect is followed only on the same origin, so the credential never leaves for another host. Every failure comes back as a short reason the owner can read, never as a throw.
export function createMcpToolLister(): McpToolLister {
  return {
    async list(url, headers): Promise<McpToolListOutcome> {
      const deadline = AbortSignal.timeout(TIMEOUT_MS);
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, deadline])
              : deadline,
          }),
      });
      const client = new Client(CLIENT_INFO);
      const options = { signal: deadline, timeout: TIMEOUT_MS };
      try {
        await client.connect(transport, options);
        const tools: ConnectionTool[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(
            cursor === undefined ? {} : { cursor },
            options,
          );
          for (const tool of page.tools) {
            if (tools.length >= MAX_TOOLS) break;
            tools.push({
              name: tool.name,
              readOnly: tool.annotations?.readOnlyHint === true,
            });
          }
          cursor = page.nextCursor;
        } while (cursor !== undefined && tools.length < MAX_TOOLS);
        return { ok: true, tools };
      } catch (err) {
        return { ok: false, reason: reasonOf(err, deadline) };
      } finally {
        await client.close().catch(() => {});
      }
    },
  };
}
