import { execFile, type ChildProcess } from "node:child_process";
import { matchCommand, type WorkItem } from "api-server-api";
import type { LocalCommand, LocalManifest } from "../domain/manifest.js";

export const OUTPUT_CAP_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 20_000;
const CLAIM_WAIT_MS = 25_000;
const IDLE_MS = 1000;

export interface WorkerTransport {
  connect(manifest: LocalManifest["pushed"], host: string): Promise<void>;
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
      | { status: "done"; exitCode: number; output: string; truncated: boolean }
      | { status: "cancelled" }
      | { status: "interrupted"; reason: string };
  }): Promise<void>;
  drain(satellite: string): Promise<void>;
}

export interface WorkerLog {
  line(text: string): void;
}

interface RunningJob {
  child: ChildProcess;
  timer: NodeJS.Timeout | null;
}

function resolveCommand(
  manifest: LocalManifest,
  cmd: string[],
): LocalCommand | string {
  const matched = matchCommand(
    manifest.commands.map((c) => c.parsed),
    cmd,
  );
  if (!matched.ok) return matched.reason;
  return manifest.commands[matched.index]!;
}

export function createWorker(deps: {
  manifest: LocalManifest;
  transport: WorkerTransport;
  log: WorkerLog;
  host: string;
}) {
  const running = new Map<number, RunningJob>();
  const name = deps.manifest.pushed.name;
  let draining = false;
  let stopped = false;

  function spawn(item: WorkItem): void {
    const command = resolveCommand(deps.manifest, item.cmd);
    if (typeof command === "string") {
      deps.log.line(`REFUSED ${name}#${item.sequence}: ${command}`);
      void deps.transport.report({
        satellite: name,
        sequence: item.sequence,
        outcome: {
          status: "interrupted",
          reason: `refused locally: ${command}`,
        },
      });
      return;
    }

    const [program, ...args] = item.cmd;
    const cwd = command.cwd ?? deps.manifest.cwd;
    const timeoutMs = command.timeoutMs ?? deps.manifest.timeoutMs;
    const startedAt = Date.now();
    deps.log.line(`START ${name}#${item.sequence}: ${item.cmd.join(" ")}`);

    const child = execFile(
      program!,
      args,
      {
        cwd,
        maxBuffer: OUTPUT_CAP_BYTES,
        shell: false,
      },
      (error, stdout, stderr) => {
        const entry = running.get(item.sequence);
        if (entry?.timer) clearTimeout(entry.timer);
        running.delete(item.sequence);
        const output = `${stdout}${stderr}`;
        const truncated = output.length >= OUTPUT_CAP_BYTES;
        const exitCode =
          typeof error?.code === "number" ? error.code : error ? 1 : 0;
        deps.log.line(
          `EXIT ${name}#${item.sequence}: code ${exitCode} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
        );
        void deps.transport.report({
          satellite: name,
          sequence: item.sequence,
          outcome: {
            status: "done",
            exitCode,
            output: output.slice(0, OUTPUT_CAP_BYTES),
            truncated,
          },
        });
      },
    );

    const timer =
      timeoutMs === undefined
        ? null
        : setTimeout(() => {
            deps.log.line(`TIMEOUT ${name}#${item.sequence}`);
            child.kill("SIGKILL");
          }, timeoutMs);
    running.set(item.sequence, { child, timer });
  }

  function cancel(sequence: number): void {
    const entry = running.get(sequence);
    if (entry === undefined) return;
    deps.log.line(`CANCEL ${name}#${sequence}`);
    entry.child.kill("SIGTERM");
  }

  return {
    get runningCount(): number {
      return running.size;
    },

    async start(): Promise<void> {
      await deps.transport.connect(deps.manifest.pushed, deps.host);
      deps.log.line(`connected as "${name}" — permitted commands:`);
      for (const command of deps.manifest.commands)
        deps.log.line(
          `  ${command.run}${command.approval === "always" ? "   [needs approval]" : ""}`,
        );

      const heartbeat = setInterval(() => {
        void deps.transport
          .heartbeat({ satellite: name, running: [...running.keys()] })
          .catch((err: unknown) =>
            deps.log.line(`heartbeat failed: ${String(err)}`),
          );
      }, HEARTBEAT_MS);

      try {
        while (!stopped) {
          if (draining) {
            if (running.size === 0) break;
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          const capacity = deps.manifest.pushed.maxConcurrent - running.size;
          try {
            const items = await deps.transport.claim({
              satellite: name,
              capacity: Math.max(capacity, 0),
              waitMs: CLAIM_WAIT_MS,
            });
            for (const item of items)
              if (item.kind === "cancel") cancel(item.sequence);
              else spawn(item);
            if (items.length === 0 && !stopped && !draining)
              await new Promise((r) => setTimeout(r, IDLE_MS));
          } catch (err) {
            deps.log.line(`claim failed, retrying: ${String(err)}`);
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      } finally {
        clearInterval(heartbeat);
      }
    },

    async drain(): Promise<void> {
      draining = true;
      await deps.transport.drain(name).catch(() => {});
      deps.log.line(
        running.size === 0
          ? "draining — nothing running, exiting"
          : `draining — waiting for ${running.size} job(s); interrupt again to kill them`,
      );
    },

    async forceStop(): Promise<void> {
      stopped = true;
      for (const [sequence, entry] of running) {
        entry.child.kill("SIGKILL");
        if (entry.timer) clearTimeout(entry.timer);
        await deps.transport
          .report({
            satellite: name,
            sequence,
            outcome: {
              status: "interrupted",
              reason: "the satellite was stopped while this job was running",
            },
          })
          .catch(() => {});
      }
      running.clear();
    },
  };
}
