import { spawn } from "node:child_process";
import { connect, type Socket } from "node:net";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { WebSocket } from "ws";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";
import {
  VIDEO_FPS,
  startVideo,
  videoAvailable,
  type VideoStream,
} from "./browser-video.js";

export const PREVIEW_SESSION = "preview";
export const PREVIEW_IDLE_CLOSE_MS = 10 * 60_000;

const VIDEO_BACKLOG_BYTES = 1024 * 1024;
const HEALTH_CHECK_MS = 3_000;
const UNRESPONSIVE_RESTART_MS = 60_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000];
const KEYFRAME_MIN_INTERVAL_MS = 1_000;
const ENCODER_RESTART_DELAY_MS = 1_000;
const FPS_REPORT_MS = 5_000;
const VNC_PORT = 5999;
const DISPLAY_RETRY_MS = 500;
const DISPLAY_WAIT_MS = 60_000;
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

const sameViewport = (a: Viewport | null, b: Viewport | null) =>
  !!a &&
  !!b &&
  a.width === b.width &&
  a.height === b.height &&
  a.scale === b.scale;

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
  | { type: "no_video" }
  | { type: "resize"; width: number; height: number; scale: number };

const PAGE_NAVIGATION = {
  reload: "location.reload()",
  back: "history.back()",
  forward: "history.forward()",
} as const;

export type BrowserState = "starting" | "ready" | "failed";

export type BrowserCommand = (args: string[]) => Promise<string>;

