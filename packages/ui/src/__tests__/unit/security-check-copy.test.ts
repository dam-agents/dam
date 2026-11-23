// TEST_OVERVIEW: The words of the security check. Its Experimental features row
// TEST_OVERVIEW: names the install's assistant from the brand and says where the
// TEST_OVERVIEW: person chooses how much a check does. The levels say what each
// TEST_OVERVIEW: one runs, and only the top one says that it runs turns on the
// TEST_OVERVIEW: person's other agents. The alert's headline counts the problems.
import { describe, expect, it } from "vitest";

import { securityCheckFeatureRow } from "../../modules/features/lib/security-check-feature-row.js";
import { securityCheckHeadline } from "../../modules/security-checks/lib/security-check-copy.js";
import {
  securityCheckLevelIntro,
  securityCheckLevelOptions,
} from "../../modules/security-checks/lib/security-check-levels.js";

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
  // TEST_SCENARIO: the row is the `security-check` feature. It tells the person that a check runs no turn on their other agents unless they choose so, and that the level is in the assistant's own settings.
  it("says who runs the check and where its level is chosen", () => {
    const row = securityCheckFeatureRow(brand);
    expect(row).toMatchObject({
      id: "security-check",
      label: "Security check",
    });
    expect(row.description).toContain("Dambledore checks your setup");
    expect(row.description).toContain("no turn on your other agents");
    expect(row.description).toContain("Dambledore's settings, under General");
  });

  // TEST_SCENARIO: a branded install shows its own assistant's name, so nothing is hardcoded.
  it("takes the assistant's name from the brand", () => {
    const row = securityCheckFeatureRow({ ...brand, assistantName: "Ada" });
    expect(row.description).toContain("Ada checks your setup");
    expect(row.description).not.toContain("Dambledore");
  });
});

describe("the levels of the security check", () => {
  const described = (value: string): string =>
    securityCheckLevelOptions(brand).find((option) => option.value === value)
      ?.description ?? "";

  // TEST_SCENARIO: a person reads the levels from none to the most, in that order, before they choose.
  it("lists the levels from off to deep", () => {
    expect(
      securityCheckLevelOptions(brand).map((option) => option.label),
    ).toEqual(["Off", "Low", "Medium", "High", "Deep"]);
  });

  // TEST_SCENARIO: the three middle levels are one run of the assistant, each at its own effort, and say nothing of a turn on another agent.
  it("names the effort of each run of the assistant", () => {
    for (const effort of ["low", "medium", "high"]) {
      expect(described(effort)).toBe(
        `One run of Dambledore a week, at ${effort} effort.`,
      );
    }
  });

  // TEST_SCENARIO: the top level is the only one that runs turns on the person's other agents, so its words say that each question runs a turn there and costs one.
  it("says that only the top level runs a turn on other agents", () => {
    expect(described("deep")).toContain("runs one turn on that agent");
    expect(securityCheckLevelIntro(brand)).toContain(
      "Only Deep runs a turn on your other agents",
    );
    expect(securityCheckLevelIntro(brand)).toContain("calls no model");
  });
});

describe("the security check alert's headline", () => {
  // TEST_SCENARIO: one problem reads in the singular and several are counted.
  it("counts the problems", () => {
    expect(securityCheckHeadline(1)).toBe("Your setup has 1 security problem");
    expect(securityCheckHeadline(3)).toBe("Your setup has 3 security problems");
  });
});
