import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { WebSocket } from "ws";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";
import {
  VIDEO_FPS,
  calibrateTop,
  startVideo,
  videoAvailable,
  type VideoStream,
} from "./browser-video.js";

export const PREVIEW_SESSION = "preview";
export const PREVIEW_IDLE_CLOSE_MS = 10 * 60_000;

const VIDEO_BACKLOG_BYTES = 1024 * 1024;
const VIEWPORT_CHECK_MS = 3_000;
const FPS_REPORT_MS = 5_000;
const LOW_FPS = 20;

export interface Viewport {
  width: number;
  height: number;
  scale: number;
}

export function parseViewport(out: string): Viewport | null {
  const match = /(\d+)x(\d+)@([\d.]+)/.exec(out);
  return match
    ? {
        width: Number(match[1]),
        height: Number(match[2]),
        scale: Number(match[3]),
      }
    : null;
}
const VIEWPORT_MIN = 200;
const VIEWPORT_MAX = 4096;

const viewportScale = (v: unknown): v is number =>
  typeof v === "number" && v >= 1 && v <= 2;

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
  | { type: "restart_browser" }
  | { type: "resize"; width: number; height: number; scale: number };

export type BrowserCommand = (args: string[]) => Promise<string>;

export interface BrowserVideo {
  available(): boolean;
  calibrate(width: number, height: number): Promise<number>;
  start(opts: {
    width: number;
    height: number;
    scale: number;
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
  const { type, url, width, height, scale } = msg as Record<string, unknown>;
  if (
    type === "reload" ||
    type === "back" ||
    type === "forward" ||
    type === "clear_data" ||
    type === "restart_browser"
  )
    return { type };
  if (type === "navigate" && typeof url === "string") return { type, url };
  if (type === "resize" && viewportSide(width) && viewportSide(height)) {
    if (scale === undefined) return { type, width, height, scale: 1 };
    return viewportScale(scale) ? { type, width, height, scale } : null;
  }
  return null;
}

export function fileLog(
  path: string,
  maxBytes = 1_000_000,
): (msg: string) => void {
  return (msg) => {
    try {
      if (statSync(path).size > maxBytes) renameSync(path, `${path}.1`);
    } catch {}
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${new Date().toISOString()} ${msg}\n`);
    } catch {}
  };
}

export const VIDEO_UNAVAILABLE =
  "This agent's image cannot stream its browser: it has no virtual display or no ffmpeg.";

export function isScreencastFrame(raw: Buffer): boolean {
  return raw.subarray(0, 32).toString().includes('"type":"frame"');
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

export function commandTimeoutMs(args: string[]): number {
  return args[0] === "open" ? 45_000 : 15_000;
}

export function agentBrowserCommand(
  envReader: RuntimeEnvReader,
  profileDir: string,
): BrowserCommand {
  return (args) =>
    new Promise((resolve, reject) => {
      const [command, argv] = browserCommandLine(args, profileDir);
      const child = spawn(command, argv, {
        env: {
          ...mergedSpawnEnv(envReader),
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {}
        reject(new Error(`${args[0]} timed out`));
      }, commandTimeoutMs(args));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `${args[0]} exited ${code}`));
      });
    });
}

export function isPreviewProcess(cmdline: string, profileDir: string): boolean {
  const args = cmdline.split("\0");
  if (args.includes(`--user-data-dir=${profileDir}`)) return true;
  const session = args.indexOf("--session");
  return (
    session >= 0 &&
    args[session + 1] === PREVIEW_SESSION &&
    args.some((a) => a.includes("agent-browser"))
  );
}

export function killablePreviewPids(
  processes: { pid: number; cmdline: string }[],
  profileDir: string,
  daemonPid: number | null,
  self: { pid: number; ppid: number },
): number[] {
  const protectedPids = new Set([1, self.pid, self.ppid]);
  return processes
    .filter(({ pid }) => pid > 1 && !protectedPids.has(pid))
    .filter(
      ({ pid, cmdline }) =>
        isPreviewProcess(cmdline, profileDir) ||
        (pid === daemonPid && cmdline.includes("agent-browser")),
    )
    .map(({ pid }) => pid);
}

export async function killPreviewProcesses(profileDir: string): Promise<void> {
  const daemon =
    Number(
      await readFile(
        join(homedir(), ".agent-browser", `${PREVIEW_SESSION}.pid`),
        "utf8",
      ).catch(() => ""),
    ) || null;
  const processes: { pid: number; cmdline: string }[] = [];
  for (const entry of await readdir("/proc").catch(() => [])) {
    const pid = Number(entry);
    if (!pid) continue;
    const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(
      () => "",
    );
    if (cmdline) processes.push({ pid, cmdline });
  }
  for (const pid of killablePreviewPids(processes, profileDir, daemon, {
    pid: process.pid,
    ppid: process.ppid,
  })) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

export function screenVideo(run: BrowserCommand): BrowserVideo {
  return {
    available: videoAvailable,
    calibrate: (width, height) =>
      calibrateTop(
        (path) => run(["screenshot", "--device-pixels", path]),
        width,
        height,
      ),
    start: startVideo,
  };
}

export function createBrowserPreview(deps: {
  run: BrowserCommand;
  profileDir: string;
  streamUrl?: (port: number) => string;
  idleCloseMs?: number;
  video?: BrowserVideo;
  viewportCheckMs?: number;
  stopBrowser?: () => Promise<void>;
  log: (msg: string) => void;
}): BrowserPreview {
  const stopBrowser =
    deps.stopBrowser ??
    (async () => {
      await deps.run(["close"]).catch(() => "");
      await killPreviewProcesses(deps.profileDir);
    });
  const idleCloseMs = deps.idleCloseMs ?? PREVIEW_IDLE_CLOSE_MS;
  const video = deps.video ?? screenVideo(deps.run);
  const streamUrl =
    deps.streamUrl ?? ((port: number) => `ws://127.0.0.1:${port}/`);
  const clients = new Set<WebSocket>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const contentTops = new Map<number, number>();
  let lastStreamPort: number | null = null;

  async function streamPort(): Promise<number> {
    const out = await deps.run(["stream", "status", "--json"]);
    const port = (JSON.parse(out) as { data?: { port?: unknown } }).data?.port;
    if (typeof port !== "number") throw new Error("browser stream has no port");
    if (port !== lastStreamPort) contentTops.clear();
    lastStreamPort = port;
    return port;
  }

  async function contentTop(width: number, height: number, scale: number) {
    const cached = contentTops.get(scale);
    if (cached !== undefined) return cached;
    const top = await video.calibrate(
      Math.round(width * scale),
      Math.round(height * scale),
    );
    contentTops.set(scale, top);
    return top;
  }

  const timed = async <T>(label: string, step: () => Promise<T>) => {
    const started = Date.now();
    try {
      return await step();
    } finally {
      deps.log(`${label} ${Date.now() - started}ms`);
    }
  };

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
        String(msg.scale),
      ]);
    } else if (msg.type === "restart_browser") {
      contentTops.clear();
      await stopBrowser();
      for (const c of clients) c.close(1012, "browser restarted");
    } else {
      await stopBrowser();
      await rm(deps.profileDir, { recursive: true, force: true });
      for (const c of clients) c.close(1012, "browser data cleared");
    }
  }

  function scheduleIdleClose() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (clients.size > 0) return;
      stopBrowser().catch((err: Error) => deps.log(err.message));
    }, idleCloseMs);
    idleTimer.unref?.();
  }

  function attach(client: WebSocket, query: URLSearchParams) {
    if (!video.available()) {
      sendError(client, VIDEO_UNAVAILABLE);
      client.close(1011, "video unavailable");
      return;
    }
    clients.add(client);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    let upstream: WebSocket | null = null;
    const pending: [Buffer, boolean][] = [];
    let videoStream: VideoStream | null = null;
    let viewport: Viewport | null = null;
    let dropping = false;
    let restarting = false;

    let framesSent = 0;
    const sendVideoFrame = (frame: Buffer, key: boolean) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (client.bufferedAmount > VIDEO_BACKLOG_BYTES) {
        if (!dropping)
          deps.log(
            `video: viewer behind (${client.bufferedAmount} bytes queued), dropping frames`,
          );
        dropping = true;
        return;
      }
      if (dropping && !key) {
        if (!restarting) {
          deps.log("video: restarting the encoder for a keyframe");
          void restartVideo(true);
        }
        return;
      }
      dropping = false;
      framesSent++;
      client.send(frame, { binary: true });
    };
    const fpsReport = setInterval(() => {
      const fps = framesSent / (FPS_REPORT_MS / 1000);
      framesSent = 0;
      if (videoStream && fps < LOW_FPS)
        deps.log(
          `video: ${fps.toFixed(1)} fps to this viewer at ${viewport?.width}x${viewport?.height}@${viewport?.scale}`,
        );
    }, FPS_REPORT_MS);
    fpsReport.unref?.();

    async function applyViewport(wanted: Viewport) {
      const actual = parseViewport(
        await deps
          .run([
            "eval",
            "innerWidth + 'x' + innerHeight + '@' + devicePixelRatio",
          ])
          .catch(() => ""),
      );
      if (
        actual?.width === wanted.width &&
        actual.height === wanted.height &&
        actual.scale === wanted.scale
      )
        return false;
      await deps.run([
        "set",
        "viewport",
        String(wanted.width),
        String(wanted.height),
        String(wanted.scale),
      ]);
      return true;
    }

    async function restartVideo(viewportJustSet = false) {
      restarting = true;
      videoStream?.stop();
      videoStream = null;
      const wanted = viewport;
      if (!wanted || client.readyState !== WebSocket.OPEN) {
        restarting = false;
        return;
      }
      if (!viewportJustSet)
        await timed("viewport check", () => applyViewport(wanted)).catch(
          () => false,
        );
      const top = await timed("calibrate", () =>
        contentTop(wanted.width, wanted.height, wanted.scale),
      );
      restarting = false;
      if (viewport !== wanted || client.readyState !== WebSocket.OPEN) return;
      videoStream = video.start({
        ...wanted,
        top,
        onFrame: sendVideoFrame,
        log: (msg) => deps.log(`video: ${msg}`),
      });
      const info = {
        type: "stream_info",
        codec: "h264",
        width: Math.round(wanted.width * wanted.scale),
        height: Math.round(wanted.height * wanted.scale),
        scale: wanted.scale,
        fps: VIDEO_FPS,
      };
      deps.log(
        `video: started ${info.width}x${info.height} at ${info.fps} fps, top ${top}`,
      );
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify(info));
    }

    let checking = false;
    const viewportCheck = setInterval(() => {
      const wanted = viewport;
      if (!wanted || restarting || checking) return;
      checking = true;
      applyViewport(wanted)
        .then((changed) => {
          if (changed && viewport === wanted) return restartVideo();
        })
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    }, deps.viewportCheckMs ?? VIEWPORT_CHECK_MS);
    viewportCheck.unref?.();

    client.on("message", (data: Buffer, isBinary: boolean) => {
      const msg = isBinary ? null : parseControl(data.toString());
      if (msg) {
        timed(msg.type, () => control(client, msg))
          .then(() => {
            if (msg.type === "resize") {
              viewport = {
                width: msg.width,
                height: msg.height,
                scale: msg.scale,
              };
              return restartVideo(true);
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
      clearInterval(viewportCheck);
      clearInterval(fpsReport);
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

    timed("connect", () => open(url))
      .then((port) => {
        if (client.readyState !== WebSocket.OPEN) return;
        const target = new URL(streamUrl(port));
        const us = new WebSocket(target);
        upstream = us;
        us.on("open", () => {
          us.send(JSON.stringify({ type: "screencast_stop" }));
          for (const [d, b] of pending.splice(0)) us.send(d, { binary: b });
        });
        us.on("message", (d: Buffer, isBinary) => {
          if (client.readyState !== WebSocket.OPEN) return;
          if (!isBinary && isScreencastFrame(d)) return;
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
