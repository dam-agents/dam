/**
 * Thin K8s client — Secret and agent-platform.ai custom-resource operations
 * only. No domain types, no YAML parsing, no label constants.
 */
import * as k8s from "@kubernetes/client-node";

// ---------------------------------------------------------------------------
// K8sClient interface
// ---------------------------------------------------------------------------

export interface K8sClient {
  /** The namespace this client is scoped to (i.e. where agent pods live). */
  readonly namespace: string;

  // Agents/forks are custom resources and templates are file-mounted now,
  // so the api-server makes no ConfigMap calls — none are exposed.
  listSecrets(labelSelector: string): Promise<k8s.V1Secret[]>;
  getSecret(name: string): Promise<k8s.V1Secret | null>;
  createSecret(body: k8s.V1Secret): Promise<k8s.V1Secret>;
  replaceSecret(name: string, body: k8s.V1Secret): Promise<k8s.V1Secret>;
  deleteSecret(name: string): Promise<void>;

  // agent-platform.ai/v1 custom resources. `plural` selects the
  // resource (e.g. "agents"); the group/version are the platform's.
  getCustomObject(plural: string, name: string): Promise<KubeObject | null>;
  listCustomObjects(
    plural: string,
    labelSelector?: string,
  ): Promise<KubeObject[]>;
  createCustomObject(plural: string, body: object): Promise<KubeObject>;
  /** RFC 7386 merge-patch — replaces the supplied spec/metadata subtrees,
   *  arrays included. Conflict-free (no resourceVersion), so no 409 retry. */
  patchCustomObject(
    plural: string,
    name: string,
    body: object,
  ): Promise<KubeObject>;
  deleteCustomObject(plural: string, name: string): Promise<void>;
}

/** A minimally-typed Kubernetes custom resource as returned by the dynamic
 *  CustomObjects API. Consumers cast `spec`/`status` to their shape. */
export interface KubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    uid?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: unknown;
  status?: unknown;
}

// The platform's custom-resource group/version. Kept here so the
// generic CR methods stay caller-agnostic about coordinates.
const CR_GROUP = "agent-platform.ai";
const CR_VERSION = "v1";

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

export function createK8sClient(
  api: k8s.CoreV1Api,
  namespace: string,
): K8sClient {
  // The CustomObjects client drives agent-platform.ai/v1 resources. Built
  // from the same default KubeConfig as `api` so callers don't have to thread
  // a second client through every composition site.
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const co = kc.makeApiClient(k8s.CustomObjectsApi);
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
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function podBaseUrl(agentId: string, namespace: string): string {
  return `${agentId}-0.${agentId}.${namespace}.svc:8080`;
}

export function createApi(namespace: string) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  return {
    api: kc.makeApiClient(k8s.CoreV1Api),
    // Injected into the fork orchestrator so it stays unit-testable
    // with a fake. The agents K8sClient builds its own CustomObjectsApi
    // internally — it's faked in tests, so it needs no injected client.
    customObjects: kc.makeApiClient(k8s.CustomObjectsApi),
    namespace,
  };
}
