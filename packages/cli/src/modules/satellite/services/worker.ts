import { spawn, type ChildProcess } from "node:child_process";
import { matchCommand, type WorkItem } from "api-server-api";
import type { LocalCommand, LocalManifest } from "../domain/manifest.js";

export const OUTPUT_CAP_BYTES = 1024 * 1024;

function describeTimeout(ms: number | undefined): string {
  if (ms === undefined) return "configured";
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}
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

type KillReason = "cancel" | "timeout" | "shutdown";

interface RunningJob {
  child: ChildProcess;
  timer: NodeJS.Timeout | null;
  killedAs: KillReason | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A command is spawned in its own process group, so a
 * script that starts children can be stopped whole. Signalling the direct child
 * alone leaves those children running on the user's machine with nothing left to
 * report them.
 */
function signalGroup(entry: RunningJob, signal: NodeJS.Signals): void {
  const pid = entry.child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    entry.child.kill(signal);
  }
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

  function startJob(item: WorkItem): void {
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

    let output = "";
    let truncated = false;
    const keep = (chunk: Buffer): void => {
      if (truncated) return;
      const room = OUTPUT_CAP_BYTES - output.length;
      const text = chunk.toString("utf8");
      if (text.length >= room) {
        output += text.slice(0, room);
        truncated = true;
        return;
      }
      output += text;
    };

    const child = spawn(program!, args, {
      cwd,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);

    const settle = (exitCode: number, signal: NodeJS.Signals | null): void => {
      const entry = running.get(item.sequence);
      if (entry?.timer) clearTimeout(entry.timer);
      running.delete(item.sequence);
      const killedAs = entry?.killedAs ?? null;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);

      if (killedAs !== null) {
        deps.log.line(
          `${killedAs.toUpperCase()} ${name}#${item.sequence} after ${elapsed}s`,
        );
        void deps.transport.report({
          satellite: name,
          sequence: item.sequence,
          outcome:
            killedAs === "cancel"
              ? { status: "cancelled" }
              : {
                  status: "interrupted",
                  reason:
                    killedAs === "timeout"
                      ? `stopped at its ${describeTimeout(timeoutMs)} timeout`
                      : "the satellite was stopped while this job was running",
                },
        });
        return;
      }

      deps.log.line(
        `EXIT ${name}#${item.sequence}: code ${exitCode} in ${elapsed}s`,
      );
      void deps.transport.report({
        satellite: name,
        sequence: item.sequence,
        outcome: {
          status: "done",
          exitCode,
          output,
          truncated,
        },
      });
      if (signal !== null)
        deps.log.line(`${name}#${item.sequence} ended on ${signal}`);
    };

    child.on("error", (err) => {
      running.delete(item.sequence);
      deps.log.line(`FAILED ${name}#${item.sequence}: ${err.message}`);
      void deps.transport.report({
        satellite: name,
        sequence: item.sequence,
        outcome: {
          status: "interrupted",
          reason: `could not start the command: ${err.message}`,
        },
      });
    });
    child.on("close", (code, signal) => settle(code ?? 1, signal));

    const entry: RunningJob = { child, timer: null, killedAs: null };
    if (timeoutMs !== undefined)
      entry.timer = setTimeout(() => {
        entry.killedAs = "timeout";
        signalGroup(entry, "SIGKILL");
      }, timeoutMs);
    running.set(item.sequence, entry);
  }

  function cancel(sequence: number): void {
    const entry = running.get(sequence);
    if (entry === undefined) return;
    deps.log.line(`CANCEL ${name}#${sequence}`);
    entry.killedAs = "cancel";
    signalGroup(entry, "SIGTERM");
  }

  return {
    get runningCount(): number {
      return running.size;
    },

    cancel,

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
              else startJob(item);
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
        entry.killedAs = "shutdown";
        signalGroup(entry, "SIGKILL");
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
