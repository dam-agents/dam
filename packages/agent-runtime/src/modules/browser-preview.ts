import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { WebSocket } from "ws";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";

export const PREVIEW_SESSION = "preview";
export const PREVIEW_IDLE_CLOSE_MS = 10 * 60_000;

const STREAM_QUERY_KEYS = ["maxFps", "pacing"] as const;

export type PreviewControl =
  | { type: "navigate"; url: string }
  | { type: "reload" }
  | { type: "clear_data" };

export type BrowserCommand = (args: string[]) => Promise<string>;

export interface BrowserPreview {
  attach(client: WebSocket, query: URLSearchParams): void;
  viewers(): number;
  close(): void;
}

export function previewUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:"
    ? url.href
    : null;
}

export function parseControl(data: string): PreviewControl | null {
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const { type, url } = msg as { type?: unknown; url?: unknown };
  if (type === "reload" || type === "clear_data") return { type };
  if (type === "navigate" && typeof url === "string") return { type, url };
  return null;
}

export function agentBrowserCommand(
  envReader: RuntimeEnvReader,
  profileDir: string,
): BrowserCommand {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        "agent-browser",
        ["--session", PREVIEW_SESSION, "--profile", profileDir, ...args],
        { env: mergedSpawnEnv(envReader), timeout: 60_000 },
        (err, stdout, stderr) =>
          err
            ? reject(new Error(stderr.trim() || err.message))
            : resolve(stdout),
      );
    });
}

export function createBrowserPreview(deps: {
  run: BrowserCommand;
  profileDir: string;
  streamUrl?: (port: number) => string;
  idleCloseMs?: number;
  log: (msg: string) => void;
}): BrowserPreview {
  const idleCloseMs = deps.idleCloseMs ?? PREVIEW_IDLE_CLOSE_MS;
  const streamUrl =
    deps.streamUrl ?? ((port: number) => `ws://127.0.0.1:${port}/`);
  const clients = new Set<WebSocket>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  async function streamPort(): Promise<number> {
    const out = await deps.run(["stream", "status", "--json"]);
    const port = (JSON.parse(out) as { data?: { port?: unknown } }).data?.port;
    if (typeof port !== "number") throw new Error("browser stream has no port");
    return port;
  }

  async function open(url: string | null): Promise<number> {
    if (url) await deps.run(["open", url]);
    return streamPort();
  }

  function sendError(client: WebSocket, message: string) {
    if (client.readyState === WebSocket.OPEN)
      client.send(JSON.stringify({ type: "preview_error", message }));
  }

  async function control(client: WebSocket, msg: PreviewControl) {
    if (msg.type === "navigate") {
      const url = previewUrl(msg.url);
      if (!url) return sendError(client, "Only http and https addresses open");
      await deps.run(["open", url]);
    } else if (msg.type === "reload") {
      await deps.run(["reload"]);
    } else {
      await deps.run(["close"]).catch(() => "");
      await rm(deps.profileDir, { recursive: true, force: true });
      for (const c of clients) c.close(1012, "browser data cleared");
    }
  }

  function scheduleIdleClose() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (clients.size > 0) return;
      deps.run(["close"]).catch((err: Error) => deps.log(err.message));
    }, idleCloseMs);
    idleTimer.unref?.();
  }

  function attach(client: WebSocket, query: URLSearchParams) {
    clients.add(client);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    let upstream: WebSocket | null = null;
    const pending: [Buffer, boolean][] = [];
    client.on("message", (data: Buffer, isBinary: boolean) => {
      const msg = isBinary ? null : parseControl(data.toString());
      if (msg) {
        control(client, msg).catch((err: Error) =>
          sendError(client, err.message),
        );
        return;
      }
      if (upstream?.readyState === WebSocket.OPEN)
        upstream.send(data, { binary: isBinary });
      else pending.push([data, isBinary]);
    });
    client.on("close", () => {
      clients.delete(client);
      upstream?.close();
      if (clients.size === 0) scheduleIdleClose();
    });

    const rawUrl = query.get("url");
    const url = rawUrl === null ? null : previewUrl(rawUrl);
    if (rawUrl !== null && !url) {
      client.close(1008, "Only http and https addresses open");
      return;
    }

    open(url)
      .then((port) => {
        if (client.readyState !== WebSocket.OPEN) return;
        const target = new URL(streamUrl(port));
        for (const key of STREAM_QUERY_KEYS) {
          const value = query.get(key);
          if (value !== null) target.searchParams.set(key, value);
        }
        const us = new WebSocket(target);
        upstream = us;
        us.on("open", () => {
          for (const [d, b] of pending.splice(0)) us.send(d, { binary: b });
        });
        us.on("message", (d, isBinary) => {
          if (client.readyState === WebSocket.OPEN)
            client.send(d, { binary: isBinary });
        });
        us.on("close", () => {
          if (client.readyState === WebSocket.OPEN)
            client.close(1011, "browser stream closed");
        });
        us.on("error", (err) => {
          deps.log(`stream: ${err.message}`);
          us.close();
        });
      })
      .catch((err: Error) => {
        deps.log(`open: ${err.message}`);
        if (client.readyState === WebSocket.OPEN)
          client.close(1011, "browser failed to start");
      });
  }

  return {
    attach,
    viewers: () => clients.size,
    close() {
      if (idleTimer) clearTimeout(idleTimer);
      for (const c of clients) c.close(1001, "runtime shutting down");
    },
  };
}
