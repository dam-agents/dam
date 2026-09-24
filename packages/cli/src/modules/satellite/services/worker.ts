import type {
  SatelliteManifest,
  SatelliteTool,
  WorkItem,
} from "api-server-api";
import type { CallOutcome, SatelliteBackend } from "./backend.js";

const HEARTBEAT_MS = 20_000;
const CLAIM_WAIT_MS = 25_000;
const IDLE_MS = 1000;

export interface WorkerTransport {
  connect(manifest: SatelliteManifest, host: string): Promise<void>;
  claim(input: {
    satellite: string;
    capacity: number;
    waitMs: number;
  }): Promise<WorkItem[]>;
  heartbeat(input: { satellite: string; running: number[] }): Promise<void>;
  report(input: {
    satellite: string;
    sequence: number;
    outcome:
      | {
          status: "done";
          isError: boolean;
          exitCode: number | null;
          output: string;
          truncated: boolean;
        }
      | { status: "cancelled"; output?: string; truncated?: boolean }
      | {
          status: "interrupted";
          reason: string;
          output?: string;
          truncated?: boolean;
        };
  }): Promise<void>;
  drain(satellite: string): Promise<void>;
}

export class SatelliteRemovedError extends Error {
  constructor(satellite: string) {
    super(`${satellite} is no longer registered on the platform`);
    this.name = "SatelliteRemovedError";
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

function reportable(
  outcome: CallOutcome,
): Parameters<WorkerTransport["report"]>[0]["outcome"] {
  if (outcome.status !== "done") return outcome;
  return {
    status: "done",
    isError: outcome.isError,
    exitCode: outcome.exitCode,
    output: outcome.output,
    truncated: outcome.truncated,
  };
}

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
}) {
  const { name, backend, transport, log } = deps;
  const running = new Set<number>();
  const reporting = new Set<Promise<void>>();
  let draining = false;
  let stopped = false;
  const slotWaiters = new Set<() => void>();
  let cancelPoll: Promise<void> | null = null;

  const report = (input: Parameters<WorkerTransport["report"]>[0]): void => {
    const sent = transport
      .report(input)
      .catch((err: unknown) => {
        log.line(
          `could not report ${name}#${input.sequence}, leaving it to the lease: ${String(err)}`,
        );
      })
      .finally(() => reporting.delete(sent));
    reporting.add(sent);
  };

  const settleReports = async (): Promise<void> => {
    while (reporting.size > 0) await Promise.all([...reporting]);
  };

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
          satellite: name,
          sequence: item.sequence,
          outcome: reportable(outcome),
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
          satellite: name,
          sequence: item.sequence,
          outcome: { status: "interrupted", reason },
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

  function stopClaiming(err: unknown): boolean {
    if (!(err instanceof SatelliteRemovedError)) return false;
    log.line(
      `${name} was removed on the platform — no longer claiming work; start it again to register it anew`,
    );
    draining = true;
    return true;
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
      await transport.connect(manifest(backend.tools), deps.host);
      announce(`connected as "${name}"`);
      for (const line of deps.guide ?? []) log.line(line);

      const heartbeat = setInterval(() => {
        void transport
          .heartbeat({ satellite: name, running: [...running] })
          .catch((err: unknown) =>
            log.line(`heartbeat failed: ${String(err)}`),
          );
      }, HEARTBEAT_MS);

      try {
        while (!stopped) {
          if (draining) {
            if (running.size === 0) break;
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          const capacity = deps.maxConcurrent - running.size;
          if (capacity <= 0) {
            cancelPoll ??= transport
              .claim({ satellite: name, capacity: 0, waitMs: CLAIM_WAIT_MS })
              .then((items) => void handle(items))
              .catch(async (err: unknown) => {
                if (stopClaiming(err)) return;
                log.line(`claim failed, retrying: ${String(err)}`);
                await new Promise((r) => setTimeout(r, 2000));
              })
              .finally(() => {
                cancelPoll = null;
              });
            await Promise.race([cancelPoll, slotFreed()]);
            continue;
          }
          try {
            const items = await transport.claim({
              satellite: name,
              capacity,
              waitMs: CLAIM_WAIT_MS,
            });
            const started = handle(items);
            if (started === 0 && !stopped && !draining)
              await new Promise((r) => setTimeout(r, IDLE_MS));
          } catch (err) {
            if (stopClaiming(err)) continue;
            log.line(`claim failed, retrying: ${String(err)}`);
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      } finally {
        clearInterval(heartbeat);
        await settleReports();
        await backend.close().catch(() => {});
      }
    },

    async drain(): Promise<void> {
      draining = true;
      await transport.drain(name).catch(() => {});
      log.line(
        running.size === 0
          ? "draining — nothing running, exiting"
          : `draining — waiting for ${running.size} job(s); interrupt again to kill them`,
      );
    },

    async forceStop(): Promise<void> {
      stopped = true;
      backend.killAll();
      for (const sequence of running)
        await transport
          .report({
            satellite: name,
            sequence,
            outcome: {
              status: "interrupted",
              reason: "the satellite was stopped while this job was running",
            },
          })
          .catch(() => {});
      running.clear();
      await settleReports();
      await backend.close().catch(() => {});
    },
  };
}
