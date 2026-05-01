import { describe, it, expect, vi } from "vitest";
import { createAgentTokenResolver } from "../../modules/skills/infrastructure/agent-token.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

function makeK8s(overrides: Partial<K8sClient> = {}): K8sClient {
  return {
    listConfigMaps: vi.fn(),
    getConfigMap: vi.fn(),
    createConfigMap: vi.fn(),
    replaceConfigMap: vi.fn(),
    deleteConfigMap: vi.fn(),
    getSecret: vi.fn(),
    listPods: vi.fn(),
    getPod: vi.fn(),
    patchPod: vi.fn(),
    listPVCs: vi.fn(),
    deletePVC: vi.fn(),
    ...overrides,
  } as unknown as K8sClient;
}

describe("agent-token resolver", () => {
  it("returns the base64-decoded access-token from the Secret", async () => {
    const token = "aoc_super-secret-value";
    const getSecret = vi.fn().mockResolvedValue({
      data: { "access-token": Buffer.from(token).toString("base64") },
    });
    const resolve = createAgentTokenResolver(makeK8s({ getSecret }));

    await expect(resolve("agent-abc")).resolves.toBe(token);
    expect(getSecret).toHaveBeenCalledWith("humr-agent-agent-abc-token");
  });

  it("throws when the Secret is missing", async () => {
    const resolve = createAgentTokenResolver(makeK8s({
      getSecret: vi.fn().mockResolvedValue(null),
    }));
    await expect(resolve("agent-gone")).rejects.toThrow(/not found/);
  });

  it("throws when the Secret has no access-token key", async () => {
    const resolve = createAgentTokenResolver(makeK8s({
      getSecret: vi.fn().mockResolvedValue({ data: {} }),
    }));
    await expect(resolve("agent-half")).rejects.toThrow(/no access-token/);
  });
});
