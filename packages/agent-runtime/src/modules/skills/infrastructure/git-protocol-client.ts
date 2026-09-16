import * as fs from "node:fs/promises";
import { join } from "node:path";
import type { Result, SkillsDomainError } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";

import { describeFailure, runOnce } from "../../../core/run-once.js";

const COMMAND_TIMEOUT_MS = 60_000;

export interface SeedTarget {
  ref?: string;
  commit?: string;
  branch?: string;
}

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
  fetchInto: (
    url: string,
    dest: string,
    target: SeedTarget,
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
    async fetchInto(url, dest, target) {
      const { ref, commit, branch } = target;
      const isSha = (v: string | undefined) =>
        v !== undefined && /^[0-9a-f]{40}$/i.test(v);
      const git = (...args: string[]) => runProc("git", ["-C", dest, ...args]);
      try {
        await fs.mkdir(dest, { recursive: true });
        const hasGit = await fs.stat(join(dest, ".git")).then(
          () => true,
          () => false,
        );
        if (!hasGit) await runProc("git", ["init", "--quiet", dest]);
        try {
          await git("remote", "add", "origin", url);
        } catch {
          await git("remote", "set-url", "origin", url);
        }
        if (branch) {
          let onBranch = true;
          try {
            await git(
              "fetch",
              "--quiet",
              "--depth",
              "50",
              "origin",
              `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
            );
          } catch (e) {
            if (!commit) throw e;
            onBranch = false;
          }
          if (onBranch) {
            const want = commit ?? `refs/remotes/origin/${branch}`;
            if (commit) {
              const present = await git("cat-file", "-e", `${commit}^{commit}`)
                .then(() => true)
                .catch(() => false);
              if (!present)
                await git("fetch", "--quiet", "--depth", "1", "origin", commit);
            }
            await git("reset", "--hard", "--quiet", want);
            await git("checkout", "--quiet", "-B", branch, want);
            await git(
              "branch",
              "--quiet",
              "-u",
              `origin/${branch}`,
              branch,
            ).catch(() => undefined);
            return ok(undefined);
          }
        }
        const want = commit ?? ref ?? "HEAD";
        try {
          await git(
            "fetch",
            "--quiet",
            "--depth",
            isSha(want) ? "1" : "50",
            "origin",
            want,
          );
        } catch (e) {
          if (!isSha(want)) throw e;
          await git("fetch", "--quiet", "origin");
          await git("checkout", "--quiet", "--force", want);
          return ok(undefined);
        }
        if (ref && !commit && !isSha(ref)) {
          await git("reset", "--hard", "--quiet", "FETCH_HEAD");
          await git("checkout", "--quiet", "-B", ref, "FETCH_HEAD");
        } else {
          await git("checkout", "--quiet", "--force", "FETCH_HEAD");
        }
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
  if (!result.ok)
    throw new Error(describeFailure(command.join(" "), result.error));
  return result.value.stdout;
}
