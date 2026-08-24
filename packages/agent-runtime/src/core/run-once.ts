import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { err, ok, type Result } from "./result.js";

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const MAX_DESCRIBED_STDERR = 500;

export interface RunOnceOptions {
  command: readonly string[];
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  onLine?: (line: string) => void;
}

export interface ProcessOutput {
  stdout: string;
  stderr: string;
}

export type ProcessFailure =
  | { kind: "not-spawnable"; message: string }
  | { kind: "timed-out"; timeoutMs: number }
  | { kind: "output-capped"; maxOutputBytes: number }
  | { kind: "exited"; code: number | null; stderr: string };

export type RunOnceResult = Result<ProcessOutput, ProcessFailure>;

export function describeFailure(
  command: readonly string[],
  failure: ProcessFailure,
): string {
  const name = command.join(" ");
  switch (failure.kind) {
    case "not-spawnable":
      return `${name} failed to start: ${failure.message}`;
    case "timed-out":
      return `${name} timed out after ${failure.timeoutMs}ms`;
    case "output-capped":
      return `${name} produced more than ${failure.maxOutputBytes} bytes of output`;
    case "exited": {
      const trimmed = failure.stderr.trim().slice(0, MAX_DESCRIBED_STDERR);
      return `${name} exited ${failure.code}` + (trimmed ? `: ${trimmed}` : "");
    }
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs one short-lived subprocess to completion and
 * reports what happened, so no caller hand-rolls the spawn/decode/deadline
 * block. It owns the parts that are easy to get subtly wrong: a deadline
 * (SIGKILL on expiry, and the timeout is required — an unbounded subprocess is
 * never intended), a byte budget on retained output, and decoding that
 * reassembles multi-byte characters split across stream chunks. Failure is a
 * value, never an exception, because callers disagree about policy: some log
 * and continue, some reject, some fall back to another source. Output is
 * either retained and returned, or — when onLine is given — relayed line by
 * line and not retained at all, which is what a caller streaming a long build
 * into a log wants; only retained output is capped. Long-lived children (the
 * harness, a PTY, sshd) are out of scope: they have lifecycles, not results.
 */
export function runOnce(opts: RunOnceOptions): Promise<RunOnceResult> {
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const relay = opts.onLine;

  return new Promise<RunOnceResult>((resolve) => {
    const [bin, ...args] = opts.command;
    if (bin === undefined) {
      resolve(err({ kind: "not-spawnable", message: "empty command" }));
      return;
    }

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    let retainedBytes = 0;

    const settle = (result: RunOnceResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(err({ kind: "timed-out", timeoutMs: opts.timeoutMs }));
    }, opts.timeoutMs);

    const readStream = (
      stream: NodeJS.ReadableStream,
      retain: (text: string) => void,
    ): (() => void) => {
      const decoder = new StringDecoder("utf8");
      let pending = "";
      stream.on("data", (chunk: Buffer) => {
        const text = decoder.write(chunk);
        if (relay) {
          pending += text;
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) if (line) relay(line);
          return;
        }
        retainedBytes += chunk.length;
        retain(text);
        if (retainedBytes > maxOutputBytes) {
          child.kill("SIGKILL");
          settle(err({ kind: "output-capped", maxOutputBytes }));
        }
      });
      return () => {
        const tail = pending + decoder.end();
        if (relay) {
          if (tail) relay(tail);
          return;
        }
        retain(tail);
      };
    };

    const flushStdout = readStream(child.stdout, (text) => (stdout += text));
    const flushStderr = readStream(child.stderr, (text) => (stderr += text));

    child.on("error", (error) =>
      settle(err({ kind: "not-spawnable", message: error.message })),
    );

    child.on("close", (code) => {
      flushStdout();
      flushStderr();
      if (code !== 0) {
        settle(err({ kind: "exited", code, stderr }));
        return;
      }
      settle(ok({ stdout, stderr }));
    });
  });
}
