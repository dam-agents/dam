import { err, ok, type Result } from "../../../core/result.js";
import {
  isConflict,
  isNotFound,
  type K8sClient,
  type KubeObject,
} from "./k8s.js";
import type { AgentStateCache } from "./agent-state-cache.js";
import {
  ACTIVE_SESSION_KEY,
  AGENTS_PLURAL,
  ANN_ROLL_REV,
  DISABLED_KEY,
  INVOCATIONS_ACTIVE_KEY,
  ANN_KIT_UPDATE_PENDING,
  LAST_ACTIVITY_KEY,
  RECLAIMED_AT_KEY,
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
  REFUSAL_FAIL_FAST_GRACE_MS,
  PAUSE_SETTLE_POLL_MS,
  PAUSE_SETTLE_TIMEOUT_MS,
  WAKE_POLL_INITIAL_MS,
  WAKE_POLL_MAX_MS,
  WAKE_TIMEOUT_MS,
} from "./poll-until-ready.js";
import {
  AgentWakeTimeoutError,
  classifyWakeFailure,
  REFUSED_START_REASONS,
  wakeFailureReasonToken,
} from "../domain/wake-failure.js";
import { AgentStoppedError } from "../domain/agent-stopped.js";
import { createAgentWake } from "./agent-wake.js";
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
  writeAgentSpec(
    id: string,
    owner: string | undefined,
    patch: AgentSpecWrite,
  ): Promise<AgentSpecWriteResult>;
  delete(id: string, owner?: string): Promise<boolean>;
  restart(id: string, owner?: string): Promise<boolean>;
  wake(
    id: string,
  ): Promise<
    Result<InfraAgent, { type: "AgentNotFound" } | { type: "AgentDisabled" }>
  >;
  setDisabled(id: string, disabled: boolean): Promise<InfraAgent | null>;
  requestStop(id: string): Promise<InfraAgent | null>;
  requestSleep(id: string): Promise<InfraAgent | null>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
  getOwner(id: string): Promise<string | null>;
  resolveIdentity(
    id: string,
  ): Promise<{ owner: string; agentId: string; environmentOf?: string } | null>;
  patchAnnotation(id: string, key: string, value: string): Promise<void>;
  setInvocationPin(id: string): Promise<boolean>;
  readInvocationPin(id: string): Promise<string | null>;
  releaseInvocationPin(id: string, resourceVersion: string): Promise<void>;
  patchAnnotations(
    id: string,
    annotations: Record<string, string | null>,
  ): Promise<void>;
  nudgeKitUpdate(
    id: string,
    expectedCommit: string,
    at: string,
  ): Promise<boolean>;
  listAgentIdsWithAnnotation(key: string, value: string): Promise<string[]>;

  wakeIfHibernated(id: string): Promise<AgentActivityStamp | null>;
  wakeUnlessStopped(id: string): Promise<boolean>;
  restoreActivityIfUnchanged(
    id: string,
    stamp: AgentActivityStamp,
  ): Promise<void>;
  isReady(id: string): Promise<boolean>;
  ensureReady(
    id: string,
    opts?: { onWaking?: () => void; waitOnly?: boolean },
  ): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: one spec write decided from a live read: a null annotation removes it. The write names the version it was decided from, so a controller status write in between makes it conflict rather than go through on stale state; a write with no version to name is refused as a conflict.
export interface AgentSpecWrite {
  spec?: Record<string, unknown>;
  annotations: Record<string, string | null>;
  resourceVersion: string | undefined;
  signalVersion?: number | undefined;
  statusVersion?: number | undefined;
}

export type AgentSpecWriteResult =
  | { ok: true; value: InfraAgent }
  | { ok: false; reason: "not-found" | "conflict" };

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an activity write replaced, so a rollback can
 * put exactly it back.
 * The custom resource identified the write by its timestamp; the store
 * identifies it by the token that changes with it, and carries the previous
 * timestamp when there is one.
 */
export interface AgentActivityStamp {
  previous: string | null;
  previousAt?: string | null;
  written: string;
}

