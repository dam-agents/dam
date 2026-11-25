import type { PlatformToolCaller } from "../services/ports.js";

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 30_000;

function firstJsonRpc(raw: string, contentType: string): unknown {
  if (contentType.includes("text/event-stream")) {
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("data:"))
        return JSON.parse(t.slice("data:".length).trim());
    }
    return null;
  }
  return raw.trim() ? JSON.parse(raw) : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a call of one tool on the agent's platform MCP server, at `PLATFORM_MCP_URL`, the way a real harness calls it: initialize, the initialized notification, then `tools/call`. It returns the tool's result, and throws when the server cannot be reached, answers an error, or the tool reports one.
 */
export function createPlatformToolCaller(): PlatformToolCaller {
  const mcpUrl = process.env.PLATFORM_MCP_URL ?? "";

  async function post(
    payload: unknown,
    sessionId?: string,
  ): Promise<{ sessionId?: string; parsed: unknown }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`MCP ${res.status}: ${body.slice(0, 300)}`);
    const ct = res.headers.get("content-type") ?? "";
    return {
      sessionId: res.headers.get("mcp-session-id") ?? undefined,
      parsed: firstJsonRpc(body, ct),
    };
  }

  return async (name, args) => {
    if (!mcpUrl) throw new Error("PLATFORM_MCP_URL is not set");
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mock-agent", version: "1" },
      },
    });
    const sid = init.sessionId;
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);
    const { parsed } = await post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name, arguments: args },
      },
      sid,
    );
    const answer = parsed as {
      result?: { isError?: boolean; content?: { text?: string }[] };
      error?: { message?: string };
    } | null;
    if (!answer) throw new Error(`MCP returned no answer to ${name}`);
    if (answer.error) throw new Error(answer.error.message ?? "MCP error");
    const text = (answer.result?.content ?? [])
      .map((c) => c.text ?? "")
      .join("\n");
    if (answer.result?.isError) throw new Error(text || `${name} failed`);
    return { text, result: answer.result };
  };
}
