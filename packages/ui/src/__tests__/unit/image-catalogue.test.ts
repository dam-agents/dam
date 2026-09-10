import { describe, expect, it } from "vitest";

import { imageCatalogue } from "../../modules/sandboxes/lib/image-catalogue.js";
import type { TemplateView } from "../../types.js";

function template(
  id: string,
  category: TemplateView["category"] = "harness",
): TemplateView {
  return {
    id,
    name: id,
    image: `${id}:latest`,
    category,
    experimental: false,
  };
}

const CATALOGUE = [
  template("claude-code"),
  template("codex"),
  template("nous", "preconfigured"),
];

describe("imageCatalogue", () => {
  // TEST_SCENARIO: preconfigured images are picked elsewhere; letting one into the harness list offers it as a coding agent, which it is not.
  it("leaves specialized images out of the only list it offers", () => {
    const { harnesses } = imageCatalogue(CATALOGUE);
    expect(harnesses.map((t) => t.id)).toEqual(["claude-code", "codex"]);
  });

  it("is empty rather than undefined on an install that ships no templates", () => {
    expect(imageCatalogue([]).harnesses).toEqual([]);
  });
});
