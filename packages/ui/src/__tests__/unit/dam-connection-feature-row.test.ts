// TEST_OVERVIEW: The Experimental features row that offers the Connection letting
// TEST_OVERVIEW: an agent act as its owner: its own switch beside the assistant's,
// TEST_OVERVIEW: named by the install's brand, and saying what turning it off does
// TEST_OVERVIEW: — nothing already made stops working.
import { describe, expect, it } from "vitest";

import { damConnectionFeatureRow } from "../../modules/features/lib/dam-connection-feature-row.js";

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

describe("the connection row in Experimental features", () => {
  // TEST_SCENARIO: the row is the `damConnection` feature, and both its sentences name the install rather than anything hardcoded.
  it("reads as its own switch, in the install's words", () => {
    expect(damConnectionFeatureRow(brand)).toEqual({
      id: "damConnection",
      label: "DAM connection",
      description:
        "Let your agents act as you on DAM through a connection. Turning this off leaves the connections you already made working.",
    });
  });

  // TEST_SCENARIO: a branded install shows its own name, so nothing is written here that a rename would leave stale.
  it("takes the name from the brand", () => {
    expect(
      damConnectionFeatureRow({ ...brand, name: "Platform" }),
    ).toMatchObject({
      label: "Platform connection",
      description:
        "Let your agents act as you on Platform through a connection. Turning this off leaves the connections you already made working.",
    });
  });
});
