/** Validates a user-typed MCP server URL before OAuth discovery runs.
 *  Returns an error message, or null when the URL is well-formed. */
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
