import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WebSocket } from "ws";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";
import { type PageWatch, type WatchPages, watchPages } from "./browser-cdp.js";

export const BROWSER_SESSION = "default";

const HEALTH_CHECK_MS = 3_000;
const CHECK_TIMEOUT_MS = 15_000;
const UNRESPONSIVE_RESTART_MS = 60_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000];
const BROWSER_GONE_AFTER_CHECKS = 2;
export const DISPLAY_STREAM_URL = "ws://127.0.0.1:5999/api/websockets";
const DISPLAY_RETRY_MS = 500;
const DISPLAY_WAIT_MS = 60_000;
const DISPLAY_PENDING_MAX_BYTES = 256 * 1024;

export const DISPLAY_COMMAND = "/usr/local/bin/platform-display";
export const DISPLAY_TOOLS = [
  DISPLAY_COMMAND,
  "/usr/bin/Xvfb",
  "/opt/selkies/bin/selkies",
  "/opt/ms-playwright/chromium",
] as const;

export function displayAvailable(
  exists: (path: string) => boolean = existsSync,
): boolean {
  return DISPLAY_TOOLS.every((path) => exists(path));
}

export const DISPLAY_UNAVAILABLE =
  "This agent's image cannot show its browser: it has no virtual display or stream server.";

export type PreviewControl =
  | { type: "navigate"; url: string }
  | { type: "reload" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "stop" }
  | { type: "clear_data" }
  | { type: "restart_browser" };

export type BrowserState = "starting" | "ready" | "failed";

export type BrowserCommand = (args: string[]) => Promise<string>;

