import { TRPCClientError } from "@trpc/client";
import type { FileWorkItem, SatelliteManifest, WorkItem } from "api-server-api";
import {
  createBackoff,
  type Backoff,
  type BackoffOptions,
} from "../../shared/backoff.js";
import type { FileOpAnswer, FileOpRequest, FileOps } from "./file-ops.js";
import {
  describeOffline,
  FenceUnsupportedError,
  SatelliteRemovedError,
  type FileWorkerTransport,
  type WorkerLog,
} from "./worker.js";

const HEARTBEAT_MS = 20_000;
const CLAIM_WAIT_MS = 25_000;
const IDLE_MS = 1000;
const SATURATED_MS = 250;
const SUMMARY_MS = 60_000;
const STOP_CLAIM_WAIT_MS = 2000;

const CREATING_OPS = new Set(["create", "mkdir", "symlink"]);
const DELETING_OPS = new Set(["unlink", "rmdir"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Counters = {
  ops: number;
  bytesRead: number;
  bytesWritten: number;
  created: number;
  renamed: number;
  deleted: number;
};

function counters(): Counters {
  return {
    ops: 0,
    bytesRead: 0,
    bytesWritten: 0,
    created: 0,
    renamed: 0,
    deleted: 0,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Why a files worker cannot serve, in the words of
 * whoever has to fix it. The manifest itself is the one refusal a worker can do
 * nothing about: a platform older than the file channel has no place for a
 * Satellite with no tools, and waiting does not grow one, so the message names the
 * upgrade instead of repeating a schema error.
 */
export function describeFilesOffline(err: unknown): string {
  const refused = refusedManifest(err);
  if (refused !== null) return refused;
  return describeOffline(err);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a connect was refused because the platform's
 * own manifest schema has no file tree in it — every version before the mount
 * requires at least one tool, so it answers a validation failure naming the
 * manifest's `tools` (or, in a later platform, `kind` or `files`). Any other
 * refusal is about this manifest's content and is the server's to explain. The
 * old-platform case is not worth retrying: waiting does not grow the schema.
 */
function refusedManifest(err: unknown): string | null {
  if (!(err instanceof TRPCClientError)) return null;
  const code = (err.data as { code?: string } | undefined)?.code;
  if (code !== "BAD_REQUEST" && code !== "PARSE_ERROR") return null;
  const issues = (err.data as { zodError?: { issues?: unknown } } | undefined)
    ?.zodError?.issues;
  const detail = JSON.stringify(issues ?? err.message);
  if (!/"(tools|kind|files)"/.test(detail)) return null;
  return `this platform does not support satellite files mounts yet — upgrade the platform (${err.message})`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The files worker: one Satellite's mount served from
 * one directory on this machine. It claims File Operations beside Jobs, runs up
 * to `maxConcurrent` of them at once, and answers each on its own request — a
 * files Satellite has no Jobs, no outcomes, no MCP server, and no per-call record
 * beyond a summary line a minute with counts and no path.
 *
 * Every operation carries the instant its Agent stops waiting, and one past it is
 * answered without touching the machine, so a change never lands after the Agent
 * was told it failed. An operation that throws is one failed operation, never a
 * stopped worker.
 */
export function createFileWorker(deps: {
  name: string;
  root: string;
  writable: boolean;
  maxConcurrent: number;
  description?: string;
  host: string;
  ops: FileOps;
  transport: FileWorkerTransport;
  log: WorkerLog;
  retry?: BackoffOptions;
  summaryMs?: number;
  guide?: string[];
}) {
  const { name, transport, log } = deps;
  const counts = counters();
  const opened = new Set<string>();
  const inFlight = new Set<string>();
  let incarnation: string | undefined;
  let connected = false;
  let everConnected = false;
  let draining = false;
  let stopped = false;
  let stopping: Promise<void> = Promise.resolve();
  let releaseStop: () => void = () => {};
  const stopSignal = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });

  const manifest = (): SatelliteManifest => ({
    name,
    kind: "files",
    ...(deps.description === undefined
      ? {}
      : { description: deps.description }),
    maxConcurrent: deps.maxConcurrent,
    tools: [],
    files: { writable: deps.writable },
  });

  function summaryLine(): void {
    if (counts.ops === 0) return;
    log.line(
      `SUMMARY ${name}: ${counts.ops} ops, ${opened.size} files opened, ` +
        `${counts.bytesRead} bytes read, ${counts.bytesWritten} bytes written, ` +
        `${counts.created} created, ${counts.renamed} renamed, ${counts.deleted} deleted`,
    );
    Object.assign(counts, counters());
    opened.clear();
  }

  function count(item: FileWorkItem, answer: FileOpAnswer): void {
    counts.ops += 1;
    if (!answer.ok) return;
    if (item.op === "read" && answer.data !== undefined) {
      counts.bytesRead += Buffer.from(answer.data, "base64").length;
      const dev = item.args?.dev;
      const ino = item.args?.ino;
      if (typeof dev === "number" && typeof ino === "number")
        opened.add(`${dev}:${ino}`);
    }
    if (item.op === "write" && item.data !== undefined)
      counts.bytesWritten += Buffer.from(item.data, "base64").length;
    if (CREATING_OPS.has(item.op)) counts.created += 1;
    if (item.op === "rename") counts.renamed += 1;
    if (DELETING_OPS.has(item.op)) counts.deleted += 1;
  }

  async function sendAnswer(
    item: FileWorkItem,
    answer: FileOpAnswer,
    at: string | undefined,
  ): Promise<void> {
    if (at === undefined) {
      log.line(
        `dropped the answer to an operation for ${item.agent?.name ?? item.agent?.id ?? "an agent"}: this worker never registered, so the platform has no registration to answer under`,
      );
      return;
    }
    if (stopped) return;
    await transport.fileResult({
      satellite: name,
      id: item.id,
      incarnation: at,
      ...answer,
    });
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: An operation the Agent will never get an answer to
   * from this machine. It was claimed while the worker was stopping, so it is
   * answered "Host is down" through the same request the answer would have taken,
   * and the Agent's own tools stop waiting at once instead of at their deadline.
   */
  function refuseClaimed(items: readonly WorkItem[]): void {
    const claimed = items.filter((item) => item.kind === "file");
    if (claimed.length === 0) return;
    log.line(
      `answered ${claimed.length} operation(s) with \"Host is down\" — this worker is stopping`,
    );
    for (const item of claimed)
      void sendAnswer(
        item,
        { ok: false, errno: "EHOSTDOWN" },
        incarnation,
      ).catch((err: unknown) => {
        log.line(`could not answer a claimed operation: ${String(err)}`);
      });
  }

  function startOperation(item: FileWorkItem): void {
    inFlight.add(item.id);
    const at = incarnation;
    const deadline = Date.now() + item.remainingMs;
    if (item.remainingMs <= 0) {
      log.line(
        `dropped an operation for ${item.agent?.name ?? item.agent?.id ?? "an agent"}: its Agent stopped waiting before it reached this machine`,
      );
      inFlight.delete(item.id);
      void sendAnswer(item, { ok: false, errno: "EIO" }, at).catch(
        (err: unknown) => {
          log.line(`could not answer an expired operation: ${String(err)}`);
        },
      );
      return;
    }
    const request: FileOpRequest = {
      op: item.op,
      deadline,
      ...(item.path === undefined ? {} : { path: item.path }),
      ...(item.args === undefined ? {} : { args: item.args }),
      ...(item.data === undefined ? {} : { data: item.data }),
    };
    void deps.ops
      .run(request)
      .catch((): FileOpAnswer => ({ ok: false, errno: "EIO" }))
      .then(async (result) => {
        count(item, result);
        await sendAnswer(item, result, at);
      })
      .catch((err: unknown) => {
        log.line(
          `could not answer an operation for ${item.agent?.name ?? item.agent?.id ?? "an agent"}: ${String(err)}`,
        );
      })
      .finally(() => {
        inFlight.delete(item.id);
      });
  }

  async function backOff(reason: string, retry: Backoff): Promise<void> {
    const delay = retry.next();
    if (!stopped)
      log.line(`${reason} — retrying in ${(delay / 1000).toFixed(1)}s`);
    await sleep(delay);
  }

  async function connect(retry: Backoff): Promise<void> {
    while (!stopped) {
      if (draining && inFlight.size === 0) return;
      try {
        const registered = await transport.connect({
          manifest: manifest(),
          host: deps.host,
          ...(incarnation === undefined ? {} : { resume: incarnation }),
        });
        if (registered?.incarnation !== undefined)
          incarnation = registered.incarnation;
      } catch (err) {
        if (err instanceof SatelliteRemovedError) {
          log.line(
            `${name} was removed on the platform — no longer claiming work; start it again to register it anew`,
          );
          draining = true;
          releaseStop();
          return;
        }
        const refused = refusedManifest(err);
        if (refused !== null) {
          stopped = true;
          releaseStop();
          throw new Error(refused);
        }
        connected = false;
        await backOff(describeFilesOffline(err), retry);
        continue;
      }
      connected = true;
      retry.reset();
      if (everConnected) {
        log.line(`reconnected as "${name}"`);
        return;
      }
      everConnected = true;
      log.line(`connected as "${name}" — files:`);
      log.line(
        `  ${deps.root} — ${deps.writable ? "read and write" : "read-only"}`,
      );
      for (const line of deps.guide ?? []) log.line(line);
      return;
    }
  }

  async function tellPlatformItIsDraining(): Promise<void> {
    try {
      await transport.drain({
        satellite: name,
        ...(incarnation === undefined ? {} : { incarnation }),
      });
    } catch (err) {
      log.line(
        err instanceof FenceUnsupportedError
          ? `could not tell the platform this machine is draining: it does not enforce registrations — ${name} goes offline on its own window instead`
          : `could not tell the platform this machine is draining: ${String(err)}`,
      );
    }
  }

  return {
    get inFlightCount(): number {
      return inFlight.size;
    },

    summary: summaryLine,

    async start(): Promise<void> {
      const retry = createBackoff(deps.retry);
      const heartbeat = setInterval(() => {
        if (!connected || stopped) return;
        void transport
          .heartbeat({
            satellite: name,
            running: [],
            ...(incarnation === undefined ? {} : { incarnation }),
          })
          .catch((err: unknown) => {
            if (!stopped) log.line(`heartbeat failed: ${String(err)}`);
          });
      }, HEARTBEAT_MS);
      const summary = setInterval(summaryLine, deps.summaryMs ?? SUMMARY_MS);
      heartbeat.unref?.();
      summary.unref?.();

      try {
        while (!stopped) {
          if (draining) {
            if (inFlight.size === 0) break;
            await sleep(SATURATED_MS);
            continue;
          }
          if (!connected) {
            await connect(retry);
            continue;
          }
          const capacity = deps.maxConcurrent - inFlight.size;
          if (capacity <= 0) {
            await sleep(SATURATED_MS);
            continue;
          }
          let items: WorkItem[];
          try {
            items = await Promise.race([
              transport.claim({
                satellite: name,
                capacity,
                waitMs: CLAIM_WAIT_MS,
                ...(incarnation === undefined ? {} : { incarnation }),
              }),
              stopSignal.then(() =>
                sleep(STOP_CLAIM_WAIT_MS).then((): WorkItem[] => []),
              ),
            ]);
            retry.reset();
          } catch (err) {
            if (err instanceof SatelliteRemovedError) {
              log.line(
                `${name} was removed on the platform — no longer claiming work; start it again to register it anew`,
              );
              draining = true;
              continue;
            }
            connected = false;
            await backOff(describeFilesOffline(err), retry);
            continue;
          }
          if (stopped || draining) {
            refuseClaimed(items);
            continue;
          }
          let started = 0;
          for (const item of items)
            if (item.kind === "file") {
              startOperation(item);
              started += 1;
            }
          if (started === 0 && !stopped && !draining) await sleep(IDLE_MS);
        }
      } finally {
        clearInterval(heartbeat);
        clearInterval(summary);
        await stopping;
        summaryLine();
      }
    },

    async drain(): Promise<void> {
      draining = true;
      releaseStop();
      log.line(
        inFlight.size === 0
          ? "draining — nothing in flight, exiting"
          : `draining — waiting for ${inFlight.size} operation(s); interrupt again to stop them`,
      );
      stopping = tellPlatformItIsDraining();
      await stopping;
    },

    forceStop(): void {
      stopped = true;
      draining = true;
      releaseStop();
      inFlight.clear();
    },
  };
}

export type FileWorker = ReturnType<typeof createFileWorker>;
