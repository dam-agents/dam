import type {
  SatelliteImage,
  SatelliteManifest,
  SatelliteTool,
  WorkItem,
} from "api-server-api";
import { AuthRequiredAtTransportError } from "../../shared/trpc/trpc-client.js";
import {
  createBackoff,
  type Backoff,
  type BackoffOptions,
} from "../domain/backoff.js";
import type { CallOutcome, SatelliteBackend } from "./backend.js";

const HEARTBEAT_MS = 20_000;
const CLAIM_WAIT_MS = 25_000;
const IDLE_MS = 1000;
const PAUSE_STEP_MS = 250;
const MAX_UNSENT = 16;
const CRASH_LOOP_MS = 10_000;
const DRAIN_GRACE_MS = 15_000;
const FORCE_REPORT_MS = 2_000;

type ReportOutcome =
  | {
      status: "done";
      isError: boolean;
      exitCode: number | null;
      output: string;
      images: SatelliteImage[];
      truncated: boolean;
    }
  | { status: "cancelled"; output?: string; truncated?: boolean }
  | {
      status: "interrupted";
      reason: string;
      output?: string;
      truncated?: boolean;
    };

export interface WorkerTransport {
  connect(input: {
    manifest: SatelliteManifest;
    host: string;
    resume?: string;
  }): Promise<{ incarnation: string } | undefined>;
  claim(input: {
    satellite: string;
    capacity: number;
    waitMs: number;
  }): Promise<WorkItem[]>;
  heartbeat(input: { satellite: string; running: number[] }): Promise<void>;
  report(input: {
    satellite: string;
    sequence: number;
    incarnation?: string;
    outcome: ReportOutcome;
  }): Promise<void>;
  drain(satellite: string): Promise<void>;
}

export class SatelliteRemovedError extends Error {
  constructor(satellite: string) {
    super(`${satellite} is no longer registered on the platform`);
    this.name = "SatelliteRemovedError";
  }
}

class SatelliteStoppedError extends Error {
  constructor() {
    super("the satellite is stopping");
    this.name = "SatelliteStoppedError";
  }
}

export interface WorkerLog {
  line(text: string): void;
}

function agentLabel(agent: WorkItem["agent"]): string {
  if (agent === undefined) return "an agent";
  return agent.name === null ? agent.id : `${agent.name} (${agent.id})`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Why the worker is not connected, in the words of
 * whoever has to fix it. A missing or expired sign-in keeps retrying like any
 * other failure, because a service is fixed by minting the key, not by waiting,
 * but it says what ends it instead of repeating a class name. The transport
 * wraps its own errors in the tRPC client's, so the cause chain is read.
 */
export function describeOffline(err: unknown): string {
  for (let at: unknown = err; at instanceof Error; at = at.cause) {
    if (at instanceof AuthRequiredAtTransportError)
      return `not signed in (${at.message}) — run \`dam login\`, or set DAM_TOKEN to a key with the satellites:serve scope`;
  }
  return `offline: ${String(err)}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one line the worker's log says about how a
 * call ended. The log is the interface for whoever is at the machine, so each
 * way a call can end reads differently: a command that ran and exited, one
 * that failed, one the machine refused to run at all, one cancelled on the
 * platform's request, and one whose outcome is unknown.
 */
export function describeOutcome(
  sequence: number,
  outcome: CallOutcome,
  startedAt: number,
): string {
  const elapsed = seconds(Date.now() - startedAt);
  switch (outcome.status) {
    case "done":
      if (outcome.blocked === true)
        return `BLOCKED #${sequence}: ${firstLine(outcome.output)}`;
      if (!outcome.isError)
        return `DONE #${sequence} in ${elapsed}${outcome.exitCode === null ? "" : `: exit ${outcome.exitCode}`}`;
      return `FAILED #${sequence} in ${elapsed}: ${outcome.exitCode === null ? firstLine(outcome.output) || "the tool returned an error" : `exit ${outcome.exitCode}`}`;
    case "cancelled":
      return `CANCELLED #${sequence} after ${elapsed}`;
    case "interrupted":
      return `INTERRUPTED #${sequence} after ${elapsed}: ${outcome.reason}`;
  }
}

function reportable(outcome: CallOutcome): ReportOutcome {
  if (outcome.status !== "done") return outcome;
  return {
    status: "done",
    isError: outcome.isError,
    exitCode: outcome.exitCode,
    output: outcome.output,
    images: outcome.images ?? [],
    truncated: outcome.truncated,
  };
}

type Unsent = { outcome: ReportOutcome; incarnation: string | undefined };

