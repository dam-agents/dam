import { kitSeedEventPayload } from "agent-runtime-api";
import { existsSync, readdirSync } from "node:fs";
import { lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  EventReportInput,
  KitSeedEventPayload,
  Plugin,
} from "agent-runtime-api";

import type { EventReporter } from "./trigger-plugin.js";
import { eventPlugin } from "../infrastructure/plugin-registry.js";
import { safeReport } from "../infrastructure/report.js";

const KIND = "kit-seed";
const DETAIL_MAX = 2_000;
const LISTED_COLLISIONS = 5;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export type GitIn = (dir: string, args: readonly string[]) => Promise<string>;

class Refusal extends Error {}

function repositoryKey(url: string): string {
  const trimmed = url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  try {
    const parsed = new URL(trimmed);
    return `${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return trimmed;
  }
}

function sameRepository(a: string, b: string): boolean {
  return repositoryKey(a) === repositoryKey(b);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: puts a Starter Kit's repository into an Agent
 * that already exists, without overwriting anything. A destination that is
 * already a checkout of the kit's repository is adopted: no file changes,
 * and the answer is the commit it shares with the kit's branch, so a Kit
 * Update starts from there. A checkout of another repository is refused, so
 * an earlier seed is never taken for the kit's. A home that is no checkout
 * is seeded only when none of the repository's files is there yet, and a
 * work directory only when it is empty. The answer goes back as an event
 * report, which the platform waits for before it applies the rest of the
 * kit: the commit on success, the reason on a refusal.
 */
export function createKitSeedPlugin(deps: {
  workDir: string;
  git: GitIn;
  reporter: EventReporter;
  log: (msg: string) => void;
}): Plugin {
  const git = (dir: string, ...args: string[]) =>
    deps.git(dir, ["-c", `safe.directory=${dir}`, ...args]);

  async function fetchTarget(
    dest: string,
    seed: KitSeedEventPayload,
    depth: readonly string[],
  ): Promise<string> {
    if (seed.branch) {
      await git(
        dest,
        "fetch",
        "--quiet",
        ...depth,
        "origin",
        `+refs/heads/${seed.branch}:refs/remotes/origin/${seed.branch}`,
      );
      if (!seed.commit) return `refs/remotes/origin/${seed.branch}`;
    }
    if (seed.commit) {
      const present = await git(
        dest,
        "cat-file",
        "-e",
        `${seed.commit}^{commit}`,
      ).then(
        () => true,
        () => false,
      );
      if (!present)
        await git(dest, "fetch", "--quiet", ...depth, "origin", seed.commit);
      return seed.commit;
    }
    await git(dest, "fetch", "--quiet", ...depth, "origin", "HEAD");
    return "FETCH_HEAD";
  }

  async function adopt(
    dest: string,
    seed: KitSeedEventPayload,
  ): Promise<string> {
    const origin = await git(dest, "remote", "get-url", "origin").then(
      (out) => out.trim(),
      () => null,
    );
    if (origin === null || !sameRepository(origin, seed.url))
      throw new Refusal(
        `${dest} already holds a checkout of ${origin ?? "a repository with no origin"}, not of the kit's ${seed.url}`,
      );
    const target = await fetchTarget(
      dest,
      seed.branch ? { ...seed, commit: undefined } : seed,
      [],
    );
    const base = (
      await git(dest, "merge-base", "HEAD", target).catch(() => "")
    ).trim();
    if (!COMMIT_SHA.test(base))
      throw new Refusal(
        `the checkout in ${dest} shares no commit with the kit's ${seed.branch ?? seed.commit ?? "default branch"}`,
      );
    return base;
  }

  async function seedFresh(
    dest: string,
    seed: KitSeedEventPayload,
    intoHome: boolean,
  ): Promise<string> {
    if (!intoHome && existsSync(dest) && readdirSync(dest).length > 0)
      throw new Refusal(
        `the work directory ${dest} is not empty, and it is no checkout of the kit's ${seed.url}`,
      );
    await mkdir(dest, { recursive: true });
    await git(dest, "init", "--quiet");
    try {
      await git(dest, "remote", "add", "origin", seed.url);
      const target = await fetchTarget(dest, seed, ["--depth", "50"]);
      const commit = (
        await git(dest, "rev-parse", `${target}^{commit}`)
      ).trim();
      const paths = (await git(dest, "ls-tree", "-r", "--name-only", commit))
        .split("\n")
        .filter((p) => p.length > 0);
      const taken: string[] = [];
      for (const path of paths)
        if (await pathExists(join(dest, path))) taken.push(path);
      if (taken.length > 0) {
        const listed = taken.slice(0, LISTED_COLLISIONS).join(", ");
        const more =
          taken.length > LISTED_COLLISIONS
            ? ` and ${taken.length - LISTED_COLLISIONS} more`
            : "";
        throw new Refusal(
          `the kit's repository has files the agent already has in ${dest}: ${listed}${more}; move them away and apply the kit again`,
        );
      }
      await git(dest, "reset", "--quiet", "--hard", commit);
      if (seed.branch) {
        await git(dest, "checkout", "--quiet", "-B", seed.branch, commit);
        await git(
          dest,
          "branch",
          "--quiet",
          "-u",
          `origin/${seed.branch}`,
          seed.branch,
        ).catch(() => "");
      }
      return commit;
    } catch (err) {
      await rm(join(dest, ".git"), { recursive: true, force: true });
      throw err;
    }
  }

  const report = (input: EventReportInput): Promise<boolean> =>
    safeReport(
      () => deps.reporter.report(input),
      deps.log,
      "[kit-seed] event report",
      { attempts: 3, delayMs: 1_000 },
    );

  return eventPlugin(KIND, KIND, async (payload, ctx) => {
    const seed = kitSeedEventPayload.parse(payload);
    const intoHome = seed.into === "home";
    const dest = intoHome ? ctx.agentHome : deps.workDir;
    try {
      const commit = existsSync(join(dest, ".git"))
        ? await adopt(dest, seed)
        : await seedFresh(dest, seed, intoHome);
      deps.log(`[kit-seed] ${dest} is on ${seed.url} at ${commit}`);
      await report({
        eventId: ctx.eventId,
        outcome: "ok",
        stage: "run",
        detail: commit,
      });
    } catch (err) {
      const detail =
        err instanceof Refusal
          ? err.message
          : `the kit's repository ${seed.url} could not be fetched: ${(err as Error).message}`;
      deps.log(`[kit-seed] ${detail}`);
      await report({
        eventId: ctx.eventId,
        outcome: err instanceof Refusal ? "declined" : "failed",
        stage: "run",
        detail: detail.slice(0, DETAIL_MAX),
      });
    }
  });
}
