export function validateMcpUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Enter a valid URL, e.g. https://mcp.example.com/sse.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "The MCP server URL must use http or https.";
  }
  return null;
}
