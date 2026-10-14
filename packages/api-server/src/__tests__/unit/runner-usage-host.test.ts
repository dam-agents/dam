import { describe, it, expect } from "vitest";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { readRunnerUsage } from "../../modules/budgets/infrastructure/runner-usage.js";

/**
 * TEST_OVERVIEW: On a laptop one runner outside the cluster serves every
 * owner, and the controller writes its one usage Secret for no owner. An
 * owner with no Secret of their own is read through that one, or the VM
 * resource bars there say usage is unavailable for ever.
 */

function fakeK8s(byOwner: boolean, host: boolean) {
  const selectors: string[] = [];
  const k8s = {
    listSecrets: async (selector: string) => {
      selectors.push(selector);
      const wantsHost = selector.includes("!");
      return (wantsHost ? host : byOwner) ? [{ data: {} }] : [];
    },
  } as unknown as K8sClient;
  return { k8s, selectors };
}

describe("finding the runner to read usage from", () => {
  it("an owner without a Secret of their own is read through the host runner's", async () => {
    const { k8s, selectors } = fakeK8s(false, true);
    await readRunnerUsage(k8s, "owner-host", 0);
    expect(selectors).toEqual([
      "agent-platform.ai/vm-runner-usage=true,agent-platform.ai/owner=owner-host",
      "agent-platform.ai/vm-runner-usage=true,!agent-platform.ai/owner",
    ]);
  });

  it("an owner with a runner pod of their own never falls back to another Secret", async () => {
    const { k8s, selectors } = fakeK8s(true, true);
    await readRunnerUsage(k8s, "owner-pod", 0);
    expect(selectors).toHaveLength(1);
  });
});
