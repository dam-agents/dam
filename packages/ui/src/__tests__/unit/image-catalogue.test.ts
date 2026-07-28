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
];

// The switch is the only door to a VM sandbox: a stale `vm: true` in a
// persisted wizard snapshot must not open it once the feature is off again.
describe("imageCatalogue", () => {
  it("hides VM templates and the toggle when the feature is off", () => {
    for (const vm of [false, true]) {
      const { showVmToggle, vmSelected, harnesses } = imageCatalogue(
        CATALOGUE,
        { vm, vmFeatureEnabled: false },
      );
      expect(showVmToggle).toBe(false);
      expect(vmSelected).toBe(false);
      expect(harnesses.map((t) => t.id)).toEqual(["claude-code", "codex"]);
    }
  });

  it("reveals the toggle but still shows container images until it is on", () => {
    const { showVmToggle, harnesses } = imageCatalogue(CATALOGUE, {
      vm: false,
      vmFeatureEnabled: true,
    });
    expect(showVmToggle).toBe(true);
    expect(harnesses.map((t) => t.id)).toEqual(["claude-code", "codex"]);
  });

  it("swaps the catalogue to VM images when the toggle is on", () => {
    const { vmSelected, harnesses, preconfigured } = imageCatalogue(CATALOGUE, {
      vm: true,
      vmFeatureEnabled: true,
    });
    expect(vmSelected).toBe(true);
    expect(harnesses.map((t) => t.id)).toEqual(["claude-code-vm"]);
    expect(preconfigured).toEqual([]);
  });

  it("keeps the toggle hidden when the install ships no VM templates", () => {
    const containersOnly = CATALOGUE.filter((t) => !t.vm);
    const { showVmToggle, vmSelected, harnesses } = imageCatalogue(
      containersOnly,
      { vm: true, vmFeatureEnabled: true },
    );
    expect(showVmToggle).toBe(false);
    expect(vmSelected).toBe(false);
    expect(harnesses.map((t) => t.id)).toEqual(["claude-code", "codex"]);
  });
});
