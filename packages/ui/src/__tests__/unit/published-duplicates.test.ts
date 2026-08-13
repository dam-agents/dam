import type { LocalSkill, Skill, SkillPublishRecord } from "api-server-api";
import { describe, expect, it } from "vitest";

import { publishedDuplicatesBySource } from "../../modules/sandboxes/components/skills/published-duplicates.js";

const local = (name: string, contentHash?: string): LocalSkill => ({
  name,
  description: "",
  skillPath: "/home/agent/.agents/skills",
  ...(contentHash !== undefined ? { contentHash } : {}),
});

const scanned = (name: string, contentHash: string): Skill => ({
  source: "https://github.com/acme/skills",
  name,
  description: "",
  version: "deadbeef",
  contentHash,
});

const publish = (
  skillName: string,
  sourceId: string,
  prState: SkillPublishRecord["prState"] = null,
): SkillPublishRecord => ({
  skillName,
  sourceId,
  sourceName: "acme",
  sourceGitUrl: "https://github.com/acme/skills",
  prUrl: "https://github.com/acme/skills/pull/7",
  publishedAt: "2026-08-01T00:00:00.000Z",
  prState,
  prStateCheckedAt: null,
});

describe("publishedDuplicatesBySource (#3019)", () => {
  it("suppresses the source row when the publish record and the hash both match", () => {
    const out = publishedDuplicatesBySource(
      [local("websearch", "h1")],
      [publish("websearch", "src-1")],
      { "src-1": [scanned("websearch", "h1")] },
    );
    expect(out.get("src-1")).toEqual(new Set(["websearch"]));
  });

  it("does not gate on prState — an unresolved record still suppresses on hash proof", () => {
    const out = publishedDuplicatesBySource(
      [local("websearch", "h1")],
      [publish("websearch", "src-1", null)],
      { "src-1": [scanned("websearch", "h1")] },
    );
    expect(out.get("src-1")).toEqual(new Set(["websearch"]));
  });

  it("never suppresses without a local hash — absence cannot prove a match", () => {
    const out = publishedDuplicatesBySource(
      [local("websearch")],
      [publish("websearch", "src-1", "merged")],
      { "src-1": [scanned("websearch", "h1")] },
    );
    expect(out.size).toBe(0);
  });

  it("shows both rows for a locally edited copy (hash mismatch)", () => {
    const out = publishedDuplicatesBySource(
      [local("websearch", "h-edited")],
      [publish("websearch", "src-1", "merged")],
      { "src-1": [scanned("websearch", "h1")] },
    );
    expect(out.size).toBe(0);
  });

  it("leaves an unrelated same-named skill in another source alone — no publish record there", () => {
    const out = publishedDuplicatesBySource(
      [local("websearch", "h1")],
      [publish("websearch", "src-1")],
      {
        "src-1": [scanned("websearch", "h1")],
        "src-2": [scanned("websearch", "h1")],
      },
    );
    expect(out.get("src-1")).toEqual(new Set(["websearch"]));
    expect(out.has("src-2")).toBe(false);
  });

  it("suppresses in every source the skill was published to, independently", () => {
    const out = publishedDuplicatesBySource(
      [local("websearch", "h1")],
      [publish("websearch", "src-1"), publish("websearch", "src-2")],
      {
        "src-1": [scanned("websearch", "h1")],
        "src-2": [scanned("websearch", "h-old")],
      },
    );
    expect(out.get("src-1")).toEqual(new Set(["websearch"]));
    expect(out.has("src-2")).toBe(false);
  });
});
