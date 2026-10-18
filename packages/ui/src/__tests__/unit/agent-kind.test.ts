// TEST_OVERVIEW: an agent from a starter kit shows Onboarding until it has
// TEST_OVERVIEW: marked its onboarding complete, and a kit reference parses
// TEST_OVERVIEW: into its catalog, kit and version.
import { describe, expect, test } from "vitest";

import {
  onboardingBadge,
  parseStarterKitRef,
} from "../../modules/agents/utils/agent-kind.js";

describe("onboardingBadge", () => {
  test("carries the fraction done once the agent has set its checklist", () => {
    expect(
      onboardingBadge({
        starterKit: "platform/code-reviewer@abc123",
        starterKitOnboarded: null,
        onboardingSteps: [
          { id: "github", label: "Connect GitHub", done: true },
          { id: "first-run", label: "Run the first review", done: false },
        ],
      })?.label,
    ).toBe("Onboarding 1/2");
  });

  test("shows while a kit agent has not marked onboarding complete", () => {
    const badge = onboardingBadge({
      starterKit: "platform/code-reviewer@abc123",
      starterKitOnboarded: null,
    });
    expect(badge?.label).toBe("Onboarding");
    expect(badge?.variant).toBe("kit");
    expect(badge?.title).toMatch(/Any schedules on it are held/);
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
