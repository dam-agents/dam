import { is409, type K8sClient } from "./k8s.js";
import { retry } from "./retry.js";
import {
  LABEL_TYPE,
  TYPE_AGENT,
  LABEL_OWNER,
  LABEL_ROLE,
  ROLE_AGENT,
  LAST_ACTIVITY_KEY,
  ANN_PENDING_IMPORT,
  ANN_CREATE_ERROR,
  ANN_CONVERGED_POD,
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
  SETTLED_DEFAULT,
  type InfraAgent,
  type ContributionsStatus,
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

/** Port: outbox-derived contribution status — has the current version settled, and what failed? */
export interface ContributionsSettledPort {
  status(agentId: string): Promise<ContributionsStatus>;
  statusMany(agentIds: string[]): Promise<Map<string, ContributionsStatus>>;
}

export interface AgentsRepository {
  list(owner?: string): Promise<InfraAgent[]>;
  get(id: string, owner?: string): Promise<InfraAgent | null>;
  create(
    spec: Record<string, unknown>,
    owner: string,
    templateId?: string,
    pendingImport?: boolean,
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
  /** Atomic multi-key annotation patch (one read-modify-write); "" clears a key. */
  patchAnnotations(id: string, entries: Record<string, string>): Promise<void>;
  /** One atomic write for a failed create: stamp the error, clear the import gate, hibernate. */
  markCreateFailed(id: string, reason: string): Promise<void>;
  wakeIfHibernated(id: string): Promise<boolean>;
  isPodReady(id: string): Promise<boolean>;
  /** Block until podReady ∧ ¬terminating ∧ currentState=running ∧ contributionsSettled ∧ ¬importPending. */
  ensureReady(id: string): Promise<void>;
  /** Block until the pod can safely receive a file import: podReady ∧ ¬terminating.
   *  Roll-robustness comes from the import-proxy's retry, not from anticipating env-rolls. */
  ensureImportable(id: string): Promise<void>;
}

export function createAgentsRepository(
  k8s: K8sClient,
  contributions: ContributionsSettledPort,
): AgentsRepository {
  // Single-flight per agent id. Concurrent callers for the same id share
  // one in-flight wake+wait+bump; callers for different ids don't block each
  // other. Correctness does not depend on this (K8s optimistic concurrency
  // already serializes concurrent ConfigMap updates) — it keeps API load
  // sane under bursty call patterns.
  const inflight = new Map<string, Promise<void>>();

  // DB-resilient status reads: a transient outbox-DB error must not 500 a
  // k8s-backed list/get or abort a wake. Unknown ⇒ treat as settled.
  const safeStatus = async (id: string): Promise<ContributionsStatus> => {
    try {
      return await contributions.status(id);
    } catch {
      return SETTLED_DEFAULT;
    }
  };
  const safeStatusMany = async (
    ids: string[],
  ): Promise<Map<string, ContributionsStatus>> => {
    try {
      return await contributions.statusMany(ids);
    } catch {
      return new Map();
    }
  };

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

  // Fully converged on the live pod — the moment we record so later incremental applies/imports don't re-gate readiness.
  const isConverged = (a: InfraAgent): boolean =>
    a.podReady &&
    !a.terminating &&
    a.currentState === "running" &&
    a.contributionsSettled &&
    !a.importPending;

  // Stamp the converged-since-boot marker (keyed to pod uid) once, when first observed converged. Best-effort; next read retries.
  const markConvergedIfNeeded = async (a: InfraAgent): Promise<void> => {
    if (!a.podUid || a.warm || !isConverged(a)) return;
    await k8s
      .patchConfigMap(a.id, {
        metadata: { annotations: { [ANN_CONVERGED_POD]: a.podUid } },
      })
      .catch(() => {});
  };

  // One read of all gate inputs: the agent projected from its CM + live pod
  // (both podReady and `terminating` are derived from the pod).
  const readState = async (id: string): Promise<InfraAgent | null> => {
    const [pod, cm, status] = await Promise.all([
      k8s.getPod(`${id}-0`),
      k8s.getConfigMap(id),
      safeStatus(id),
    ]);
    return cm ? parseInfraAgent(cm, pod ?? undefined, status) : null;
  };

  // Wake-if-needed, then poll `ready` to true (or timeout). Single-flighted per
  // `key`, bumps last-activity on success. `deadlineMs` is shared across a
  // composed call so reachable+extras stay within one budget, not 2×.
  async function ensureCondition(
    id: string,
    key: string,
    ready: () => Promise<boolean>,
    diag: () => Promise<string>,
    deadlineMs: number,
  ): Promise<void> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const work = (async () => {
      if (await ready()) {
        await bumpLastActivity(id);
        return;
      }
      await repo.wakeIfHibernated(id);
      const ok = await pollUntilReady(
        ready,
        WAKE_POLL_INITIAL_MS,
        WAKE_POLL_MAX_MS,
        Math.max(0, deadlineMs - Date.now()),
      );
      if (!ok) throw new Error(await diag());
      await bumpLastActivity(id);
    })().finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
  }

  /** ADR-032 reachability: the pod is up enough to receive a call. */
  async function ensureReachable(
    id: string,
    deadlineMs: number,
  ): Promise<void> {
    const diag = async () =>
      `agent ${id} did not become reachable within ${WAKE_TIMEOUT_MS / 1000}s`;
    return ensureCondition(
      id,
      `reach:${id}`,
      () => repo.isPodReady(id),
      diag,
      deadlineMs,
    );
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
      const agentIds = configMaps
        .map((cm) => cm.metadata?.name)
        .filter((n): n is string => typeof n === "string");
      const statusMap = await safeStatusMany(agentIds);
      const agents = configMaps.map((cm) => {
        const id = cm.metadata!.name!;
        return parseInfraAgent(
          cm,
          podMap.get(id),
          statusMap.get(id) ?? SETTLED_DEFAULT,
        );
      });
      // Record convergence for any agent first observed warm (no-op otherwise).
      await Promise.all(agents.map(markConvergedIfNeeded));
      return agents;
    },

    async get(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return null;
      if (!hasType(cm, TYPE_AGENT)) return null;
      if (owner && !isOwnedBy(cm, owner)) return null;
      const [pod, status] = await Promise.all([
        k8s.getPod(`${id}-0`),
        safeStatus(id),
      ]);
      const infra = parseInfraAgent(cm, pod ?? undefined, status);
      await markConvergedIfNeeded(infra);
      return infra;
    },

    async create(spec, owner, templateId?, pendingImport?) {
      const body = buildAgentConfigMap(spec, owner, templateId, pendingImport);
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
        const [pod, status] = await Promise.all([
          k8s.getPod(`${id}-0`),
          safeStatus(id),
        ]);
        return parseInfraAgent(cm, pod ?? undefined, status);
      }
      const woken = setDesiredState(cm, "running");
      await k8s.replaceConfigMap(cm.metadata!.name!, woken);
      const reread = await k8s.getConfigMap(id);
      if (!reread) return null;
      const [pod, status] = await Promise.all([
        k8s.getPod(`${id}-0`),
        safeStatus(id),
      ]);
      return parseInfraAgent(reread, pod ?? undefined, status);
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

    async patchAnnotations(id, entries) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return;
      if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
      Object.assign(cm.metadata!.annotations, entries);
      await k8s.replaceConfigMap(id, cm);
    },

    async markCreateFailed(id, reason) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return;
      if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
      cm.metadata!.annotations[ANN_CREATE_ERROR] = reason;
      delete cm.metadata!.annotations[ANN_PENDING_IMPORT];
      await k8s.replaceConfigMap(id, setDesiredState(cm, "hibernated"));
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
      const deadline = Date.now() + WAKE_TIMEOUT_MS;
      await ensureReachable(id, deadline);
      const ready = async (): Promise<boolean> => {
        const infra = await readState(id);
        if (infra === null) return false;
        if (
          !infra.podReady ||
          infra.terminating ||
          infra.currentState !== "running"
        )
          return false;
        // Past the startup opening (warm), don't wait on background apply/import.
        if (!infra.warm && (!infra.contributionsSettled || infra.importPending))
          return false;
        await markConvergedIfNeeded(infra);
        return true;
      };
      const diag = async (): Promise<string> => {
        const infra = await readState(id).catch(() => null);
        return (
          `agent ${id} did not become ready within ${WAKE_TIMEOUT_MS / 1000}s ` +
          `(podReady=${infra?.podReady ?? "n/a"}, ` +
          `terminating=${infra?.terminating ?? "n/a"}, ` +
          `currentState=${infra?.currentState ?? "n/a"}, ` +
          `warm=${infra?.warm ?? "n/a"}, ` +
          `contributionsSettled=${infra?.contributionsSettled ?? "n/a"}, ` +
          `importPending=${infra?.importPending ?? "n/a"})`
        );
      };
      return ensureCondition(id, `ready:${id}`, ready, diag, deadline);
    },

    async ensureImportable(id) {
      const deadline = Date.now() + WAKE_TIMEOUT_MS;
      await ensureReachable(id, deadline);
      const ready = async (): Promise<boolean> => {
        const infra = await readState(id);
        return infra !== null && infra.podReady && !infra.terminating;
      };
      const diag = async (): Promise<string> => {
        const infra = await readState(id).catch(() => null);
        return (
          `agent ${id} did not become importable within ${WAKE_TIMEOUT_MS / 1000}s ` +
          `(podReady=${infra?.podReady ?? "n/a"}, ` +
          `terminating=${infra?.terminating ?? "n/a"})`
        );
      };
      return ensureCondition(id, `import:${id}`, ready, diag, deadline);
    },
  };

  return repo;
}
