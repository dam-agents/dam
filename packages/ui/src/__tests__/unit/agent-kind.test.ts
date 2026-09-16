// TEST_OVERVIEW: the agent row's provenance and state badges — an agent from a
// TEST_OVERVIEW: starter kit is badged with the kit's id, and shows Onboarding
// TEST_OVERVIEW: until the agent has marked its onboarding complete; a plain
// TEST_OVERVIEW: agent shows neither.
import { describe, expect, test } from "vitest";

import {
  onboardingBadge,
  parseStarterKitRef,
  starterKitBadge,
} from "../../modules/agents/utils/agent-kind.js";

describe("starterKitBadge", () => {
  test("names the kit without its catalog or version, keeping the full ref on hover", () => {
    expect(
      starterKitBadge({ starterKit: "platform/code-reviewer@abc123" }),
    ).toEqual({
      label: "code-reviewer",
      variant: "muted",
      title: "platform/code-reviewer@abc123",
    });
  });

  test("is absent for an agent that came from no kit", () => {
    expect(starterKitBadge({ starterKit: null })).toBeNull();
  });
});

describe("onboardingBadge", () => {
  test("shows while a kit agent has not marked onboarding complete", () => {
    const badge = onboardingBadge({
      starterKit: "platform/code-reviewer@abc123",
      starterKitOnboarded: null,
    });
    expect(badge?.label).toBe("Onboarding");
    expect(badge?.variant).toBe("kit");
    expect(badge?.title).toMatch(/schedules are held/);
  });

  test("goes away once the completion mark is set", () => {
    expect(
      onboardingBadge({
        starterKit: "platform/code-reviewer@abc123",
        starterKitOnboarded: "2026-09-15T14:00:00Z",
      }),
    ).toBeNull();
  });

  test("never shows for an agent that came from no kit", () => {
    expect(
      onboardingBadge({ starterKit: null, starterKitOnboarded: null }),
    ).toBeNull();
  });
});

describe("parseStarterKitRef", () => {
  test("splits catalog, kit and version", () => {
    expect(parseStarterKitRef("platform/code-reviewer@abc123")).toEqual({
      catalog: "platform",
      kit: "code-reviewer",
      version: "abc123",
    });
  });

  test("tolerates a ref without a version, and rejects one without a catalog", () => {
    expect(parseStarterKitRef("curated/docs")).toEqual({
      catalog: "curated",
      kit: "docs",
      version: null,
    });
    expect(parseStarterKitRef("code-reviewer@abc")).toBeNull();
    expect(parseStarterKitRef("platform/@v1")).toBeNull();
  });
});
