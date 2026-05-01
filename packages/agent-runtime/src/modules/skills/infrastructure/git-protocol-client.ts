import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import type { Result, SkillsDomainError } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";

const COMMAND_TIMEOUT_MS = 60_000;

export interface GitProtocolClient {
  /** `git clone --quiet --depth N <url> <dest>` — used by scan when the host
   *  isn't GitHub. Maps subprocess failures to `SourceFetchFailed`. */
  cloneShallow: (
    url: string,
    dest: string,
    depth?: number,
  ) => Promise<Result<void, SkillsDomainError>>;
  /** Fetch a specific commit SHA into `dest`, falling back to a full clone
   *  + checkout when the host doesn't support partial fetches. Used by
   *  install for non-GitHub URLs. */
  fetchAtSha: (
    url: string,
    sha: string,
    dest: string,
  ) => Promise<Result<void, SkillsDomainError>>;
  /** `git -C <dir> log -1 --format=%H -- <relPath>` — last touching commit
   *  for a path inside a clone. Used by scan to derive per-skill versions
   *  on non-GitHub sources. */
  lastTouchingSha: (
    repoDir: string,
    relPath: string,
  ) => Promise<Result<string, SkillsDomainError>>;
}

export function createGitProtocolClient(): GitProtocolClient {
  return {
    async cloneShallow(url, dest, depth = 50) {
      try {
        await runProc("git", ["clone", "--quiet", "--no-local", "--depth", String(depth), url, dest]);
        return ok(undefined);
      } catch (e) {
        return err({ kind: "SourceFetchFailed", source: url, detail: (e as Error).message });
      }
    },
    async fetchAtSha(url, sha, dest) {
      try {
        await runProc("git", ["init", "--quiet", dest]);
        await runProc("git", ["-C", dest, "remote", "add", "origin", url]);
        await runProc("git", ["-C", dest, "fetch", "--depth", "1", "origin", sha]);
        await runProc("git", ["-C", dest, "checkout", "--quiet", "FETCH_HEAD"]);
        return ok(undefined);
      } catch {
        // fall through to full clone
      }
      try {
        await fs.rm(dest, { recursive: true, force: true });
        await fs.mkdir(dest, { recursive: true });
        await runProc("git", ["clone", "--quiet", "--no-local", url, dest]);
        await runProc("git", ["-C", dest, "checkout", "--quiet", sha]);
        return ok(undefined);
      } catch (e) {
        return err({ kind: "SourceFetchFailed", source: url, detail: (e as Error).message });
      }
    },
    async lastTouchingSha(repoDir, relPath) {
      try {
        const out = await runCapture("git", ["-C", repoDir, "log", "-1", "--format=%H", "--", relPath]);
        return ok(out.trim());
      } catch (e) {
        return err({ kind: "SourceFetchFailed", source: repoDir, detail: (e as Error).message });
      }
    },
  };
}

async function runProc(cmd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} ${args.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}

async function runCapture(cmd: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} ${args.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);
    proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}
