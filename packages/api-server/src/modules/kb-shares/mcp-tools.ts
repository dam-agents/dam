import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KbShareAgentOps } from "./compose.js";

interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function json(value: unknown): ToolContent {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(text: string): ToolContent {
  return { content: [{ type: "text", text }], isError: true };
}

async function run(fn: () => Promise<ToolContent>): Promise<ToolContent> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

const OWNER_LINK_NOTE =
  "The owner copies the share link from the knowledge base page — it is never available to agents.";

export function registerKbShareTools(
  server: McpServer,
  deps: { ops: KbShareAgentOps; agentId: string },
): void {
  server.tool(
    "share_knowledge_base",
    `Share THIS knowledge base with the team: publishes a read-only snapshot behind a durable share link and keeps it fresh automatically. Idempotent — if the knowledge base is already shared, returns its current share status. ${OWNER_LINK_NOTE}`,
    {},
    () =>
      run(async () => {
        const view = await deps.ops.share(deps.agentId);
        return json({ share: view, note: OWNER_LINK_NOTE });
      }),
  );

  server.tool(
    "refresh_knowledge_base_share",
    "Republish THIS knowledge base's shared snapshot now, so consumers see the latest content without waiting for the automatic refresh. Returns the publish status.",
    {},
    () =>
      run(async () => {
        const view = await deps.ops.refresh(deps.agentId);
        return json({ share: view });
      }),
  );

  server.tool(
    "get_share_status",
    "Report whether THIS knowledge base is shared, and if so its publish state, snapshot freshness, document count, and usage counters.",
    {},
    () =>
      run(async () => {
        const view = await deps.ops.status(deps.agentId);
        return view === null
          ? json({ shared: false })
          : json({ shared: true, share: view });
      }),
  );
}
