import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface CapturedStream {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface ScriptRun {
  exitCode: number | null;
  failure?: string;
  stdout: CapturedStream;
  stderr: CapturedStream;
}

const TAIL_CHARS = 500;

const PIPE_GRACE_MS = 2_000;

class OutputCapExceeded extends Error {}

class PipesReleased extends Error {}

interface Capture {
  stream: Transform;
  tail: () => string;
}

function capture(maxBytes: number, keepTail: boolean): Capture {
  let sizeBytes = 0;
  let tail = Buffer.alloc(0);
  const stream = new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (sizeBytes + chunk.length > maxBytes) {
        done(new OutputCapExceeded());
        return;
      }
      sizeBytes += chunk.length;
      if (keepTail) {
        const joined = Buffer.concat([tail, chunk]);
        tail = joined.subarray(Math.max(0, joined.length - TAIL_CHARS * 4));
      }
      done(null, chunk);
    },
  });
  return {
    stream,
    tail: () => tail.toString("utf8").trim().slice(-TAIL_CHARS),
  };
}

async function captured(path: string): Promise<CapturedStream> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      sizeBytes += (chunk as Buffer).length;
      hash.update(chunk as Buffer);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return { path, sizeBytes, sha256: hash.digest("hex") };
}

function exitOf(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | Error> {
  return new Promise((resolve) => {
    child.once("error", (err) => resolve(err));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: runs a script sub-agent's command once and keeps
 * its stdout and stderr as files, byte for byte, with the size and sha256 of
 * each. The driver reads these bytes and nothing else, so nothing here decodes
 * or trims the streams; only the failure text reads the stderr tail. The run
 * ends at the invocation deadline, or when either stream passes maxBytes,
 * since one presigned upload carries at most that many bytes. A process the
 * script left running in the background may hold its stdout open after the
 * script exits, even one that left the group with setsid, so a short grace
 * after that exit the group is killed and any pipe still open is closed; the
 * run ends with the script's own exit code.
 */
export async function runScript(opts: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  deadline: Date;
  stdoutPath: string;
  stderrPath: string;
  maxBytes: number;
}): Promise<ScriptRun> {
  const stdout = capture(opts.maxBytes, false);
  const stderr = capture(opts.maxBytes, true);
  const result = async (
    failure?: string,
    exitCode: number | null = null,
  ): Promise<ScriptRun> => ({
    exitCode,
    ...(failure !== undefined && { failure }),
    stdout: await captured(opts.stdoutPath),
    stderr: await captured(opts.stderrPath),
  });
  const withTail = (reason: string) => {
    const tail = stderr.tail();
    return tail ? `${reason}: ${tail}` : reason;
  };

  let child: ChildProcess;
  try {
    child = spawn("bash", ["-lc", opts.command], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
  } catch (err) {
    return result(`script failed to start: ${(err as Error).message}`);
  }

  const killGroup = () => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  const release = () => {
    killGroup();
    for (const pipe of [child.stdout, child.stderr]) {
      if (pipe && !pipe.destroyed) pipe.destroy(new PipesReleased());
    }
  };
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      release();
    },
    Math.max(0, opts.deadline.getTime() - Date.now()),
  );
  const exit = exitOf(child);
  let lingering: NodeJS.Timeout | undefined;
  void exit.then(() => {
    clearTimeout(timer);
    lingering = setTimeout(release, PIPE_GRACE_MS);
  });
  const copies = await Promise.allSettled([
    pipeline(child.stdout!, stdout.stream, createWriteStream(opts.stdoutPath)),
    pipeline(child.stderr!, stderr.stream, createWriteStream(opts.stderrPath)),
  ]);
  const capped = copies.some(
    (c) => c.status === "rejected" && c.reason instanceof OutputCapExceeded,
  );
  if (capped) release();
  const ended = await exit;
  clearTimeout(timer);
  clearTimeout(lingering);

  if (ended instanceof Error)
    return result(`script failed to start: ${ended.message}`);
  if (capped)
    return result(
      `the script's output passed ${opts.maxBytes} bytes, the most one stream can carry`,
    );
  if (timedOut)
    return result(withTail("script ran past the invocation deadline"));
  const broken = copies.find(
    (c) => c.status === "rejected" && !(c.reason instanceof PipesReleased),
  );
  if (broken?.status === "rejected")
    return result(
      `the script's output could not be kept: ${(broken.reason as Error).message}`,
      ended.code,
    );
  if (ended.signal !== null)
    return result(withTail(`script was killed by ${ended.signal}`));
  if (ended.code !== 0)
    return result(withTail(`script exited ${ended.code}`), ended.code);
  return result(undefined, 0);
}
