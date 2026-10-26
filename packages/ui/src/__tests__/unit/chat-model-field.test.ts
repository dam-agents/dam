import { describe, expect, test } from "vitest";

import {
  chatDefaultView,
  modelIsDirty,
  shownModel,
} from "../../modules/sandboxes/lib/chat-model-field.js";

const resolved = chatDefaultView({ model: "claude/ibm/claude-opus-5" });
const unsaved = chatDefaultView(null);

describe("the model control reads the chat default", () => {
  // TEST_SCENARIO: the release starts a chat from the saved pair. A harness setting of A with a saved pair of B must show B, or the control names a model the next chat will not use.
  test("shows the saved pair, not the harness setting", () => {
    expect(shownModel(resolved, "claude-haiku")).toBe(
      "claude/ibm/claude-opus-5",
    );
    expect(shownModel(resolved, null)).toBe("claude/ibm/claude-opus-5");
  });

  // TEST_SCENARIO: before any pair is saved the field falls back to the harness setting, as 0.2.23 showed it.
  test("falls back to the harness setting with no pair saved", () => {
    expect(shownModel(unsaved, "claude-haiku")).toBe("claude-haiku");
    expect(shownModel(undefined, "claude-haiku")).toBe("claude-haiku");
  });
});

describe("a model choice is saved when the pair needs it", () => {
  // TEST_SCENARIO: the field shows the harness setting because no pair is saved, and the release refuses to run without one. Picking the value already shown must therefore save it, not read as no change.
  test("picking the value already shown saves the missing pair", () => {
    expect(modelIsDirty(unsaved, "claude-haiku", "claude-haiku")).toBe(true);
    expect(modelIsDirty(undefined, "claude-haiku", "claude-haiku")).toBe(false);
  });

  // TEST_SCENARIO: after the pair is saved, the same choice is the baseline and nothing is dirty; a different model still is.
  test("a saved pair settles the field", () => {
    expect(
      modelIsDirty(
        resolved,
        "claude/ibm/claude-opus-5",
        "claude/ibm/claude-opus-5",
      ),
    ).toBe(false);
    expect(
      modelIsDirty(
        resolved,
        "claude/ibm/claude-sonnet",
        "claude/ibm/claude-opus-5",
      ),
    ).toBe(true);
    expect(modelIsDirty(resolved, null, "claude/ibm/claude-opus-5")).toBe(true);
  });
});
