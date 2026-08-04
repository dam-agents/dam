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
  /** Merge-patch arbitrary spec fields without an ownership check — for
   *  trusted internal fan-outs (e.g. connection grants). */
  patchSpec(id: string, patch: Record<string, unknown>): Promise<void>;
  delete(id: string, owner?: string): Promise<boolean>;
  restart(id: string, owner?: string): Promise<boolean>;
  wake(id: string): Promise<InfraAgent | null>;
  /** Hard stop (#1900): stamp `stop-requested` (and clear the session pin)
   *  so the controller scales the pair down now. Sticky — see ensureReady. */
  requestStop(id: string): Promise<InfraAgent | null>;
  /** Pause (#1900): scale down now like a stop, but clear the stamp once
   *  hibernated — the agent then wakes on any deliberate touch. */
  requestPause(id: string): Promise<InfraAgent | null>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
  getOwner(id: string): Promise<string | null>;
  /** Resolve an agent CR to its identity. Used by the ext_authz hot path
   *  to look up egress rules and credit pending approvals. The agent is
   *  its own resource, so `agentId === id`. */
  resolveIdentity(
    id: string,
  ): Promise<{ owner: string; agentId: string } | null>;
  patchAnnotation(id: string, key: string, value: string): Promise<void>;
  /** Agent ids currently carrying `annotation[key] === value` — used by
   *  boot-time pin reconciliation (experiments) alongside the setters. */
  listAgentIdsWithAnnotation(key: string, value: string): Promise<string[]>;

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

  // Semantically "long idle": parses as RFC3339, always outside any idle
  // window. Stamped by pause so the agent stays down once its stop clears.
  const STALE_ACTIVITY = "1970-01-01T00:00:00Z";

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
      // An explicit wake is one of the two deliberate paths that clear a
      // pending hard stop (#1900); background bumps never do.
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
      // Clearing active-session alongside the stamp lets the controller's
      // shouldRun turn false even while a session pin is still open.
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
      // Pause = stop, then un-stick once down (#1900). The stamp's
      // stickiness during the scale-down window is load-bearing: it is what
      // keeps background polls from resurrecting the pair mid-descent. Once
      // the controller reports Hibernated, clearing the stamp leaves a
      // plain hibernated agent — non-sticky by construction, woken by any
      // deliberate touch through the budget gate.
      const obj = await k8s.getCustomObject(AGENTS_PLURAL, id);
      if (!obj) return null;
      // last-activity is staled HERE, not at settle time: it makes
      // shouldRun stay false once the stop stamp clears (else a recently
      // used agent would revive itself), and stamping it in the initial
      // patch means a concurrent wake mid-descent (fresh bump + stop clear)
      // is never clobbered by the settle-watcher, whose own patch touches
      // only the stop key.
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
          // Fail-safe in the strict direction: the agent stays stopped; one
          // explicit wake recovers it.
          getLogger().warn(
            { agentId: id },
            "agent.pause.settle-timeout — leaving hard stop in place",
          );
          return;
        }
        // Compare-and-clear the exact stamp this pause wrote: a *stop* (or a
        // second pause) issued during the settle window carries a newer stamp
        // that must stay sticky — clearing it unconditionally would revive
        // the pair under a fresh last-activity, undoing the user's stop.
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
      // Unconditional activity poke; waking an already-running
      // agent simply keeps it warm. This is the schedule-fire path — the
      // second deliberate path that clears a hard stop (#1900): schedules
      // override a stop by decision, and the UI warns at stop time.
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
        // A pending hard stop wins over everything (#1900): throwing here —
        // before the ready fast-path and before wakeIfHibernated — is what
        // keeps background polling from resurrecting (or keeping warm) a
        // stopped agent. Only wake()/wakeIfHibernated() clear the stop.
        const current = await k8s.getCustomObject(AGENTS_PLURAL, id);
        if (!current) {
          // A missing CR can never become ready — fail typed and now,
          // not after the 120s poll budget.
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
        // A plain activity bump, NOT wakeIfHibernated: ensureReady already
        // established no stop is pending, and it must not cancel one that
        // lands concurrently — only wake()/wakeIfHibernated() clear a stop.
        try {
          await bumpLastActivity(id);
        } catch (e) {
          // Deleted between the entry read and the bump — typed not-found
          // beats a raw 404 surfacing to the caller.
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
        // A parked agent keeps its OverBudget condition standing, and the
        // condition doesn't say which wake attempt it applies to — so the
        // first polls of a fresh wake may read the PREVIOUS attempt's
        // denial. Heuristic (deliberately not a cross-component handshake):
        // treat OverBudget as OUR denial only when it appeared during this
        // wake's own poll (a transition we observed — the controller ruled
        // on us), or once the grace window has passed with the refusal
        // still standing. Within the grace, a stale denial rides through to
        // the reconcile of our bump, which admits or re-denies in well
        // under the window.
        let sawNotOverBudget = false;
        const ready = await pollUntilReady(
          async () => {
            // Each tick reads the full CR, not just the Ready boolean:
            // an OverBudget refusal (#1900) or a concurrent hard stop is
            // terminal for this attempt — the controller will not scale up
            // — so fail fast instead of burning the wake timeout.
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
              return false; // possibly stale — wait out the grace window
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
