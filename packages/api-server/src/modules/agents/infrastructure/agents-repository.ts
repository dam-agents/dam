import { type K8sClient } from "./k8s.js";
import {
  ACTIVE_SESSION_KEY,
  AGENTS_PLURAL,
  ANN_ROLL_REV,
  LABEL_OWNER,
  LAST_ACTIVITY_KEY,
  STOP_REQUESTED_KEY,
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
  OVER_BUDGET_FAIL_FAST_GRACE_MS,
  PAUSE_SETTLE_POLL_MS,
  PAUSE_SETTLE_TIMEOUT_MS,
  WAKE_POLL_INITIAL_MS,
  WAKE_POLL_MAX_MS,
  WAKE_TIMEOUT_MS,
} from "./poll-until-ready.js";
import {
  AgentWakeTimeoutError,
  classifyWakeFailure,
  wakeFailureReasonToken,
} from "../domain/wake-failure.js";
import { AgentStoppedError } from "../domain/agent-stopped.js";
import { getLogger } from "../../../core/logger.js";

export interface AgentsRepository {
  list(owner?: string): Promise<InfraAgent[]>;
  get(id: string, owner?: string): Promise<InfraAgent | null>;
  create(
    spec: Record<string, unknown>,
    owner: string,
    name: string,
    templateId?: string,
    annotations?: Record<string, string>,
  ): Promise<InfraAgent>;
  updateSpec(
    id: string,
    owner: string | undefined,
    patch: Record<string, unknown>,
  ): Promise<InfraAgent | null>;
  patchSpec(id: string, patch: Record<string, unknown>): Promise<void>;
  delete(id: string, owner?: string): Promise<boolean>;
  restart(id: string, owner?: string): Promise<boolean>;
  wake(id: string): Promise<InfraAgent | null>;
  requestStop(id: string): Promise<InfraAgent | null>;
  requestPause(id: string): Promise<InfraAgent | null>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
  getOwner(id: string): Promise<string | null>;
  resolveIdentity(
    id: string,
  ): Promise<{ owner: string; agentId: string } | null>;
  patchAnnotation(id: string, key: string, value: string): Promise<void>;
  listAgentIdsWithAnnotation(key: string, value: string): Promise<string[]>;

  wakeIfHibernated(id: string): Promise<boolean>;
  isReady(id: string): Promise<boolean>;
  ensureReady(id: string, opts?: { onWaking?: () => void }): Promise<void>;
}

