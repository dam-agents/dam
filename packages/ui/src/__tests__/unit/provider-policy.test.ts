import { describe, expect, test } from "vitest";

import {
  offeredProviderRows,
  PROVIDER_ROWS,
} from "../../modules/providers/lib/provider-rows.js";
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

describe("offeredProviderRows", () => {
  test("offers every provider in catalog order without a policy", () => {
    expect(offeredProviderRows().map((row) => row.type)).toEqual(
      PROVIDER_ROWS.map((row) => row.type),
    );
  });

  test("applies a kinded policy: only the allowed rows, recommended first", () => {
    const { allow, recommended } = providerPolicy("experiment");
    expect(offeredProviderRows(allow, recommended).map((row) => row.type)) //
      .toEqual(["ibm-litellm", "anthropic"]);
  });

  test("keeps the recommended row first whatever the catalog order", () => {
    const rows = offeredProviderRows(["openai", "anthropic"], "openai");
    expect(rows.map((row) => row.type)).toEqual(["openai", "anthropic"]);
  });
});
