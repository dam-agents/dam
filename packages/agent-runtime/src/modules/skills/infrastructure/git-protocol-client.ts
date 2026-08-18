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
        await runProc("git", [
          "clone",
          "--quiet",
          "--no-local",
          "--depth",
          String(depth),
          ...(ref ? ["--branch", ref] : []),
          "--end-of-options",
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
        await runProc("git", ["init", "--quiet", "--end-of-options", dest]);
        await runProc("git", [
          "-C",
          dest,
          "remote",
          "add",
          "--end-of-options",
          "origin",
          url,
        ]);
        await runProc("git", [
          "-C",
          dest,
          "fetch",
          "--depth",
          "1",
          "--end-of-options",
          "origin",
          sha,
        ]);
        await runProc("git", [
          "-C",
          dest,
          "checkout",
          "--quiet",
          "--end-of-options",
          "FETCH_HEAD",
        ]);
        return ok(undefined);
      } catch {}
      try {
        await fs.rm(dest, { recursive: true, force: true });
        await fs.mkdir(dest, { recursive: true });
        await runProc("git", [
          "clone",
          "--quiet",
          "--no-local",
          "--end-of-options",
          url,
          dest,
        ]);
        await runProc("git", [
          "-C",
          dest,
          "checkout",
          "--quiet",
          "--end-of-options",
          sha,
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

const GIT_ALLOW_PROTOCOL = "https:http:ssh:git:file";

const gitArgv = (cmd: string, args: string[]): string[] =>
  cmd === "git" ? ["-c", "maintenance.auto=false", ...args] : args;

const gitEnv = (cmd: string): { env: NodeJS.ProcessEnv } | undefined =>
  cmd === "git" ? { env: { ...process.env, GIT_ALLOW_PROTOCOL } } : undefined;

async function runProc(cmd: string, args: string[]): Promise<void> {
  const argv = gitArgv(cmd, args);
  await new Promise<void>((resolve, reject) => {
    const supervised = spawnSupervised(cmd, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      ...gitEnv(cmd),
    });
    const proc = supervised.child;
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      void supervised.terminate();
      reject(
        new Error(
          `${cmd} ${argv.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`,
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
      void supervised.terminate();
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(
        new Error(
          `${cmd} ${argv.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
}

async function runCapture(cmd: string, args: string[]): Promise<string> {
  const argv = gitArgv(cmd, args);
  return await new Promise<string>((resolve, reject) => {
    const supervised = spawnSupervised(cmd, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      ...gitEnv(cmd),
    });
    const proc = supervised.child;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      void supervised.terminate();
      reject(
        new Error(
          `${cmd} ${argv.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`,
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
          `${cmd} ${argv.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
}
