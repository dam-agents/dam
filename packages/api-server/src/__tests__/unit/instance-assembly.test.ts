import { describe, it, expect } from "vitest";
import type { Agent } from "api-server-api";
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

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "test-agent",
    templateId: "claude-code",
    spec: {
      version: "v1",
      name: "test-agent",
      image: "registry.example.com/claude-code:latest",
    },
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

describe("assembleInstance projection", () => {
  it("projects templateId and image from the agent", () => {
    const result = assembleInstance(infra(), agent(), [], []);
    expect(result.templateId).toBe("claude-code");
    expect(result.image).toBe("registry.example.com/claude-code:latest");
  });

  it("returns templateId null when the agent has no template", () => {
    const result = assembleInstance(
      infra(),
      agent({ templateId: undefined, spec: { version: "v1", name: "raw", image: "raw:1" } }),
      [],
      [],
    );
    expect(result.templateId).toBeNull();
    expect(result.image).toBe("raw:1");
  });

  it("returns templateId null and image empty when agent is null", () => {
    const result = assembleInstance(infra(), null, [], []);
    expect(result.templateId).toBeNull();
    expect(result.image).toBe("");
  });
});

