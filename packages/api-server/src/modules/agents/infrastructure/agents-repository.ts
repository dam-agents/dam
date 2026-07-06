import { type K8sClient } from "./k8s.js";
import {
  ACTIVE_SESSION_KEY,
  AGENTS_PLURAL,
  ANN_ROLL_REV,
  LABEL_OWNER,
  LAST_ACTIVITY_KEY,
} from "./labels.js";
import {
  agentIsOwnedBy,
  agentOwner,
  buildAgentObject,
  parseInfraAgent,
  readyConditionStatus,
  type InfraAgent,
} from "./agent-mappers.js";
import {
  pollUntilReady,
  WAKE_POLL_INITIAL_MS,
  WAKE_POLL_MAX_MS,
  WAKE_TIMEOUT_MS,
} from "./poll-until-ready.js";
import {
  AgentWakeTimeoutError,
  classifyWakeFailure,
  wakeFailureReasonToken,
} from "../domain/wake-failure.js";
import { getLogger } from "../../../core/logger.js";

export interface AgentsRepository {
  list(owner?: string): Promise<InfraAgent[]>;
  get(id: string, owner?: string): Promise<InfraAgent | null>;
  create(
    spec: Record<string, unknown>,
    owner: string,
    name: string,
    templateId?: string,
  ): Promise<InfraAgent>;
  updateSpec(
    id: string,
    owner: string | undefined,
    patch: Record<string, unknown>,
  ): Promise<InfraAgent | null>;
  /** Merge-patch arbitrary spec fields without an ownership check — for
   *  trusted internal fan-outs (e.g. connection grants). */
  patchSpec(id: string, patch: Record<string, unknown>): Promise<void>;
  delete(id: string, owner?: string): Promise<boolean>;
  restart(id: string, owner?: string): Promise<boolean>;
  wake(id: string): Promise<InfraAgent | null>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
  getOwner(id: string): Promise<string | null>;
  /** Resolve an agent CR to its identity. Used by the ext_authz hot path
   *  to look up egress rules and credit pending approvals. The agent is
   *  its own resource, so `agentId === id`. */
  resolveIdentity(
    id: string,
  ): Promise<{ owner: string; agentId: string } | null>;
  patchAnnotation(id: string, key: string, value: string): Promise<void>;
  clearActiveSessions(): Promise<number>;
  wakeIfHibernated(id: string): Promise<boolean>;
  /** Authoritative reachability: the controller's Ready condition
   *  (`AgentPodReady ∧ GatewayPodReady`). Absent or False ⇒ not ready; the
   *  api-server never reads pods. */
  isReady(id: string): Promise<boolean>;
  /** Make the agent's pod reachable. Idempotent, single-flight per id; bumps
   *  `agent-platform.ai/last-activity` on success to keep the pod warm.
   *  `onWaking` fires when the call enters (or joins) a cold-start wait —
   *  never on the already-ready fast path — so callers can tell their user
   *  a wake is underway. Throws `AgentWakeTimeoutError` (with the
   *  classified condition snapshot) when the budget expires. */
  ensureReady(id: string, opts?: { onWaking?: () => void }): Promise<void>;
}

