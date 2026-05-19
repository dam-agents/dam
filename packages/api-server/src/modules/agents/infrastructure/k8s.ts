/**
 * Thin K8s client — generic ConfigMap / Pod / PVC operations only.
 * No domain types, no YAML parsing, no label constants.
 */
import * as k8s from "@kubernetes/client-node";

// ---------------------------------------------------------------------------
// K8sClient interface
// ---------------------------------------------------------------------------

export interface K8sClient {
  /** The namespace this client is scoped to (i.e. where agent pods live). */
  readonly namespace: string;

  listConfigMaps(labelSelector: string): Promise<k8s.V1ConfigMap[]>;
  getConfigMap(name: string): Promise<k8s.V1ConfigMap | null>;
  createConfigMap(body: k8s.V1ConfigMap): Promise<k8s.V1ConfigMap>;
  replaceConfigMap(
    name: string,
    body: k8s.V1ConfigMap,
  ): Promise<k8s.V1ConfigMap>;
  patchConfigMap(name: string, body: object): Promise<void>;
  deleteConfigMap(name: string): Promise<void>;

  listSecrets(labelSelector: string): Promise<k8s.V1Secret[]>;
  getSecret(name: string): Promise<k8s.V1Secret | null>;
  createSecret(body: k8s.V1Secret): Promise<k8s.V1Secret>;
  replaceSecret(name: string, body: k8s.V1Secret): Promise<k8s.V1Secret>;
  deleteSecret(name: string): Promise<void>;

  listPods(labelSelector: string): Promise<k8s.V1Pod[]>;
  getPod(name: string): Promise<k8s.V1Pod | null>;
  patchPod(name: string, body: object): Promise<void>;
  deletePod(name: string): Promise<boolean>;

  listPVCs(labelSelector: string): Promise<k8s.V1PersistentVolumeClaim[]>;
  deletePVC(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isStatus(err: unknown, code: number): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: number }).code === code
  );
}
const is404 = (err: unknown) => isStatus(err, 404);
export const is409 = (err: unknown) => isStatus(err, 409);

export function createK8sClient(
  api: k8s.CoreV1Api,
  namespace: string,
): K8sClient {
  return {
    namespace,

    async listConfigMaps(labelSelector) {
      const res = await api.listNamespacedConfigMap({
        namespace,
        labelSelector,
      });
      return res.items ?? [];
    },

    async getConfigMap(name) {
      try {
        return await api.readNamespacedConfigMap({ name, namespace });
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async createConfigMap(body) {
      return api.createNamespacedConfigMap({
        namespace,
        body: { ...body, metadata: { ...body.metadata, namespace } },
      });
    },

    async replaceConfigMap(name, body) {
      return api.replaceNamespacedConfigMap({
        name,
        namespace,
        body: { ...body, metadata: { ...body.metadata, namespace } },
      });
    },

    async patchConfigMap(name, body) {
      await api.patchNamespacedConfigMap(
        { name, namespace, body },
        k8s.setHeaderOptions(
          "Content-Type",
          k8s.PatchStrategy.StrategicMergePatch,
        ),
      );
    },

    async deleteConfigMap(name) {
      await api.deleteNamespacedConfigMap({ name, namespace });
    },

    async listSecrets(labelSelector) {
      const res = await api.listNamespacedSecret({ namespace, labelSelector });
      return res.items ?? [];
    },

    async getSecret(name) {
      try {
        return await api.readNamespacedSecret({ name, namespace });
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async createSecret(body) {
      return api.createNamespacedSecret({
        namespace,
        body: { ...body, metadata: { ...body.metadata, namespace } },
      });
    },

    async replaceSecret(name, body) {
      return api.replaceNamespacedSecret({
        name,
        namespace,
        body: { ...body, metadata: { ...body.metadata, namespace } },
      });
    },

    async deleteSecret(name) {
      try {
        await api.deleteNamespacedSecret({ name, namespace });
      } catch (err) {
        if (is404(err)) return;
        throw err;
      }
    },

    async listPods(labelSelector) {
      const res = await api.listNamespacedPod({ namespace, labelSelector });
      return res.items ?? [];
    },

    async getPod(name) {
      try {
        return await api.readNamespacedPod({ name, namespace });
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async patchPod(name, body) {
      await api.patchNamespacedPod({ name, namespace, body });
    },

    async deletePod(name) {
      try {
        await api.deleteNamespacedPod({ name, namespace });
        return true;
      } catch (err) {
        if (is404(err)) return false;
        throw err;
      }
    },

    async listPVCs(labelSelector) {
      const res = await api.listNamespacedPersistentVolumeClaim({
        namespace,
        labelSelector,
      });
      return res.items ?? [];
    },

    async deletePVC(name) {
      await api.deleteNamespacedPersistentVolumeClaim({ name, namespace });
    },
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function podBaseUrl(instanceId: string, namespace: string): string {
  return `${instanceId}-0.${instanceId}.${namespace}.svc:8080`;
}

export function createApi(namespace: string) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  return { api: kc.makeApiClient(k8s.CoreV1Api), namespace };
}
