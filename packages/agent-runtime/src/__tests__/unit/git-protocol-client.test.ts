import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runOnce } from "../../core/run-once.js";
import { createGitProtocolClient } from "../../modules/skills/infrastructure/git-protocol-client.js";

/**
 * TEST_OVERVIEW: the git client drives real git through the shared subprocess
 * runner.
 *
 * Skill install clones and inspects repositories, so this client is the path a
 * user actually feels when adding a skill from git. It had no coverage while it
 * hand-rolled its own spawn; these tests exercise it against a repository
 * created on disk, so the capture path (reading a sha out of stdout), the
 * discard path (clone), and the failure mapping are all checked against a real
 * subprocess rather than a stub.
 */

let tmp: string;
let origin: string;

async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await runOnce({
    command: [
      "git",
      "-c",
      "user.email=bench@example.com",
      "-c",
      "user.name=Bench",
      "-C",
      cwd,
      ...args,
    ],
    timeoutMs: 30_000,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "git-protocol-"));
  origin = path.join(tmp, "origin");
  await fs.mkdir(origin);
  await git(origin, "init", "--quiet", "--initial-branch=main");
  await fs.writeFile(path.join(origin, "SKILL.md"), "# skill\n", "utf8");
  await git(origin, "add", "SKILL.md");
  await git(origin, "commit", "--quiet", "-m", "add skill");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("git protocol client", () => {
  /**
   * TEST_SCENARIO: A shallow clone of a real repository lands the working
   * tree at the destination — the path skill install takes for a git source.
   */
  it("should shallow-clone a repository onto disk", async () => {
    const client = createGitProtocolClient();
    const dest = path.join(tmp, "clone");

    const result = await client.cloneShallow(`file://${origin}`, dest, 1);

    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(dest, "SKILL.md"), "utf8")).toBe(
      "# skill\n",
    );
  });

  /**
   * TEST_SCENARIO: Reading the last commit that touched a file goes through
   * the capture path, so stdout must arrive intact and trimmed enough to use
   * as a sha.
   */
  it("should read the sha that last touched a path", async () => {
    const client = createGitProtocolClient();

    const result = await client.lastTouchingSha(origin, "SKILL.md");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  /**
   * TEST_SCENARIO: A source that does not exist must come back as a domain
   * failure carrying git's own complaint, not an exception and not a silent
   * empty clone.
   */
  it("should report a missing source as a fetch failure", async () => {
    const client = createGitProtocolClient();
    const missing = `file://${path.join(tmp, "nope")}`;

    const result = await client.cloneShallow(missing, path.join(tmp, "out"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("SourceFetchFailed");
    if (result.error.kind !== "SourceFetchFailed") return;
    expect(result.error.detail).toContain("exited");
  });
});
