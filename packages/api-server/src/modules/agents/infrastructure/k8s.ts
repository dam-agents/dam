import * as k8s from "@kubernetes/client-node";

export interface K8sClient {
  readonly namespace: string;

  readAgentPodRestart(
    agentId: string,
  ): Promise<{ restarts: number; reason: string | null } | null>;

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
  watchCustomObject(
    plural: string,
    name: string,
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

    async readAgentPodRestart(agentId) {
      const res = await api.listNamespacedPod({
        namespace,
        labelSelector: `agent-platform.ai/pair=${agentId},agent-platform.ai/role=agent`,
      });
      const pods = res.items ?? [];
      if (pods.length === 0) return null;
      let restarts = 0;
      let reason: string | null = null;
      for (const pod of pods) {
        for (const cs of pod.status?.containerStatuses ?? []) {
          const count = cs.restartCount ?? 0;
          if (count > restarts) {
            restarts = count;
            reason = cs.lastState?.terminated?.reason ?? null;
          }
        }
      }
      return { restarts, reason };
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
      return watchPath(`${plural}`, {}, onEvent, onEnd);
    },
    watchCustomObject(plural, name, onEvent, onEnd) {
      return watchPath(
        `${plural}`,
        { fieldSelector: `metadata.name=${name}` },
        onEvent,
        onEnd,
      );
    },
  };

  function watchPath(
    plural: string,
    queryParams: Record<string, string>,
    onEvent: (phase: string, obj: KubeObject) => void,
    onEnd: (err?: unknown) => void,
  ): () => void {
    let stopped = false;
    let connection: AbortController | null = null;
    watcher
      .watch(
        `/apis/${CR_GROUP}/${CR_VERSION}/namespaces/${namespace}/${plural}`,
        queryParams,
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
  }
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
