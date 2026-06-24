import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { KeepAwakeStore } from "./keep-awake.js";

const idShape = {
  id: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,128}$/)
    .optional()
    .describe(
      "Stable identifier for this pin (e.g. a workflow or run id). Release later with the same id — lets a different turn or a reconciler clean up without holding a handle. Omit for a one-off pin you release in the same scope.",
    ),
};

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const text = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
});

function run(fn: () => void, ok: string): ToolResult {
  try {
    fn();
    return text(ok);
  } catch (e) {
    return {
      content: [{ type: "text", text: `error: ${String(e)}` }],
      isError: true,
    };
  }
}

function createServer(store: KeepAwakeStore): McpServer {
  const server = new McpServer({
    name: "platform-keep-awake",
    version: "1.0.0",
  });

  server.registerTool(
    "keep_awake_acquire",
    {
      description:
        "Keep this agent awake (prevent hibernation) while background work runs. The agent will not hibernate until every pin is released, so ALWAYS release when the work finishes — a leftover pin keeps it running and consuming resources indefinitely.",
      inputSchema: idShape,
    },
    ({ id }) =>
      run(
        () => store.acquire(id),
        id ? `keep-awake acquired: ${id}` : "keep-awake acquired",
      ),
  );

  server.registerTool(
    "keep_awake_release",
    {
      description:
        "Release a keep-awake pin taken with keep_awake_acquire. Pass the same id to release a keyed pin; omit id to release one un-keyed pin. The agent can hibernate again once no pins remain.",
      inputSchema: idShape,
    },
    ({ id }) =>
      run(
        () => store.release(id),
        id ? `keep-awake released: ${id}` : "keep-awake released",
      ),
  );

  server.registerTool(
    "keep_awake_purge",
    {
      description:
        "Clear every keep-awake pin at once — both keyed and un-keyed. The agent can hibernate again immediately. Use this to reset keep-awake state, e.g. a reconciler clearing stale pins after a crash or when no background work should be running.",
      inputSchema: {},
    },
    () => run(() => store.purge(), "keep-awake purged"),
  );

  return server;
}

export async function handleKeepAwakeMcp(
  req: IncomingMessage,
  res: ServerResponse,
  store: KeepAwakeStore,
): Promise<void> {
  const server = createServer(store);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
