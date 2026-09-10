import type { AgentStore } from "./agent-store.js";
import {
  ACTIVE_SESSION_KEY,
  ANN_ROLL_REV,
  LAST_ACTIVITY_KEY,
  STOP_REQUESTED_KEY,
} from "./labels.js";
import {
  agentIsOwnedBy,
  buildAgentRecord,
  parseInfraAgent,
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

export function createAgentsRepository(store: AgentStore): AgentsRepository {
  const inflight = new Map<string, Promise<void>>();

  const STALE_ACTIVITY = "1970-01-01T00:00:00Z";

  async function bumpLastActivity(id: string): Promise<void> {
    await store.patchAnnotations(id, {
      [LAST_ACTIVITY_KEY]: new Date().toISOString(),
    });
  }

  const repo: AgentsRepository = {
    async list(owner?) {
      return (await store.list(owner)).map((r) => parseInfraAgent(r));
    },

    async get(id, owner?) {
      const record = await store.get(id);
      if (!record) return null;
      if (owner && !agentIsOwnedBy(record, owner)) return null;
      return parseInfraAgent(record);
    },

    async create(spec, owner, name, templateId?, annotations?) {
      const created = await store.create(
        buildAgentRecord(spec, owner, name, templateId, annotations),
      );
      return parseInfraAgent(created);
    },

    async updateSpec(id, owner, patch) {
      const record = await store.get(id);
      if (!record) return null;
      if (owner && !agentIsOwnedBy(record, owner)) return null;
      const updated = await store.patchSpec(id, patch);
      return updated ? parseInfraAgent(updated) : null;
    },

    async patchSpec(id, patch) {
      await store.patchSpec(id, patch);
    },

    async delete(id, owner?) {
      const record = await store.get(id);
      if (!record) return false;
      if (owner && !agentIsOwnedBy(record, owner)) return false;
      return store.delete(id);
    },

    async restart(id, owner?) {
      const record = await store.get(id);
      if (!record) return false;
      if (owner && !agentIsOwnedBy(record, owner)) return false;
      await store.patchAnnotations(id, {
        [ANN_ROLL_REV]: new Date().toISOString(),
      });
      return true;
    },

    async wake(id) {
      const updated = await store.patchAnnotations(id, {
        [LAST_ACTIVITY_KEY]: new Date().toISOString(),
        [STOP_REQUESTED_KEY]: "",
      });
      return updated ? parseInfraAgent(updated) : null;
    },

    async requestStop(id) {
      const updated = await store.patchAnnotations(id, {
        [STOP_REQUESTED_KEY]: new Date().toISOString(),
        [ACTIVE_SESSION_KEY]: "",
      });
      return updated ? parseInfraAgent(updated) : null;
    },

    async requestPause(id) {
      const pauseStamp = new Date().toISOString();
      const updated = await store.patchAnnotations(id, {
        [STOP_REQUESTED_KEY]: pauseStamp,
        [ACTIVE_SESSION_KEY]: "",
        [LAST_ACTIVITY_KEY]: STALE_ACTIVITY,
      });
      if (!updated) return null;
      const infra = parseInfraAgent(updated);
      void (async () => {
        const settled = await pollUntilReady(
          async () => (await repo.get(id))?.hibernated ?? true,
          {
            initialMs: PAUSE_SETTLE_POLL_MS,
            maxMs: PAUSE_SETTLE_POLL_MS,
            timeoutMs: PAUSE_SETTLE_TIMEOUT_MS,
            wakeOn: () => store.whenChanged(id),
          },
        );
        if (!settled) {
          getLogger().warn(
            { agentId: id },
            "agent.pause.settle-timeout — leaving hard stop in place",
          );
          return;
        }
        const current = await store.get(id);
        const standing = current?.annotations[STOP_REQUESTED_KEY];
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
      const record = await store.get(id);
      return record !== null && agentIsOwnedBy(record, owner);
    },

    async getOwner(id) {
      return (await store.get(id))?.owner ?? null;
    },

    async resolveIdentity(id) {
      const record = await store.get(id);
      return record ? { owner: record.owner, agentId: id } : null;
    },

    async patchAnnotation(id, key, value) {
      await store.patchAnnotations(id, { [key]: value });
    },

    async listAgentIdsWithAnnotation(key, value) {
      const records = await store.list();
      return records
        .filter((r) => r.annotations[key] === value)
        .map((r) => r.id);
    },

    async wakeIfHibernated(id) {
      const updated = await store.patchAnnotations(id, {
        [LAST_ACTIVITY_KEY]: new Date().toISOString(),
        [STOP_REQUESTED_KEY]: "",
      });
      return updated !== null;
    },

    async isReady(id) {
      return (await store.get(id))?.status.ready === true;
    },

    async ensureReady(id, opts) {
      const existing = inflight.get(id);
      if (existing) {
        opts?.onWaking?.();
        return existing;
      }

      const work = (async () => {
        const current = await store.get(id);
        if (!current) {
          throw new AgentWakeTimeoutError({
            agentId: id,
            timeoutMs: WAKE_TIMEOUT_MS,
            durationMs: 0,
            failure: { kind: "not-found" },
          });
        }
        if (current.annotations[STOP_REQUESTED_KEY]) {
          throw new AgentStoppedError(id);
        }
        if (current.status.ready === true) {
          await bumpLastActivity(id);
          return;
        }
        opts?.onWaking?.();
        const startedAt = Date.now();
        getLogger().info({ agentId: id }, "agent.wake.begin");
        await bumpLastActivity(id);
        let sawNotOverBudget = false;
        const ready = await pollUntilReady(
          async () => {
            const record = await store.get(id);
            if (!record) return false;
            if (record.annotations[STOP_REQUESTED_KEY]) {
              throw new AgentStoppedError(id);
            }
            const infra = parseInfraAgent(record);
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
            wakeOn: () => store.whenChanged(id),
          },
        );
        const durationMs = Date.now() - startedAt;
        if (!ready) {
          const record = await store.get(id);
          const infra = record ? parseInfraAgent(record) : null;
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
              sandboxNotReadyReason: infra?.sandboxNotReadyReason,
              gatewayReady: infra?.gatewayReady,
              gatewayNotReadyReason: infra?.gatewayNotReadyReason,
              errorReason: infra?.errorReason,
              sandboxTerminationReason: infra?.sandboxTerminationReason,
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
