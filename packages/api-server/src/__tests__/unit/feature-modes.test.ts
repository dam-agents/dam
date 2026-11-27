import { readFileSync } from "node:fs";

import { featuresOfLevel } from "api-server-api";
import { describe, expect, it } from "vitest";

import { createFeaturesService } from "../../modules/features/services/features-service.js";

/**
 * TEST_OVERVIEW: The chart's per-feature mode decides a flag for every user when it is on or off, and leaves the user's stored choice in force when it is `user` — where a feature on by default, the assistant, reads as on until the person stores that they do not want it.
 */
describe("feature modes", () => {
  // TEST_SCENARIO: a user has opted into two features and out of none; the install pins one of them off and an untouched one on.
  it("pins on and off over the stored choice, and leaves the user mode to the user", async () => {
    const service = createFeaturesService({
      repo: {
        listEnabled: () =>
          Promise.resolve({
            processes: true,
            dambledore: true,
          }),
        upsert: () => Promise.resolve(),
      },
      owner: "u",
      surface: "test",
      modes: {
        processes: "user",
        "advanced-connections": "user",
        "custom-avatars": "on",
        environments: "user",
        hermes: "user",
        "github-enterprise-hosts": "user",
        damConnection: "user",
        dambledore: "off",
        "chat-network-approvals": "user",
        "one-time-tasks": "user",
        "security-check": "user",
        "mcp-tool-approval": "user",
      },
    });
    expect(await service.flags()).toMatchObject({
      processes: true,
      dambledore: false,
      "custom-avatars": true,
      "advanced-connections": false,
    });
  });

  // TEST_SCENARIO: the assistant is on for everyone who has stored nothing, so a fresh account gets one at its next request; storing the switch off is how a person declines, and every other feature stays off until switched on.
  it("gives the assistant to a person who stored nothing, and takes it away when they say so", async () => {
    const flags = async (stored: Record<string, boolean>) =>
      createFeaturesService({
        repo: {
          listEnabled: () => Promise.resolve(stored),
          upsert: () => Promise.resolve(),
        },
        owner: "u",
        surface: "test",
        modes: {
          processes: "user",
          "advanced-connections": "user",
          "custom-avatars": "user",
          "github-enterprise-hosts": "user",
          environments: "user",
          hermes: "user",
          dambledore: "user",
          damConnection: "user",
          "chat-network-approvals": "user",
          "one-time-tasks": "user",
          "security-check": "user",
          "mcp-tool-approval": "user",
        },
      }).flags();
    expect(await flags({})).toMatchObject({
      dambledore: true,
      processes: false,
      damConnection: false,
    });
    expect(await flags({ dambledore: false })).toMatchObject({
      dambledore: false,
    });
    expect(await flags({ dambledore: true })).toMatchObject({
      dambledore: true,
    });
  });

  // TEST_SCENARIO: the chart refuses values that name an internal feature, before the api-server would. It keeps its own list of them, which must name the same features as the contract, or a pin of a new internal feature would pass the render and stop the api-server.
  it("has the chart refuse the same internal features as the contract", () => {
    const chart = readFileSync(
      new URL("../../../../../helm/templates/_validators.tpl", import.meta.url),
      "utf8",
    );
    const listed =
      /define "platform\.internalFeatures" -}}\n{{- list (.+?) \| toJson/.exec(
        chart,
      );
    expect(
      listed?.[1].split(" ").map((id) => JSON.parse(id) as string),
    ).toEqual(featuresOfLevel("internal"));
  });
});
