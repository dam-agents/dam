/* TEST_OVERVIEW: A skill source that is not on github.com — a GitHub
Enterprise host — is scanned and installed with git inside the machine. That
git must run with the agent's runtime env, where the Connection placeholder
and gh's credential setup live; with the runtime's bare process env the
request names no Connection, so on an agent that requires addresses the
gateway adds no credential and the host answers 401. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runOnce } from "../../core/run-once.js";
import { composeSkills } from "../../modules/skills/compose.js";

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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-scan-env-"));
  origin = path.join(tmp, "origin");
  await fs.mkdir(path.join(origin, "skills", "review"), { recursive: true });
  await git(origin, "init", "--quiet", "--initial-branch=main");
  await fs.writeFile(
    path.join(origin, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: reviews\n---\nbody\n",
    "utf8",
  );
  await git(origin, "add", ".");
  await git(origin, "commit", "--quiet", "-m", "add skill");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("skill scan of a non-GitHub source", () => {
  /**
   * TEST_SCENARIO: git resolves the source's https URL only through config
   * carried in the env the skills composition is given, so a scan whose git
   * drops that env fails the clone.
   */
  it("should clone with the env it is given", async () => {
    const source = "https://ghe.example.com/org/skills";
    const skillPath = path.join(tmp, "home", ".agents", "skills");
    await fs.mkdir(skillPath, { recursive: true });
    const { service } = composeSkills({
      skillPaths: [skillPath],
      pristineSkillPaths: [],
      githubToken: () => "",
      spawnEnv: () => ({
        ...process.env,
        HOME: tmp,
        GIT_CONFIG_GLOBAL: path.join(tmp, ".gitconfig"),
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.file://${origin}.insteadOf`,
        GIT_CONFIG_VALUE_0: source,
      }),
      log: () => {},
    });

    const result = await service.scan({ source });

    expect(result.ok && result.value.map((s) => s.name)).toEqual(["review"]);
  });
});
