import {
  KB_AGGREGATE_MCP_SERVER,
  mcpToolPrefix,
  PLATFORM_OUTBOUND_MCP_SERVER,
} from "api-server-api";

const PLATFORM_MCP_TOOL_PREFIXES = [
  PLATFORM_OUTBOUND_MCP_SERVER,
  KB_AGGREGATE_MCP_SERVER,
].map(mcpToolPrefix);

export function isPlatformMcpTool(
  toolName: string | null | undefined,
): boolean {
  if (!toolName) return false;
  return PLATFORM_MCP_TOOL_PREFIXES.some((prefix) =>
    toolName.startsWith(prefix),
  );
}
