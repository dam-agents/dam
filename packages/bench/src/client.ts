import { performance } from "node:perf_hooks";

import { WebSocket } from "ws";

const TRUNCATION_SENTINEL = "platform_clipped_replay";

export interface LoadPhases {
  wsOpenMs: number;
  initializeMs: number;
  firstEventMs: number;
  lastEventMs: number;
  responseMs: number;
}

export interface LoadSample {
  wallClock: string;
  sessionId: string;
  events: number;
  eventBytes: number;
  truncated: boolean;
  kinds: Record<string, number>;
  phases: LoadPhases;
}

export interface AcpTarget {
  host: string;
  agentId: string;
  token: string;
}

function acpUrl(target: AcpTarget, passive: boolean): string {
  const proto = target.host.startsWith("https://") ? "wss:" : "ws:";
  const base = target.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const passiveSuffix = passive ? "&passive=1" : "";
  return `${proto}//${base}/api/agents/${encodeURIComponent(target.agentId)}/acp?token=${encodeURIComponent(target.token)}${passiveSuffix}`;
}

interface JsonRpcFrame {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingRequest {
  resolve: (frame: JsonRpcFrame) => void;
  reject: (error: Error) => void;
}

class AcpProbeConnection {
  private readonly ws: WebSocket;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 0;
  onNotification: ((frame: JsonRpcFrame, rawBytes: number) => void) | null =
    null;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      const raw = data.toString();
      let frame: JsonRpcFrame;
      try {
        frame = JSON.parse(raw) as JsonRpcFrame;
      } catch {
        return;
      }
      if (frame.id !== undefined && frame.method === undefined) {
        const entry = this.pending.get(frame.id as number);
        if (entry) {
          this.pending.delete(frame.id as number);
          if (frame.error) {
            entry.reject(
              new Error(`${frame.error.message} (code ${frame.error.code})`),
            );
          } else {
            entry.resolve(frame);
          }
        }
        return;
      }
      if (frame.id !== undefined && frame.method !== undefined) {
        this.ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            error: { code: -32601, message: "not supported by bench probe" },
          }),
        );
        return;
      }
      this.onNotification?.(frame, Buffer.byteLength(raw));
    });
    ws.on("close", () => this.failAll(new Error("websocket closed")));
    ws.on("error", (error) => this.failAll(error as Error));
  }

  static open(url: string): Promise<AcpProbeConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once("open", () => resolve(new AcpProbeConnection(ws)));
      ws.once("error", reject);
    });
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcFrame> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  close(): void {
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.close();
    }
  }
}

async function initialize(conn: AcpProbeConnection): Promise<void> {
  await conn.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "platform-bench", version: "0.0.1" },
  });
}

export async function ensureAgentReachable(target: AcpTarget): Promise<void> {
  const conn = await AcpProbeConnection.open(acpUrl(target, true));
  try {
    await initialize(conn);
  } finally {
    conn.close();
  }
}

export async function measureSessionLoad(
  target: AcpTarget,
  sessionId: string,
  timeoutMs = 300_000,
): Promise<LoadSample> {
  const wallClock = new Date().toISOString();
  const t0 = performance.now();
  const conn = await AcpProbeConnection.open(acpUrl(target, false));
  const tOpen = performance.now();

  let events = 0;
  let eventBytes = 0;
  let truncated = false;
  let firstEventAt = 0;
  let lastEventAt = 0;
  const kinds: Record<string, number> = {};

  conn.onNotification = (frame, rawBytes) => {
    if (frame.method !== "session/update") return;
    const params = frame.params as
      | { sessionId?: string; update?: { sessionUpdate?: string } }
      | undefined;
    if (params?.sessionId !== sessionId) return;
    const now = performance.now();
    if (firstEventAt === 0) firstEventAt = now;
    lastEventAt = now;
    events += 1;
    eventBytes += rawBytes;
    const kind = params.update?.sessionUpdate ?? "unknown";
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (kind === TRUNCATION_SENTINEL) truncated = true;
  };

  const deadline = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`session/load timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ).unref();
  });

  try {
    await Promise.race([initialize(conn), deadline]);
    const tInitialized = performance.now();
    await Promise.race([
      conn.request("session/load", { sessionId, cwd: ".", mcpServers: [] }),
      deadline,
    ]);
    const tResponse = performance.now();
    return {
      wallClock,
      sessionId,
      events,
      eventBytes,
      truncated,
      kinds,
      phases: {
        wsOpenMs: tOpen - t0,
        initializeMs: tInitialized - tOpen,
        firstEventMs: firstEventAt > 0 ? firstEventAt - tInitialized : -1,
        lastEventMs: lastEventAt > 0 ? lastEventAt - tInitialized : -1,
        responseMs: tResponse - tInitialized,
      },
    };
  } finally {
    conn.close();
  }
}
