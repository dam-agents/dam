// TEST_OVERVIEW: Every list of profiles, Settings › Profiles and each picker, shows them in one order: the most used, then by name.
import type { ProfileWithUsage } from "api-server-api";
import { expect, it } from "vitest";

import { sortProfiles } from "../../modules/profiles/lib/profile-detail.js";

const profile = (
  name: string,
  uses: { agents?: number; channels?: number; schedules?: number } = {},
): ProfileWithUsage => ({
  id: name,
  name,
  harness: "claude-code",
  providerTemplate: "bedrock",
  model: "bedrock/opus",
  settings: {},
  subagent: null,
  usage: { agents: 0, channels: 0, schedules: 0, ...uses },
  availability: null,
});

/** TEST_SCENARIO: uses count agents, channels and schedules together; equal uses fall back to the name; the list it sorts, a query's cached data, is left as it was. */
it("puts the most used first, then by name", () => {
  expect(
    sortProfiles(
      Object.freeze([
        profile("Zeta", { agents: 1 }),
        profile("Alpha"),
        profile("Busy", { channels: 1, schedules: 2 }),
        profile("Beta"),
      ]),
    ).map((p) => p.name),
  ).toEqual(["Busy", "Zeta", "Alpha", "Beta"]);
});
