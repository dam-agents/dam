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
  // TEST_SCENARIO: the harness list is the only one the setup form offers, and a preconfigured image reaching it would be offered as something to build an agent on rather than the prepared thing it is.
  it("leaves specialized images out of the only list it offers", () => {
    const { harnesses } = imageCatalogue(CATALOGUE);
    expect(harnesses.map((t) => t.id)).toEqual(["claude-code", "codex"]);
  });
});
