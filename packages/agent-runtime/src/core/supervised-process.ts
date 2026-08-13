import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { readProcessEntry, readProcessTable } from "./process-table.js";

export const TEARDOWN_GRACE_MS = 5_000;

const POLL_MS = 100;

export function sendSignal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {}
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let ownSidCache: number | null | undefined;
function ownSid(): number | null {
  return (ownSidCache ??= readProcessEntry(process.pid)?.sid ?? null);
}

export interface TerminateOptions {
  log?: (msg: string) => void;
  leaderStartTime?: number;
}

export async function terminateSession(
  sid: number,
  opts: TerminateOptions = {},
): Promise<void> {
  const { log, leaderStartTime } = opts;

  const self = ownSid();
  if (!Number.isInteger(sid) || sid <= 1) return;
  if (self === null) {
    log?.("cannot read own session from /proc; refusing to tear down anything");
    return;
  }
  if (sid === self) {
    log?.(`refusing to tear down the runtime's own session (${sid})`);
    return;
  }

  const leader = readProcessEntry(sid);
  if (
    leader &&
    leaderStartTime !== undefined &&
    leader.startTime !== leaderStartTime
  ) {
    log?.(`pid ${sid} was reused; leaving that session alone`);
    return;
  }
  if (leader) sendSignal(sid, "SIGTERM");

  const members = () => readProcessTable().filter((p) => p.sid === sid);

  const deadline = Date.now() + TEARDOWN_GRACE_MS;
  while (Date.now() < deadline) {
    if (members().length === 0) return;
    await sleep(POLL_MS);
  }

  const remaining = members();
  if (remaining.length === 0) return;

  const stuck = remaining.filter((p) => p.state === "D");
  log?.(
    `force-killing ${remaining.length} process(es) left in session ${sid}` +
      (stuck.length > 0
        ? ` (${stuck.length} in uninterruptible I/O — SIGKILL cannot land until it completes)`
        : ""),
  );
  for (const p of remaining) {
    log?.(`  kill -9 ${p.pid} ${p.cmdline}`);
    sendSignal(p.pid, "SIGKILL");
  }
}

export interface SupervisedProcess<C extends ChildProcess = ChildProcess> {
  readonly child: C;
  terminate(opts?: TerminateOptions): Promise<void>;
}

type NoShell<T> = Omit<T, "shell">;

export function spawnSupervised(
  command: string,
  args: readonly string[],
  options: NoShell<SpawnOptionsWithoutStdio>,
): SupervisedProcess<ChildProcessWithoutNullStreams>;
export function spawnSupervised(
  command: string,
  args: readonly string[],
  options?: NoShell<SpawnOptions>,
): SupervisedProcess<ChildProcess>;
export function spawnSupervised(
  command: string,
  args: readonly string[],
  options: NoShell<SpawnOptions> = {},
): SupervisedProcess<ChildProcess> {
  const child = spawn(command, args as string[], {
    ...options,
    detached: true,
    shell: false,
  });
  const startTime =
    child.pid === undefined
      ? undefined
      : readProcessEntry(child.pid)?.startTime;

  return {
    child,
    async terminate(terminateOpts?: TerminateOptions) {
      if (child.pid === undefined) return;
      await terminateSession(child.pid, {
        leaderStartTime: startTime,
        ...terminateOpts,
      });
    },
  };
}
