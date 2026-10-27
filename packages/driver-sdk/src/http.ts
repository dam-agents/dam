import process from "node:process";

const mcpUrl = process.env.PLATFORM_MCP_URL;
if (!mcpUrl) {
  throw new Error(
    "PLATFORM_MCP_URL is not set — the driver SDK only runs inside a platform agent's machine.",
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

const SESSION_REF_VAR = "PLATFORM_SESSION_REF";

const SESSION_ID_VARS = [
  "HARNESS_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
  "PI_SESSION_ID",
];

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Driver's Session this script runs in, as
 * the harness put it in the script's environment, so a spawn records it and
 * its sub-agent shows only in that Session's chat. Pi hands its chat Sessions
 * a Session ref; every harness, and a terminal, sets a Session id on its shell
 * commands, the platform's own variable first. A blank value names nothing:
 * Pi sets a blank ref outside a chat Session. A script run outside any
 * Session sends nothing and its sub-agents show in every chat.
 */
export function spawningSessionHeaders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const ref = env[SESSION_REF_VAR]?.trim();
  const sessionId = SESSION_ID_VARS.map((name) => env[name]?.trim()).find(
    (value) => value,
  );
  return {
    ...(ref ? { "x-platform-session-ref": ref } : {}),
    ...(sessionId ? { "x-platform-session-id": sessionId } : {}),
  };
}

export async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${root}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...extraHeaders,
    },
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
