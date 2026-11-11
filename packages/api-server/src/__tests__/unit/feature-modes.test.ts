import { describe, expect, it } from "vitest";

import { createFeaturesService } from "../../modules/features/services/features-service.js";

/**
 * TEST_OVERVIEW: The chart's per-feature mode decides a flag for every user when it is on or off, and leaves the user's stored choice in force when it is experimental — where a feature on by default, the assistant, reads as on until the person stores that they do not want it.
 */
describe("feature modes", () => {
  // TEST_SCENARIO: a user has opted into two features and out of none; the install pins one of them off and an untouched one on.
  it("pins on and off over the stored choice, and leaves experimental to the user", async () => {
    const service = createFeaturesService({
      repo: {
        listEnabled: () =>
          Promise.resolve({
            processes: true,
            "agent-telemetry": true,
          }),
        upsert: () => Promise.resolve(),
      },
      owner: "u",
      surface: "test",
      modes: {
        processes: "off",
        "agent-telemetry": "experimental",
        "advanced-connections": "experimental",
        "chat-forms": "experimental",
        "custom-avatars": "experimental",
        environments: "experimental",
        hermes: "experimental",
        "github-enterprise-hosts": "experimental",
        damConnection: "experimental",
        dambledore: "experimental",
      },
    });
    expect(await service.flags()).toMatchObject({
      processes: false,
      "agent-telemetry": true,
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
          processes: "experimental",
          "agent-telemetry": "experimental",
          "advanced-connections": "experimental",
          "chat-forms": "experimental",
          "custom-avatars": "experimental",
          "github-enterprise-hosts": "experimental",
          environments: "experimental",
          hermes: "experimental",
          dambledore: "experimental",
          damConnection: "experimental",
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
});
