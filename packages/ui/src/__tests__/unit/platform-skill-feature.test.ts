import type { LocalSkill } from "api-server-api";
import { platformSkillFeature } from "api-server-api";
import { describe, expect, it } from "vitest";

/**
 * TEST_OVERVIEW: A Local Skill is recognised as a platform skill — one the
 * platform ships to make a feature usable — only when the image vouches for
 * it. The verdict is the intersection of two independent facts: the
 * agent-runtime judged the skill's Skill Origin against the pristine roots in
 * the image, and the skill's name is in the platform's own registry. Either
 * one alone is not enough: the registry is public knowledge, and a name is
 * just a directory a user can create on the agent-writable PVC.
 */

function skill(over: Partial<LocalSkill>): LocalSkill {
  return {
    name: "platform-schedules",
    description: "",
    skillPath: "/home/agent/.agents/skills",
    ...over,
  };
}

describe("platformSkillFeature", () => {
  /**
   * TEST_SCENARIO: The image ships `platform-schedules` so Schedules works. A
   * user edit moves the local copy off the pristine hash, which the runtime
   * reports as system-modified — the skill still came from the platform, so
   * it must keep naming its feature.
   */
  it("should name the feature for an image-shipped skill, edited or not", () => {
    expect(platformSkillFeature(skill({ origin: "system" }))?.id).toBe(
      "schedules",
    );
    expect(platformSkillFeature(skill({ origin: "system-modified" }))?.id).toBe(
      "schedules",
    );
  });

  /**
   * TEST_SCENARIO: A user authors a skill directory named after a registry
   * entry on the PVC. It has no pristine counterpart, so the runtime judges
   * it `user` — and a pod predating origin classification reports no origin
   * at all, which readers treat as user. Neither may borrow the platform's
   * badge.
   */
  it("should refuse a user-authored skill squatting on a platform name", () => {
    expect(platformSkillFeature(skill({ origin: "user" }))).toBeUndefined();
    expect(platformSkillFeature(skill({}))).toBeUndefined();
  });
});
