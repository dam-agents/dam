import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`${command} failed (${exitCode ?? "signal"}): ${stderr.trim()}`);
    this.name = "CommandError";
  }
}

/**
 * Runs a node command. Arguments are passed as a vector, never a shell string:
 * agent ids, hostnames and image references all reach these commands from user
 * input, and a shell would make each one an injection point.
 */
export async function exec(
  file: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<string> {
  try {
    const child = run(file, args, {
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 32 * 1024 * 1024,
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    });
    if (opts.input !== undefined) {
      child.child.stdin?.end(opts.input);
    }
    return (await child).stdout;
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    throw new CommandError(
      `${file} ${args.join(" ")}`,
      e.code ?? null,
      e.stderr ?? String(err),
    );
  }
}
