// TEST_OVERVIEW: the kit-seed plugin puts a Starter Kit's repository into an Agent that already exists and never overwrites. A checkout of the kit's own repository is adopted with no file changed, and the answer is the commit it shares with the kit's branch; a checkout of another repository is refused; a home that is no checkout is seeded only when none of the repository's files is there, and a work directory only when it is empty. Every answer is an event report, the commit on success and the reason otherwise. The tests run real git against a repository on disk.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EventContext, EventReportInput } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import { createGitRunner } from "../../modules/git/protocol-client.js";
import { createKitSeedPlugin } from "../../modules/runtime-channel/drivers/kit-seed-plugin.js";

function sh(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  }).trim();
}

/** TEST_SCENARIO: the fixture — an upstream kit repository on disk with one commit on `main`, an agent home and work directory, and the plugin bound to them with its reports captured. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "kit-seed-"));
  const upstream = join(root, "upstream");
  mkdirSync(upstream);
  sh(upstream, "init", "--quiet", "-b", "main");
  writeFileSync(join(upstream, "CLAUDE.md"), "kit instructions\n");
  writeFileSync(join(upstream, "ONBOARDING.md"), "kit onboarding\n");
  sh(upstream, "add", ".");
  sh(upstream, "commit", "--quiet", "-m", "kit v1");
  const first = sh(upstream, "rev-parse", "HEAD");
  const home = join(root, "home");
  const workDir = join(root, "work");
  mkdirSync(home);
  const reports: EventReportInput[] = [];
  const plugin = createKitSeedPlugin({
    workDir,
    git: createGitRunner(),
    reporter: {
      report: async (input) => {
        reports.push(input);
      },
    },
    log: () => {},
  }).bindEvent!("kit-seed", { impl: "kit-seed" });
  const ctx: EventContext = {
    eventId: "kit-seed:agent-1:1",
    agentHome: home,
    pluginStateDir: join(root, "state"),
    log: () => {},
  };
  return {
    upstream,
    url: `file://${upstream}`,
    first,
    home,
    workDir,
    reports,
    seed: (payload: Record<string, unknown>) => plugin(payload, ctx),
    commitUpstream(file: string, text: string): string {
      writeFileSync(join(upstream, file), text);
      sh(upstream, "add", ".");
      sh(upstream, "commit", "--quiet", "-m", `change ${file}`);
      return sh(upstream, "rev-parse", "HEAD");
    },
  };
}

describe("kit-seed plugin", () => {
  it("seeds a home that holds none of the kit's files, and answers the commit", async () => {
    const h = setup();
    writeFileSync(join(h.home, "notes.txt"), "mine\n");

    await h.seed({ url: h.url, branch: "main", into: "home" });

    expect(h.reports).toEqual([
      expect.objectContaining({ outcome: "ok", detail: h.first }),
    ]);
    expect(readFileSync(join(h.home, "CLAUDE.md"), "utf8")).toBe(
      "kit instructions\n",
    );
    expect(readFileSync(join(h.home, "notes.txt"), "utf8")).toBe("mine\n");
    expect(sh(h.home, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  /* TEST_SCENARIO: the review's first finding. A home that holds a file at a path the kit's repository also has keeps it as it was: the seed is declined, names the file, and leaves no repository behind. */
  it("declines a home that already holds one of the kit's files, and changes nothing", async () => {
    const h = setup();
    writeFileSync(join(h.home, "CLAUDE.md"), "my own instructions\n");

    await h.seed({ url: h.url, branch: "main", into: "home" });

    expect(h.reports).toEqual([
      expect.objectContaining({
        outcome: "declined",
        detail: expect.stringContaining("CLAUDE.md"),
      }),
    ]);
    expect(readFileSync(join(h.home, "CLAUDE.md"), "utf8")).toBe(
      "my own instructions\n",
    );
    expect(existsSync(join(h.home, "ONBOARDING.md"))).toBe(false);
    expect(existsSync(join(h.home, ".git"))).toBe(false);
  });

  /* TEST_SCENARIO: the maintainer's adopt rule. An agent that already runs the kit's definition, with a change of its own and behind the kit's branch, keeps every file; the answer is the commit its checkout shares with the branch, from which a Kit Update starts. */
  it("adopts a checkout of the kit's repository without touching a file", async () => {
    const h = setup();
    sh(h.home, "clone", "--quiet", h.url, ".");
    writeFileSync(join(h.home, "CLAUDE.md"), "edited by the user\n");
    h.commitUpstream("CHANGELOG.md", "v2\n");

    await h.seed({ url: `${h.url}.git/`, branch: "main", into: "home" });

    expect(h.reports).toEqual([
      expect.objectContaining({ outcome: "ok", detail: h.first }),
    ]);
    expect(readFileSync(join(h.home, "CLAUDE.md"), "utf8")).toBe(
      "edited by the user\n",
    );
    expect(existsSync(join(h.home, "CHANGELOG.md"))).toBe(false);
    expect(sh(h.home, "rev-parse", "HEAD")).toBe(h.first);
  });

  /* TEST_SCENARIO: the review's second finding. A work directory an earlier seed filled from another repository is never taken for the kit's: the seed is declined and names both repositories. */
  it("declines a checkout of another repository", async () => {
    const h = setup();
    const other = join(h.upstream, "..", "other");
    mkdirSync(other);
    sh(other, "init", "--quiet", "-b", "main");
    writeFileSync(join(other, "README.md"), "other\n");
    sh(other, "add", ".");
    sh(other, "commit", "--quiet", "-m", "other");
    mkdirSync(h.workDir);
    sh(h.workDir, "clone", "--quiet", `file://${other}`, ".");

    await h.seed({ url: h.url, branch: "main", into: "work" });

    expect(h.reports).toEqual([
      expect.objectContaining({
        outcome: "declined",
        detail: expect.stringMatching(/already holds a checkout of .*other/),
      }),
    ]);
    expect(existsSync(join(h.workDir, "CLAUDE.md"))).toBe(false);
  });

  it("declines a work directory that is not empty", async () => {
    const h = setup();
    mkdirSync(h.workDir);
    writeFileSync(join(h.workDir, "draft.md"), "mine\n");

    await h.seed({ url: h.url, branch: "main", into: "work" });

    expect(h.reports).toEqual([
      expect.objectContaining({
        outcome: "declined",
        detail: expect.stringContaining("is not empty"),
      }),
    ]);
    expect(existsSync(join(h.workDir, ".git"))).toBe(false);
  });

  it("seeds an empty work directory at the commit the kit pins", async () => {
    const h = setup();
    const second = h.commitUpstream("CHANGELOG.md", "v2\n");

    await h.seed({ url: h.url, branch: "main", commit: h.first, into: "work" });

    expect(h.reports).toEqual([
      expect.objectContaining({ outcome: "ok", detail: h.first }),
    ]);
    expect(sh(h.workDir, "rev-parse", "HEAD")).toBe(h.first);
    expect(second).not.toBe(h.first);
  });

  /* TEST_SCENARIO: a redelivered event finds the checkout the first delivery made and adopts it, so the answer is the same commit and nothing is fetched over it. */
  it("answers the same commit when the event is delivered again", async () => {
    const h = setup();
    await h.seed({ url: h.url, branch: "main", into: "home" });
    await h.seed({ url: h.url, branch: "main", into: "home" });
    expect(h.reports.map((r) => [r.outcome, r.detail])).toEqual([
      ["ok", h.first],
      ["ok", h.first],
    ]);
  });

  it("reports a repository it cannot fetch as failed", async () => {
    const h = setup();
    await h.seed({
      url: `file://${join(h.upstream, "..", "missing")}`,
      branch: "main",
      into: "home",
    });
    expect(h.reports).toEqual([
      expect.objectContaining({
        outcome: "failed",
        detail: expect.stringContaining("could not be fetched"),
      }),
    ]);
    expect(existsSync(join(h.home, ".git"))).toBe(false);
  });
});
