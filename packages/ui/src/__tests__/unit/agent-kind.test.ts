// TEST_OVERVIEW: the agent row's provenance and state badges — an agent from a
// TEST_OVERVIEW: starter kit is badged with the kit's id, and shows Onboarding
// TEST_OVERVIEW: until the agent has marked its onboarding complete; a plain
// TEST_OVERVIEW: agent shows neither.
import { describe, expect, test } from "vitest";

import {
  knowledgeBadge,
  onboardingBadge,
  parseStarterKitRef,
  starterKitBadge,
} from "../../modules/agents/utils/agent-kind.js";
import type { AgentView } from "../../types.js";

function agent(extra: Partial<AgentView>): AgentView {
  return { id: "a", name: "a", ...extra } as AgentView;
}

describe("knowledgeBadge", () => {
  // TEST_SCENARIO: the kit badge names the procedure an agent was built from, which does not say what the agent offers. Someone scanning the agents list needs to see which ones hold knowledge others can query.
  test("badges an agent that publishes a knowledge base", () => {
    expect(agent({ kbShareRoots: ["wiki"] })).toBeDefined();
    expect(knowledgeBadge(agent({ kbShareRoots: ["wiki"] }))?.label).toBe(
      "Knowledge",
    );
  });

  // TEST_SCENARIO: an agent stamped before kits says so with its kind rather than with roots, and must badge the same way — the badge is about the capability, not about how the agent was made.
  test("badges a knowledge base made before kits", () => {
    expect(knowledgeBadge(agent({ kind: "knowledge-base" }))?.label).toBe(
      "Knowledge",
    );
  });

  test("leaves an ordinary agent unbadged", () => {
    expect(knowledgeBadge(agent({}))).toBeNull();
    expect(knowledgeBadge(agent({ starterKit: "platform/x@1" }))).toBeNull();
  });
});

describe("starterKitBadge", () => {
  test("names the kit without its catalog or version, keeping the full ref on hover", () => {
    expect(
      starterKitBadge({
        starterKit: "platform/code-reviewer@abc123",
        kbTemplateId: null,
      }),
    ).toEqual({
      label: "code-reviewer",
      variant: "muted",
      title: "platform/code-reviewer@abc123",
    });
  });

  test("is absent for an agent that came from no kit", () => {
    expect(
      starterKitBadge({ starterKit: null, kbTemplateId: null }),
    ).toBeNull();
  });

  // TEST_SCENARIO: a knowledge base made before kits carries no kit stamp, only the template it was built from. The template ids are the kit ids, so it reads as that kit rather than as a kind of its own.
  test("names the kit a pre-kits knowledge base was built from", () => {
    expect(
      starterKitBadge({ starterKit: null, kbTemplateId: "llm-wiki" }),
    ).toEqual({
      label: "llm-wiki",
      variant: "muted",
      title: "platform/llm-wiki",
    });
  });
});

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
