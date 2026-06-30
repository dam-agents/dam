import { describe, it, expect } from "vitest";
import {
  createRunsService,
  RunFailedError,
} from "../../modules/runs/services/runs-service.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";

// Minimal K8sClient stub: only the custom-object methods runs-service touches.
function fakeK8s(overrides: Partial<K8sClient>): K8sClient {
  return overrides as unknown as K8sClient;
}

describe("runs-service", () => {
  it("creates a Run CR with the agent name, owner-refed to the parent agent", async () => {
    type RunBody = {
      spec?: { agentName?: string };
      metadata?: { ownerReferences?: { uid?: string; kind?: string }[] };
    };
    let created: { plural: string; body: RunBody } | null = null;
    const svc = createRunsService(
      fakeK8s({
        createCustomObject: async (plural, body) => {
          created = { plural, body: body as RunBody };
          return {} as KubeObject;
        },
      }),
    );
    await svc.create("run-x", "my-agent", "agent-uid-123");
    expect(created!.plural).toBe("runs");
    expect(created!.body.spec?.agentName).toBe("my-agent");
    const ownerRef = created!.body.metadata?.ownerReferences?.[0];
    expect(ownerRef).toMatchObject({ kind: "Agent", uid: "agent-uid-123" });
  });

  it("returns the podIP once the executor is Ready", async () => {
    let n = 0;
    const svc = createRunsService(
      fakeK8s({
        getCustomObject: async () => {
          n += 1;
          return n < 2
            ? ({ status: { phase: "Pending" } } as KubeObject)
            : ({ status: { phase: "Ready", podIP: "10.4.5.6" } } as KubeObject);
        },
      }),
    );
    expect(await svc.waitReady("run-x", new AbortController().signal)).toBe(
      "10.4.5.6",
    );
  });

  it("throws RunFailedError with the controller's reason on Failed", async () => {
    const svc = createRunsService(
      fakeK8s({
        getCustomObject: async () =>
          ({
            status: {
              phase: "Failed",
              error: { reason: "PodNotReady", detail: "boom" },
            },
          }) as KubeObject,
      }),
    );
    await expect(
      svc.waitReady("run-x", new AbortController().signal),
    ).rejects.toBeInstanceOf(RunFailedError);
  });

  it("aborts the wait when the signal fires", async () => {
    const ac = new AbortController();
    ac.abort();
    const svc = createRunsService(
      fakeK8s({
        getCustomObject: async () =>
          ({ status: { phase: "Pending" } }) as KubeObject,
      }),
    );
    await expect(svc.waitReady("run-x", ac.signal)).rejects.toBeInstanceOf(
      RunFailedError,
    );
  });

  it("deletes by name and swallows not-found", async () => {
    const deleted: string[] = [];
    const svc = createRunsService(
      fakeK8s({
        deleteCustomObject: async (_plural, name) => {
          deleted.push(name);
        },
      }),
    );
    await svc.delete("run-x");
    expect(deleted).toEqual(["run-x"]);
  });
});
