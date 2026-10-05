import { isConflict, isNotFound, type K8sClient } from "./k8s.js";
import type { AgentStateCache } from "./agent-state-cache.js";
import {
  ACTIVE_SESSION_KEY,
  AGENTS_PLURAL,
  ANN_ROLL_REV,
  INVOCATIONS_ACTIVE_KEY,
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

const PIN_CONFLICT_RETRIES = 4;

export interface AgentsRepository {
  list(owner?: string): Promise<InfraAgent[]>;
  get(id: string, owner?: string): Promise<InfraAgent | null>;
  peekCached(id: string): InfraAgent | null;
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
  getLive(id: string, owner: string | undefined): Promise<InfraAgent | null>;
  writeRuntimeMigration(
    id: string,
    owner: string | undefined,
    patch: RuntimeMigrationWrite,
  ): Promise<RuntimeMigrationWriteResult>;
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
  setInvocationPin(id: string): Promise<boolean>;
  readInvocationPin(id: string): Promise<string | null>;
  releaseInvocationPin(id: string, resourceVersion: string): Promise<void>;
  patchAnnotations(
    id: string,
    annotations: Record<string, string | null>,
  ): Promise<void>;
  listAgentIdsWithAnnotation(key: string, value: string): Promise<string[]>;

  wakeIfHibernated(id: string): Promise<AgentActivityStamp | null>;
  restoreActivityIfUnchanged(
    id: string,
    stamp: AgentActivityStamp,
  ): Promise<void>;
  isReady(id: string): Promise<boolean>;
  ensureReady(id: string, opts?: { onWaking?: () => void }): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: one write of a runtime migration's request, abort, retry or Backend switch. A null annotation removes it. The write names the version it was decided from, so a controller status write in between — the machine reported booted — makes it conflict rather than go through on stale state; a write with no version to name is refused as a conflict.
export interface RuntimeMigrationWrite {
  spec?: Record<string, unknown>;
  annotations: Record<string, string | null>;
  resourceVersion: string | undefined;
}

export type RuntimeMigrationWriteResult =
  | { ok: true; value: InfraAgent }
  | { ok: false; reason: "not-found" | "conflict" };

export interface AgentActivityStamp {
  previous: string | null;
  written: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the Backend is fixed at create, and the api-server is the one writer of the Agent spec, so this is where that holds. The runtime migration is the one sanctioned change of Backend and goes through writeRuntimeMigration; every other spec write that names the Backend is a bug and fails loudly.
function assertBackendUntouched(patch: Record<string, unknown>): void {
  if ("backend" in patch)
    throw new Error(
      "an agent's backend changes only through a runtime migration",
    );
}

// UNIT_BOUNDARY_DESCRIPTION: a wake for an Agent a runtime migration holds down could only wait out the timeout, so it is refused at once, with a cause that says whether the move is under way or failed after it stopped the container.
function refuseWhileMigrating(
  id: string,
  infra: InfraAgent,
  durationMs: number,
): void {
  const hold = infra.runtimeMigrationHold ?? "none";
  if (hold === "none") return;
  throw new AgentWakeTimeoutError({
    agentId: id,
    timeoutMs: WAKE_TIMEOUT_MS,
    durationMs,
    failure: { kind: hold === "failed" ? "migration-failed" : "migrating" },
  });
}

export function createAgentsRepository(
  k8s: K8sClient,
  cache: AgentStateCache,
): AgentsRepository {
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
      const objs = await cache.list(owner);
      return objs.map((o) => parseInfraAgent(o));
    },

    async get(id, owner?) {
      const obj = await cache.get(id);
      if (!obj) return null;
      if (owner && !agentIsOwnedBy(obj, owner)) return null;
      return parseInfraAgent(obj);
    },

    peekCached(id) {
      const obj = cache.peekCached(id);
      return obj ? parseInfraAgent(obj) : null;
    },

    async create(spec, owner, name, templateId?, annotations?) {
      const created = await k8s.createCustomObject(
        AGENTS_PLURAL,
        buildAgentObject(spec, owner, name, templateId, annotations),
      );
      return parseInfraAgent(created);
    },

    async updateSpec(id, owner, patch) {
      assertBackendUntouched(patch);
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      if (owner && !agentIsOwnedBy(obj, owner)) return null;
      const updated = await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        spec: patch,
      });
      return parseInfraAgent(updated);
    },

    async patchSpec(id, patch) {
      assertBackendUntouched(patch);
      await k8s.patchCustomObject(AGENTS_PLURAL, id, { spec: patch });
    },

    async getLive(id, owner) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      if (owner && !agentIsOwnedBy(obj, owner)) return null;
      return parseInfraAgent(obj);
    },

    async writeRuntimeMigration(id, owner, patch) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return { ok: false, reason: "not-found" };
      if (owner && !agentIsOwnedBy(obj, owner))
        return { ok: false, reason: "not-found" };
      if (!patch.resourceVersion) return { ok: false, reason: "conflict" };
      try {
        const updated = await k8s.patchCustomObject(AGENTS_PLURAL, id, {
          metadata: {
            annotations: patch.annotations,
            resourceVersion: patch.resourceVersion,
          },
          ...(patch.spec ? { spec: patch.spec } : {}),
        });
        return { ok: true, value: parseInfraAgent(updated) };
      } catch (e) {
        if (isConflict(e)) return { ok: false, reason: "conflict" };
        if (isNotFound(e)) return { ok: false, reason: "not-found" };
        throw e;
      }
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
            [INVOCATIONS_ACTIVE_KEY]: "",
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
            [INVOCATIONS_ACTIVE_KEY]: "",
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
          {
            initialMs: PAUSE_SETTLE_POLL_MS,
            maxMs: PAUSE_SETTLE_POLL_MS,
            timeoutMs: PAUSE_SETTLE_TIMEOUT_MS,
            wakeOn: () => cache.whenChanged(id),
          },
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
      const obj = await cache.get(id);
      return obj !== null && agentIsOwnedBy(obj, owner);
    },

    async getOwner(id) {
      const obj = await cache.get(id);
      return obj ? (agentOwner(obj) ?? null) : null;
    },

    async resolveIdentity(id) {
      const obj = await cache.get(id);
      if (!obj) return null;
      const owner = agentOwner(obj);
      if (!owner) return null;
      return { owner, agentId: id };
    },

    async setInvocationPin(id) {
      for (let attempt = 0; ; attempt++) {
        const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
        if (!obj || obj.metadata?.annotations?.[STOP_REQUESTED_KEY])
          return false;
        try {
          await k8s.patchCustomObject(AGENTS_PLURAL, id, {
            metadata: {
              resourceVersion: obj.metadata?.resourceVersion,
              annotations: { [INVOCATIONS_ACTIVE_KEY]: "true" },
            },
          });
          return true;
        } catch (e) {
          if (!isConflict(e) || attempt >= PIN_CONFLICT_RETRIES) throw e;
        }
      }
    },

    async readInvocationPin(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (obj?.metadata?.annotations?.[INVOCATIONS_ACTIVE_KEY] !== "true")
        return null;
      return obj.metadata.resourceVersion ?? null;
    },

    async releaseInvocationPin(id, resourceVersion) {
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: {
          resourceVersion,
          annotations: {
            [LAST_ACTIVITY_KEY]: new Date().toISOString(),
            [INVOCATIONS_ACTIVE_KEY]: "",
          },
        },
      });
    },

    async patchAnnotation(id, key, value) {
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: { annotations: { [key]: value } },
      });
    },

    async patchAnnotations(id, annotations) {
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: { annotations },
      });
    },

    async listAgentIdsWithAnnotation(key, value) {
      const objs = await cache.list();
      const ids: string[] = [];
      for (const o of objs) {
        const id = o.metadata?.name;
        if (id && o.metadata?.annotations?.[key] === value) ids.push(id);
      }
      return ids;
    },

    async wakeIfHibernated(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      const written = new Date().toISOString();
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: {
          annotations: {
            [LAST_ACTIVITY_KEY]: written,
            [STOP_REQUESTED_KEY]: "",
          },
        },
      });
      return {
        previous: obj.metadata?.annotations?.[LAST_ACTIVITY_KEY] ?? null,
        written,
      };
    },

    async restoreActivityIfUnchanged(id, stamp) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return;
      if (obj.metadata?.annotations?.[LAST_ACTIVITY_KEY] !== stamp.written)
        return;
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: {
          annotations: {
            [LAST_ACTIVITY_KEY]: stamp.previous ?? STALE_ACTIVITY,
          },
        },
      });
    },

    async isReady(id) {
      const obj = await cache.get(id);
      return obj !== null && readyConditionStatus(obj) === "True";
    },

    async ensureReady(id, opts) {
      const existing = inflight.get(id);
      if (existing) {
        opts?.onWaking?.();
        return existing;
      }

      const work = (async () => {
        const current = await cache.get(id);
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
        refuseWhileMigrating(id, parseInfraAgent(current), 0);
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
            const obj = await cache.get(id);
            if (!obj) return false;
            if (obj.metadata?.annotations?.[STOP_REQUESTED_KEY]) {
              throw new AgentStoppedError(id);
            }
            const infra = parseInfraAgent(obj);
            refuseWhileMigrating(id, infra, Date.now() - startedAt);
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
          {
            initialMs: WAKE_POLL_INITIAL_MS,
            maxMs: WAKE_POLL_MAX_MS,
            timeoutMs: WAKE_TIMEOUT_MS,
            wakeOn: () => cache.whenChanged(id),
          },
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
