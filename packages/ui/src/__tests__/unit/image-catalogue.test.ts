import { describe, expect, it } from "vitest";

import { defaultHarnessId } from "../../modules/sandboxes/lib/image-catalogue.js";
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

const CATALOGUE = [template("codex"), template("default")];

describe("the harness catalogue", () => {
  // TEST_SCENARIO: an install that has Claude Code should open on it rather than on whichever harness happens to sort first, and an install without it still has to offer something.
  it("prefers the default template, and falls back to whatever is installed", () => {
    expect(defaultHarnessId(CATALOGUE)).toBe("default");
    expect(defaultHarnessId([template("codex")])).toBe("codex");
    expect(defaultHarnessId([])).toBeNull();
  });
});
