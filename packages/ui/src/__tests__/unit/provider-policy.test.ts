import { describe, expect, test } from "vitest";

import {
  offeredProviderRows,
  PROVIDER_ROWS,
} from "../../modules/providers/lib/provider-rows.js";
import { setupProviderPolicy } from "../../modules/sandboxes/lib/setup-policy.js";

describe("setupProviderPolicy", () => {
  test.each(["coding-agent", "starter-kit"] as const)(
    "%s offers every provider, still steering to the proxy",
    (flow) => {
      expect(setupProviderPolicy(flow)).toEqual({
        recommended: "ibm-litellm",
      });
    },
  );
});

describe("offeredProviderRows", () => {
  test("offers every provider in catalog order without a policy", () => {
    expect(offeredProviderRows().map((row) => row.type)).toEqual(
      PROVIDER_ROWS.map((row) => row.type),
    );
  });

  test("applies an allow list: only the allowed rows, recommended first", () => {
    expect(
      offeredProviderRows(["anthropic", "ibm-litellm"], "ibm-litellm").map(
        (row) => row.type,
      ),
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
