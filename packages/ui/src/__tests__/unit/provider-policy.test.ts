import { describe, expect, test } from "vitest";

import {
  offeredProviderRows,
  PROVIDER_ROWS,
} from "../../modules/providers/lib/provider-rows.js";
import { setupProviderPolicy } from "../../modules/sandboxes/lib/setup-policy.js";

describe("setupProviderPolicy", () => {
  test.each(["experiment", "knowledge-base"] as const)(
    "%s offers only the two credentials that reach Claude, steering to the proxy",
    (flow) => {
      const policy = setupProviderPolicy(flow);
      expect(policy.allow).toEqual(["ibm-litellm", "anthropic"]);
      expect(policy.recommended).toBe("ibm-litellm");
    },
  );

  test("coding-agent offers every provider, still steering to the proxy", () => {
    expect(setupProviderPolicy("coding-agent")).toEqual({
      recommended: "ibm-litellm",
    });
  });
});

describe("offeredProviderRows", () => {
  test("offers every provider in catalog order without a policy", () => {
    expect(offeredProviderRows().map((row) => row.type)).toEqual(
      PROVIDER_ROWS.map((row) => row.type),
    );
  });

  test("applies a kinded policy: only the allowed rows, recommended first", () => {
    const { allow, recommended } = setupProviderPolicy("experiment");
    expect(
      offeredProviderRows(allow, recommended).map((row) => row.type),
    ).toEqual(["ibm-litellm", "anthropic"]);
  });

  test("recommends the proxy first for a coding agent without restricting the list", () => {
    const { allow, recommended } = setupProviderPolicy("coding-agent");
    expect(offeredProviderRows(allow, recommended)[0]?.type).toBe(
      "ibm-litellm",
    );
    expect(offeredProviderRows(allow, recommended)).toHaveLength(
      PROVIDER_ROWS.length,
    );
  });

  test("keeps the recommended row first whatever the catalog order", () => {
    const rows = offeredProviderRows(["openai", "anthropic"], "openai");
    expect(rows.map((row) => row.type)).toEqual(["openai", "anthropic"]);
  });
});
