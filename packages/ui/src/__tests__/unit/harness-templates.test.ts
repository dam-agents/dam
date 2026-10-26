// TEST_OVERVIEW: the 0.2.24 install ships one shared harness image and keeps the four retired template ids as aliases. The old chooser offers one entry per harness the catalogue lists, keyed by the retired id so creation and existing agent cards still speak 0.2.23, and the entry carries the shared image, the harness's providers and its release notes.
import { describe, expect, it } from "vitest";

import {
  harnessForTemplateId,
  withHarnessTemplates,
} from "../../modules/templates/lib/harness-templates.js";
import type { TemplateView } from "../../types.js";

const SHARED: TemplateView = {
  id: "default",
  name: "Coding agent",
  image: "quay.io/dam-agents/default:1",
  category: "harness",
  experimental: false,
};

const CATALOGUE = {
  default: "claude-code" as const,
  harnesses: [
    {
      name: "claude-code" as const,
      displayName: "Claude",
      description: "Anthropic's coding agent",
      providers: ["anthropic" as const],
      tags: ["Anthropic"],
      experimental: false,
    },
    {
      name: "pi" as const,
      displayName: "Pi",
      providers: ["openai" as const],
      tags: ["Any provider"],
      releaseNotesUrl: "https://pi.invalid/notes",
      experimental: true,
    },
    {
      name: "copilot" as const,
      displayName: "Copilot",
      providers: ["openai" as const],
      tags: [],
      experimental: false,
    },
  ],
};

describe("the harness catalogue as templates", () => {
  // TEST_SCENARIO: an install whose only template is the shared image still offers a choice per harness, on the retired ids 0.2.23 sent, and every entry points at the shared image so creating an agent pulls no image of its own.
  it("offers one entry per harness on the retired template ids", () => {
    const merged = withHarnessTemplates([SHARED], CATALOGUE);
    const harnesses = merged.filter((t) => t.id !== "default");
    expect(harnesses.map((t) => t.id)).toEqual(["claude-code", "pi-agent"]);
    expect(harnesses.map((t) => t.name)).toEqual(["Claude", "Pi"]);
    expect(harnesses.every((t) => t.image === SHARED.image)).toBe(true);
    expect(harnesses[1]).toMatchObject({
      harness: "pi",
      providers: ["openai"],
      releaseNotesUrl: "https://pi.invalid/notes",
      experimental: true,
    });
  });

  // TEST_SCENARIO: a harness with no retired id cannot be named to the server, so the chooser leaves it out rather than offer a template the create call would reject. Without the shared image, or before the catalogue answers, the list is unchanged.
  it("leaves out what the old form cannot name, and passes the list through otherwise", () => {
    expect(
      withHarnessTemplates([SHARED], CATALOGUE).some((t) => t.id === "copilot"),
    ).toBe(false);
    expect(withHarnessTemplates([SHARED], undefined)).toEqual([SHARED]);
    const custom: TemplateView = { ...SHARED, id: "acme", image: "acme:1" };
    expect(withHarnessTemplates([custom], CATALOGUE)).toEqual([custom]);
  });

  // TEST_SCENARIO: creation and kit application name the harness behind the retired id, so the server sets `spec.harness` even though the retired id resolves to the shared image, which names none.
  it("maps a retired template id back to its harness", () => {
    expect(harnessForTemplateId("pi-agent")).toBe("pi");
    expect(harnessForTemplateId("default")).toBeUndefined();
    expect(harnessForTemplateId(null)).toBeUndefined();
  });
});
