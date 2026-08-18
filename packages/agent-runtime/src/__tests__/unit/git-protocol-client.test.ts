import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGitProtocolClient } from "../../modules/skills/infrastructure/git-protocol-client.js";

/**
 * TEST_OVERVIEW: what the platform hands to git stays data.
 *
 * A skill's source url and version arrive from the caller and become positional
 * arguments to git. git reads a leading dash as an option wherever it appears,
 * even after a positional, so a version can stop being a version and start
 * being an instruction. These run real git against local repositories — no
 * network — because the behaviour under test is git's argument parsing.
 */

const client = createGitProtocolClient();
let dir: string;
let source: string;
let sha: string;

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", cwd: dir }).trim();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "git-argv-"));
  source = join(dir, "source");
  git("init", "--quiet", source);
  git(
    "-C",
    source,
    "-c",
    "user.email=t@example.test",
    "-c",
    "user.name=t",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "one",
  );
  sha = git("-C", source, "rev-parse", "HEAD");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("git-protocol-client", () => {
  /**
   * TEST_SCENARIO: regression — a version shaped like an option once ran a
   * command. `--upload-pack=` names the program git executes to serve a fetch,
   * and the version reaches `git fetch` as a bare positional, so git read it as
   * that option instead of as a revision.
   */
  it("refuses a version that git would read as an option", async () => {
    const marker = join(dir, "version-escaped");

    const result = await client.fetchAtSha(
      source,
      `--upload-pack=touch ${marker}`,
      join(dir, "dest-version"),
    );

    expect(existsSync(marker), "the payload must not run").toBe(false);
    expect(result.ok).toBe(false);
  });

  /**
   * TEST_SCENARIO: the guard must not cost the ordinary path — an honest sha
   * still checks out, which is what shows the refusal above rejects the argument
   * shape rather than the whole call being broken.
   */
  it("still fetches an ordinary revision", async () => {
    const dest = join(dir, "dest-ok");

    const result = await client.fetchAtSha(source, sha, dest);

    expect(result.ok).toBe(true);
    expect(git("-C", dest, "rev-parse", "HEAD")).toBe(sha);
  });

  /**
   * TEST_SCENARIO: the same for clone, whose positionals carry the guard too.
   */
  it("still clones an ordinary source", async () => {
    const dest = join(dir, "clone-ok");

    const result = await client.cloneShallow(source, dest);

    expect(result.ok).toBe(true);
    expect(git("-C", dest, "rev-parse", "HEAD")).toBe(sha);
  });
});
