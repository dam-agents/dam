import type { KubeObject } from "./k8s.js";
import { parseInfraAgent } from "./agent-mappers.js";
import {
  pollUntilReady,
  REFUSAL_FAIL_FAST_GRACE_MS,
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
import { getLogger } from "../../../core/logger.js";
import type { AgentChangeSubscription } from "./agent-state-cache.js";
import { DISABLED_KEY, STOP_REQUESTED_KEY } from "./labels.js";

export interface AgentWakeOptions {
  onWaking?: () => void;
  waitOnly?: boolean;
}

export interface AgentWake {
  ensureReady(id: string, opts?: AgentWakeOptions): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: waking an Agent and waiting until the platform can
 * route to it, decided only from what a reader observes — never from a write it
 * made.
 * It is the same code whichever store holds the Agent, the custom resource today
 * and the rows after the switch, because the thing it reads is one Agent in one
 * shape either way.
 * Its correctness rests on three properties of that reader, and a store that
 * breaks one breaks this: a cached read sees what the controller last wrote, a
 * live read is not stale when a timeout is decided, and a change subscription
 * wakes on the Agent it names.
 */
export function createAgentWake(deps: {
  readCached(id: string): Promise<KubeObject | null>;
  readLive(id: string): Promise<KubeObject | null>;
  isReady(id: string): Promise<boolean>;
  bumpLastActivity(id: string): Promise<void>;
  whenChanged(id: string): AgentChangeSubscription;
}): AgentWake {
  const inflight = new Map<string, Promise<void>>();

  const ensureReady: AgentWake["ensureReady"] = async (id, opts) => {
    const existing = inflight.get(id);
    if (existing) {
      opts?.onWaking?.();
      return existing;
    }
    const waitOnly = opts?.waitOnly ?? false;

    const work = (async () => {
      const current = await deps.readCached(id);
      if (!current) {
        throw new AgentWakeTimeoutError({
          agentId: id,
          timeoutMs: WAKE_TIMEOUT_MS,
          durationMs: 0,
          failure: { kind: "not-found" },
        });
      }
      if (current.metadata?.annotations?.[STOP_REQUESTED_KEY]) {
        throw new AgentStoppedError(
          id,
          !!current.metadata.annotations[DISABLED_KEY],
        );
      }
      if (await deps.isReady(id)) {
        if (!waitOnly) await deps.bumpLastActivity(id);
        return;
      }
      opts?.onWaking?.();
      const startedAt = Date.now();
      getLogger().info({ agentId: id }, "agent.wake.begin");
      try {
        if (!waitOnly) await deps.bumpLastActivity(id);
      } catch (e) {
        if (!(await deps.readLive(id))) {
          throw new AgentWakeTimeoutError({
            agentId: id,
            timeoutMs: WAKE_TIMEOUT_MS,
            durationMs: Date.now() - startedAt,
            failure: { kind: "not-found" },
          });
        }
        throw e;
      }
      let sawNotRefused = false;
      const ready = await pollUntilReady(
        async () => {
          const obj = await deps.readCached(id);
          if (!obj) return false;
          if (obj.metadata?.annotations?.[STOP_REQUESTED_KEY]) {
            throw new AgentStoppedError(
              id,
              !!obj.metadata.annotations[DISABLED_KEY],
            );
          }
          const infra = parseInfraAgent(obj);
          if (waitOnly && infra.hibernated && !infra.wakeRequested) {
            throw new AgentWakeTimeoutError({
              agentId: id,
              timeoutMs: WAKE_TIMEOUT_MS,
              durationMs: Date.now() - startedAt,
              failure: classifyWakeFailure(infra),
            });
          }
          if (
            infra.overBudget ||
            (!infra.hibernated &&
              REFUSED_START_REASONS.has(infra.agentPodNotReadyReason ?? ""))
          ) {
            const graceOver =
              Date.now() - startedAt >= REFUSAL_FAIL_FAST_GRACE_MS;
            if (sawNotRefused || graceOver) {
              getLogger().warn(
                {
                  agentId: id,
                  cause: wakeFailureReasonToken(classifyWakeFailure(infra)),
                },
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
          sawNotRefused = true;
          return infra.ready;
        },
        {
          initialMs: WAKE_POLL_INITIAL_MS,
          maxMs: WAKE_POLL_MAX_MS,
          timeoutMs: WAKE_TIMEOUT_MS,
          wakeOn: () => deps.whenChanged(id),
        },
      );
      const durationMs = Date.now() - startedAt;
      if (!ready) {
        const obj = await deps.readLive(id);
        const infra = obj ? parseInfraAgent(obj) : null;
        if (infra?.ready) {
          getLogger().info(
            { agentId: id, durationMs, lateReady: true },
            "agent.wake.ready",
          );
          if (!waitOnly) await deps.bumpLastActivity(id);
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
      if (!waitOnly) await deps.bumpLastActivity(id);
    })();
    if (waitOnly) return work;
    const tracked = work.finally(() => inflight.delete(id));
    inflight.set(id, tracked);
    return tracked;
  };

  return { ensureReady };
}
