import * as fs from "node:fs/promises";
import type { Result, SkillsDomainError } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import { spawnSupervised } from "../../../core/supervised-process.js";

const COMMAND_TIMEOUT_MS = 60_000;

export interface GitProtocolClient {
  cloneShallow: (
    url: string,
    dest: string,
    depth?: number,
    ref?: string,
  ) => Promise<Result<void, SkillsDomainError>>;
  fetchAtSha: (
    url: string,
    sha: string,
    dest: string,
  ) => Promise<Result<void, SkillsDomainError>>;
  lastTouchingSha: (
    repoDir: string,
    relPath: string,
  ) => Promise<Result<string, SkillsDomainError>>;
}

export function createGitProtocolClient(): GitProtocolClient {
  return {
    async cloneShallow(url, dest, depth = 50, ref) {
      try {
        await git([
          "clone",
          "--quiet",
          "--no-local",
          "--depth",
          String(depth),
          ...(ref ? ["--branch", ref] : []),
          url,
          dest,
        ]);
        return ok(undefined);
      } catch (e) {
        return err({
          kind: "SourceFetchFailed",
          source: url,
          detail: (e as Error).message,
        });
      }
    },
    async fetchAtSha(url, sha, dest) {
      try {
        await git(["init", "--quiet", dest]);
        await git(["-C", dest, "remote", "add", "origin", url]);
        await git(["-C", dest, "fetch", "--depth", "1", "origin", sha]);
        await git(["-C", dest, "checkout", "--quiet", "FETCH_HEAD"]);
        return ok(undefined);
      } catch {}
      try {
        await fs.rm(dest, { recursive: true, force: true });
        await fs.mkdir(dest, { recursive: true });
        await git(["clone", "--quiet", "--no-local", url, dest]);
        await git(["-C", dest, "checkout", "--quiet", sha]);
        return ok(undefined);
      } catch (e) {
        return err({
          kind: "SourceFetchFailed",
          source: url,
          detail: (e as Error).message,
        });
      }
    },
    async lastTouchingSha(repoDir, relPath) {
      try {
        const out = await runCapture("git", [
          "-C",
          repoDir,
          "log",
          "-1",
          "--format=%H",
          "--",
          relPath,
        ]);
        return ok(out.trim());
      } catch (e) {
        return err({
          kind: "SourceFetchFailed",
          source: repoDir,
          detail: (e as Error).message,
        });
      }
    },
  };
}

// Throwaway clones: git's auto-maintenance would fork a detached repack that
// outlives the command and leaves the reaper to collect it.
const git = (args: string[]): Promise<void> =>
  runProc("git", ["-c", "maintenance.auto=false", ...args]);

async function runProc(cmd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const supervised = spawnSupervised(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const proc = supervised.child;
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      // git's network I/O runs in a helper child that outlives a kill on git.
      void supervised.terminate();
      reject(
        new Error(
          `${cmd} ${args.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`,
        ),
      );
    }, COMMAND_TIMEOUT_MS);
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      // git's network helpers outlive a kill on git, inside git's own session.
      void supervised.terminate();
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(
        new Error(
          `${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
}

async function runCapture(cmd: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const supervised = spawnSupervised(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const proc = supervised.child;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      void supervised.terminate();
      reject(
        new Error(
          `${cmd} ${args.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`,
        ),
      );
    }, COMMAND_TIMEOUT_MS);
    proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      void supervised.terminate();
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(
        new Error(
          `${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
}
