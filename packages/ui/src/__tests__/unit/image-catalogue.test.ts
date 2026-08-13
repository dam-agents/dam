import { describe, expect, it } from "vitest";

import { imageCatalogue } from "../../modules/sandboxes/lib/image-catalogue.js";
import type { TemplateView } from "../../types.js";

function template(
  id: string,
  vm: boolean,
  category: TemplateView["category"] = "harness",
): TemplateView {
  return {
    id,
    name: id,
    image: `${id}:latest`,
    category,
    experimental: vm,
    vm,
  };
}

const CATALOGUE = [
  template("claude-code", false),
  template("codex", false),
  template("claude-code-vm", true),
  template("nous", false, "preconfigured"),
  template("nous-vm", true, "preconfigured"),
];

describe("imageCatalogue", () => {
  it("hides VM-backed templates entirely when the feature is off", () => {
    const { harnesses, preconfigured } = imageCatalogue(CATALOGUE, {
      vmFeatureEnabled: false,
    });
    expect(harnesses.map((t) => t.id)).toEqual(["claude-code", "codex"]);
    expect(preconfigured.map((t) => t.id)).toEqual(["nous"]);
  });

  it("mixes VM-backed templates in alongside container ones when on", () => {
    const { harnesses, preconfigured } = imageCatalogue(CATALOGUE, {
      vmFeatureEnabled: true,
    });
    expect(harnesses.map((t) => t.id)).toEqual([
      "claude-code",
      "codex",
      "claude-code-vm",
    ]);
    expect(preconfigured.map((t) => t.id)).toEqual(["nous", "nous-vm"]);
  });

  it("is a no-op on an install that ships no VM templates", () => {
    const containersOnly = CATALOGUE.filter((t) => !t.vm);
    for (const vmFeatureEnabled of [false, true]) {
      const { harnesses } = imageCatalogue(containersOnly, {
        vmFeatureEnabled,
      });
      expect(harnesses.map((t) => t.id)).toEqual(["claude-code", "codex"]);
    }
  });
});
