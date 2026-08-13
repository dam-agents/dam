import process from "node:process";

const mcpUrl = process.env.PLATFORM_MCP_URL;
if (!mcpUrl) {
  throw new Error(
    "PLATFORM_MCP_URL is not set — the driver SDK only runs inside a platform agent pod.",
  );
}

const { base, agentId } = ((): { base: string; agentId: string } => {
  const u = new URL(mcpUrl);
  const m = u.pathname.match(/^\/api\/agents\/([^/]+)\/mcp$/);
  if (!m) throw new Error(`unexpected PLATFORM_MCP_URL shape: ${mcpUrl}`);
  return {
    base: `${u.protocol}//${u.host}`,
    agentId: decodeURIComponent(m[1]!),
  };
})();

export { agentId as driverAgentId };

const root = `${base}/api/agents/${encodeURIComponent(agentId)}`;

export async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${root}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${text || res.statusText}`,
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export function log(msg: string): void {
  process.stderr.write(`[invoke] ${msg}\n`);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
