import { describe, it, expect } from "vitest";
import { parseSeedSources, seedSlug, seedSourceId } from "../../modules/skills/infrastructure/seed-sources.js";

describe("seedSlug", () => {
  it("kebab-cases the name", () => {
    expect(seedSlug("Anthropic Skills")).toBe("anthropic-skills");
    expect(seedSlug("Cluster Ops")).toBe("cluster-ops");
  });

  it("collapses non-alphanumerics into single dashes and trims edges", () => {
    expect(seedSlug("  Foo //Bar  ")).toBe("foo-bar");
    expect(seedSlug("a---b")).toBe("a-b");
  });

  it("returns empty for an all-symbol name", () => {
    expect(seedSlug("???")).toBe("");
  });
});

describe("seedSourceId", () => {
  it("prefixes with skill-src-seed-", () => {
    expect(seedSourceId("Cluster Ops")).toBe("skill-src-seed-cluster-ops");
  });
});

describe("parseSeedSources", () => {
  it("returns empty for unset and empty inputs", () => {
    expect(parseSeedSources(undefined)).toEqual([]);
    expect(parseSeedSources("")).toEqual([]);
    expect(parseSeedSources("   ")).toEqual([]);
  });

  it("parses a valid JSON array of seeds", () => {
    const raw = JSON.stringify([
      { name: "Anthropic Skills", gitUrl: "https://github.com/anthropics/skills" },
      { name: "Cluster Ops", gitUrl: "https://github.com/sys/cluster-ops" },
    ]);
    expect(parseSeedSources(raw)).toEqual([
      {
        id: "skill-src-seed-anthropic-skills",
        name: "Anthropic Skills",
        gitUrl: "https://github.com/anthropics/skills",
      },
      {
        id: "skill-src-seed-cluster-ops",
        name: "Cluster Ops",
        gitUrl: "https://github.com/sys/cluster-ops",
      },
    ]);
  });

  it("rejects malformed JSON with a clear message", () => {
    expect(() => parseSeedSources("{not json")).toThrow(/SKILL_SOURCES_SEED is not valid JSON/);
  });

  it("rejects shape mismatches via Zod", () => {
    expect(() => parseSeedSources(JSON.stringify([{ name: "x" }]))).toThrow();
    expect(() => parseSeedSources(JSON.stringify([{ name: "x", gitUrl: "not-a-url" }]))).toThrow();
    expect(() => parseSeedSources(JSON.stringify([{ name: "", gitUrl: "https://github.com/x/y" }]))).toThrow();
  });

  it("rejects an empty slug (name slugs to nothing)", () => {
    expect(() =>
      parseSeedSources(JSON.stringify([{ name: "???", gitUrl: "https://github.com/x/y" }])),
    ).toThrow(/empty id/);
  });

  it("rejects slug collisions across entries", () => {
    expect(() =>
      parseSeedSources(JSON.stringify([
        { name: "Anthropic Skills", gitUrl: "https://github.com/x/a" },
        { name: "anthropic-skills", gitUrl: "https://github.com/x/b" },
      ])),
    ).toThrow(/both slug to/);
  });
});
