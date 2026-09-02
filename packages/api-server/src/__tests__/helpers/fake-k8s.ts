import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";

export function fakeK8s(initial: KubeObject[] = []) {
  const store = new Map<string, KubeObject>();
  for (const o of initial) store.set(o.metadata?.name ?? "", o);
  const client: K8sClient = {
    namespace: "test-agents",
    watchCustomObjects() {
      return () => {};
    },
    async getCustomObject(_plural, name) {
      return store.get(name) ?? null;
    },
    async listCustomObjects() {
      return [...store.values()];
    },
    async createCustomObject(_plural, body) {
      const obj = body as KubeObject;
      store.set(obj.metadata?.name ?? "", obj);
      return obj;
    },
    async patchCustomObject(_plural, name, body) {
      const existing = store.get(name);
      if (!existing) throw new Error(`404: ${name}`);
      const patch = body as KubeObject;
      const merged: KubeObject = {
        ...existing,
        ...(patch.metadata
          ? {
              metadata: {
                ...existing.metadata,
                ...patch.metadata,
                annotations: {
                  ...existing.metadata?.annotations,
                  ...patch.metadata.annotations,
                },
              },
            }
          : {}),
      };
      store.set(name, merged);
      return merged;
    },
    async deleteCustomObject(_plural, name) {
      store.delete(name);
    },
    listSecrets: () => Promise.reject(new Error("not implemented")),
    getSecret: () => Promise.reject(new Error("not implemented")),
    createSecret: () => Promise.reject(new Error("not implemented")),
    replaceSecret: () => Promise.reject(new Error("not implemented")),
    deleteSecret: () => Promise.reject(new Error("not implemented")),
  };
  return { client, store };
}
