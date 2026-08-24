import * as fs from "node:fs/promises";
import type { Result, SkillsDomainError } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";

import { describeFailure, runOnce } from "../../../core/run-once.js";

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
        await runProc("git", [
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
        await runProc("git", ["init", "--quiet", dest]);
        await runProc("git", ["-C", dest, "remote", "add", "origin", url]);
        await runProc("git", [
          "-C",
          dest,
          "fetch",
          "--depth",
          "1",
          "origin",
          sha,
        ]);
        await runProc("git", ["-C", dest, "checkout", "--quiet", "FETCH_HEAD"]);
        return ok(undefined);
      } catch {}
      try {
        await fs.rm(dest, { recursive: true, force: true });
        await fs.mkdir(dest, { recursive: true });
        await runProc("git", ["clone", "--quiet", "--no-local", url, dest]);
        await runProc("git", ["-C", dest, "checkout", "--quiet", sha]);
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

async function runProc(cmd: string, args: string[]): Promise<void> {
  await runCapture(cmd, args);
}

async function runCapture(cmd: string, args: string[]): Promise<string> {
  const command = [cmd, ...args];
  const result = await runOnce({ command, timeoutMs: COMMAND_TIMEOUT_MS });
  if (!result.ok) throw new Error(describeFailure(command, result.error));
  return result.value.stdout;
}
