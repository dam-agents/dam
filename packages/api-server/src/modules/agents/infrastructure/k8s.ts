import * as k8s from "@kubernetes/client-node";
import { AGENTS_PLURAL, GROUP, VERSION } from "./labels.js";

export interface K8sClient {
  readonly namespace: string;

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
    generation?: number;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: unknown;
  status?: unknown;
}

const is404 = (err: unknown) =>
  err instanceof Error &&
  "code" in err &&
  (err as { code: number }).code === 404;
export const isNotFound = is404;

export const isConflict = (err: unknown) =>
  err instanceof Error &&
  "code" in err &&
  (err as { code: number }).code === 409;
const isDnsSubdomainName = (name: string) =>
  /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/.test(name);

export async function listCustomObjectsOrEmpty<T>(
  list: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await list();
  } catch (err) {
    if (is404(err)) return [];
    throw err;
  }
}

let cachedKubeConfig: k8s.KubeConfig | undefined;

function loadKubeConfig(): k8s.KubeConfig {
  if (!cachedKubeConfig) {
    cachedKubeConfig = new k8s.KubeConfig();
    cachedKubeConfig.loadFromDefault();
  }
  return cachedKubeConfig;
}

export function createK8sClient(
  api: k8s.CoreV1Api,
  namespace: string,
): K8sClient {
  const kc = loadKubeConfig();
  const co = kc.makeApiClient(k8s.CustomObjectsApi);
  const watcher = new k8s.Watch(kc);
  const crArgs = (plural: string) => ({
    group: GROUP,
    version: VERSION,
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
      if (!isDnsSubdomainName(name)) return null;
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
      if (!isDnsSubdomainName(name))
        throw new Error(`invalid object name: ${name}`);
      return api.replaceNamespacedSecret({
        name,
        namespace,
        body: { ...body, metadata: { ...body.metadata, namespace } },
      });
    },

    async deleteSecret(name) {
      if (!isDnsSubdomainName(name)) return;
      try {
        await api.deleteNamespacedSecret({ name, namespace });
      } catch (err) {
        if (is404(err)) return;
        throw err;
      }
    },

    async getCustomObject(plural, name) {
      if (!isDnsSubdomainName(name)) return null;
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
      return listCustomObjectsOrEmpty(async () => {
        const res = await co.listNamespacedCustomObject({
          ...crArgs(plural),
          ...(labelSelector ? { labelSelector } : {}),
        });
        return ((res as { items?: KubeObject[] }).items ?? []) as KubeObject[];
      });
    },

    async createCustomObject(plural, body) {
      return (await co.createNamespacedCustomObject({
        ...crArgs(plural),
        body,
      })) as KubeObject;
    },

    async patchCustomObject(plural, name, body) {
      if (!isDnsSubdomainName(name))
        throw new Error(`invalid object name: ${name}`);
      return (await co.patchNamespacedCustomObject(
        { ...crArgs(plural), name, body },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      )) as KubeObject;
    },

    async deleteCustomObject(plural, name) {
      if (!isDnsSubdomainName(name)) return;
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
          `/apis/${GROUP}/${VERSION}/namespaces/${namespace}/${plural}`,
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

export function agentServiceAddress(
  agentId: string,
  namespace: string,
): string {
  return `${agentId}.${namespace}.svc:8080`;
}

export function createApi(namespace: string) {
  const kc = loadKubeConfig();
  return {
    api: kc.makeApiClient(k8s.CoreV1Api),
    namespace,
  };
}

export const currentClusterServer = (): string | null => {
  const cluster = loadKubeConfig().getCurrentCluster();
  return cluster?.server ?? null;
};

export const createLeaseApi = () =>
  loadKubeConfig().makeApiClient(k8s.CoordinationV1Api);

export const createAuthorizationApi = () =>
  loadKubeConfig().makeApiClient(k8s.AuthorizationV1Api);

export type AgentInformer = k8s.Informer<KubeObject> &
  k8s.ObjectCache<KubeObject>;

// UNIT_BOUNDARY_DESCRIPTION: client-node ends every watch after 30 s, and its informer then waits before it watches again: 1 s, then twice as long each time no agent changed, up to 30 s. In that wait the agent cache misses every write, so an agent created a moment ago reads as not found. A watch that ends on time is not a failure, so the informer watches again at once. A real failure still reaches the cache's error handler, which restarts with its own backoff.
export function createAgentInformer(namespace: string): AgentInformer {
  const kc = loadKubeConfig();
  const co = kc.makeApiClient(k8s.CustomObjectsApi);
  const path = `/apis/${GROUP}/${VERSION}/namespaces/${namespace}/${AGENTS_PLURAL}`;
  return new k8s.ListWatch<KubeObject>(
    path,
    new k8s.Watch(kc),
    async () => {
      const res = (await co.listNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: AGENTS_PLURAL,
      })) as k8s.KubernetesListObject<KubeObject>;
      return res;
    },
    false,
    undefined,
    undefined,
    { delayFn: async () => {} },
  );
}
