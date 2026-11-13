// TEST_OVERVIEW: The Experimental features row for the assistant reads the way the
// TEST_OVERVIEW: design asks, with both names taken from the brand: the title is the
// TEST_OVERVIEW: install's assistant name and the description says it can control the
// TEST_OVERVIEW: install's platform for them.
import { describe, expect, it } from "vitest";

import { assistantFeatureRow } from "../../modules/features/lib/assistant-feature-row.js";

const brand = {
  name: "DAM",
  short: "dam",
  title: "",
  vendor: "",
  assistantName: "Dambledore",
  theme: {
    light: {
      accent: "#0F62FE",
      accentHover: "#0353E9",
      accentLight: "#edf5ff",
    },
    dark: { accent: "#4589FF", accentHover: "#78A9FF", accentLight: "#0f1f3a" },
  },
};

describe("the assistant's row in Experimental features", () => {
  // TEST_SCENARIO: the row is the `dambledore` feature, titled with the install's assistant and described in the design's words with the install's own platform name.
  it("reads as the assistant row the design asks for", () => {
    expect(assistantFeatureRow(brand)).toEqual({
      id: "dambledore",
      label: "Dambledore",
      description: "An assistant that can control DAM for you.",
    });
  });

  // TEST_SCENARIO: a branded install shows its own names, so nothing is hardcoded.
  it("takes both names from the brand", () => {
    const other = { ...brand, name: "Platform", assistantName: "Ada" };
    expect(assistantFeatureRow(other)).toMatchObject({
      label: "Ada",
      description: "An assistant that can control Platform for you.",
    });
  });
});
