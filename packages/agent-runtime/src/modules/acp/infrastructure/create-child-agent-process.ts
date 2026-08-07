import { mkdirSync } from "node:fs";
import readline from "node:readline";
import { spawnSupervised } from "../../../core/supervised-process.js";
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

  const cleanEnv = Object.fromEntries(
    Object.entries(opts.env ?? process.env).filter(
      ([k]) => !k.startsWith("npm_"),
    ),
  );

  try {
    mkdirSync(opts.workingDir, { recursive: true });
  } catch (err) {
    process.stderr.write(
      `[agent-process] could not create workingDir ${opts.workingDir}: ${(err as Error).message}\n`,
    );
  }

  const supervised = spawnSupervised(cmd, args, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: opts.workingDir,
    env: cleanEnv,
  });
  const child = supervised.child;

  child.on("error", (err) => {
    process.stderr.write(`[agent-process] spawn error: ${err.message}\n`);
  });

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
      // The harness stops its own workers; what *those* started outlives them.
      void supervised.terminate({
        log: (msg) => process.stderr.write(`[agent-process] ${msg}\n`),
      });
    },
    exited,
  };
}
