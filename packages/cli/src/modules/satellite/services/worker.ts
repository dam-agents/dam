import type {
  SatelliteManifest,
  SatelliteTool,
  WorkItem,
} from "api-server-api";
import type { SatelliteBackend } from "./backend.js";

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
        }
      | { status: "needs-approval"; reason: string };
  }): Promise<void>;
  drain(satellite: string): Promise<void>;
}

export interface WorkerLog {
  line(text: string): void;
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
}) {
  const { name, backend, transport, log } = deps;
  const running = new Set<number>();
  const reporting = new Set<Promise<void>>();
  let draining = false;
  let stopped = false;

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
    void backend
      .call({
        sequence: item.sequence,
        tool: item.tool,
        args: item.args,
        approved: item.approved,
      })
      .then((outcome) => {
        report({ satellite: name, sequence: item.sequence, outcome });
      })
      .catch((err: unknown) => {
        report({
          satellite: name,
          sequence: item.sequence,
          outcome: {
            status: "interrupted",
            reason: String(err).slice(0, 280),
          },
        });
      })
      .finally(() => running.delete(item.sequence));
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
          try {
            const items = await transport.claim({
              satellite: name,
              capacity: Math.max(capacity, 0),
              waitMs: CLAIM_WAIT_MS,
            });
            let started = 0;
            for (const item of items)
              if (item.kind === "cancel") {
                log.line(`CANCEL ${name}#${item.sequence}`);
                backend.cancel(item.sequence);
              } else {
                startJob(item);
                started++;
              }
            if (started === 0 && !stopped && !draining)
              await new Promise((r) => setTimeout(r, IDLE_MS));
          } catch (err) {
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
