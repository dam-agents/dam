import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLocalSkillRepository } from "../../modules/skills/infrastructure/local-skill-repository.js";
import type { SkillPath } from "../../modules/skills/domain/skill-path.js";

/**
 * TEST_OVERVIEW: The skills every agent image ships in its workspace seed, as
 * the agent's runtime lists them. A harness puts each skill's name and
 * description into the model's context and opens the body only when the
 * description says to, so each skill the runtime lists there must carry a
 * description the Agent Skills format accepts: present and at most 1024
 * characters.
 */

const IMAGE_SKILLS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../agents/base/rootfs/app/working-dir/.agents/skills",
) as SkillPath;

describe("image-shipped skills", () => {
  // TEST_SCENARIO: the platform-docs skill, which tells any agent how to answer a question about the platform from its docs and release notes, is discovered like the other shipped skills.
  it("lists platform-docs, and each listed skill has a description that fits", async () => {
    const skills = await createLocalSkillRepository().listLocal(
      [IMAGE_SKILLS],
      [IMAGE_SKILLS],
    );

    expect(skills.map((s) => s.name)).toContain("platform-docs");
    for (const skill of skills) {
      expect(skill.description.length, skill.name).toBeGreaterThan(0);
      expect(skill.description.length, skill.name).toBeLessThanOrEqual(1024);
    }
  });
});
