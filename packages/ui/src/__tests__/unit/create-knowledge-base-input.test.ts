// TEST_OVERVIEW: the knowledge-base setup form submits only when name, KB template,
// TEST_OVERVIEW: harness and provider are all chosen; the create input carries the
// TEST_OVERVIEW: provider as a granted connection (deduplicated) on the trusted preset.
import { describe, expect, test } from "vitest";

import {
  buildKnowledgeBaseCreateInput,
  isKnowledgeBaseSetupComplete,
  type KnowledgeBaseSetupDraft,
} from "../../modules/knowledge-bases/lib/create-knowledge-base-input.js";

const complete: KnowledgeBaseSetupDraft = {
  name: " my kb ",
  templateId: "codex",
  kbTemplateId: "plain-wiki",
  providerRef: { id: "conn-p" } as KnowledgeBaseSetupDraft["providerRef"],
  connectionIds: ["conn-a", "conn-p"],
};

describe("isKnowledgeBaseSetupComplete", () => {
  test("requires every choice", () => {
    expect(isKnowledgeBaseSetupComplete(complete)).toBe(true);
    for (const patch of [
      { name: "  " },
      { templateId: null },
      { kbTemplateId: null },
      { providerRef: null },
    ] as const) {
      expect(isKnowledgeBaseSetupComplete({ ...complete, ...patch })).toBe(
        false,
      );
    }
  });
});

describe("buildKnowledgeBaseCreateInput", () => {
  test("trims the name and grants the provider once", () => {
    expect(buildKnowledgeBaseCreateInput(complete)).toEqual({
      name: "my kb",
      templateId: "codex",
      kbTemplateId: "plain-wiki",
      egressPreset: "trusted",
      connectionIds: ["conn-a", "conn-p"],
    });
  });

  test("refuses an incomplete draft", () => {
    expect(() =>
      buildKnowledgeBaseCreateInput({ ...complete, templateId: null }),
    ).toThrow();
  });
});
