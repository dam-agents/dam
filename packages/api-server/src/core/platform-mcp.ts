export const PLATFORM_OUTBOUND_MCP_SERVER = "platform-outbound";
export const KB_AGGREGATE_MCP_SERVER = "knowledge-bases";

const PLATFORM_MCP_TOOL_PREFIXES = [
  PLATFORM_OUTBOUND_MCP_SERVER,
  KB_AGGREGATE_MCP_SERVER,
].map((server) => `mcp__${server}__`);

export function isPlatformMcpTool(
  toolName: string | null | undefined,
): boolean {
  if (!toolName) return false;
  return PLATFORM_MCP_TOOL_PREFIXES.some((prefix) =>
    toolName.startsWith(prefix),
  );
}
