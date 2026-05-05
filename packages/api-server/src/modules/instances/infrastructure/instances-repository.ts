import { is409, type K8sClient } from "../../agents/infrastructure/k8s.js";
import { retry } from "../../agents/infrastructure/retry.js";
import {
  LABEL_TYPE, TYPE_INSTANCE, LABEL_OWNER, LABEL_INSTANCE_REF, LABEL_AGENT_REF, LAST_ACTIVITY_KEY,
} from "../../agents/infrastructure/labels.js";
import {
  isOwnedBy, hasType, patchSpecField, setDesiredState, isPodReady,
} from "../../agents/infrastructure/configmap-mappers.js";
import { parseInfraInstance, buildInstanceConfigMap } from "./configmap-mappers.js";
import {
  pollUntilReady, WAKE_POLL_INITIAL_MS, WAKE_POLL_MAX_MS, WAKE_TIMEOUT_MS,
} from "../../agents/infrastructure/poll-until-ready.js";
import type { InfraInstance } from "../domain/instance-assembly.js";

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

export interface InstancesRepository {
  list(owner?: string): Promise<InfraInstance[]>;
  get(id: string, owner?: string): Promise<InfraInstance | null>;
  create(agentId: string, spec: Record<string, unknown>, owner: string): Promise<InfraInstance>;
  updateSpec(id: string, owner: string | undefined, patch: Record<string, unknown>): Promise<InfraInstance | null>;
  delete(id: string, owner?: string): Promise<boolean>;
  restart(id: string, owner?: string): Promise<boolean>;
  wake(id: string): Promise<InfraInstance | null>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
  getOwner(id: string): Promise<string | null>;
  /** Resolve an instance to its `(owner, agentId)`. Used by the ext_authz
   *  hot path to look up egress rules and credit pending approvals. */
  resolveIdentity(id: string): Promise<{ owner: string; agentId: string } | null>;
  patchAnnotation(id: string, key: string, value: string): Promise<void>;
  wakeIfHibernated(id: string): Promise<boolean>;
  isPodReady(id: string): Promise<boolean>;
  /**
   * Make the instance's pod reachable. Idempotent; single-flight per id;
   * bumps `agent-platform.ai/last-activity` on every successful completion so any
   * caller implicitly keeps the pod warm.
   *
   * The observed pod Ready condition is the authoritative signal — not
   * `desiredState`. See ADR-032.
   */
  ensureReady(id: string): Promise<void>;
}

