import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalSkillRepository } from "../../modules/skills/infrastructure/local-skill-repository.js";

// TEST_OVERVIEW: the pod scan reports which of three path outcomes it hit, so a wrong source path is named rather than read as an empty repo.

const repo = createLocalSkillRepository();

let repoDir: string;

beforeEach(async () => {
  repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "clone-scan-"));
});

afterEach(async () => {
  await fs.rm(repoDir, { recursive: true, force: true });
});

async function writeSkill(rel: string): Promise<void> {
  const dir = path.join(repoDir, rel);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: x\n---\nbody");
}

describe("findSkillDirsInClone", () => {
  it("finds the skills under an explicit path", async () => {
    await writeSkill("nested/skills/one");
    expect(await repo.findSkillDirsInClone(repoDir, "nested/skills")).toEqual({
      kind: "found",
      dirs: ["nested/skills/one"],
    });
  });

  it("reports path-missing when the path is not a directory in the repo", async () => {
    await writeSkill("skills/one");
    expect(await repo.findSkillDirsInClone(repoDir, "nope")).toEqual({
      kind: "path-missing",
      subPath: "nope",
    });
  });

  // TEST_SCENARIO: a path aimed at a skill's own directory exists but holds no child skill — the mistake that reads as an empty repo.
  it("reports path-empty when the path holds no skill one level below", async () => {
    await writeSkill("skills/one");
    expect(await repo.findSkillDirsInClone(repoDir, "skills/one")).toEqual({
      kind: "path-empty",
      subPath: "skills/one",
    });
  });

  // TEST_SCENARIO: silence stays correct without an explicit path, since the roots union tries three locations.
  it("stays found with no explicit path, whether or not the roots match", async () => {
    expect(await repo.findSkillDirsInClone(repoDir)).toEqual({
      kind: "found",
      dirs: [],
    });
    await writeSkill("skills/one");
    expect(await repo.findSkillDirsInClone(repoDir)).toEqual({
      kind: "found",
      dirs: ["skills/one"],
    });
  });
});