/**
 * UNIT_BOUNDARY_DESCRIPTION: The loop between the platform queue and whatever
 * this machine exposes. It knows nothing about commands — a work item is an MCP
 * tool call, and the backend decides what that means and whether it may run.
 */
export function createWorker(deps: {
  name: string;
  maxConcurrent: number;
  description?: string;
  backend: SatelliteBackend;
  transport: WorkerTransport;
  log: WorkerLog;
  host: string;
  guide?: string[];
  retry?: BackoffOptions;
}) {
  const { name, backend, transport, log } = deps;
  const running = new Set<number>();
  const reporting = new Set<Promise<void>>();
  const unsent = new Map<number, Unsent>();
  let draining = false;
  let stopped = false;
  let connected = false;
  let everConnected = false;
  let incarnation: string | undefined;
  const slotWaiters = new Set<() => void>();
  let cancelPoll: Promise<void> | null = null;
  let abandon: () => void = () => {};
  const abandoned = new Promise<void>((resolve) => {
    abandon = resolve;
  });

  /**
   * UNIT_BOUNDARY_DESCRIPTION: A call the shutdown stops waiting for. A worker
   * asked to stop cannot sit on a request that never answers — the supervisor
   * kills it instead of getting a clean stop — so every platform call, and the
   * MCP server's own readiness, is raced against the stop. What is still open
   * is closed by the process exit.
   */
  async function guarded<T>(work: Promise<T>): Promise<T> {
    work.catch(() => {});
    return Promise.race([
      work,
      abandoned.then(() => {
        throw new SatelliteStoppedError();
      }),
    ]);
  }

  const report = (input: {
    sequence: number;
    outcome: ReportOutcome;
    at: string | undefined;
  }): void => {
    const sent = guarded(
      transport.report({
        satellite: name,
        sequence: input.sequence,
        ...(input.at === undefined ? {} : { incarnation: input.at }),
        outcome: input.outcome,
      }),
    )
      .catch((err: unknown) => {
        if (stopped || err instanceof SatelliteStoppedError) return;
        if (unsent.size >= MAX_UNSENT)
          unsent.delete(unsent.keys().next().value as number);
        unsent.set(input.sequence, {
          outcome: input.outcome,
          incarnation: input.at,
        });
        log.line(
          `could not report ${name}#${input.sequence} yet, keeping it for the next attempt: ${String(err)}`,
        );
      })
      .finally(() => reporting.delete(sent));
    reporting.add(sent);
  };

  const settleReports = async (): Promise<void> => {
    while (reporting.size > 0) await Promise.all([...reporting]);
  };

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Outcomes that never reached the platform, sent
   * again before more work is taken. A Job's lease runs out a minute after its
   * last heartbeat and the sweep then reports the outcome as unknown, so an
   * outage shorter than that is a result the Agent would otherwise never see.
   * An outcome is replayed only to the registration it was claimed under: a
   * name can be registered again from another machine, whose Job sequence
   * starts over, and settling its #1 with this machine's #1 would be wrong.
   */
  async function flushUnsent(): Promise<void> {
    for (const [sequence, entry] of [...unsent]) {
      if (entry.incarnation !== incarnation) {
        unsent.delete(sequence);
        log.line(
          `dropping the outcome of ${name}#${sequence}: the platform holds a different registration of ${name}`,
        );
        continue;
      }
      try {
        await guarded(
          transport.report({
            satellite: name,
            sequence,
            ...(incarnation === undefined ? {} : { incarnation }),
            outcome: entry.outcome,
          }),
        );
        unsent.delete(sequence);
      } catch (err) {
        if (err instanceof SatelliteStoppedError) return;
      }
    }
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Makes sure the MCP server behind this machine is
   * running, and says whether it had to be started again. A server that keeps
   * exiting soon after it starts is waited out on its own backoff, so a crash
   * loop does not restart it on every pass.
   */
  async function ensureLocal(
    crashRetry: Backoff,
  ): Promise<{ restarted: boolean }> {
    const { restarted, livedMs } = await guarded(backend.ensureReady());
    if (!restarted) return { restarted: false };
    log.line("restarted what this machine serves — the MCP server had exited");
    if (livedMs !== undefined && livedMs < CRASH_LOOP_MS && !stopped)
      await backOff(
        `the MCP server exited ${seconds(livedMs)} after it started`,
        crashRetry,
      );
    else crashRetry.reset();
    return { restarted: true };
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Registers this machine again, retrying until it
   * works. Re-registering is what the platform calls a connect: identity is the
   * name, so the same name keeps the same Satellite, its Grants and its Job
   * sequence, and only the tool list is replaced. The registration this worker
   * already served is named, so a Satellite that was removed, or registered
   * again from another machine, is not taken over by a worker still holding the
   * old one.
   */
  async function connect(
    retry: Backoff,
    crashRetry: Backoff,
  ): Promise<boolean> {
    for (;;) {
      if (stopped || (draining && running.size === 0)) return false;
      try {
        await ensureLocal(crashRetry);
        const registered = await guarded(
          transport.connect({
            manifest: manifest(backend.tools),
            host: deps.host,
            ...(incarnation === undefined ? {} : { resume: incarnation }),
          }),
        );
        incarnation = registered?.incarnation;
      } catch (err) {
        if (stopped || err instanceof SatelliteStoppedError) return false;
        if (err instanceof SatelliteRemovedError) return stopClaiming(err);
        connected = false;
        await backOff(describeOffline(err), retry);
        continue;
      }
      connected = true;
      if (!everConnected) {
        everConnected = true;
        announce(`connected as "${name}"`);
        for (const line of deps.guide ?? []) log.line(line);
      } else {
        log.line(`reconnected as "${name}"`);
      }
      await flushUnsent();
      return true;
    }
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Whether this machine may take work: its own MCP
   * server is running, and the platform holds the tool list it offers right
   * now. A server that had to be started again is registered before any claim,
   * since the platform's Snapshot would otherwise describe tools this machine
   * no longer offers, and a readiness failure retries registration rather than
   * falling through to a claim.
   */
  async function ready(retry: Backoff, crashRetry: Backoff): Promise<boolean> {
    for (;;) {
      if (stopped || (draining && running.size === 0)) return false;
      if (!connected) return connect(retry, crashRetry);
      try {
        if (!(await ensureLocal(crashRetry)).restarted) return true;
      } catch (err) {
        if (err instanceof SatelliteStoppedError) return false;
        connected = false;
        await backOff(describeOffline(err), retry);
        continue;
      }
      connected = false;
      return connect(retry, crashRetry);
    }
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: A wait that a shutdown cuts short. Draining with
   * nothing running, or a stop, ends it at once: a service asked to stop does
   * not sit out the last backoff step of a platform it cannot reach.
   */
  async function pause(ms: number): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until && !stopped && !(draining && running.size === 0))
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(PAUSE_STEP_MS, until - Date.now())),
      );
  }

  async function backOff(reason: string, retry: Backoff): Promise<void> {
    const delay = retry.next();
    if (!stopped) log.line(`${reason} — retrying in ${seconds(delay)}`);
    await pause(delay);
  }

  const manifest = (tools: SatelliteTool[]): SatelliteManifest => ({
    name,
    ...(deps.description === undefined
      ? {}
      : { description: deps.description }),
    maxConcurrent: deps.maxConcurrent,
    tools,
  });

  function startJob(item: WorkItem): void {
    running.add(item.sequence);
    const startedAt = Date.now();
    const at = incarnation;
    log.line(
      `REQUEST #${item.sequence} from ${agentLabel(item.agent)}: ${backend.describeCall(item.tool, item.args)}`,
    );
    void backend
      .call({
        sequence: item.sequence,
        tool: item.tool,
        args: item.args,
      })
      .then((outcome) => {
        log.line(describeOutcome(item.sequence, outcome, startedAt));
        report({
          sequence: item.sequence,
          outcome: reportable(outcome),
          at,
        });
      })
      .catch((err: unknown) => {
        const reason = String(err).slice(0, 280);
        log.line(
          describeOutcome(
            item.sequence,
            { status: "interrupted", reason, output: "", truncated: false },
            startedAt,
          ),
        );
        report({
          sequence: item.sequence,
          outcome: { status: "interrupted", reason },
          at,
        });
      })
      .finally(() => {
        running.delete(item.sequence);
        for (const wake of slotWaiters) wake();
        slotWaiters.clear();
      });
  }

  function slotFreed(): Promise<void> {
    return new Promise((resolve) => {
      if (running.size < deps.maxConcurrent) resolve();
      else slotWaiters.add(resolve);
    });
  }

  function handle(items: WorkItem[]): number {
    let started = 0;
    for (const item of items)
      if (item.kind === "cancel") {
        log.line(`CANCEL REQUESTED #${item.sequence}`);
        backend.cancel(item.sequence);
      } else {
        startJob(item);
        started++;
      }
    return started;
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: A Satellite that is gone stops this worker
   * rather than being registered again. Registering it would undo a removal,
   * and a machine that keeps asking for a name it no longer serves fills the
   * log with an error that never resolves. What is running finishes and the
   * process exits; a supervisor that starts it again gets a fresh registration.
   */
  function stopClaiming(err: SatelliteRemovedError): false {
    log.line(
      `${name} was removed on the platform — no longer claiming work; start it again to register it anew`,
    );
    log.line(String(err));
    draining = true;
    return false;
  }

  function announce(prefix: string): void {
    log.line(`${prefix} — tools:`);
    for (const tool of backend.tools)
      log.line(
        `  ${tool.name}${tool.title === undefined ? "" : ` — ${tool.title}`}`,
      );
  }

  return {
    get runningCount(): number {
      return running.size;
    },

    announce,

    async start(): Promise<void> {
      const retry = createBackoff(deps.retry);
      const crashRetry = createBackoff(deps.retry);

      const heartbeat = setInterval(() => {
        if (!connected || stopped) return;
        void guarded(
          transport.heartbeat({ satellite: name, running: [...running] }),
        ).catch((err: unknown) => {
          if (!stopped && !(err instanceof SatelliteStoppedError))
            log.line(`heartbeat failed: ${String(err)}`);
        });
      }, HEARTBEAT_MS);

      try {
        while (!stopped) {
          if (draining) {
            if (running.size === 0) break;
            await pause(500);
            continue;
          }
          if (!(await ready(retry, crashRetry))) break;
          if (unsent.size > 0) await flushUnsent();
          const capacity = deps.maxConcurrent - running.size;
          if (capacity <= 0) {
            cancelPoll ??= guarded(
              transport.claim({
                satellite: name,
                capacity: 0,
                waitMs: CLAIM_WAIT_MS,
              }),
            )
              .then((items) => void handle(items))
              .catch(async (err: unknown) => {
                if (stopped || err instanceof SatelliteStoppedError) return;
                if (err instanceof SatelliteRemovedError) {
                  stopClaiming(err);
                  return;
                }
                connected = false;
                await backOff(describeOffline(err), retry);
              })
              .finally(() => {
                cancelPoll = null;
              });
            await Promise.race([cancelPoll, slotFreed()]);
            continue;
          }
          try {
            const items = await guarded(
              transport.claim({
                satellite: name,
                capacity,
                waitMs: CLAIM_WAIT_MS,
              }),
            );
            retry.reset();
            const started = handle(items);
            if (started === 0 && !stopped && !draining) await pause(IDLE_MS);
          } catch (err) {
            if (stopped || err instanceof SatelliteStoppedError) break;
            if (err instanceof SatelliteRemovedError) {
              stopClaiming(err);
              continue;
            }
            connected = false;
            await backOff(describeOffline(err), retry);
          }
        }
      } finally {
        clearInterval(heartbeat);
        const grace = setTimeout(abandon, DRAIN_GRACE_MS);
        grace.unref?.();
        await settleReports();
        clearTimeout(grace);
        if (connected && !stopped) await flushUnsent().catch(() => {});
        await guarded(backend.close()).catch(() => {});
      }
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Asks to stop: claim nothing more, let what is
     * running finish and report, and stop waiting on the platform after a
     * bounded grace, which leaves room inside the supervisor's stop timeout for
     * the exit. A job longer than that is the supervisor's to bound, and the
     * platform settles it as interrupted.
     */
    async drain(): Promise<void> {
      draining = true;
      log.line(
        running.size === 0
          ? "draining — nothing running, exiting"
          : `draining — waiting for ${running.size} job(s); interrupt again to kill them`,
      );
      const grace = setTimeout(() => {
        log.line(
          `draining — no longer waiting on the platform; a job still running is settled as interrupted`,
        );
        abandon();
      }, DRAIN_GRACE_MS);
      grace.unref?.();
      if (running.size === 0) abandon();
      await guarded(transport.drain(name)).catch(() => {});
    },

    async forceStop(): Promise<void> {
      stopped = true;
      backend.killAll();
      const reports = [...running].map((sequence) =>
        transport
          .report({
            satellite: name,
            sequence,
            ...(incarnation === undefined ? {} : { incarnation }),
            outcome: {
              status: "interrupted",
              reason: "the satellite was stopped while this job was running",
            },
          })
          .catch(() => {}),
      );
      await Promise.race([
        Promise.all(reports),
        new Promise((resolve) => setTimeout(resolve, FORCE_REPORT_MS)),
      ]);
      running.clear();
      abandon();
      await backend.close().catch(() => {});
    },
  };
}
