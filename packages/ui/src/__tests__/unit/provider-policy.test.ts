import { describe, expect, test } from "vitest";

import {
  providerPolicy,
  startingPointDefaults,
} from "../../modules/sandboxes/lib/wizard-snapshot.js";

describe("providerPolicy", () => {
  test.each(["experiment", "knowledge-base"] as const)(
    "%s offers only the two credentials that reach Claude, steering to the proxy",
    (startingPoint) => {
      const policy = providerPolicy(startingPoint);
      expect(policy.allow).toEqual(["ibm-litellm", "anthropic"]);
      expect(policy.recommended).toBe("ibm-litellm");
    },
  );

  test.each(["specialized", "general-purpose", "custom", null] as const)(
    "%s offers every provider",
    (startingPoint) => {
      expect(providerPolicy(startingPoint)).toEqual({});
    },
  );

  test("switching to a kinded path drops a provider it may not offer", () => {
    // Otherwise a previously-picked OpenAI would stay selected but invisible,
    // and ride the create call.
    expect(startingPointDefaults("experiment").providerRef).toBeNull();
    expect(startingPointDefaults("knowledge-base").providerRef).toBeNull();
  });
});
