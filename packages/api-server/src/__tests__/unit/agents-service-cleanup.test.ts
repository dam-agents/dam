import { describe, it, expect, vi } from "vitest";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";

function makeRepo(overrides: Partial<AgentsRepository> = {}): AgentsRepository {
  return {
    list: async () => [],
    get: async () => null,
    create: async () => ({
      id: "a",
      name: "a",
      spec: { name: "a", version: "1", image: "img" },
    }),
    updateSpec: async () => null,
    delete: async () => {},
    ...overrides,
  };
}

describe("agents-service.delete cleanup hooks", () => {
  it("invokes every hook with the deleted agent id, in order", async () => {
    const calls: Array<{ hook: string; id: string }> = [];
    const svc = createAgentsService({
      repo: makeRepo(),
      owner: "u-1",
      readTemplateSpec: async () => null,
      cleanupHooks: [
        async (id) => {
          calls.push({ hook: "egress", id });
        },
        async (id) => {
          calls.push({ hook: "approvals", id });
        },
      ],
    });

    await svc.delete("agent-xyz");
    expect(calls).toEqual([
      { hook: "egress", id: "agent-xyz" },
      { hook: "approvals", id: "agent-xyz" },
    ]);
  });

  it("logs and continues when one hook throws", async () => {
    const calls: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const svc = createAgentsService({
      repo: makeRepo(),
      owner: "u-1",
      readTemplateSpec: async () => null,
      cleanupHooks: [
        async () => {
          throw new Error("boom");
        },
        async (id) => {
          calls.push(id);
        },
      ],
    });

    await svc.delete("agent-xyz");
    // Second hook still ran with the same id.
    expect(calls).toEqual(["agent-xyz"]);
    // Failure was reported, not silently swallowed.
    expect(stderr).toHaveBeenCalled();
    const msg = stderr.mock.calls.flat().join(" ");
    expect(msg).toContain("agent-xyz");
    expect(msg).toContain("boom");
    stderr.mockRestore();
  });

  it("only fires hooks after the K8s delete succeeds", async () => {
    const calls: string[] = [];
    const svc = createAgentsService({
      repo: makeRepo({
        delete: async () => {
          throw new Error("k8s 500");
        },
      }),
      owner: "u-1",
      readTemplateSpec: async () => null,
      cleanupHooks: [
        async (id) => {
          calls.push(id);
        },
      ],
    });

    await expect(svc.delete("agent-xyz")).rejects.toThrow("k8s 500");
    expect(calls).toEqual([]);
  });

  it("is a no-op when no hooks are configured", async () => {
    const svc = createAgentsService({
      repo: makeRepo(),
      owner: "u-1",
      readTemplateSpec: async () => null,
    });
    await expect(svc.delete("agent-xyz")).resolves.toBeUndefined();
  });
});
