// TEST_OVERVIEW: A skill source repo may alias one skill directory from
// another via a relative symlink (dam publishes `.claude/skills/<name>` as
// links into `.agents/skills/<name>`). Resolving a skill in a clone must
// land on the real directory, and materializing it must publish a real
// directory — never a symlink into the clone's temp dir, which dangles the
// moment the clone is cleaned up and gets the install reaped as a ghost.
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalSkillRepository } from "../../modules/skills/infrastructure/local-skill-repository.js";
import { makeSkillName } from "../../modules/skills/domain/skill-name.js";
import type { SkillPath } from "../../modules/skills/domain/skill-path.js";

const skillMd = (name: string) =>
  `---\nname: ${name}\ndescription: about ${name}\n---\nbody\n`;

describe("resolveSkillDirInClone with symlinked source roots", () => {
  const repo = createLocalSkillRepository();
  let tmp: string;
  let clone: string;
  let target: SkillPath;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-symlink-"));
    clone = path.join(tmp, "clone");
    target = path.join(tmp, "home", ".agents", "skills") as SkillPath;
    await fs.mkdir(target, { recursive: true });

    const realDir = path.join(clone, ".agents", "skills", "grill-me");
    await fs.mkdir(realDir, { recursive: true });
    await fs.writeFile(
      path.join(realDir, "SKILL.md"),
      skillMd("grill-me"),
      "utf8",
    );
    await fs.mkdir(path.join(clone, ".claude", "skills"), { recursive: true });
    await fs.symlink(
      "../../.agents/skills/grill-me",
      path.join(clone, ".claude", "skills", "grill-me"),
    );
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("resolves through the symlinked root to the real directory", async () => {
    const name = makeSkillName("grill-me");
    if (!name.ok) throw new Error("invalid name");
    const resolved = await repo.resolveSkillDirInClone(clone, name.value);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const st = await fs.lstat(resolved.value);
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isDirectory()).toBe(true);
  });

  it("materializes a real directory, not a symlink into the clone", async () => {
    const name = makeSkillName("grill-me");
    if (!name.ok) throw new Error("invalid name");
    const resolved = await repo.resolveSkillDirInClone(clone, name.value);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    await repo.writeFromDir(name.value, [target], resolved.value);
    const published = path.join(target, "grill-me");
    const st = await fs.lstat(published);
    expect(st.isSymbolicLink()).toBe(false);
    await fs.rm(clone, { recursive: true, force: true });
    const content = await fs.readFile(
      path.join(published, "SKILL.md"),
      "utf8",
    );
    expect(content).toContain("grill-me");
  });

  it("skips a candidate whose symlink escapes the clone", async () => {
    const outside = path.join(tmp, "outside", "evil");
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "SKILL.md"), skillMd("evil"), "utf8");
    await fs.mkdir(path.join(clone, "skills"), { recursive: true });
    await fs.symlink(outside, path.join(clone, "skills", "evil"));
    const name = makeSkillName("evil");
    if (!name.ok) throw new Error("invalid name");
    const resolved = await repo.resolveSkillDirInClone(clone, name.value);
    expect(resolved.ok).toBe(false);
  });
});
