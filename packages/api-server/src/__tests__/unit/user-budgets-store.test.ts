// TEST_OVERVIEW: how the api-server writes one user's UserBudget for an operator: a new budget is created under the name the CRD pins to its owner, a change patches only the fields it names, null takes a field back to the default, a budget left with no field is deleted, and every write records who made it and when. A refusal from the cluster's validation is a BAD_REQUEST that carries the cluster's reason.
import { describe, expect, it } from "vitest";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import {
  deleteUserBudget,
  listUserBudgets,
  readUserBudgetSizes,
  writeUserBudget,
} from "../../modules/budgets/infrastructure/user-budgets.js";

function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return patch;
  }
  const out: Record<string, unknown> =
    target && typeof target === "object" && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}

function budgetsCluster(refuse?: { code: number; body: string }) {
  const store = new Map<string, KubeObject>();
  const fail = () => {
    throw Object.assign(new Error("refused"), refuse);
  };
  const k8s = {
    namespace: "test-agents",
    async getCustomObject(_plural: string, name: string) {
      return store.get(name) ?? null;
    },
    async listCustomObjects() {
      return [...store.values()];
    },
    async createCustomObject(_plural: string, body: object) {
      if (refuse) fail();
      const obj = body as KubeObject;
      store.set(obj.metadata!.name!, obj);
      return obj;
    },
    async patchCustomObject(_plural: string, name: string, body: object) {
      if (refuse) fail();
      const merged = mergePatch(store.get(name), body) as KubeObject;
      store.set(name, merged);
      return merged;
    },
    async deleteCustomObject(_plural: string, name: string) {
      store.delete(name);
    },
  } as unknown as K8sClient;
  return { k8s, store };
}

describe("UserBudget writes", () => {
  it("creates a budget under the owner's pinned name, with who set it", async () => {
    const { k8s, store } = budgetsCluster();
    const { row, from } = await writeUserBudget(k8s, {
      ownerSub: "ada",
      change: { cpu: "16", memory: null },
      setBySub: "op-1",
    });
    expect(from).toBeNull();
    const obj = store.get("budget-ada")!;
    expect(obj.kind).toBe("UserBudget");
    expect(obj.spec).toEqual({ owner: "ada", cpu: "16" });
    expect(obj.metadata?.annotations?.["agent-platform.ai/budget-set-by"]).toBe(
      "op-1",
    );
    expect(row).toMatchObject({
      ownerSub: "ada",
      cpu: "16",
      memory: null,
      storage: null,
      setBySub: "op-1",
    });
    expect(Date.parse(row!.updatedAt!)).not.toBeNaN();
  });

  it("changes one field and keeps the others", async () => {
    const { k8s } = budgetsCluster();
    await writeUserBudget(k8s, {
      ownerSub: "ada",
      change: { cpu: "16", memory: "32Gi", storage: "500Gi" },
      setBySub: "op-1",
    });
    const { from } = await writeUserBudget(k8s, {
      ownerSub: "ada",
      change: { memory: "64Gi", storage: null },
      setBySub: "op-2",
    });
    expect(from).toEqual({ cpu: "16", memory: "32Gi", storage: "500Gi" });
    expect(await readUserBudgetSizes(k8s, "ada")).toEqual({
      cpu: "16",
      memory: "64Gi",
      storage: null,
    });
    const [row] = await listUserBudgets(k8s);
    expect(row?.setBySub).toBe("op-2");
  });

  it("deletes a budget whose last field goes back to the default", async () => {
    const { k8s, store } = budgetsCluster();
    await writeUserBudget(k8s, {
      ownerSub: "ada",
      change: { cpu: "16" },
      setBySub: "op-1",
    });
    const { row } = await writeUserBudget(k8s, {
      ownerSub: "ada",
      change: { cpu: null },
      setBySub: "op-1",
    });
    expect(row).toBeNull();
    expect(store.has("budget-ada")).toBe(false);
  });

  it("removes a budget and says what it was", async () => {
    const { k8s } = budgetsCluster();
    await writeUserBudget(k8s, {
      ownerSub: "ada",
      change: { memory: "32Gi" },
      setBySub: "op-1",
    });
    expect(await deleteUserBudget(k8s, "ada")).toEqual({
      cpu: null,
      memory: "32Gi",
      storage: null,
    });
    expect(await deleteUserBudget(k8s, "ada")).toBeNull();
  });

  it("lists a budget written with kubectl, with no record of who set it", async () => {
    const { k8s, store } = budgetsCluster();
    store.set("budget-bob", {
      metadata: { name: "budget-bob" },
      spec: { owner: "bob", cpu: 8 },
    });
    expect(await listUserBudgets(k8s)).toEqual([
      {
        ownerSub: "bob",
        cpu: "8",
        memory: null,
        storage: null,
        setBySub: null,
        updatedAt: null,
      },
    ]);
  });

  it("answers the cluster's validation refusal as a BAD_REQUEST with its reason", async () => {
    const { k8s } = budgetsCluster({
      code: 422,
      body: JSON.stringify({
        message: 'UserBudget "budget-A" is invalid: spec.owner: Invalid value',
      }),
    });
    await expect(
      writeUserBudget(k8s, {
        ownerSub: "A",
        change: { cpu: "4" },
        setBySub: "op-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("spec.owner: Invalid value"),
    });
  });
});