export function createAgentsRepository(k8s: K8sClient): AgentsRepository {
  // Single-flight per agent id. Concurrent callers for the same id share
  // one in-flight wake+wait+bump; callers for different ids don't block each
  // other. Correctness does not depend on this (K8s optimistic concurrency
  // already serializes concurrent writes) — it keeps API load sane under
  // bursty call patterns.
  const inflight = new Map<string, Promise<void>>();

  // RFC 7386 merge-patch — no read-modify-write, no resourceVersion, no 409
  // conflict possible. One round trip.
  async function bumpLastActivity(id: string): Promise<void> {
    await k8s.patchCustomObject(AGENTS_PLURAL, id, {
      metadata: {
        annotations: { [LAST_ACTIVITY_KEY]: new Date().toISOString() },
      },
    });
  }

  const repo: AgentsRepository = {
    async list(owner?) {
      const selector = owner ? `${LABEL_OWNER}=${owner}` : undefined;
      const objs = await k8s.listCustomObjects(AGENTS_PLURAL, selector);
      return objs.map((o) => parseInfraAgent(o));
    },

    async get(id, owner?) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      if (owner && !agentIsOwnedBy(obj, owner)) return null;
      return parseInfraAgent(obj);
    },

    async create(spec, owner, name, templateId?) {
      const created = await k8s.createCustomObject(
        AGENTS_PLURAL,
        buildAgentObject(spec, owner, name, templateId),
      );
      return parseInfraAgent(created);
    },

    async updateSpec(id, owner, patch) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      if (owner && !agentIsOwnedBy(obj, owner)) return null;
      // Merge-patch sets the given spec fields (arrays replaced wholesale);
      // conflict-free, so no read-modify-write retry loop is needed.
      const updated = await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        spec: patch,
      });
      return parseInfraAgent(updated);
    },

    async patchSpec(id, patch) {
      await k8s.patchCustomObject(AGENTS_PLURAL, id, { spec: patch });
    },

    async delete(id, owner?) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return false;
      if (owner && !agentIsOwnedBy(obj, owner)) return false;
      await k8s.deleteCustomObject(AGENTS_PLURAL, id);
      return true;
    },

    async restart(id, owner?) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return false;
      if (owner && !agentIsOwnedBy(obj, owner)) return false;
      // Bump roll-rev. The controller stamps it into both pod
      // templates, rolling the pair — no pod-template annotation dance, no
      // direct pod deletion.
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: { annotations: { [ANN_ROLL_REV]: new Date().toISOString() } },
      });
      return true;
    },

    async wake(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      // Waking is an activity poke — bump last-activity so the
      // reconciler scales the pair up. There is no desiredState to flip.
      await bumpLastActivity(id);
      const reread = await k8s.getCustomObject(AGENTS_PLURAL, id);
      return reread ? parseInfraAgent(reread) : null;
    },

    async isOwnedBy(id, owner) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      return obj !== null && agentIsOwnedBy(obj, owner);
    },

    async getOwner(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      return obj ? (agentOwner(obj) ?? null) : null;
    },

    async resolveIdentity(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      const owner = agentOwner(obj);
      if (!owner) return null;
      return { owner, agentId: id };
    },

    async patchAnnotation(id, key, value) {
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: { annotations: { [key]: value } },
      });
    },

    async clearActiveSessions() {
      const objs = await k8s.listCustomObjects(AGENTS_PLURAL);
      let cleared = 0;
      for (const o of objs) {
        const id = o.metadata?.name;
        if (id && o.metadata?.annotations?.[ACTIVE_SESSION_KEY] === "true") {
          await repo.patchAnnotation(id, ACTIVE_SESSION_KEY, "");
          cleared++;
        }
      }
      return cleared;
    },

    async wakeIfHibernated(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return false;
      // Unconditional activity poke; waking an already-running
      // agent simply keeps it warm.
      await bumpLastActivity(id);
      return true;
    },

    async isReady(id) {
      // The controller-published Ready condition is the sole authority.
      // Absent (not yet reconciled) or False ⇒ not ready — the
      // api-server never inspects pods directly.
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      return obj !== null && readyConditionStatus(obj) === "True";
    },

    async ensureReady(id, opts) {
      const existing = inflight.get(id);
      if (existing) {
        // A joiner shares the in-flight wake but still gets the slow-path
        // signal — its user is waiting on the same cold start.
        opts?.onWaking?.();
        return existing;
      }

      const work = (async () => {
        if (await repo.isReady(id)) {
          await bumpLastActivity(id);
          return;
        }
        opts?.onWaking?.();
        const startedAt = Date.now();
        getLogger().info({ agentId: id }, "agent.wake.begin");
        await repo.wakeIfHibernated(id);
        const ready = await pollUntilReady(
          () => repo.isReady(id),
          WAKE_POLL_INITIAL_MS,
          WAKE_POLL_MAX_MS,
          WAKE_TIMEOUT_MS,
        );
        const durationMs = Date.now() - startedAt;
        if (!ready) {
          // The poll watched a boolean; the CR carries the controller's
          // full diagnosis. One extra read, only on the failure path.
          const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
          const infra = obj ? parseInfraAgent(obj) : null;
          if (infra?.ready) {
            // Won the race at the deadline — don't fail a turn that works.
            getLogger().info(
              { agentId: id, durationMs, lateReady: true },
              "agent.wake.ready",
            );
            await bumpLastActivity(id);
            return;
          }
          const failure = classifyWakeFailure(infra);
          getLogger().warn(
            {
              agentId: id,
              durationMs,
              cause: wakeFailureReasonToken(failure),
              hibernated: infra?.hibernated,
              agentPodNotReadyReason: infra?.agentPodNotReadyReason,
              gatewayPodReady: infra?.gatewayPodReady,
              reconciledReason: infra?.reconciledReason,
              podTerminationReason: infra?.podTerminationReason,
            },
            "agent.wake.timeout",
          );
          throw new AgentWakeTimeoutError({
            agentId: id,
            timeoutMs: WAKE_TIMEOUT_MS,
            durationMs,
            failure,
          });
        }
        getLogger().info({ agentId: id, durationMs }, "agent.wake.ready");
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