export function createAgentsRepository(k8s: K8sClient): AgentsRepository {
  const inflight = new Map<string, Promise<void>>();

  const STALE_ACTIVITY = "1970-01-01T00:00:00Z";

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

    async create(spec, owner, name, templateId?, annotations?) {
      const created = await k8s.createCustomObject(
        AGENTS_PLURAL,
        buildAgentObject(spec, owner, name, templateId, annotations),
      );
      return parseInfraAgent(created);
    },

    async updateSpec(id, owner, patch) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      if (owner && !agentIsOwnedBy(obj, owner)) return null;
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
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: { annotations: { [ANN_ROLL_REV]: new Date().toISOString() } },
      });
      return true;
    },

    async wake(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: {
          annotations: {
            [LAST_ACTIVITY_KEY]: new Date().toISOString(),
            [STOP_REQUESTED_KEY]: "",
          },
        },
      });
      const reread = await k8s.getCustomObject(AGENTS_PLURAL, id);
      return reread ? parseInfraAgent(reread) : null;
    },

    async requestStop(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: {
          annotations: {
            [STOP_REQUESTED_KEY]: new Date().toISOString(),
            [ACTIVE_SESSION_KEY]: "",
          },
        },
      });
      const reread = await k8s.getCustomObject(AGENTS_PLURAL, id);
      return reread ? parseInfraAgent(reread) : null;
    },

    async requestPause(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      const pauseStamp = new Date().toISOString();
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: {
          annotations: {
            [STOP_REQUESTED_KEY]: pauseStamp,
            [ACTIVE_SESSION_KEY]: "",
            [LAST_ACTIVITY_KEY]: STALE_ACTIVITY,
          },
        },
      });
      const reread = await k8s.getCustomObject(AGENTS_PLURAL, id);
      const infra = reread ? parseInfraAgent(reread) : null;
      if (!infra) return null;
      void (async () => {
        const settled = await pollUntilReady(
          async () => (await repo.get(id))?.hibernated ?? true,
          PAUSE_SETTLE_POLL_MS,
          PAUSE_SETTLE_POLL_MS,
          PAUSE_SETTLE_TIMEOUT_MS,
        );
        if (!settled) {
          getLogger().warn(
            { agentId: id },
            "agent.pause.settle-timeout — leaving hard stop in place",
          );
          return;
        }
        const current = await k8s.getCustomObject(AGENTS_PLURAL, id);
        const standing = current?.metadata?.annotations?.[STOP_REQUESTED_KEY];
        if (standing !== pauseStamp) {
          getLogger().info(
            { agentId: id },
            "agent.pause.superseded — leaving the newer stop in place",
          );
          return;
        }
        await repo.patchAnnotation(id, STOP_REQUESTED_KEY, "");
        getLogger().info({ agentId: id }, "agent.pause.settled");
      })().catch((err) => {
        getLogger().warn(
          { agentId: id, error: (err as Error).message },
          "agent.pause.settle-failed — leaving hard stop in place",
        );
      });
      return infra;
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

    async listAgentIdsWithAnnotation(key, value) {
      const objs = await k8s.listCustomObjects(AGENTS_PLURAL);
      const ids: string[] = [];
      for (const o of objs) {
        const id = o.metadata?.name;
        if (id && o.metadata?.annotations?.[key] === value) ids.push(id);
      }
      return ids;
    },

    async wakeIfHibernated(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return false;
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: {
          annotations: {
            [LAST_ACTIVITY_KEY]: new Date().toISOString(),
            [STOP_REQUESTED_KEY]: "",
          },
        },
      });
      return true;
    },

    async isReady(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      return obj !== null && readyConditionStatus(obj) === "True";
    },

    async ensureReady(id, opts) {
      const existing = inflight.get(id);
      if (existing) {
        opts?.onWaking?.();
        return existing;
      }

      const work = (async () => {
        const current = await k8s.getCustomObject(AGENTS_PLURAL, id);
        if (!current) {
          throw new AgentWakeTimeoutError({
            agentId: id,
            timeoutMs: WAKE_TIMEOUT_MS,
            durationMs: 0,
            failure: { kind: "not-found" },
          });
        }
        if (current.metadata?.annotations?.[STOP_REQUESTED_KEY]) {
          throw new AgentStoppedError(id);
        }
        if (await repo.isReady(id)) {
          await bumpLastActivity(id);
          return;
        }
        opts?.onWaking?.();
        const startedAt = Date.now();
        getLogger().info({ agentId: id }, "agent.wake.begin");
        try {
          await bumpLastActivity(id);
        } catch (e) {
          if (!(await k8s.getCustomObject(AGENTS_PLURAL, id))) {
            throw new AgentWakeTimeoutError({
              agentId: id,
              timeoutMs: WAKE_TIMEOUT_MS,
              durationMs: Date.now() - startedAt,
              failure: { kind: "not-found" },
            });
          }
          throw e;
        }
        let sawNotOverBudget = false;
        const ready = await pollUntilReady(
          async () => {
            const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
            if (!obj) return false;
            if (obj.metadata?.annotations?.[STOP_REQUESTED_KEY]) {
              throw new AgentStoppedError(id);
            }
            const infra = parseInfraAgent(obj);
            if (infra.overBudget) {
              const graceOver =
                Date.now() - startedAt >= OVER_BUDGET_FAIL_FAST_GRACE_MS;
              if (sawNotOverBudget || graceOver) {
                getLogger().warn(
                  { agentId: id, cause: "wake-rejected:over-budget" },
                  "agent.wake.rejected",
                );
                throw new AgentWakeTimeoutError({
                  agentId: id,
                  timeoutMs: WAKE_TIMEOUT_MS,
                  durationMs: Date.now() - startedAt,
                  failure: classifyWakeFailure(infra),
                });
              }
              return false;
            }
            sawNotOverBudget = true;
            return infra.ready;
          },
          WAKE_POLL_INITIAL_MS,
          WAKE_POLL_MAX_MS,
          WAKE_TIMEOUT_MS,
        );
        const durationMs = Date.now() - startedAt;
        if (!ready) {
          const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
          const infra = obj ? parseInfraAgent(obj) : null;
          if (infra?.ready) {
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
              gatewayPodNotReadyReason: infra?.gatewayPodNotReadyReason,
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
