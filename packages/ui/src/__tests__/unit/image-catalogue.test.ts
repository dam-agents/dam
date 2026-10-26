import { describe, expect, it } from "vitest";

import {
  defaultHarnessId,
  imageCatalogue,
  reconcileHarnessSelection,
} from "../../modules/sandboxes/lib/image-catalogue.js";
import type { TemplateView } from "../../types.js";

function template(id: string): TemplateView {
  return {
    id,
    name: id,
    image: `${id}:latest`,
    category: "harness",
    experimental: false,
  };
}

const CATALOGUE = [template("codex"), template("claude-code")];

describe("the harness catalogue", () => {
  // TEST_SCENARIO: the setup form offers one list, and it is the harness images. Templates carry a category so a future non-harness image cannot reach that list by default.
  it("offers the harness images", () => {
    expect(imageCatalogue(CATALOGUE).harnesses.map((t) => t.id)).toEqual([
      "codex",
      "claude-code",
    ]);
  });

  // TEST_SCENARIO: an install that has Claude Code should open on it rather than on whichever harness happens to sort first, and an install without it still has to offer something.
  it("prefers Claude Code, and falls back to whatever is installed", () => {
    expect(defaultHarnessId(CATALOGUE)).toBe("claude-code");
    expect(defaultHarnessId([template("codex")])).toBe("codex");
    expect(defaultHarnessId([])).toBeNull();
  });

  // TEST_SCENARIO: a harness can disappear from an install between renders. A selection pointing at one that is gone must be corrected, or the form submits a template the platform no longer has.
  it("corrects a selection whose harness is gone", () => {
    expect(
      reconcileHarnessSelection(CATALOGUE, "codex", { allowNone: false }),
    ).toBeNull();
    expect(
      reconcileHarnessSelection(CATALOGUE, "retired", { allowNone: false }),
    ).toEqual({ templateId: "claude-code" });
    expect(
      reconcileHarnessSelection(CATALOGUE, "retired", { allowNone: true }),
    ).toEqual({ templateId: null });
    expect(
      reconcileHarnessSelection(CATALOGUE, null, { allowNone: false }),
    ).toEqual({
      templateId: "claude-code",
    });
  });
});