export interface BrowserVideo {
  available(): boolean;
  start(opts: {
    width: number;
    height: number;
    scale: number;
    onFrame: (frame: Buffer, key: boolean) => void;
    onExit: () => void;
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
    type === "restart_browser" ||
    type === "no_video"
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

export function commandTimeoutMs(args: string[]): number {
  if (args[0] === "launch") return 60_000;
  if (args[0] === "open") return 45_000;
  if (args[0] === "shutdown") return 30_000;
  return 15_000;
}

export function agentBrowserCommand(
  envReader: RuntimeEnvReader,
): BrowserCommand {
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn("platform-browser", args, {
        env: mergedSpawnEnv(envReader),
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

export const screenVideo: BrowserVideo = {
  available: videoAvailable,
  start: startVideo,
};

export function createCommandQueue(run: BrowserCommand): {
  run: BrowserCommand;
  idle(): boolean;
} {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    run(args) {
      pending++;
      const result = tail.then(() => run(args));
      tail = result
        .catch(() => {})
        .finally(() => {
          pending--;
        });
      return result;
    },
    idle: () => pending === 0,
  };
}

interface Viewer {
  waitingForKey: boolean;
  framesSent: number;
}

export function createBrowserPreview(deps: {
  run: BrowserCommand;
  profileDir: string;
  streamUrl?: (port: number) => string;
  idleCloseMs?: number;
  video?: BrowserVideo;
  healthCheckMs?: number;
  unresponsiveRestartMs?: number;
  retryDelaysMs?: number[];
  stopBrowser?: () => Promise<void>;
  connectDisplay?: () => Socket;
  log: (msg: string) => void;
}): BrowserPreview {
  const commands = createCommandQueue(deps.run);
  const exec = commands.run;
  const stopBrowser =
    deps.stopBrowser ??
    (async () => {
      await deps
        .run(["shutdown"])
        .catch((err: Error) => deps.log(`shutdown: ${err.message}`));
      await killPreviewProcesses(deps.profileDir);
    });
  const idleCloseMs = deps.idleCloseMs ?? PREVIEW_IDLE_CLOSE_MS;
  const unresponsiveRestartMs =
    deps.unresponsiveRestartMs ?? UNRESPONSIVE_RESTART_MS;
  const retryDelays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  const video = deps.video ?? screenVideo;
  const connectDisplay =
    deps.connectDisplay ?? (() => connect(VNC_PORT, "127.0.0.1"));
  const streamUrl =
    deps.streamUrl ?? ((port: number) => `ws://127.0.0.1:${port}/`);

  const viewers = new Map<WebSocket, Viewer>();
  let state: BrowserState = "starting";
  let failure: string | null = null;
  let browserUp = false;
  let failedLaunches = 0;
  let upstream: WebSocket | null = null;
  let pageUrl: string | null = null;
  let wanted: Viewport | null = null;
  let applied: Viewport | null = null;
  let encoder: VideoStream | null = null;
  let encoderFor: Viewport | null = null;
  let encoderBroken = false;
  let lastKeyframeRequest = 0;
  let pendingNavigation: string | null = null;
  let lastAnswerAt = Date.now();
  let generation = 0;

  let dirty = false;
  let reconciling = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let fpsTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const timed = async <T>(label: string, step: () => Promise<T>) => {
    const started = Date.now();
    try {
      return await step();
    } finally {
      deps.log(`${label} ${Date.now() - started}ms`);
    }
  };

  function sendJson(client: WebSocket, msg: object) {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  }

  function broadcast(msg: object) {
    for (const client of viewers.keys()) sendJson(client, msg);
  }

  function stateMessage() {
    return {
      type: "browser_state",
      state,
      ...(failure ? { message: failure } : {}),
    };
  }

  function setState(next: BrowserState, message: string | null = null) {
    if (state === next && failure === message) return;
    state = next;
    failure = message;
    deps.log(`browser ${next}${message ? `: ${message}` : ""}`);
    broadcast(stateMessage());
  }

  function streamInfo(v: Viewport) {
    return {
      type: "stream_info",
      codec: "h264",
      width: Math.round(v.width * v.scale),
      height: Math.round(v.height * v.scale),
      scale: v.scale,
      fps: VIDEO_FPS,
    };
  }

  function stopEncoder() {
    encoder?.stop();
    encoder = null;
    encoderFor = null;
  }

  function closeUpstream() {
    const us = upstream;
    upstream = null;
    us?.removeAllListeners();
    us?.on("error", () => {});
    us?.close();
  }

  function browserGone(reason: string) {
    if (!browserUp) return;
    deps.log(`browser lost: ${reason}`);
    browserUp = false;
    applied = null;
    stopEncoder();
    closeUpstream();
    generation++;
  }

  function schedule() {
    dirty = true;
    if (!reconciling) void reconcile();
  }

  function scheduleRetry() {
    if (retryTimer || closed) return;
    const delay =
      retryDelays[Math.min(failedLaunches - 1, retryDelays.length - 1)] ??
      1_000;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      schedule();
    }, delay);
    retryTimer.unref?.();
  }

  async function streamPort(): Promise<number> {
    const out = await exec(["stream", "status", "--json"]);
    const port = (JSON.parse(out) as { data?: { port?: unknown } }).data?.port;
    if (typeof port !== "number") throw new Error("browser stream has no port");
    return port;
  }

  async function ensureBrowser(): Promise<boolean> {
    if (browserUp && upstream) return true;
    setState("starting");
    const gen = generation;
    try {
      await timed("launch", () => exec(["launch"]));
      const port = await streamPort();
      await connectUpstream(port);
      if (gen !== generation) {
        closeUpstream();
        dirty = true;
        return false;
      }
      browserUp = true;
      failedLaunches = 0;
      lastAnswerAt = Date.now();
      return true;
    } catch (err) {
      if (gen !== generation) {
        dirty = true;
        return false;
      }
      failedLaunches++;
      const message = (err as Error).message.split("\n")[0] ?? "";
      deps.log(`launch failed (${failedLaunches}): ${message}`);
      closeUpstream();
      if (failedLaunches % 2 === 0) await stopBrowser();
      if (failedLaunches >= 3)
        setState("failed", `The browser did not start: ${message}`);
      scheduleRetry();
      return false;
    }
  }

  function connectUpstream(port: number): Promise<void> {
    closeUpstream();
    return new Promise((resolve, reject) => {
      const us = new WebSocket(streamUrl(port));
      upstream = us;
      const gen = generation;
      us.once("open", () => {
        us.send(JSON.stringify({ type: "screencast_stop" }));
        resolve();
      });
      us.on("message", (d: Buffer, isBinary) => {
        if (isBinary || isScreencastFrame(d)) return;
        const text = d.toString();
        try {
          const msg = JSON.parse(text) as { type?: unknown; url?: unknown };
          if (msg.type === "url" && typeof msg.url === "string")
            pageUrl = msg.url;
        } catch {}
        for (const client of viewers.keys())
          if (client.readyState === WebSocket.OPEN) client.send(text);
      });
      us.on("error", (err) => {
        deps.log(`stream: ${err.message}`);
        reject(err);
      });
      us.on("close", () => {
        reject(new Error("browser stream closed"));
        if (upstream !== us || gen !== generation) return;
        browserGone("stream closed");
        if (viewers.size > 0) schedule();
      });
    });
  }

  async function applyViewport(v: Viewport): Promise<void> {
    await timed("resize", () =>
      exec(["screen", String(v.width), String(v.height)]),
    );
    applied = v;
    lastAnswerAt = Date.now();
  }

  function sendFrame(frame: Buffer, key: boolean) {
    for (const [client, viewer] of viewers) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > VIDEO_BACKLOG_BYTES) {
        if (!viewer.waitingForKey)
          deps.log(
            `video: viewer behind (${client.bufferedAmount} bytes queued), skipping to the next keyframe`,
          );
        viewer.waitingForKey = true;
        continue;
      }
      if (viewer.waitingForKey && !key) continue;
      viewer.waitingForKey = false;
      viewer.framesSent++;
      client.send(frame, { binary: true });
    }
    if ([...viewers.values()].some((v) => v.waitingForKey)) requestKeyframe();
  }

  function requestKeyframe() {
    const now = Date.now();
    if (now - lastKeyframeRequest < KEYFRAME_MIN_INTERVAL_MS) return;
    lastKeyframeRequest = now;
    stopEncoder();
    schedule();
  }

  async function startEncoder(v: Viewport): Promise<void> {
    if (!sameViewport(wanted, v) || !browserUp) return;
    const started = video.start({
      ...v,
      onFrame: sendFrame,
      onExit: () => {
        if (encoder !== started) return;
        encoder = null;
        encoderFor = null;
        encoderBroken = true;
        setTimeout(() => {
          encoderBroken = false;
          if (viewers.size > 0) schedule();
        }, ENCODER_RESTART_DELAY_MS).unref?.();
      },
      log: (msg) => deps.log(`video: ${msg}`),
    });
    encoder = started;
    encoderFor = v;
    const info = streamInfo(v);
    deps.log(`video: started ${info.width}x${info.height} at ${info.fps} fps`);
    broadcast(info);
  }

  async function reconcile(): Promise<void> {
    reconciling = true;
    try {
      while (dirty && !closed) {
        dirty = false;
        if (viewers.size === 0) {
          stopEncoder();
          closeUpstream();
          browserUp = false;
          continue;
        }
        if (!(await ensureBrowser())) continue;
        if (pendingNavigation) {
          const url = pendingNavigation;
          pendingNavigation = null;
          await exec(["eval", `location.href = ${JSON.stringify(url)}`]).catch(
            (err: Error) => deps.log(`navigate: ${err.message}`),
          );
        }
        const target = wanted;
        if (!target) {
          setState("ready");
          continue;
        }
        if (!sameViewport(applied, target)) {
          try {
            await applyViewport(target);
          } catch (err) {
            deps.log(`resize: ${(err as Error).message}`);
            continue;
          }
          if (!sameViewport(wanted, target)) {
            dirty = true;
            continue;
          }
          stopEncoder();
        }
        if (!encoder && !encoderBroken) {
          try {
            await startEncoder(target);
          } catch (err) {
            deps.log(`video: ${(err as Error).message}`);
          }
        }
        setState("ready");
        if (!sameViewport(wanted, target)) dirty = true;
      }
    } finally {
      reconciling = false;
    }
  }

  async function healthCheck() {
    if (!browserUp || reconciling || !commands.idle() || viewers.size === 0)
      return;
    const actual = parseViewport(
      await exec([
        "eval",
        "innerWidth + 'x' + innerHeight + '@' + devicePixelRatio",
      ]).catch(() => ""),
    );
    if (!actual) {
      const silentFor = Date.now() - lastAnswerAt;
      if (silentFor < unresponsiveRestartMs) return;
      deps.log(`browser unresponsive for ${silentFor}ms, restarting it`);
      await restart();
      return;
    }
    lastAnswerAt = Date.now();
    if (wanted && !sameViewport(actual, wanted)) {
      deps.log(
        `viewport is ${actual.width}x${actual.height}@${actual.scale}, putting the panel's back`,
      );
      applied = null;
      schedule();
    }
  }

  async function restart(clearData = false) {
    browserGone(clearData ? "clearing data" : "restart");
    browserUp = false;
    generation++;
    setState("starting");
    await timed("shutdown", stopBrowser);
    if (clearData)
      await rm(deps.profileDir, { recursive: true, force: true }).catch(
        (err: Error) => deps.log(`clear data: ${err.message}`),
      );
    failedLaunches = 0;
    schedule();
  }

  async function control(
    client: WebSocket,
    msg: Exclude<PreviewControl, { type: "resize" } | { type: "no_video" }>,
  ) {
    if (msg.type === "navigate") {
      const url = previewUrl(msg.url);
      if (!url)
        return sendJson(client, {
          type: "preview_error",
          message: "Only http and https addresses open",
        });
      if (!browserUp) {
        pendingNavigation = url;
        return schedule();
      }
      await exec(["eval", `location.href = ${JSON.stringify(url)}`]);
    } else if (
      msg.type === "reload" ||
      msg.type === "back" ||
      msg.type === "forward"
    ) {
      if (browserUp) await exec(["eval", PAGE_NAVIGATION[msg.type]]);
    } else {
      await restart(msg.type === "clear_data");
    }
  }

  function startTimers() {
    healthTimer ??= setInterval(
      () => void healthCheck(),
      deps.healthCheckMs ?? HEALTH_CHECK_MS,
    );
    healthTimer.unref?.();
    fpsTimer ??= setInterval(() => {
      for (const viewer of viewers.values()) {
        const fps = viewer.framesSent / (FPS_REPORT_MS / 1000);
        viewer.framesSent = 0;
        if (encoder && fps < LOW_FPS)
          deps.log(
            `video: ${fps.toFixed(1)} fps to a viewer at ${encoderFor?.width}x${encoderFor?.height}@${encoderFor?.scale}`,
          );
      }
    }, FPS_REPORT_MS);
    fpsTimer.unref?.();
  }

  function stopTimers() {
    if (healthTimer) clearInterval(healthTimer);
    if (fpsTimer) clearInterval(fpsTimer);
    healthTimer = null;
    fpsTimer = null;
  }

  function scheduleIdleClose() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (viewers.size > 0) return;
      deps.log("no viewer for the idle window, closing the browser");
      stopBrowser().catch((err: Error) => deps.log(err.message));
    }, idleCloseMs);
    idleTimer.unref?.();
  }

  function attachDisplay(client: WebSocket) {
    let socket: Socket | null = null;
    const pending: Buffer[] = [];
    const startedAt = Date.now();
    client.on("message", (data: Buffer) => {
      if (socket && !socket.connecting) socket.write(data);
      else pending.push(data);
    });
    client.on("close", () => {
      socket?.destroy();
      socket = null;
    });
    const dial = () => {
      if (client.readyState !== WebSocket.OPEN) return;
      const s = connectDisplay();
      let connected = false;
      socket = s;
      s.on("connect", () => {
        connected = true;
        for (const d of pending.splice(0)) s.write(d);
      });
      s.on("data", (d: Buffer) => {
        if (client.readyState === WebSocket.OPEN)
          client.send(d, { binary: true });
      });
      s.on("error", (err) => {
        if (!connected && Date.now() - startedAt < DISPLAY_WAIT_MS) return;
        deps.log(`display: ${err.message}`);
      });
      s.on("close", () => {
        if (socket !== s) return;
        socket = null;
        if (!connected && Date.now() - startedAt < DISPLAY_WAIT_MS) {
          setTimeout(dial, DISPLAY_RETRY_MS).unref?.();
          return;
        }
        if (client.readyState === WebSocket.OPEN)
          client.close(1011, "display closed");
      });
    };
    dial();
  }

  function attach(client: WebSocket, query: URLSearchParams) {
    if (!video.available()) {
      sendJson(client, { type: "preview_error", message: VIDEO_UNAVAILABLE });
      client.close(1011, "video unavailable");
      return;
    }
    if (query.get("vnc") === "1") return attachDisplay(client);
    const rawUrl = query.get("url");
    const url = rawUrl === null ? null : previewUrl(rawUrl);
    if (rawUrl !== null && !url) {
      client.close(1008, "Only http and https addresses open");
      return;
    }

    viewers.set(client, { waitingForKey: true, framesSent: 0 });
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    startTimers();
    sendJson(client, stateMessage());
    if (pageUrl) sendJson(client, { type: "url", url: pageUrl });
    if (encoderFor) sendJson(client, streamInfo(encoderFor));
    if (url) pendingNavigation = url;
    if (encoder) requestKeyframe();
    schedule();

    client.on("message", (data: Buffer, isBinary: boolean) => {
      const msg = isBinary ? null : parseControl(data.toString());
      if (msg?.type === "no_video") {
        wanted = null;
        stopEncoder();
        return;
      }
      if (msg?.type === "resize") {
        wanted = { width: msg.width, height: msg.height, scale: msg.scale };
        schedule();
        return;
      }
      if (msg) {
        timed(msg.type, () => control(client, msg)).catch((err: Error) =>
          sendJson(client, { type: "preview_error", message: err.message }),
        );
        return;
      }
      if (upstream?.readyState === WebSocket.OPEN)
        upstream.send(data, { binary: isBinary });
    });
    client.on("close", () => {
      viewers.delete(client);
      if (viewers.size > 0) return;
      stopTimers();
      stopEncoder();
      closeUpstream();
      browserUp = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      scheduleIdleClose();
    });
  }

  return {
    attach,
    viewers: () => viewers.size,
    close() {
      closed = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (retryTimer) clearTimeout(retryTimer);
      stopTimers();
      stopEncoder();
      closeUpstream();
      for (const c of viewers.keys()) c.close(1001, "runtime shutting down");
    },
  };
}
