import { describe, it, expect } from "vitest";
import type { TemplateSpec } from "api-server-api";
import {
  assembleSpecFromTemplate,
  concreteResources,
} from "../../modules/agents/domain/spec-assembly.js";

const baseTemplate: TemplateSpec = {
  version: "agent-platform.ai/v1",
  image: "quay.io/dam-agents/nous:latest",
};

const defaultLimits = { cpu: "1", memory: "1Gi" };

describe("assembleSpecFromTemplate", () => {
  it("carries the template's hibernationTimeout onto the agent spec", () => {
    // "0s" is the never-hibernate sentinel a workload image (e.g. Nous) seeds
    // so its off-session background work isn't hibernated mid-run.
    const spec = assembleSpecFromTemplate(
      "nous-1",
      { ...baseTemplate, hibernationTimeout: "0s" },
      {},
      defaultLimits,
    );
    expect(spec.hibernationTimeout).toBe("0s");
  });

  it("leaves hibernationTimeout unset when the template omits it (inherit the default)", () => {
    const spec = assembleSpecFromTemplate(
      "agent-1",
      baseTemplate,
      {},
      defaultLimits,
    );
    expect(spec.hibernationTimeout).toBeUndefined();
  });
});

describe("concreteResources", () => {
  it("falls to the small chart default when neither slider nor template chooses", () => {
    expect(concreteResources(undefined, undefined, defaultLimits)).toEqual({
      limits: { cpu: "1", memory: "1Gi" },
    });
  });

  it("the user's size wins over the template, per dimension", () => {
    const out = concreteResources(
      { limits: { cpu: "500m", memory: "2Gi" } },
      { cpu: "4" },
      defaultLimits,
    );
    expect(out.limits).toEqual({ cpu: "4", memory: "2Gi" });
  });

  it("template limits win over the chart default; requests pass through as the operator escape hatch", () => {
    const out = concreteResources(
      {
        limits: { cpu: "2" },
        requests: { cpu: "1" },
      },
      undefined,
      defaultLimits,
    );
    expect(out.limits).toEqual({ cpu: "2", memory: "1Gi" });
    expect(out.requests).toEqual({ cpu: "1" });
  });

  it("preserves extended resources on limits", () => {
    const out = concreteResources(
      { limits: { "nvidia.com/gpu": "1" } },
      undefined,
      defaultLimits,
    );
    expect(out.limits["nvidia.com/gpu"]).toBe("1");
    expect(out.limits.cpu).toBe("1");
  });
});
