import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  EXEC_TIMEOUT_DEFAULT_MS,
  type ExecRunResult,
  type ExecService,
  type ExecStartResult,
  type ExecTailResult,
} from "agent-runtime-api";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";

const OUTPUT_CAP = 200_000;
const TAIL_CHUNK_CAP = 64_000;
const CWD_MARK = "@@platform-exec-cwd@@:";

interface BackgroundJob {
  pid: number;
  logPath: string;
  running: boolean;
  exitCode: number | null;
}

export function capOutput(output: string): {
  output: string;
  truncated: boolean;
} {
  if (output.length <= OUTPUT_CAP) return { output, truncated: false };
  const half = Math.floor(OUTPUT_CAP / 2);
  return {
    output: `${output.slice(0, half)}\n\n[... output truncated ...]\n\n${output.slice(-half)}`,
    truncated: true,
  };
}

export function stripCwdMark(output: string): {
  output: string;
  cwd: string | undefined;
} {
  const at = output.lastIndexOf(CWD_MARK);
  if (at === -1) return { output, cwd: undefined };
  const rest = output.slice(at + CWD_MARK.length);
  const end = rest.indexOf("\n");
  const cwd = end === -1 ? rest : rest.slice(0, end);
  const before = output.slice(0, at).replace(/\n$/, "");
  const after = end === -1 ? "" : rest.slice(end + 1);
  return { output: before + after, cwd: cwd || undefined };
}

export function createExecService(
  workDir: string,
  envReader: RuntimeEnvReader,
): ExecService {
  const jobs = new Map<string, BackgroundJob>();
  const logDir = join(workDir, ".platform-exec");

  const resolveCwd = (cwd: string | undefined): string =>
    cwd && existsSync(cwd) ? cwd : workDir;

  return {
    async run(input): Promise<ExecRunResult> {
      const cwd = resolveCwd(input.cwd);
      const timeoutMs = input.timeoutMs ?? EXEC_TIMEOUT_DEFAULT_MS;
      const startedAt = Date.now();
      const wrapped = `${input.command}\n__platform_ec=$?; printf '\\n${CWD_MARK}%s\\n' "$PWD"; exit $__platform_ec`;

      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        const collect = (chunk: Buffer) => {
          if (bytes < OUTPUT_CAP * 4) chunks.push(chunk);
          bytes += chunk.length;
        };
        const child = spawn("/bin/bash", ["-c", wrapped], {
          cwd,
          env: mergedSpawnEnv(envReader),
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        }, timeoutMs);
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        const finish = (exitCode: number | null, extra?: string) => {
          clearTimeout(timer);
          const raw = Buffer.concat(chunks).toString("utf8") + (extra ?? "");
          const { output: unmarked, cwd: newCwd } = stripCwdMark(raw);
          const { output, truncated } = capOutput(unmarked);
          resolve({
            exitCode: timedOut ? null : exitCode,
            output,
            truncated,
            timedOut,
            cwd: newCwd ?? cwd,
            durationMs: Date.now() - startedAt,
          });
        };
        child.on("error", (err) =>
          finish(null, `spawn failed: ${err.message}`),
        );
        child.on("close", (code) => finish(code));
      });
    },

    async start(input): Promise<ExecStartResult> {
      const cwd = resolveCwd(input.cwd);
      const backgroundId = randomUUID();
      mkdirSync(logDir, { recursive: true });
      const logPath = join(logDir, `${backgroundId}.log`);
      const out = openSync(logPath, "a");
      const child = spawn("/bin/bash", ["-c", input.command], {
        cwd,
        env: mergedSpawnEnv(envReader),
        detached: true,
        stdio: ["ignore", out, out],
      });
      closeSync(out);
      const job: BackgroundJob = {
        pid: child.pid ?? -1,
        logPath,
        running: true,
        exitCode: null,
      };
      jobs.set(backgroundId, job);
      child.on("error", () => {
        job.running = false;
      });
      child.on("close", (code) => {
        job.running = false;
        job.exitCode = code;
      });
      return { backgroundId };
    },

    async tail(backgroundId, offset = 0): Promise<ExecTailResult | null> {
      const job = jobs.get(backgroundId);
      if (!job) return null;
      let output = "";
      let nextOffset = offset;
      try {
        const size = statSync(job.logPath).size;
        if (size > offset) {
          const fd = openSync(job.logPath, "r");
          try {
            const len = Math.min(size - offset, TAIL_CHUNK_CAP);
            const buf = Buffer.alloc(len);
            const read = readSync(fd, buf, 0, len, offset);
            output = buf.subarray(0, read).toString("utf8");
            nextOffset = offset + read;
          } finally {
            closeSync(fd);
          }
        }
      } catch {
        output = "";
      }
      return {
        output,
        nextOffset,
        running: job.running,
        exitCode: job.exitCode,
      };
    },

    async kill(backgroundId): Promise<boolean> {
      const job = jobs.get(backgroundId);
      if (!job || !job.running || job.pid <= 0) return false;
      try {
        process.kill(-job.pid, "SIGKILL");
        return true;
      } catch {
        return false;
      }
    },
  };
}
