// TEST_OVERVIEW: a compact label such as the model chip names a provider by its preset's short name, both CurveBender templates share one, and a preset without a short name falls back to its display name.
import { describe, expect, it } from "vitest";
import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  shortNameForTemplate,
} from "api-server-api";

describe("shortNameForTemplate", () => {
  /** TEST_SCENARIO: the IBM proxy and both CurveBender templates have short names. */
  it("names presets by their short name", () => {
    expect(shortNameForTemplate("ibm-litellm")).toBe("IBM proxy");
    expect(shortNameForTemplate("curve-bender")).toBe("CurveBender");
    expect(shortNameForTemplate(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)).toBe(
      "CurveBender",
    );
  });

  /** TEST_SCENARIO: a preset with no short name keeps its display name, and an unknown template has none. */
  it("falls back to the display name", () => {
    expect(shortNameForTemplate("anthropic")).toBe("Anthropic");
    expect(shortNameForTemplate("no-such-template")).toBeNull();
  });
});
