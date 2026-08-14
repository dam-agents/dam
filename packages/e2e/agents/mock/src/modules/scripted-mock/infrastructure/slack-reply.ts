import type { SlackReplyPoster } from "../services/ports.js";

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 15_000;

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

export function createSlackReplyPoster(): SlackReplyPoster {
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
    const ct = res.headers.get("content-type") ?? "";
    return {
      sessionId: res.headers.get("mcp-session-id") ?? undefined,
      parsed: firstJsonRpc(body, ct),
    };
  }

  return async ({ text, threadTs }) => {
    if (!mcpUrl) {
      process.stderr.write(
        "[mock-agent] PLATFORM_MCP_URL not set — cannot post Slack reply\n",
      );
      return;
    }
    try {
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
      await post(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "reply",
            arguments: { text, ...(threadTs ? { threadTs } : {}) },
          },
        },
        sid,
      );
    } catch (err) {
      process.stderr.write(
        `[mock-agent] Slack reply failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };
}
