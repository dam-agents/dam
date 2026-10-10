import type { Skill, SkillPublishRecord, SkillSource } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  latestPublishByName,
  publishTargetSources,
  resolveTrackTarget,
} from "../../modules/sandboxes/components/skills/publish-target.js";

const REPO = "https://github.com/acme/skills";

const source = (id: string, name: string, gitUrl = REPO): SkillSource => ({
  id,
  name,
  gitUrl,
});

const scanned = (name: string): Skill => ({
  source: REPO,
  name,
  description: "",
  version: "deadbeef",
  contentHash: "h1",
});

const publish = (
  overrides: Partial<SkillPublishRecord> = {},
): SkillPublishRecord => ({
  skillName: "websearch",
  sourceId: "src-old",
  sourceName: "skills",
  sourceGitUrl: REPO,
  prUrl: `${REPO}/pull/7`,
  publishedAt: "2026-08-01T00:00:00.000Z",
  prState: "merged",
  prStateCheckedAt: null,
  ...overrides,
});

describe("publishTargetSources", () => {
  it("puts the original source first, then other sources of the same repository", () => {
    const out = publishTargetSources(publish(), [
      source("src-new", "dam repo skills"),
      source("src-other", "other", "https://github.com/acme/other"),
      source("src-old", "skills"),
    ]);
    expect(out.map((s) => s.id)).toEqual(["src-old", "src-new"]);
  });

  it("matches the repository regardless of case and a trailing .git", () => {
    const out = publishTargetSources(
      publish({ sourceGitUrl: "https://github.com/Acme/Skills.git" }),
      [source("src-new", "dam repo skills")],
    );
    expect(out.map((s) => s.id)).toEqual(["src-new"]);
  });
});

describe("resolveTrackTarget (#4030)", () => {
  it("tracks from the original source while it still lists the skill", () => {
    const target = resolveTrackTarget(
      publish(),
      [source("src-old", "skills")],
      { "src-old": [scanned("websearch")] },
    );
    expect(target).toMatchObject({
      kind: "ready",
      source: { id: "src-old" },
      skill: { name: "websearch" },
    });
  });

  it("tracks from a re-added source of the same repository after the original was removed", () => {
    const target = resolveTrackTarget(
      publish(),
      [source("src-new", "dam repo skills")],
      { "src-new": [scanned("websearch")] },
    );
    expect(target).toMatchObject({
      kind: "ready",
      source: { id: "src-new", name: "dam repo skills" },
    });
  });

  it("falls through to another source of the repository when the original doesn't list the skill", () => {
    const target = resolveTrackTarget(
      publish(),
      [source("src-old", "skills"), source("src-new", "dam repo skills")],
      { "src-old": [], "src-new": [scanned("websearch")] },
    );
    expect(target).toMatchObject({ kind: "ready", source: { id: "src-new" } });
  });

  it("says the source hasn't been scanned while a matching source has no list yet", () => {
    const target = resolveTrackTarget(
      publish(),
      [source("src-new", "dam repo skills")],
      {},
    );
    expect(target).toEqual({
      kind: "unavailable",
      sourceName: "dam repo skills",
      reason:
        "dam repo skills hasn't been scanned yet, so this skill's published version isn't known",
    });
  });

  it("asks for a refresh when every matching source is scanned but none lists the skill", () => {
    const target = resolveTrackTarget(
      publish(),
      [source("src-new", "dam repo skills")],
      { "src-new": [scanned("other-skill")] },
    );
    expect(target).toMatchObject({
      kind: "unavailable",
      sourceName: "dam repo skills",
      reason: expect.stringContaining("Refresh the source"),
    });
  });

  it("asks to add a source for the repository when no current source points at it", () => {
    const target = resolveTrackTarget(
      publish(),
      [source("src-x", "other", "https://github.com/acme/other")],
      { "src-x": [scanned("websearch")] },
    );
    expect(target).toEqual({
      kind: "unavailable",
      sourceName: "skills",
      reason:
        "No skill source points at github.com/acme/skills anymore. Add it as a source to track this skill",
    });
  });
});

describe("latestPublishByName", () => {
  it("keeps the newest publish of a skill whatever the list order", () => {
    const newer = publish({
      sourceId: "src-b",
      sourceGitUrl: "https://github.com/acme/other",
      publishedAt: "2026-09-01T00:00:00.000Z",
    });
    const older = publish();
    expect(latestPublishByName([newer, older]).get("websearch")).toBe(newer);
    expect(latestPublishByName([older, newer]).get("websearch")).toBe(newer);
  });
});
