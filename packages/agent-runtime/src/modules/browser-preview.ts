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
import {
  type BrowserAction,
  type BrowserDomainError,
  type BrowserService,
  type BrowserSnapshot,
  type BrowserState,
  err,
  ok,
  type PageState,
  type Result,
} from "agent-runtime-api";
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

export function browserOffered(env = process.env): boolean {
  return env.PLATFORM_REQUIRE_CONNECTION_ADDRESS === "true";
}

export type BrowserCommand = (args: string[]) => Promise<string>;

export interface BrowserPreview extends BrowserService {
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
 * defaults — up for every open panel. A panel's watch (its subscription over
 * the runtime's tRPC) keeps it launched (`get url` starts agent-browser's daemon and browser when
 * none runs) and watches its pages over CDP (browser-cdp), so the page's
 * address, title, loading and history reach the panel as they change and the
 * toolbar's actions run without queueing behind the agent; a CDP
 * connection that drops is a browser gone. Its display socket (attachDisplay)
 * is relayed to the display's stream server, held with what its client sent
 * until that server answers. A check or launch that times out finds the
 * browser busy — a heavy page, or the agent's own commands ahead in
 * agent-browser's queue — not gone, and is left alone: only an outright
 * failure, or a minute without an answer, stops it (its daemon, its Chromium
 * and the profile's singleton locks) and launches it again, since killing a
 * busy browser loses the user's page. Everything is refused, before anything
 * starts, on an agent that does not require named connections — the panel's
 * user would otherwise browse with the agent's injected credentials — and on
 * an image without the display stack.
 */
export function createBrowserPreview(deps: {
  run: BrowserCommand;
  profileDir: string;
  socketDir: string;
  available?: () => boolean;
  offered?: () => boolean;
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
  const offered = deps.offered ?? (() => browserOffered());
  const unresponsiveRestartMs =
    deps.unresponsiveRestartMs ?? UNRESPONSIVE_RESTART_MS;
  const retryDelays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  const displayStreamUrl = deps.displayStreamUrl ?? DISPLAY_STREAM_URL;
  const watch = deps.watch ?? watchPages;

  const viewers = new Set<(snapshot: BrowserSnapshot) => void>();
  let state: BrowserState = "starting";
  let failure: string | null = null;
  let shown: PageState | null = null;
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

  const snapshot = (): BrowserSnapshot => ({
    state,
    message: failure,
    page: shown,
  });

  function notify() {
    const current = snapshot();
    for (const viewer of viewers) viewer(current);
  }

  function setState(next: BrowserState, message: string | null = null) {
    if (state === next && failure === message) return;
    state = next;
    failure = message;
    deps.log(`browser ${next}${message ? `: ${message}` : ""}`);
    notify();
  }

  function showPage(next: PageState | null) {
    if (!next) return;
    shown = next;
    notify();
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
        if (opened && page === opened) showPage(s);
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
      showPage(opened.state());
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

  const refusal = (): BrowserDomainError | null =>
    !offered()
      ? { kind: "NotOffered" }
      : !available()
        ? { kind: "NoDisplay" }
        : null;

  const attempt = async (
    label: string,
    step: () => Promise<unknown>,
  ): Promise<Result<void, BrowserDomainError>> => {
    try {
      await timed(label, step);
      return ok(undefined);
    } catch (e) {
      return err({ kind: "Failed", detail: (e as Error).message });
    }
  };

  async function navigate(
    raw: string,
  ): Promise<Result<void, BrowserDomainError>> {
    const refused = refusal();
    if (refused) return err(refused);
    const url = previewUrl(raw);
    if (!url) return err({ kind: "NotWebAddress" });
    if (!browserUp || !page) {
      pendingNavigation = url;
      schedule();
      return ok(undefined);
    }
    const target = page;
    return attempt("navigate", () => target.navigate(url));
  }

  async function act(
    action: BrowserAction,
  ): Promise<Result<void, BrowserDomainError>> {
    const refused = refusal();
    if (refused) return err(refused);
    if (action === "restart" || action === "clearData")
      return attempt(action, () => restart(action === "clearData"));
    if (!browserUp || !page) return ok(undefined);
    const target = page;
    return attempt(action, () => target[action]());
  }

  function addViewer(viewer: (snapshot: BrowserSnapshot) => void) {
    viewers.add(viewer);
    if (viewers.size === 1) lastAnswerAt = Date.now();
    startTimers();
    schedule();
  }

  function removeViewer(viewer: (snapshot: BrowserSnapshot) => void) {
    viewers.delete(viewer);
    if (viewers.size > 0) return;
    stopTimers();
    browserUp = false;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function watchBrowser(
    signal?: AbortSignal,
  ): Result<AsyncIterable<BrowserSnapshot>, BrowserDomainError> {
    const refused = refusal();
    if (refused) return err(refused);
    async function* stream(): AsyncGenerator<BrowserSnapshot> {
      let latest: BrowserSnapshot | null = snapshot();
      let wake: (() => void) | null = null;
      const viewer = (next: BrowserSnapshot) => {
        latest = next;
        wake?.();
      };
      const onAbort = () => wake?.();
      signal?.addEventListener("abort", onAbort);
      addViewer(viewer);
      try {
        while (!signal?.aborted && !closed) {
          if (!latest) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
            continue;
          }
          const next: BrowserSnapshot = latest;
          latest = null;
          yield next;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        removeViewer(viewer);
      }
    }
    return ok(stream());
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
    const refused = refusal();
    if (!refused) return false;
    client.close(
      1011,
      refused.kind === "NotOffered"
        ? "browser not offered"
        : "display unavailable",
    );
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

  return {
    watch: watchBrowser,
    navigate,
    act,
    attachDisplay,
    viewers: () => viewers.size,
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopTimers();
      page?.close();
      notify();
    },
  };
}
