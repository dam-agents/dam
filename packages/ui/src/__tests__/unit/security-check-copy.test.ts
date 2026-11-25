// TEST_OVERVIEW: The words of the security check. Its Experimental features row
// TEST_OVERVIEW: names the install's assistant from the brand and says where the
// TEST_OVERVIEW: person chooses how much a check does. The levels say in a few
// TEST_OVERVIEW: plain words what each one runs, and only the top one says that
// TEST_OVERVIEW: it runs the person's other agents and costs there. None of the
// TEST_OVERVIEW: words is a term of the platform. The alert's headline counts
// TEST_OVERVIEW: the problems.
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
  // TEST_SCENARIO: the row is the `security-check` feature. It tells the person what the assistant does once a week, and that the level is in the assistant's own settings.
  it("says who runs the check and where its level is chosen", () => {
    const row = securityCheckFeatureRow(brand);
    expect(row).toMatchObject({
      id: "security-check",
      label: "Security advisory",
    });
    expect(row.description).toContain("Dambledore looks for security problems");
    expect(row.description).toContain("Dambledore's settings, under General");
  });

  // TEST_SCENARIO: a branded install shows its own assistant's name, so nothing is hardcoded.
  it("takes the assistant's name from the brand", () => {
    const row = securityCheckFeatureRow({ ...brand, assistantName: "Ada" });
    expect(row.description).toContain("Ada looks for security problems");
    expect(row.description).not.toContain("Dambledore");
  });
});

describe("the levels of the security check", () => {
  const described = (value: string): string =>
    securityCheckLevelOptions(brand).find((option) => option.value === value)
      ?.description ?? "";

  // TEST_SCENARIO: a person reads three levels, from none to the most, in that order, before they choose.
  it("lists the levels from off to deep", () => {
    expect(
      securityCheckLevelOptions(brand).map((option) => option.label),
    ).toEqual(["Off", "Standard", "Deep"]);
  });

  // TEST_SCENARIO: the standard level says that the assistant checks alone and that the person's other agents do not run.
  it("says that the standard check runs no other agent", () => {
    expect(described("standard")).toBe(
      "Dambledore checks on its own. Your other agents do not run.",
    );
  });

  // TEST_SCENARIO: the top level is the only one that runs the person's other agents, so its words say that each of them runs once and costs what it usually costs.
  it("says that only the top level runs other agents, at their cost", () => {
    expect(described("deep")).toBe(
      "Dambledore also asks the agents you share with other people about their instructions. Each of them runs once, at its usual cost.",
    );
    expect(described("off")).toBe("No weekly check.");
  });

  // TEST_SCENARIO: a person who does not know the platform's terms reads the intro and every level: one or two short sentences each, with no "turn", no "model", no "effort" and no "accounts at risk".
  it("keeps the words short and free of the platform's terms", () => {
    const words = [
      securityCheckLevelIntro(brand),
      securityCheckFeatureRow(brand).description,
      ...securityCheckLevelOptions(brand).map((option) => option.description),
    ];
    for (const text of words) {
      expect(text).not.toMatch(/\bturns?\b|\bmodel\b|\beffort\b|at risk/);
      expect(text.length).toBeLessThanOrEqual(190);
    }
    expect(securityCheckLevelIntro(brand)).toBe(
      "Once a week, Dambledore looks for security problems in how your agents are set up, and alerts you when it finds one.",
    );
  });
});

describe("the security check alert's headline", () => {
  // TEST_SCENARIO: one problem reads in the singular and several are counted.
  it("counts the problems", () => {
    expect(securityCheckHeadline(1)).toBe("Your setup has 1 security problem");
    expect(securityCheckHeadline(3)).toBe("Your setup has 3 security problems");
  });
});
