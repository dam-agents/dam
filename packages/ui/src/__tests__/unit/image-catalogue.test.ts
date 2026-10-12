import { describe, expect, it } from "vitest";

import {
  defaultHarnessId,
  imageCatalogue,
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

const CATALOGUE = [template("codex"), template("default")];

describe("the harness catalogue", () => {
  // TEST_SCENARIO: the setup form offers one list, and it is the harness images. Templates carry a category so a future non-harness image cannot reach that list by default.
  it("offers the harness images", () => {
    expect(imageCatalogue(CATALOGUE).harnesses.map((t) => t.id)).toEqual([
      "codex",
      "default",
    ]);
  });

  // TEST_SCENARIO: an install that has Claude Code should open on it rather than on whichever harness happens to sort first, and an install without it still has to offer something.
  it("prefers the default template, and falls back to whatever is installed", () => {
    expect(defaultHarnessId(CATALOGUE)).toBe("default");
    expect(defaultHarnessId([template("codex")])).toBe("codex");
    expect(defaultHarnessId([])).toBeNull();
  });
});
