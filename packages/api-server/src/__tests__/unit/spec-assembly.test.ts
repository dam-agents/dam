import { describe, it, expect } from "vitest";
import type { TemplateSpec } from "api-server-api";
import {
  assembleSpecFromTemplate,
  concreteResources,
  vmDiskFromMounts,
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
    expect(spec.backend).toEqual({ type: "vm", vm: undefined });
    expect(spec.runtimeClassName).toBeUndefined();
    expect(spec.nodeSelector).toBeUndefined();
  });

  // TEST_SCENARIO: a machine has one disk, so the template's mounts become a list of paths on it. The disk's size is not copied here — it stays the agent's own storageSize, which the controller already reads, so the number cannot drift between two places.
  it("turns a template's persisted mounts into the machine's disk", () => {
    const spec = assembleSpecFromTemplate(
      "nous-1",
      {
        ...baseTemplate,
        storageSize: "20Gi",
        mounts: [
          { path: "/home/agent", persist: true },
          { path: "/tmp", persist: false },
        ],
      },
      { vm: true },
      defaultLimits,
    );
    expect(spec.backend).toEqual({
      type: "vm",
      vm: { disk: { persist: ["/home/agent"] } },
    });
    expect(spec.storageSize).toBe("20Gi");
  });
});

describe("vmDiskFromMounts", () => {
  // TEST_SCENARIO: a machine discards its whole root every time it stops, so a path with no place on the disk is already empty on the next boot. A non-persisted mount therefore needs no counterpart here — unlike a container, where it is an emptyDir of its own.
  it("keeps only the paths that persist", () => {
    expect(
      vmDiskFromMounts([
        { path: "/home/agent", persist: true },
        { path: "/tmp", persist: false },
        { path: "/data", persist: true },
      ]),
    ).toEqual({ disk: { persist: ["/home/agent", "/data"] } });
  });

  // TEST_SCENARIO: a template with no mounts says nothing about the disk, which is not the same as saying nothing persists. Leaving the block off is what tells the controller to fall back to the chart's default mounts; an empty list would be taken at its word and the agent would lose its home.
  it("declares nothing when the template declares no mounts", () => {
    expect(vmDiskFromMounts(undefined)).toBeUndefined();
    expect(vmDiskFromMounts([])).toBeUndefined();
  });

  // TEST_SCENARIO: a template whose mounts are all ephemeral does mean "persist nothing", and says so — the block is present with an empty list, which the controller takes literally rather than falling back.
  it("declares an empty disk when every mount is ephemeral", () => {
    expect(vmDiskFromMounts([{ path: "/tmp", persist: false }])).toEqual({
      disk: { persist: [] },
    });
  });

  it("leaves the agent on a container when the caller asks for nothing", () => {
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
