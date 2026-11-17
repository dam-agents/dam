// TEST_OVERVIEW: The words of the security check. Its Experimental features row
// TEST_OVERVIEW: names the install's assistant from the brand and says that each
// TEST_OVERVIEW: check spends the person's model budget, which is why it waits for
// TEST_OVERVIEW: the switch. The alert's headline counts the problems the check found.
import { describe, expect, it } from "vitest";

import { securityCheckFeatureRow } from "../../modules/features/lib/security-check-feature-row.js";
import { securityCheckHeadline } from "../../modules/security-checks/lib/security-check-copy.js";

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

describe("the security check's row in Experimental features", () => {
  // TEST_SCENARIO: the row is the `security-check` feature and tells the person the check spends their model budget before they turn it on.
  it("says who runs the check and that it spends the model budget", () => {
    const row = securityCheckFeatureRow(brand);
    expect(row).toMatchObject({
      id: "security-check",
      label: "Security check",
    });
    expect(row.description).toContain("Dambledore checks your setup");
    expect(row.description).toContain("spends your model budget");
  });

  // TEST_SCENARIO: a branded install shows its own assistant's name, so nothing is hardcoded.
  it("takes the assistant's name from the brand", () => {
    const row = securityCheckFeatureRow({ ...brand, assistantName: "Ada" });
    expect(row.description).toContain("Ada checks your setup");
    expect(row.description).not.toContain("Dambledore");
  });
});

describe("the security check alert's headline", () => {
  // TEST_SCENARIO: one problem reads in the singular and several are counted.
  it("counts the problems", () => {
    expect(securityCheckHeadline(1)).toBe("Your setup has 1 security problem");
    expect(securityCheckHeadline(3)).toBe("Your setup has 3 security problems");
  });
});
