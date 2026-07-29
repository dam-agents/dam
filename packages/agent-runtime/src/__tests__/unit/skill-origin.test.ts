import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalSkillRepository } from "../../modules/skills/infrastructure/local-skill-repository.js";
import type { SkillPath } from "../../modules/skills/domain/skill-path.js";

async function writeSkill(
  root: string,
  dirName: string,
  content: string,
): Promise<void> {
  const dir = path.join(root, dirName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), content, "utf8");
}

const skillMd = (name: string, body = "instructions") =>
  `---\nname: ${name}\ndescription: about ${name}\n---\n${body}\n`;

describe("listLocal origin classification", () => {
  let tmp: string;
  let local: SkillPath[];
  let pristine: SkillPath[];

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-origin-"));
    local = [path.join(tmp, "home", ".agents", "skills") as SkillPath];
    pristine = [path.join(tmp, "image", ".agents", "skills") as SkillPath];
    await fs.mkdir(local[0], { recursive: true });
    await fs.mkdir(pristine[0], { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("classifies an untouched image-shipped skill as system", async () => {
    await writeSkill(pristine[0], "websearch", skillMd("websearch"));
    await writeSkill(local[0], "websearch", skillMd("websearch"));

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, pristine);

    expect(skills).toHaveLength(1);
    expect(skills[0].origin).toBe("system");
  });

  it("classifies a diverged image-shipped skill as system-modified", async () => {
    await writeSkill(pristine[0], "websearch", skillMd("websearch"));
    await writeSkill(
      local[0],
      "websearch",
      skillMd("websearch", "edited by the user"),
    );

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, pristine);

    expect(skills[0].origin).toBe("system-modified");
  });

  it("divergence anywhere in the skill dir counts, not just SKILL.md", async () => {
    await writeSkill(pristine[0], "helper", skillMd("helper"));
    await writeSkill(local[0], "helper", skillMd("helper"));
    await fs.writeFile(
      path.join(local[0], "helper", "extra.sh"),
      "echo added later\n",
      "utf8",
    );

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, pristine);

    expect(skills[0].origin).toBe("system-modified");
  });

  it("classifies a runtime-created skill as user", async () => {
    await writeSkill(local[0], "my-own", skillMd("my-own"));

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, pristine);

    expect(skills[0].origin).toBe("user");
  });

  it("classifies everything as user when the pristine root doesn't exist", async () => {
    await writeSkill(local[0], "anything", skillMd("anything"));
    const missing = [path.join(tmp, "does-not-exist") as SkillPath];

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, missing);

    expect(skills[0].origin).toBe("user");
  });

  it("matches on directory name even when frontmatter names differ", async () => {
    // A frontmatter rename is a content change, not a new identity.
    await writeSkill(pristine[0], "tool", skillMd("tool"));
    await writeSkill(local[0], "tool", skillMd("renamed-tool"));

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, pristine);

    expect(skills[0].name).toBe("renamed-tool");
    expect(skills[0].origin).toBe("system-modified");
  });

  it("finds counterparts in any pristine root, e.g. the staged-skills dir", async () => {
    const staged = path.join(tmp, "staged") as SkillPath;
    await fs.mkdir(staged, { recursive: true });
    await writeSkill(staged, "dam-experiment", skillMd("dam-experiment"));
    await writeSkill(local[0], "dam-experiment", skillMd("dam-experiment"));

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, [...pristine, staged]);

    expect(skills[0].origin).toBe("system");
  });

  it("ignores a pristine dir without a SKILL.md (not a skill counterpart)", async () => {
    // e.g. the staged kit's `commands/` dir sharing a root with real skills.
    await fs.mkdir(path.join(pristine[0], "commands"), { recursive: true });
    await fs.writeFile(
      path.join(pristine[0], "commands", "foo.md"),
      "not a skill\n",
    );
    await writeSkill(local[0], "commands", skillMd("commands"));

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, pristine);

    expect(skills[0].origin).toBe("user");
  });

  it("degrades an unhashable local copy to system-modified instead of throwing", async () => {
    await writeSkill(pristine[0], "broken", skillMd("broken"));
    await writeSkill(local[0], "broken", skillMd("broken"));
    await writeSkill(local[0], "healthy", skillMd("healthy"));
    const unreadable = path.join(local[0], "broken", "secret.txt");
    await fs.writeFile(unreadable, "cannot read me\n");
    await fs.chmod(unreadable, 0o000);

    try {
      const repo = createLocalSkillRepository();
      const skills = await repo.listLocal(local, pristine);

      const byName = Object.fromEntries(skills.map((s) => [s.name, s.origin]));
      expect(byName["broken"]).toBe("system-modified");
      expect(byName["healthy"]).toBe("user");
    } finally {
      await fs.chmod(unreadable, 0o644);
    }
  });

  it("stamps no origin when pristine paths aren't provided", async () => {
    await writeSkill(local[0], "my-own", skillMd("my-own"));

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local);

    expect(skills[0].origin).toBeUndefined();
  });

  it("classifies a mixed listing skill-by-skill", async () => {
    await writeSkill(pristine[0], "baked-intact", skillMd("baked-intact"));
    await writeSkill(pristine[0], "baked-edited", skillMd("baked-edited"));
    await writeSkill(local[0], "baked-intact", skillMd("baked-intact"));
    await writeSkill(
      local[0],
      "baked-edited",
      skillMd("baked-edited", "tweaked"),
    );
    await writeSkill(local[0], "authored", skillMd("authored"));

    const repo = createLocalSkillRepository();
    const skills = await repo.listLocal(local, pristine);

    const byName = Object.fromEntries(skills.map((s) => [s.name, s.origin]));
    expect(byName).toEqual({
      "baked-intact": "system",
      "baked-edited": "system-modified",
      authored: "user",
    });
  });
});
