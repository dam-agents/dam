import {
  KB_AGGREGATE_MCP_SERVER,
  PLATFORM_OUTBOUND_MCP_SERVER,
} from "api-server-api";

function toolPrefix(server: string): string {
  return `mcp__${server}__`;
}

export const OUTBOUND_TOOL_PREFIX = toolPrefix(PLATFORM_OUTBOUND_MCP_SERVER);
const KB_TOOL_PREFIX = toolPrefix(KB_AGGREGATE_MCP_SERVER);

const PLATFORM_MCP_TOOL_PREFIXES = [OUTBOUND_TOOL_PREFIX, KB_TOOL_PREFIX];

export function isPlatformMcpTool(
  toolName: string | null | undefined,
): boolean {
  if (!toolName) return false;
  return PLATFORM_MCP_TOOL_PREFIXES.some((prefix) =>
    toolName.startsWith(prefix),
  );
}
