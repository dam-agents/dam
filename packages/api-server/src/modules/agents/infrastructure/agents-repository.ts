import { is409, type K8sClient } from "./k8s.js";
import { retry } from "./retry.js";
import {
  LABEL_TYPE,
  TYPE_AGENT,
  LABEL_OWNER,
  LABEL_ROLE,
  ROLE_AGENT,
  LAST_ACTIVITY_KEY,
} from "./labels.js";
import {
  isOwnedBy,
  hasType,
  patchSpecField,
  setDesiredState,
  isPodReady,
} from "./configmap-mappers.js";
import {
  parseInfraAgent,
  buildAgentConfigMap,
  type InfraAgent,
} from "./agents-configmap-mappers.js";
import {
  pollUntilReady,
  WAKE_POLL_INITIAL_MS,
  WAKE_POLL_MAX_MS,
  WAKE_TIMEOUT_MS,
} from "./poll-until-ready.js";

/** Re-run a read-modify-write routine when the K8s API rejects the write
 *  with 409 Conflict. Mirrors the Go controller's `retry.RetryOnConflict`
 *  so concurrent MCP + UI writers don't surface racy errors to the user. */
async function retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!is409(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

export interface AgentsRepository {
  list(owner?: string): Promise<InfraAgent[]>;
  get(id: string, owner?: string): Promise<InfraAgent | null>;
  create(
    spec: Record<string, unknown>,
    owner: string,
    templateId?: string,
  ): Promise<InfraAgent>;
  updateSpec(
    id: string,
    owner: string | undefined,
    patch: Record<string, unknown>,
  ): Promise<InfraAgent | null>;
  delete(id: string, owner?: string): Promise<boolean>;
  restart(id: string, owner?: string): Promise<boolean>;
  wake(id: string): Promise<InfraAgent | null>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
  getOwner(id: string): Promise<string | null>;
  /** Resolve an agent CM to its identity. Used by the ext_authz hot path
   *  to look up egress rules and credit pending approvals. After ADR-046
   *  the agent is its own resource, so `agentId === id`. */
  resolveIdentity(
    id: string,
  ): Promise<{ owner: string; agentId: string } | null>;
  patchAnnotation(id: string, key: string, value: string): Promise<void>;
  wakeIfHibernated(id: string): Promise<boolean>;
  isPodReady(id: string): Promise<boolean>;
  /**
   * Make the agent's pod reachable. Idempotent; single-flight per id;
   * bumps `agent-platform.ai/last-activity` on every successful completion
   * so any caller implicitly keeps the pod warm.
   *
   * The observed pod Ready condition is the authoritative signal — not
   * `desiredState`. See ADR-032.
   */
  ensureReady(id: string): Promise<void>;
}

export function createAgentsRepository(k8s: K8sClient): AgentsRepository {
  // Single-flight per agent id. Concurrent callers for the same id share
  // one in-flight wake+wait+bump; callers for different ids don't block each
  // other. Correctness does not depend on this (K8s optimistic concurrency
  // already serializes concurrent ConfigMap updates) — it keeps API load
  // sane under bursty call patterns.
  const inflight = new Map<string, Promise<void>>();

  // Strategic-merge-patch — no read-modify-write, no resourceVersion, no
  // 409 conflict possible. Mirrors the intent of the Go controller's
  // retry.RetryOnConflict wrapper but is more direct (and cheaper: one round
  // trip, no GET).
  async function bumpLastActivity(id: string): Promise<void> {
    await k8s.patchConfigMap(id, {
      metadata: {
        annotations: { [LAST_ACTIVITY_KEY]: new Date().toISOString() },
      },
    });
  }

  const repo: AgentsRepository = {
    async list(owner?) {
      const ownerSelector = owner ? `,${LABEL_OWNER}=${owner}` : "";
      const [configMaps, pods] = await Promise.all([
        k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_AGENT}${ownerSelector}`),
        // ADR-038: agent and gateway pods share the agent label; narrow
        // to role=agent so status (Ready, podIP) reflects the agent half
        // of the pair, which is what callers expect.
        k8s.listPods(`${LABEL_ROLE}=${ROLE_AGENT}`),
      ]);
      const podMap = new Map<string, (typeof pods)[number]>();
      for (const pod of pods) {
        // Pod name is `<agentId>-0` (StatefulSet replica 0)
        const podName = pod.metadata?.name;
        if (!podName) continue;
        const agentId = podName.endsWith("-0") ? podName.slice(0, -2) : podName;
        podMap.set(agentId, pod);
      }
      return configMaps.map((cm) =>
        parseInfraAgent(cm, podMap.get(cm.metadata!.name!)),
      );
    },

    async get(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return null;
      if (!hasType(cm, TYPE_AGENT)) return null;
      if (owner && !isOwnedBy(cm, owner)) return null;
      const pod = await k8s.getPod(`${id}-0`);
      return parseInfraAgent(cm, pod ?? undefined);
    },

    async create(spec, owner, templateId?) {
      const body = buildAgentConfigMap(spec, owner, templateId);
      const created = await k8s.createConfigMap(body);
      return parseInfraAgent(created);
    },

    async updateSpec(id, owner, patch) {
      // read-modify-write under a conflict-retry loop: re-fetch the
      // ConfigMap (fresh resourceVersion) on 409 so concurrent writers
      // (MCP + UI, or two tabs) don't surface racy errors.
      return retryOnConflict(async () => {
        const cm = await k8s.getConfigMap(id);
        if (!cm) return null;
        if (!hasType(cm, TYPE_AGENT)) return null;
        if (owner && !isOwnedBy(cm, owner)) return null;
        cm.data = patchSpecField(cm, patch);
        const updated = await k8s.replaceConfigMap(id, cm);
        return parseInfraAgent(updated);
      });
    },

    async delete(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return false;
      if (!hasType(cm, TYPE_AGENT)) return false;
      if (owner && !isOwnedBy(cm, owner)) return false;
      await k8s.deleteConfigMap(id);
      return true;
    },

    async restart(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return false;
      if (!hasType(cm, TYPE_AGENT)) return false;
      if (owner && !isOwnedBy(cm, owner)) return false;
      // Delete pod-0; the StatefulSet controller will recreate it with the
      // current spec. For replicas=1 this is equivalent to `kubectl rollout
      // restart` without the pod-template annotation dance.
      await k8s.deletePod(`${id}-0`);
      return true;
    },

    async wake(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_AGENT)) return null;
      const infra = parseInfraAgent(cm);
      if (infra.desiredState !== "hibernated") {
        const pod = await k8s.getPod(`${id}-0`);
        return parseInfraAgent(cm, pod ?? undefined);
      }
      const woken = setDesiredState(cm, "running");
      await k8s.replaceConfigMap(cm.metadata!.name!, woken);
      const reread = await k8s.getConfigMap(id);
      if (!reread) return null;
      const pod = await k8s.getPod(`${id}-0`);
      return parseInfraAgent(reread, pod ?? undefined);
    },

    async isOwnedBy(id, owner) {
      const cm = await k8s.getConfigMap(id);
      return cm !== null && hasType(cm, TYPE_AGENT) && isOwnedBy(cm, owner);
    },

    async getOwner(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_AGENT)) return null;
      return cm.metadata?.labels?.[LABEL_OWNER] ?? null;
    },

    async resolveIdentity(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_AGENT)) return null;
      const owner = cm.metadata?.labels?.[LABEL_OWNER];
      if (!owner) return null;
      return { owner, agentId: id };
    },

    async patchAnnotation(id, key, value) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return;
      if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
      cm.metadata!.annotations[key] = value;
      await k8s.replaceConfigMap(id, cm);
    },

    async wakeIfHibernated(id) {
      const wakeOnce = async () => {
        const cm = await k8s.getConfigMap(id);
        if (!cm || !hasType(cm, TYPE_AGENT)) return false;
        if (parseInfraAgent(cm).desiredState !== "hibernated") return true;
        await k8s.replaceConfigMap(id, setDesiredState(cm, "running"));
        return true;
      };
      return retry(wakeOnce, is409);
    },

    async isPodReady(id) {
      const pod = await k8s.getPod(`${id}-0`);
      return pod !== null && isPodReady(pod);
    },

    async ensureReady(id) {
      const existing = inflight.get(id);
      if (existing) return existing;

      const work = (async () => {
        const pod = await k8s.getPod(`${id}-0`);
        if (pod !== null && isPodReady(pod)) {
          await bumpLastActivity(id);
          return;
        }
        await repo.wakeIfHibernated(id);
        const ready = await pollUntilReady(
          () => repo.isPodReady(id),
          WAKE_POLL_INITIAL_MS,
          WAKE_POLL_MAX_MS,
          WAKE_TIMEOUT_MS,
        );
        if (!ready) {
          throw new Error(
            `agent ${id} did not become ready within ${WAKE_TIMEOUT_MS / 1000}s`,
          );
        }
        await bumpLastActivity(id);
      })().finally(() => {
        inflight.delete(id);
      });
      inflight.set(id, work);
      return work;
    },
  };

  return repo;
}
