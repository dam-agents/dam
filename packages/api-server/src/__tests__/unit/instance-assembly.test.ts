import { describe, it, expect } from "vitest";
import { assembleInstance, computeState, type InfraInstance } from "../../modules/instances/domain/instance-assembly.js";

function infra(overrides: Partial<InfraInstance> = {}): InfraInstance {
  return {
    id: "inst-1",
    name: "test",
    agentId: "agent-1",
    desiredState: "running",
    podReady: true,
    ...overrides,
  };
}

describe("computeState", () => {
  it("returns starting when currentState is running but pod not ready", () => {
    expect(computeState(infra({ currentState: "running", podReady: false }))).toBe("starting");
  });

  it("returns running when currentState is running and pod ready", () => {
    expect(computeState(infra({ currentState: "running", podReady: true }))).toBe("running");
  });
});

