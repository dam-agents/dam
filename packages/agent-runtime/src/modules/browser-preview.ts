import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { WebSocket } from "ws";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";
import {
  calibrateTop,
  startVideo,
  videoAvailable,
  type VideoStream,
} from "./browser-video.js";

export const PREVIEW_SESSION = "preview";
export const PREVIEW_IDLE_CLOSE_MS = 10 * 60_000;
export const PREVIEW_STREAM_QUALITY = "90";

const STREAM_QUERY_KEYS = ["maxFps", "pacing"] as const;
const VIDEO_BACKLOG_BYTES = 1024 * 1024;
const VIEWPORT_MIN = 200;
const VIEWPORT_MAX = 4096;

const viewportSide = (v: unknown): v is number =>
  Number.isInteger(v) &&
  (v as number) >= VIEWPORT_MIN &&
  (v as number) <= VIEWPORT_MAX;

export type PreviewControl =
  | { type: "navigate"; url: string }
  | { type: "reload" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "clear_data" }
  | { type: "resize"; width: number; height: number };

export type BrowserCommand = (args: string[]) => Promise<string>;

export interface BrowserVideo {
  available(): boolean;
  calibrate(width: number, height: number): Promise<number>;
  start(opts: {
    width: number;
    height: number;
    top: number;
    onFrame: (frame: Buffer, key: boolean) => void;
    log: (msg: string) => void;
  }): VideoStream;
}

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
  const { type, url, width, height } = msg as Record<string, unknown>;
  if (
    type === "reload" ||
    type === "back" ||
    type === "forward" ||
    type === "clear_data"
  )
    return { type };
  if (type === "navigate" && typeof url === "string") return { type, url };
  if (type === "resize" && viewportSide(width) && viewportSide(height))
    return { type, width, height };
  return null;
}

export function binaryFrame(raw: string): Buffer | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const { type, data, ...header } = msg as Record<string, unknown>;
  if (type !== "frame" || typeof data !== "string") return null;
  const head = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(head.byteLength);
  return Buffer.concat([length, head, Buffer.from(data, "base64")]);
}

export function browserCommandLine(
  args: string[],
  profileDir: string,
): [string, string[]] {
  return args[0] === "close"
    ? [
        "agent-browser",
        ["--session", PREVIEW_SESSION, "--profile", profileDir, ...args],
      ]
    : ["platform-browser", args];
}

export function agentBrowserCommand(
  envReader: RuntimeEnvReader,
  profileDir: string,
): BrowserCommand {
  return (args) =>
    new Promise((resolve, reject) => {
      const [command, argv] = browserCommandLine(args, profileDir);
      execFile(
        command,
        argv,
        {
          env: {
            ...mergedSpawnEnv(envReader),
            AGENT_BROWSER_STREAM_QUALITY: PREVIEW_STREAM_QUALITY,
          },
          timeout: 60_000,
        },
        (err, stdout, stderr) =>
          err
            ? reject(new Error(stderr.trim() || err.message))
            : resolve(stdout),
      );
    });
}

export function screenVideo(run: BrowserCommand): BrowserVideo {
  return {
    available: videoAvailable,
    calibrate: (width, height) =>
      calibrateTop((path) => run(["screenshot", path]), width, height),
    start: startVideo,
  };
}

export function createBrowserPreview(deps: {
  run: BrowserCommand;
  profileDir: string;
  streamUrl?: (port: number) => string;
  idleCloseMs?: number;
  video?: BrowserVideo;
  log: (msg: string) => void;
}): BrowserPreview {
  const idleCloseMs = deps.idleCloseMs ?? PREVIEW_IDLE_CLOSE_MS;
  const video = deps.video ?? screenVideo(deps.run);
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
    } else if (
      msg.type === "reload" ||
      msg.type === "back" ||
      msg.type === "forward"
    ) {
      await deps.run([msg.type]);
    } else if (msg.type === "resize") {
      await deps.run([
        "set",
        "viewport",
        String(msg.width),
        String(msg.height),
        "1",
      ]);
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
    const wantsVideo = query.get("codec") === "h264" && video.available();
    let videoStream: VideoStream | null = null;
    let viewport: { width: number; height: number } | null = null;
    let dropping = false;
    let restarting = false;

    const sendVideoFrame = (frame: Buffer, key: boolean) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (client.bufferedAmount > VIDEO_BACKLOG_BYTES) {
        dropping = true;
        return;
      }
      if (dropping && !key) {
        if (!restarting) void restartVideo();
        return;
      }
      dropping = false;
      client.send(frame, { binary: true });
    };

    async function restartVideo() {
      restarting = true;
      videoStream?.stop();
      videoStream = null;
      const wanted = viewport;
      if (!wanted || client.readyState !== WebSocket.OPEN) {
        restarting = false;
        return;
      }
      const top = await video.calibrate(wanted.width, wanted.height);
      restarting = false;
      if (viewport !== wanted || client.readyState !== WebSocket.OPEN) return;
      videoStream = video.start({
        ...wanted,
        top,
        onFrame: sendVideoFrame,
        log: (msg) => deps.log(`video: ${msg}`),
      });
    }

    client.on("message", (data: Buffer, isBinary: boolean) => {
      const msg = isBinary ? null : parseControl(data.toString());
      if (msg) {
        control(client, msg)
          .then(() => {
            if (wantsVideo && msg.type === "resize") {
              viewport = { width: msg.width, height: msg.height };
              return restartVideo();
            }
          })
          .catch((err: Error) => sendError(client, err.message));
        return;
      }
      if (upstream?.readyState === WebSocket.OPEN)
        upstream.send(data, { binary: isBinary });
      else pending.push([data, isBinary]);
    });
    client.on("close", () => {
      clients.delete(client);
      videoStream?.stop();
      videoStream = null;
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
          if (wantsVideo) us.send(JSON.stringify({ type: "screencast_stop" }));
          for (const [d, b] of pending.splice(0)) us.send(d, { binary: b });
        });
        us.on("message", (d: Buffer, isBinary) => {
          if (client.readyState !== WebSocket.OPEN) return;
          const frame = isBinary ? null : binaryFrame(d.toString());
          if (frame && wantsVideo) return;
          if (frame) client.send(frame, { binary: true });
          else client.send(d, { binary: isBinary });
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