export interface BrowserPreview {
  attach(client: WebSocket): void;
  attachDisplay(client: WebSocket): void;
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
  const { type, url } = msg as Record<string, unknown>;
  if (
    type === "reload" ||
    type === "back" ||
    type === "forward" ||
    type === "stop" ||
    type === "clear_data" ||
    type === "restart_browser"
  )
    return { type };
  if (type === "navigate" && typeof url === "string") return { type, url };
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

export const LAUNCH = ["get", "url"];
export const CDP_URL = ["get", "cdp-url"];

export const timedOut = (err: Error) => /timed out/i.test(err.message);

export function commandTimeoutMs(args: string[]): number {
  if (args[0] === LAUNCH[0] && args[1] === LAUNCH[1]) return 60_000;
  if (args[0] === "close") return 30_000;
  return 15_000;
}

export function agentBrowserCommand(
  envReader: RuntimeEnvReader,
): BrowserCommand {
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn("agent-browser", args, {
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
  return cmdline.split("\0").includes(`--user-data-dir=${profileDir}`);
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

export async function killPreviewProcesses(
  profileDir: string,
  socketDir: string,
): Promise<void> {
  const daemon =
    Number(
      await readFile(join(socketDir, `${BROWSER_SESSION}.pid`), "utf8").catch(
        () => "",
      ),
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
  for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"])
    await rm(join(profileDir, lock), { force: true }).catch(() => {});
}

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

/**
 * UNIT_BOUNDARY_DESCRIPTION: one supervisor keeps the agent's browser — the
 * one plain agent-browser commands drive, by the image's AGENT_BROWSER_*
 * defaults — up for every open panel. A panel's control socket (attach)
 * keeps it launched (`get url` starts agent-browser's daemon and browser when
 * none runs) and watches its pages over CDP (browser-cdp), so the page's
 * address, title, loading and history reach the panel as they change and the
 * toolbar's navigation runs without queueing behind the agent; a CDP
 * connection that drops is a browser gone. Its display socket (attachDisplay)
 * is relayed to the display's stream server, held with what its client sent
 * until that server answers. A check or launch that times out finds the
 * browser busy — a heavy page, or the agent's own commands ahead in
 * agent-browser's queue — not gone, and is left alone: only an outright
 * failure, or a minute without an answer, stops it (its daemon, its Chromium
 * and the profile's singleton locks) and launches it again, since killing a
 * busy browser loses the user's page.
 */
export function createBrowserPreview(deps: {
  run: BrowserCommand;
  profileDir: string;
  socketDir: string;
  available?: () => boolean;
  healthCheckMs?: number;
  unresponsiveRestartMs?: number;
  retryDelaysMs?: number[];
  stopBrowser?: () => Promise<void>;
  displayStreamUrl?: string;
  watch?: WatchPages;
  log: (msg: string) => void;
}): BrowserPreview {
  const commands = createCommandQueue(deps.run);
  const exec = commands.run;
  const stopBrowser =
    deps.stopBrowser ??
    (async () => {
      await deps
        .run(["close"])
        .catch((err: Error) => deps.log(`close: ${err.message}`));
      await killPreviewProcesses(deps.profileDir, deps.socketDir);
    });
  const available = deps.available ?? (() => displayAvailable());
  const unresponsiveRestartMs =
    deps.unresponsiveRestartMs ?? UNRESPONSIVE_RESTART_MS;
  const retryDelays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  const displayStreamUrl = deps.displayStreamUrl ?? DISPLAY_STREAM_URL;
  const watch = deps.watch ?? watchPages;

  const viewers = new Set<WebSocket>();
  let state: BrowserState = "starting";
  let failure: string | null = null;
  let browserUp = false;
  let failedLaunches = 0;
  let failedChecks = 0;
  let page: PageWatch | null = null;
  let pendingNavigation: string | null = null;
  let lastAnswerAt = Date.now();
  let generation = 0;

  let dirty = false;
  let reconciling = false;
  let checking = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
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
    for (const client of viewers) sendJson(client, msg);
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

  function browserGone(reason: string) {
    page?.close();
    page = null;
    if (!browserUp) return;
    deps.log(`browser lost: ${reason}`);
    browserUp = false;
    generation++;
  }

  async function openPage(gen: number): Promise<PageWatch> {
    const url = (await exec(CDP_URL)).trim();
    let opened: PageWatch | null = null;
    opened = await watch({
      url,
      onState: (s) => {
        if (opened && page === opened) broadcast({ type: "page", ...s });
      },
      onClose: () => {
        if (!opened || page !== opened || gen !== generation) return;
        browserGone("browser closed");
        schedule();
      },
      log: deps.log,
    });
    return opened;
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

  async function ensureBrowser(): Promise<boolean> {
    if (browserUp) return true;
    setState("starting");
    const gen = generation;
    try {
      await timed("launch", () => exec(LAUNCH));
      const opened = await timed("watch", () => openPage(gen));
      if (gen !== generation) {
        opened.close();
        dirty = true;
        return false;
      }
      page?.close();
      page = opened;
      browserUp = true;
      const current = opened.state();
      if (current) broadcast({ type: "page", ...current });
      failedLaunches = 0;
      return true;
    } catch (err) {
      if (gen !== generation) {
        dirty = true;
        return false;
      }
      failedLaunches++;
      const message = (err as Error).message.split("\n")[0] ?? "";
      deps.log(`launch failed (${failedLaunches}): ${message}`);
      if (failedLaunches % 2 === 0 && !timedOut(err as Error))
        await stopBrowser();
      if (failedLaunches >= 3)
        setState("failed", `The browser did not start: ${message}`);
      scheduleRetry();
      return false;
    }
  }

  async function reconcile(): Promise<void> {
    reconciling = true;
    try {
      while (dirty && !closed) {
        dirty = false;
        if (viewers.size === 0) {
          browserUp = false;
          continue;
        }
        if (!(await ensureBrowser())) continue;
        if (pendingNavigation && page) {
          const url = pendingNavigation;
          pendingNavigation = null;
          await page
            .navigate(url)
            .catch((err: Error) => deps.log(`navigate: ${err.message}`));
        }
        setState("ready");
      }
    } finally {
      reconciling = false;
    }
  }

  async function healthCheck() {
    if (!browserUp || !page || reconciling || checking || viewers.size === 0)
      return;
    let busy = false;
    checking = true;
    const answered = await page
      .ping(CHECK_TIMEOUT_MS)
      .then(
        () => true,
        (err: Error) => {
          busy = timedOut(err);
          return false;
        },
      )
      .finally(() => {
        checking = false;
      });
    if (!answered) {
      const silentFor = Date.now() - lastAnswerAt;
      if (silentFor >= unresponsiveRestartMs) {
        deps.log(`browser unresponsive for ${silentFor}ms, restarting it`);
        failedChecks = 0;
        await restart();
      } else if (!busy && ++failedChecks >= BROWSER_GONE_AFTER_CHECKS) {
        failedChecks = 0;
        browserGone("not answering");
        schedule();
      }
      return;
    }
    failedChecks = 0;
    lastAnswerAt = Date.now();
  }

  async function restart(clearData = false) {
    browserGone(clearData ? "clearing data" : "restart");
    browserUp = false;
    generation++;
    setState("starting");
    await timed("stop", stopBrowser);
    if (clearData)
      await rm(deps.profileDir, { recursive: true, force: true }).catch(
        (err: Error) => deps.log(`clear data: ${err.message}`),
      );
    failedLaunches = 0;
    lastAnswerAt = Date.now();
    schedule();
  }

  async function control(client: WebSocket, msg: PreviewControl) {
    if (msg.type === "navigate") {
      const url = previewUrl(msg.url);
      if (!url)
        return sendJson(client, {
          type: "preview_error",
          message: "Only http and https addresses open",
        });
      if (!browserUp || !page) {
        pendingNavigation = url;
        return schedule();
      }
      await page.navigate(url);
    } else if (
      msg.type === "reload" ||
      msg.type === "back" ||
      msg.type === "forward" ||
      msg.type === "stop"
    ) {
      if (browserUp && page) await page[msg.type]();
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
  }

  function stopTimers() {
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = null;
  }

  function refuseUnavailable(client: WebSocket): boolean {
    if (available()) return false;
    sendJson(client, { type: "preview_error", message: DISPLAY_UNAVAILABLE });
    client.close(1011, "display unavailable");
    return true;
  }

  function attachDisplay(client: WebSocket) {
    if (refuseUnavailable(client)) return;
    let stream: WebSocket | null = null;
    const pending: [Buffer, boolean][] = [];
    let pendingBytes = 0;
    const startedAt = Date.now();
    client.on("message", (data: Buffer, isBinary: boolean) => {
      if (stream?.readyState === WebSocket.OPEN)
        return stream.send(data, { binary: isBinary });
      pendingBytes += data.byteLength;
      if (pendingBytes > DISPLAY_PENDING_MAX_BYTES)
        return client.close(1013, "display not ready");
      pending.push([data, isBinary]);
    });
    client.on("close", () => {
      stream?.close();
      stream = null;
    });
    const dial = () => {
      if (client.readyState !== WebSocket.OPEN) return;
      const s = new WebSocket(displayStreamUrl, { perMessageDeflate: false });
      let opened = false;
      stream = s;
      s.on("open", () => {
        opened = true;
        for (const [d, b] of pending.splice(0)) s.send(d, { binary: b });
        pendingBytes = 0;
      });
      s.on("message", (d: Buffer, isBinary: boolean) => {
        if (client.readyState === WebSocket.OPEN)
          client.send(d, { binary: isBinary });
      });
      s.on("error", (err) => {
        if (!opened && Date.now() - startedAt < DISPLAY_WAIT_MS) return;
        deps.log(`display: ${err.message}`);
      });
      s.on("close", (code, reason) => {
        if (stream !== s) return;
        stream = null;
        if (!opened && Date.now() - startedAt < DISPLAY_WAIT_MS) {
          setTimeout(dial, DISPLAY_RETRY_MS).unref?.();
          return;
        }
        if (client.readyState === WebSocket.OPEN)
          client.close(
            code >= 3000 && code < 5000 ? code : 1011,
            reason.toString() || "display closed",
          );
      });
    };
    dial();
  }

  function attach(client: WebSocket) {
    if (refuseUnavailable(client)) return;
    viewers.add(client);
    if (viewers.size === 1) lastAnswerAt = Date.now();
    startTimers();
    sendJson(client, stateMessage());
    const current = page?.state();
    if (current) sendJson(client, { type: "page", ...current });
    schedule();

    client.on("message", (data: Buffer, isBinary: boolean) => {
      const msg = isBinary ? null : parseControl(data.toString());
      if (msg)
        timed(msg.type, () => control(client, msg)).catch((err: Error) =>
          sendJson(client, { type: "preview_error", message: err.message }),
        );
    });
    client.on("close", () => {
      viewers.delete(client);
      if (viewers.size > 0) return;
      stopTimers();
      browserUp = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    });
  }

  return {
    attach,
    attachDisplay,
    viewers: () => viewers.size,
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopTimers();
      page?.close();
      for (const c of viewers) c.close(1001, "runtime shutting down");
    },
  };
}
