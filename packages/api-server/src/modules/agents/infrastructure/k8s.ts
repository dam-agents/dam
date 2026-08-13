import * as k8s from "@kubernetes/client-node";

export interface K8sClient {
  readonly namespace: string;

  // Agents/forks are custom resources and templates are file-mounted now,
  // so the api-server makes no ConfigMap calls — none are exposed. Pods are
  // absent for the same reason and deliberately stay that way: readiness is
  // the Agent's Ready condition and a mid-turn crash is its published
  // restart count, both controller-written status. A pod read here would also
  // need an RBAC grant the chart withholds on purpose — see
  // docs/architecture/platform-topology.md.

  listSecrets(labelSelector: string): Promise<k8s.V1Secret[]>;
  getSecret(name: string): Promise<k8s.V1Secret | null>;
  createSecret(body: k8s.V1Secret): Promise<k8s.V1Secret>;
  replaceSecret(name: string, body: k8s.V1Secret): Promise<k8s.V1Secret>;
  deleteSecret(name: string): Promise<void>;

  getCustomObject(plural: string, name: string): Promise<KubeObject | null>;
  listCustomObjects(
    plural: string,
    labelSelector?: string,
  ): Promise<KubeObject[]>;
  createCustomObject(plural: string, body: object): Promise<KubeObject>;
  patchCustomObject(
    plural: string,
    name: string,
    body: object,
  ): Promise<KubeObject>;
  deleteCustomObject(plural: string, name: string): Promise<void>;
  watchCustomObjects(
    plural: string,
    onEvent: (phase: string, obj: KubeObject) => void,
    onEnd: (err?: unknown) => void,
  ): () => void;
}

export interface KubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    uid?: string;
    resourceVersion?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: unknown;
  status?: unknown;
}

const CR_GROUP = "agent-platform.ai";
const CR_VERSION = "v1";

function isStatus(err: unknown, code: number): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: number }).code === code
  );
}
const is404 = (err: unknown) => isStatus(err, 404);

export function createK8sClient(
  api: k8s.CoreV1Api,
  namespace: string,
): K8sClient {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const co = kc.makeApiClient(k8s.CustomObjectsApi);
  const watcher = new k8s.Watch(kc);
  const crArgs = (plural: string) => ({
    group: CR_GROUP,
    version: CR_VERSION,
    namespace,
    plural,
  });

  return {
    namespace,

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

    async getCustomObject(plural, name) {
      try {
        return (await co.getNamespacedCustomObject({
          ...crArgs(plural),
          name,
        })) as KubeObject;
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async listCustomObjects(plural, labelSelector) {
      const res = await co.listNamespacedCustomObject({
        ...crArgs(plural),
        ...(labelSelector ? { labelSelector } : {}),
      });
      return ((res as { items?: KubeObject[] }).items ?? []) as KubeObject[];
    },

    async createCustomObject(plural, body) {
      return (await co.createNamespacedCustomObject({
        ...crArgs(plural),
        body,
      })) as KubeObject;
    },

    async patchCustomObject(plural, name, body) {
      return (await co.patchNamespacedCustomObject(
        { ...crArgs(plural), name, body },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      )) as KubeObject;
    },

    async deleteCustomObject(plural, name) {
      try {
        await co.deleteNamespacedCustomObject({ ...crArgs(plural), name });
      } catch (err) {
        if (is404(err)) return;
        throw err;
      }
    },

    watchCustomObjects(plural, onEvent, onEnd) {
      let stopped = false;
      let connection: AbortController | null = null;
      watcher
        .watch(
          `/apis/${CR_GROUP}/${CR_VERSION}/namespaces/${namespace}/${plural}`,
          {},
          (phase, obj) => {
            if (!stopped) onEvent(phase, obj as KubeObject);
          },
          (err) => {
            if (!stopped) onEnd(err ?? undefined);
          },
        )
        .then((c) => {
          if (stopped) c.abort();
          else connection = c;
        })
        .catch((err) => {
          if (!stopped) onEnd(err);
        });
      return () => {
        stopped = true;
        connection?.abort();
      };
    },
  };
}

export function podBaseUrl(agentId: string, namespace: string): string {
  return `${agentId}.${namespace}.svc:8080`;
}

export function createApi(namespace: string) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  return {
    api: kc.makeApiClient(k8s.CoreV1Api),
    namespace,
  };
}
