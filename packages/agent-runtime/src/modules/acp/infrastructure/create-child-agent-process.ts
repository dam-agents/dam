import { spawn } from "node:child_process";
import readline from "node:readline";
import type { AgentProcess } from "./agent-process.js";

export interface ChildAgentProcessOptions {
  command: string[];
  workingDir: string;
  env?: Record<string, string | undefined>;
}

export function createChildAgentProcess(
  opts: ChildAgentProcessOptions,
): AgentProcess {
  const [cmd, ...args] = opts.command;

  // Strip pnpm-injected npm_config_* vars so npx doesn't emit warnings.
  const cleanEnv = Object.fromEntries(
    Object.entries(opts.env ?? process.env).filter(
      ([k]) => !k.startsWith("npm_"),
    ),
  );

  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: opts.workingDir,
    env: cleanEnv,
  });

  child.on("error", (err) => {
    process.stderr.write(`[agent-process] spawn error: ${err.message}\n`);
  });

  // send()'s writable guard is racy: after the harness exits (e.g. an image
  // without a chat harness, whose stub exits immediately), a dispatched write
  // fails async with EPIPE on this stream — unhandled, it kills the runtime
  // (PID 1) and the whole pod. Exit cleanup already closes the sessions.
  child.stdin!.on("error", (err) => {
    process.stderr.write(`[agent-process] stdin error: ${err.message}\n`);
  });

  const handlers: ((line: string) => void)[] = [];

  const rl = readline.createInterface({
    input: child.stdout!,
    crlfDelay: Infinity,
  });
  rl.on("line", (line) => {
    if (line.trim()) for (const h of handlers) h(line);
  });

  const exited = new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
  });

  return {
    send(frame) {
      if (child.stdin!.writable)
        child.stdin!.write(JSON.stringify(frame) + "\n");
    },
    onLine(handler) {
      handlers.push(handler);
    },
    kill() {
      child.kill();
    },
    exited,
  };
}
