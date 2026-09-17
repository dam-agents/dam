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

  // TEST_SCENARIO: the vm backend is chosen beside the image rather than by picking a different template, so a plain container template must assemble as a microVM on request — and runtimeClassName and nodeSelector, which the CRD rejects on that backend, must not ride along.
  it("boots a container template as a microVM without its container-only placement", () => {
    const spec = assembleSpecFromTemplate(
      "nous-1",
      {
        ...baseTemplate,
        runtimeClassName: "kata",
        nodeSelector: { pool: "gpu" },
      },
      { vm: true },
      defaultLimits,
    );
    expect(spec.backend).toEqual({ type: "vm" });
    expect(spec.runtimeClassName).toBeUndefined();
    expect(spec.nodeSelector).toBeUndefined();
  });

  it("leaves a template's own backend alone when the caller asks for nothing", () => {
    const spec = assembleSpecFromTemplate(
      "nous-1",
      { ...baseTemplate, runtimeClassName: "kata" },
      {},
      defaultLimits,
    );
    expect(spec.backend).toBeUndefined();
    expect(spec.runtimeClassName).toBe("kata");
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
