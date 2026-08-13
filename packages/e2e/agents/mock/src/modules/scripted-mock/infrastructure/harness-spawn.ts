import type {
  SpawnInvocationInput,
  SpawnInvocationResult,
} from "mock-agent-api";
import type { HarnessSpawn } from "../services/ports.js";

const TIMEOUT_MS = 30_000;

export function createHarnessSpawn(): HarnessSpawn {
  return async (
    input: SpawnInvocationInput,
  ): Promise<SpawnInvocationResult> => {
    const mcpUrl = process.env.PLATFORM_MCP_URL;
    if (!mcpUrl) throw new Error("PLATFORM_MCP_URL is not set");
    const u = new URL(mcpUrl);
    const m = u.pathname.match(/^\/api\/agents\/([^/]+)\/mcp$/);
    if (!m) throw new Error(`unexpected PLATFORM_MCP_URL shape: ${mcpUrl}`);

    const res = await fetch(
      `${u.protocol}//${u.host}/api/agents/${m[1]}/invocations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`spawn -> ${res.status}: ${text}`);
    return { id: (JSON.parse(text) as { id: string }).id };
  };
}
