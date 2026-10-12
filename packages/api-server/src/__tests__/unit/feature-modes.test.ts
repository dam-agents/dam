import { describe, expect, it } from "vitest";

import { createFeaturesService } from "../../modules/features/services/features-service.js";

/**
 * TEST_OVERVIEW: The chart's per-feature mode decides a flag for every user when it is on or off, and leaves the user's stored choice in force when it is experimental or omitted.
 */
describe("feature modes", () => {
  // TEST_SCENARIO: a user has opted into two features and out of none; the install pins one of them off and an untouched one on.
  it("pins on and off over the stored choice, and leaves experimental to the user", async () => {
    const service = createFeaturesService({
      repo: {
        listEnabled: () =>
          Promise.resolve({
            "strict-connection-addressing": true,
            "agent-telemetry": true,
          }),
        upsert: () => Promise.resolve(),
      },
      owner: "u",
      surface: "test",
      modes: {
        "strict-connection-addressing": "off",
        "interactive-artifacts": "on",
        "agent-telemetry": "experimental",
      },
    });
    expect(await service.flags()).toMatchObject({
      "strict-connection-addressing": false,
      "interactive-artifacts": true,
      "agent-telemetry": true,
      "advanced-connections": false,
    });
  });
});
