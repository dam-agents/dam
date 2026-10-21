import { describe, it, expect } from "vitest";
import type { TemplateSpec } from "api-server-api";
import {
  assembleSpecFromTemplate,
  concreteResources,
  resolveEffectiveHibernationTimeoutMin,
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

  // TEST_SCENARIO: every harness template points at one image, so the agent must carry its template's harness for the controller to tell the machine or pod which one to run.
  it("names the template's harness on the agent spec", () => {
    const spec = assembleSpecFromTemplate(
      "codex-1",
      { ...baseTemplate, harness: "codex" },
      {},
      defaultLimits,
    );
    expect(spec.harness).toBe("codex");
    expect(spec.backend).toBeUndefined();
  });

  // TEST_SCENARIO: a machine keeps HOME and discards the rest of its root at every stop, which is exactly what the default mounts already say — so the vm backend carries no storage block of its own and the mounts travel unchanged. The controller reads them, and refuses an Agent whose mounts ask to persist anything a machine could not keep.
  it("carries the template's mounts unchanged and gives a vm agent no storage size", () => {
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
    expect(spec.backend).toEqual({ type: "vm" });
    expect(spec.mounts).toEqual([
      { path: "/home/agent", persist: true },
      { path: "/tmp", persist: false },
    ]);
    expect(spec.storageSize).toBeUndefined();
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

describe("resolveEffectiveHibernationTimeoutMin", () => {
  const idle = { container: 30, vm: 5 };

  // TEST_SCENARIO: the CRD carries a Go duration, so a Template can seed a unit
  // TEST_SCENARIO: the minute parser never sees. The controller treats a
  // TEST_SCENARIO: positive nanosecond override as awake-for-an-instant, never
  // TEST_SCENARIO: as never-hibernate, so this must not project it to zero.
  it("keeps a positive sub-minute vm override awake rather than never-hibernate", () => {
    expect(resolveEffectiveHibernationTimeoutMin("1ns", true, idle)).toBe(1);
    expect(resolveEffectiveHibernationTimeoutMin("1500ms", true, idle)).toBe(1);
  });

  it("reads a Go duration the minute parser would have dropped", () => {
    expect(resolveEffectiveHibernationTimeoutMin("90s", true, idle)).toBe(2);
    expect(resolveEffectiveHibernationTimeoutMin("2h", false, idle)).toBe(120);
  });

  it("keeps zero as never-hibernate on both backends", () => {
    expect(resolveEffectiveHibernationTimeoutMin("0s", true, idle)).toBe(0);
    expect(resolveEffectiveHibernationTimeoutMin("0s", false, idle)).toBe(0);
  });

  it("inherits the backend's default when the Agent carries no override", () => {
    expect(resolveEffectiveHibernationTimeoutMin(undefined, true, idle)).toBe(
      5,
    );
    expect(resolveEffectiveHibernationTimeoutMin(undefined, false, idle)).toBe(
      30,
    );
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
