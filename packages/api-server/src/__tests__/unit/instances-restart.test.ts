import { describe, it, expect, vi } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import { createInstancesRepository } from "../../modules/instances/infrastructure/instances-repository.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  LABEL_TYPE, LABEL_OWNER, TYPE_INSTANCE, SPEC_KEY,
} from "../../modules/agents/infrastructure/labels.js";

function instanceCM(id: string, owner: string): k8s.V1ConfigMap {
  return {
    metadata: {
      name: id,
      labels: { [LABEL_TYPE]: TYPE_INSTANCE, [LABEL_OWNER]: owner },
    },
    data: {
      [SPEC_KEY]: `name: ${id}\nversion: 1\nagentId: agent-1\ndesiredState: running\n`,
    },
  };
}

function fakeK8s(overrides: Partial<K8sClient> = {}): K8sClient {
  return {
    namespace: "test-ns",
    listConfigMaps: vi.fn().mockResolvedValue([]),
    getConfigMap: vi.fn().mockResolvedValue(null),
    createConfigMap: vi.fn(),
    replaceConfigMap: vi.fn(),
    patchConfigMap: vi.fn(),
    deleteConfigMap: vi.fn(),
    listSecrets: vi.fn().mockResolvedValue([]),
    getSecret: vi.fn().mockResolvedValue(null),
    createSecret: vi.fn(),
    replaceSecret: vi.fn(),
    deleteSecret: vi.fn(),
    listPods: vi.fn().mockResolvedValue([]),
    getPod: vi.fn().mockResolvedValue(null),
    patchPod: vi.fn(),
    deletePod: vi.fn().mockResolvedValue(true),
    listPVCs: vi.fn().mockResolvedValue([]),
    deletePVC: vi.fn(),
    ...overrides,
  };
}

describe("instances-repository.restart", () => {
  it("deletes pod {id}-0 when the instance exists and is owned by caller", async () => {
    const deletePod = vi.fn().mockResolvedValue(true);
    const k8s = fakeK8s({
      getConfigMap: vi.fn().mockResolvedValue(instanceCM("inst-1", "alice")),
      deletePod,
    });
    const repo = createInstancesRepository(k8s);

    const ok = await repo.restart("inst-1", "alice");

    expect(ok).toBe(true);
    expect(deletePod).toHaveBeenCalledExactlyOnceWith("inst-1-0");
  });

  it("returns false without deleting the pod when the instance is missing", async () => {
    const deletePod = vi.fn();
    const k8s = fakeK8s({
      getConfigMap: vi.fn().mockResolvedValue(null),
      deletePod,
    });
    const repo = createInstancesRepository(k8s);

    const ok = await repo.restart("inst-1", "alice");

    expect(ok).toBe(false);
    expect(deletePod).not.toHaveBeenCalled();
  });

  it("refuses to restart an instance owned by a different user", async () => {
    const deletePod = vi.fn();
    const k8s = fakeK8s({
      getConfigMap: vi.fn().mockResolvedValue(instanceCM("inst-1", "bob")),
      deletePod,
    });
    const repo = createInstancesRepository(k8s);

    const ok = await repo.restart("inst-1", "alice");

    expect(ok).toBe(false);
    expect(deletePod).not.toHaveBeenCalled();
  });

  it("treats pod-already-gone (K8s 404) as a successful restart — the StatefulSet will recreate pod-0", async () => {
    const deletePod = vi.fn().mockResolvedValue(false);
    const k8s = fakeK8s({
      getConfigMap: vi.fn().mockResolvedValue(instanceCM("inst-1", "alice")),
      deletePod,
    });
    const repo = createInstancesRepository(k8s);

    const ok = await repo.restart("inst-1", "alice");

    expect(ok).toBe(true);
    expect(deletePod).toHaveBeenCalledExactlyOnceWith("inst-1-0");
  });
});
