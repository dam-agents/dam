import express from "express";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Redis } from "ioredis";

const PORT = 7777;
const LOCK_KEY = "agent:global";
const TTL_SECONDS = 900;

const redis = new Redis({
  host: "127.0.0.1",
  port: 6379,
  lazyConnect: false,
  maxRetriesPerRequest: null,
});

let currentToken: string | null = null;

const REFRESH_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
else
  return 0
end`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`;

async function acquireLock(): Promise<{ acquired: boolean }> {
  const token = crypto.randomUUID();
  const result = await redis.set(LOCK_KEY, token, "EX", TTL_SECONDS, "NX");
  if (result === "OK") {
    currentToken = token;
    return { acquired: true };
  }
  return { acquired: false };
}

async function refreshLock(): Promise<{ refreshed: boolean }> {
  if (!currentToken) return { refreshed: false };
  const result = await redis.eval(
    REFRESH_SCRIPT, 1, LOCK_KEY, currentToken, String(TTL_SECONDS),
  );
  if (Number(result) === 1) return { refreshed: true };
  currentToken = null;
  return { refreshed: false };
}

async function releaseLock(): Promise<{ released: boolean }> {
  if (!currentToken) return { released: false };
  const result = await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, currentToken);
  currentToken = null;
  return { released: Number(result) === 1 };
}

function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: "software-factory-lock", version: "0.1.0" });

  mcp.registerTool(
    "acquire_lock",
    {
      description:
        "Acquire the heartbeat work lock. Call this at the very start of every heartbeat. " +
        "If `acquired` is false, another heartbeat is already holding the lock — stop immediately and do no further work.",
      inputSchema: {},
    },
    async () => {
      const result = await acquireLock();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  mcp.registerTool(
    "refresh_lock",
    {
      description: "Extend the TTL on this pod's currently-held lock. No-op if not held.",
      inputSchema: {},
    },
    async () => {
      const result = await refreshLock();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  mcp.registerTool(
    "release_lock",
    {
      description: "Release this pod's currently-held lock. No-op if not held.",
      inputSchema: {},
    },
    async () => {
      const result = await releaseLock();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return mcp;
}

const app = express();
app.use(express.json());

// Stateless HTTP: the SDK's Protocol.connect() throws if already connected,
// so each request gets its own McpServer + transport pair. Construction is
// cheap (tool registration only) and matches the SDK's documented pattern.
app.post("/mcp", async (req, res) => {
  const mcp = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    process.stderr.write(`[mcp] handleRequest error: ${String(err)}\n`);
    if (!res.headersSent) res.status(500).json({ error: "mcp internal error" });
  }
});

app.post("/lock/refresh", async (_req, res) => {
  try {
    const result = await refreshLock();
    res.json(result);
  } catch (err) {
    process.stderr.write(`[mcp] /lock/refresh error: ${String(err)}\n`);
    if (!res.headersSent) res.status(500).json({ error: "refresh failed" });
  }
});

app.post("/lock/release", async (_req, res) => {
  try {
    const result = await releaseLock();
    res.json(result);
  } catch (err) {
    process.stderr.write(`[mcp] /lock/release error: ${String(err)}\n`);
    if (!res.headersSent) res.status(500).json({ error: "release failed" });
  }
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, held: currentToken !== null });
});

app.listen(PORT, "127.0.0.1");
