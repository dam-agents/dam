import { describe, expect, test } from "vitest";

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
