// TEST_OVERVIEW: Every list of profiles, Settings › Profiles and each picker, shows them in one order: the default for new agents first, then the most used, then by name.
import type { ProfileWithUsage } from "api-server-api";
import { expect, it } from "vitest";

import { sortProfiles } from "../../modules/profiles/lib/profile-detail.js";

const profile = (
  name: string,
  uses: { agents?: number; channels?: number; schedules?: number } = {},
  newAgentDefault = false,
): ProfileWithUsage => ({
  id: name,
  name,
  harness: "claude-code",
  providerTemplate: "bedrock",
  model: "bedrock/opus",
  settings: {},
  newAgentDefault,
  usage: { agents: 0, channels: 0, schedules: 0, ...uses },
  availability: null,
});

/** TEST_SCENARIO: the default leads even unused; uses count agents, channels and schedules together; equal uses fall back to the name; the list it sorts, a query's cached data, is left as it was. */
it("puts the default first, then the most used, then by name", () => {
  expect(
    sortProfiles(
      Object.freeze([
        profile("Zeta", { agents: 1 }),
        profile("Alpha"),
        profile("Busy", { channels: 1, schedules: 2 }),
        profile("Default", {}, true),
        profile("Beta"),
      ]),
    ).map((p) => p.name),
  ).toEqual(["Default", "Busy", "Zeta", "Alpha", "Beta"]);
});