export function createAgentsRepository(
  k8s: K8sClient,
  cache: AgentStateCache,
): AgentsRepository {
  const inflight = new Map<string, Promise<void>>();

  const STALE_ACTIVITY = "1970-01-01T00:00:00Z";

  const patchUnlessDisabled = async (
    id: string,
    annotations: Record<string, string>,
  ) => {
    for (let attempt = 0; ; attempt++) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      if (obj.metadata?.annotations?.[DISABLED_KEY]) return "disabled" as const;
      try {
        await k8s.patchCustomObject(AGENTS_PLURAL, id, {
          metadata: {
            resourceVersion: obj.metadata?.resourceVersion,
            annotations,
          },
        });
        return obj;
      } catch (e) {
        if (!isConflict(e) || attempt >= PIN_CONFLICT_RETRIES) throw e;
      }
    }
  };

  async function ownedObject(
    id: string,
    owner: string | undefined,
  ): Promise<KubeObject | null> {
    const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
    if (!obj) return null;
    return owner && !agentIsOwnedBy(obj, owner) ? null : obj;
  }

  async function nudgeKitUpdate(
    id: string,
    expectedCommit: string,
    at: string,
  ): Promise<boolean> {
    const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
    const pending = obj ? parseInfraAgent(obj).kitUpdatePending : undefined;
    if (!obj || !pending) return false;
    if (
      pending.targetCommit.toLowerCase() !== expectedCommit.toLowerCase() ||
      pending.nudgedAt !== undefined
    )
      return false;
    try {
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: {
          resourceVersion: obj.metadata?.resourceVersion,
          annotations: {
            [ANN_KIT_UPDATE_PENDING]: JSON.stringify({
              ...pending,
              nudgedAt: at,
            }),
          },
        },
      });
      return true;
    } catch (e) {
      if (isConflict(e) || isNotFound(e)) return false;
      throw e;
    }
  }

  // UNIT_BOUNDARY_DESCRIPTION: the stop annotation set, written once. `live` lets a caller that has already read the Agent pass it rather than pay a second read.
  async function stopAgent(
    id: string,
    opts: { stamp?: string; disabledStamp?: string; idle?: boolean } = {},
    live?: KubeObject,
  ): Promise<{ agent: InfraAgent; stamp: string } | null> {
    const obj = live ?? (await k8s.getCustomObject(AGENTS_PLURAL, id));
    if (!obj) return null;
    const stamp = opts.stamp ?? new Date().toISOString();
    await k8s.patchCustomObject(AGENTS_PLURAL, id, {
      metadata: {
        annotations: {
          ...(opts.disabledStamp !== undefined && {
            [DISABLED_KEY]: opts.disabledStamp,
          }),
          [STOP_REQUESTED_KEY]: stamp,
          [ACTIVE_SESSION_KEY]: "",
          [INVOCATIONS_ACTIVE_KEY]: "",
          ...(opts.idle && {
            [LAST_ACTIVITY_KEY]: STALE_ACTIVITY,
            [RECLAIMED_AT_KEY]: "",
          }),
        },
      },
    });
    const reread = await k8s.getCustomObject(AGENTS_PLURAL, id);
    const agent = reread ? parseInfraAgent(reread) : null;
    return agent ? { agent, stamp } : null;
  }

  const wake = createAgentWake({
    readCached: (id) => cache.get(id),
    readLive: (id) => k8s.getCustomObject(AGENTS_PLURAL, id),
    isReady: (id) => repo.isReady(id),
    bumpLastActivity,
    whenChanged: (id) => cache.whenChanged(id),
  });

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
      const infra = parseInfraAgent(created);
      const written = created.metadata?.resourceVersion;
      if (written) await cache.awaitObserved(infra.id, written);
      return infra;
    },

    async updateSpec(id, owner, patch) {
      const obj = await ownedObject(id, owner);
      if (!obj) return null;
      const updated = await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        spec: patch,
      });
      const written = updated.metadata?.resourceVersion;
      if (written) await cache.awaitObserved(id, written);
      return parseInfraAgent(updated);
    },

    async patchSpec(id, patch) {
      await k8s.patchCustomObject(AGENTS_PLURAL, id, { spec: patch });
    },

    async getLive(id, owner) {
      const obj = await ownedObject(id, owner);
      return obj ? parseInfraAgent(obj) : null;
    },

    async writeAgentSpec(id, owner, patch) {
      const obj = await ownedObject(id, owner);
      if (!obj) return { ok: false, reason: "not-found" };
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
      const obj = await ownedObject(id, owner);
      if (!obj) return false;
      await k8s.deleteCustomObject(AGENTS_PLURAL, id);
      return true;
    },

    async restart(id, owner?) {
      const obj = await ownedObject(id, owner);
      if (!obj) return false;
      await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: { annotations: { [ANN_ROLL_REV]: new Date().toISOString() } },
      });
      return true;
    },

    async wake(id) {
      const woke = await patchUnlessDisabled(id, {
        [LAST_ACTIVITY_KEY]: new Date().toISOString(),
        [STOP_REQUESTED_KEY]: "",
      });
      if (woke === "disabled") return err({ type: "AgentDisabled" });
      const reread = woke && (await k8s.getCustomObject(AGENTS_PLURAL, id));
      return reread
        ? ok(parseInfraAgent(reread))
        : err({ type: "AgentNotFound" });
    },

    async setDisabled(id, disabled) {
      const stamp = disabled ? new Date().toISOString() : "";
      const stopped = await stopAgent(id, {
        stamp,
        disabledStamp: stamp,
        idle: true,
      });
      return stopped?.agent ?? null;
    },

    async requestStop(id) {
      return (await stopAgent(id))?.agent ?? null;
    },

    async requestSleep(id) {
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      if (obj.metadata?.annotations?.[DISABLED_KEY])
        return parseInfraAgent(obj);
      const stopped = await stopAgent(id, { idle: true }, obj);
      if (!stopped) return null;
      const { agent: infra, stamp: sleepStamp } = stopped;
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
            "agent.sleep.settle-timeout — leaving the stop stamp in place",
          );
          return;
        }
        const current = await k8s.getCustomObject(AGENTS_PLURAL, id);
        const standing = current?.metadata?.annotations?.[STOP_REQUESTED_KEY];
        if (standing !== sleepStamp) {
          getLogger().info(
            { agentId: id },
            "agent.sleep.superseded — leaving the newer stop stamp in place",
          );
          return;
        }
        await repo.patchAnnotation(id, STOP_REQUESTED_KEY, "");
        getLogger().info({ agentId: id }, "agent.sleep.settled");
      })().catch((err) => {
        getLogger().warn(
          { agentId: id, error: (err as Error).message },
          "agent.sleep.settle-failed — leaving the stop stamp in place",
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
      const environmentOf = (
        obj.spec as { environmentOf?: unknown } | undefined
      )?.environmentOf;
      return typeof environmentOf === "string" && environmentOf !== ""
        ? { owner, agentId: id, environmentOf }
        : { owner, agentId: id };
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
      const updated = await k8s.patchCustomObject(AGENTS_PLURAL, id, {
        metadata: { annotations },
      });
      const written = updated.metadata?.resourceVersion;
      if (written) await cache.awaitObserved(id, written);
    },

    nudgeKitUpdate,

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
      const written = new Date().toISOString();
      const woke = await patchUnlessDisabled(id, {
        [LAST_ACTIVITY_KEY]: written,
        [STOP_REQUESTED_KEY]: "",
      });
      if (woke === null || woke === "disabled") return null;
      return {
        previous: woke.metadata?.annotations?.[LAST_ACTIVITY_KEY] ?? null,
        written,
      };
    },

    async wakeUnlessStopped(id) {
      for (let attempt = 0; ; attempt++) {
        const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
        if (!obj || obj.metadata?.annotations?.[STOP_REQUESTED_KEY])
          return false;
        try {
          await k8s.patchCustomObject(AGENTS_PLURAL, id, {
            metadata: {
              resourceVersion: obj.metadata?.resourceVersion,
              annotations: { [LAST_ACTIVITY_KEY]: new Date().toISOString() },
            },
          });
          return true;
        } catch (e) {
          if (!isConflict(e) || attempt >= PIN_CONFLICT_RETRIES) throw e;
        }
      }
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

    ensureReady: wake.ensureReady,
  };

  return repo;
}
