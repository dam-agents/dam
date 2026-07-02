import { describe, it, expect } from "vitest";
import type { TemplateSpec } from "api-server-api";
import { assembleSpecFromTemplate } from "../../modules/agents/domain/spec-assembly.js";

const baseTemplate: TemplateSpec = {
  version: "agent-platform.ai/v1",
  image: "quay.io/dam-agents/nous:latest",
};

describe("assembleSpecFromTemplate", () => {
  it("carries the template's hibernationTimeout onto the agent spec", () => {
    // "0s" is the never-hibernate sentinel a workload image (e.g. Nous) seeds
    // so its off-session background work isn't hibernated mid-run.
    const spec = assembleSpecFromTemplate(
      "nous-1",
      { ...baseTemplate, hibernationTimeout: "0s" },
      {},
    );
    expect(spec.hibernationTimeout).toBe("0s");
  });

  it("leaves hibernationTimeout unset when the template omits it (inherit the default)", () => {
    const spec = assembleSpecFromTemplate("agent-1", baseTemplate, {});
    expect(spec.hibernationTimeout).toBeUndefined();
  });
});