export function createInstancesRepository(k8s: K8sClient): InstancesRepository {
  // Single-flight per instance id. Concurrent callers for the same id share
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
      metadata: { annotations: { [LAST_ACTIVITY_KEY]: new Date().toISOString() } },
    });
  }

  return {
    async list(owner?) {
      const ownerSelector = owner ? `,${LABEL_OWNER}=${owner}` : "";
      const [configMaps, pods] = await Promise.all([
        k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_INSTANCE}${ownerSelector}`),
        k8s.listPods(LABEL_INSTANCE_REF),
      ]);
      const podMap = new Map<string, (typeof pods)[number]>();
      for (const pod of pods) {
        const ref = pod.metadata?.labels?.[LABEL_INSTANCE_REF];
        if (ref) podMap.set(ref, pod);
      }
      return configMaps.map((cm) =>
        parseInfraInstance(cm, podMap.get(cm.metadata!.name!)),
      );
    },

    async get(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return null;
      if (owner && !isOwnedBy(cm, owner)) return null;
      if (!owner && !hasType(cm, TYPE_INSTANCE)) return null;
      const pod = await k8s.getPod(`${id}-0`);
      return parseInfraInstance(cm, pod ?? undefined);
    },

    async create(agentId, spec, owner) {
      const body = buildInstanceConfigMap(agentId, spec, owner);
      const created = await k8s.createConfigMap(body);
      return parseInfraInstance(created);
    },

    async updateSpec(id, owner, patch) {
      // read-modify-write under a conflict-retry loop: re-fetch the
      // ConfigMap (fresh resourceVersion) on 409 so concurrent writers
      // (MCP + UI, or two tabs) don't surface racy errors.
      return retryOnConflict(async () => {
        const cm = await k8s.getConfigMap(id);
        if (!cm) return null;
        if (owner && !isOwnedBy(cm, owner)) return null;
        cm.data = patchSpecField(cm, patch);
        const updated = await k8s.replaceConfigMap(id, cm);
        return parseInfraInstance(updated);
      });
    },

    async delete(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return false;
      if (owner && !isOwnedBy(cm, owner)) return false;
      await k8s.deleteConfigMap(id);
      return true;
    },

    async restart(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return false;
      if (owner && !isOwnedBy(cm, owner)) return false;
      // Delete pod-0; the StatefulSet controller will recreate it with the
      // current spec. For replicas=1 this is equivalent to `kubectl rollout
      // restart` without the pod-template annotation dance, which would be
      // wiped by the next reconcile of applyStatefulSet.
      // A 404 from deletePod (pod already gone — crashed, mid-recreate, etc.)
      // is still a successful restart from the user's perspective: the
      // StatefulSet will produce a fresh pod-0 regardless.
      await k8s.deletePod(`${id}-0`);
      return true;
    },

    async wake(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return null;
      const infra = parseInfraInstance(cm);
      if (infra.desiredState !== "hibernated") {
        const pod = await k8s.getPod(`${id}-0`);
        return parseInfraInstance(cm, pod ?? undefined);
      }
      const woken = setDesiredState(cm, "running");
      await k8s.replaceConfigMap(cm.metadata!.name!, woken);
      const reread = await k8s.getConfigMap(id);
      if (!reread) return null;
      const pod = await k8s.getPod(`${id}-0`);
      return parseInfraInstance(reread, pod ?? undefined);
    },

    async isOwnedBy(id, owner) {
      const cm = await k8s.getConfigMap(id);
      return cm !== null && isOwnedBy(cm, owner);
    },

    async getOwner(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_INSTANCE)) return null;
      return cm.metadata?.labels?.[LABEL_OWNER] ?? null;
    },

    async resolveIdentity(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_INSTANCE)) return null;
      const owner = cm.metadata?.labels?.[LABEL_OWNER];
      const agentId = cm.metadata?.labels?.[LABEL_AGENT_REF];
      if (!owner || !agentId) return null;
      return { owner, agentId };
    },

    async patchAnnotation(id, key, value) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return;
      if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
      cm.metadata!.annotations[key] = value;
      await k8s.replaceConfigMap(id, cm);
    },

    async wakeIfHibernated(id) {
      // Retry on optimistic-concurrency conflict (HTTP 409) — mirrors the Go
      // controller's retry.RetryOnConflict. Without this, a racing controller
      // status write turns a routine wake into an ensureReady failure.
      const wakeOnce = async () => {
        const cm = await k8s.getConfigMap(id);
        if (!cm) return false;
        if (parseInfraInstance(cm).desiredState !== "hibernated") return true;
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
        // wakeIfHibernated is a no-op when desiredState is already "running",
        // so calling it here is cheap and covers the "running-but-pod-absent"
        // window (fresh instance, pod crash, mid-termination).
        await this.wakeIfHibernated(id);
        const ready = await pollUntilReady(
          () => this.isPodReady(id),
          WAKE_POLL_INITIAL_MS,
          WAKE_POLL_MAX_MS,
          WAKE_TIMEOUT_MS,
        );
        if (!ready) {
          throw new Error(`instance ${id} did not become ready within ${WAKE_TIMEOUT_MS / 1000}s`);
        }
        await bumpLastActivity(id);
      })().finally(() => {
        inflight.delete(id);
      });
      inflight.set(id, work);
      return work;
    },
  };
}
