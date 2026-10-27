// TEST_OVERVIEW: whether the web UI may offer a vm agent's own size. The controller sizes a machine from its spec wherever it creates no runner pod (a host runner) and wherever the owner's pool sets no memory limit; only a pool with a positive limit divides its half among the owner's running machines and ignores the spec.
import { describe, expect, it } from "vitest";

import { vmAgentSizing } from "../../config.js";

const sizing = (fields: {
  virtualizationEnabled?: boolean;
  virtualizationHostRunner?: boolean;
  vmPoolMemory?: string;
}) =>
  vmAgentSizing({
    virtualizationEnabled: true,
    virtualizationHostRunner: false,
    vmPoolMemory: "",
    ...fields,
  });

describe("vm agent sizing", () => {
  // TEST_SCENARIO: a pool-sized runner with a memory limit takes the agent's memory from half the pool, so the spec size would do nothing there.
  it("is the pool when a runner pool sets a memory limit", () => {
    expect(sizing({ vmPoolMemory: "12Gi" })).toBe("pool");
  });

  // TEST_SCENARIO: a host runner, a pool with no limit, and an install without virtualization all size a machine from its own spec.
  it("is the spec everywhere the controller reads the spec", () => {
    expect(
      sizing({ virtualizationHostRunner: true, vmPoolMemory: "12Gi" }),
    ).toBe("spec");
    expect(sizing({})).toBe("spec");
    expect(sizing({ virtualizationEnabled: false, vmPoolMemory: "12Gi" })).toBe(
      "spec",
    );
  });
});
