import type { AgentInformer, K8sClient, KubeObject } from "./k8s.js";
import { AGENTS_PLURAL, LABEL_OWNER } from "./labels.js";
import { agentIsOwnedBy } from "./agent-mappers.js";

export interface AgentChangeSubscription {
  changed: Promise<void>;
  cancel(): void;
}

export interface AgentStateCache {
  get(id: string): Promise<KubeObject | null>;
  list(owner?: string): Promise<KubeObject[]>;
  whenChanged(id: string): AgentChangeSubscription;
}

export interface RunningAgentStateCache extends AgentStateCache {
  stop(): Promise<void>;
}

const RESTART_DELAY_MS = 5_000;
const MAX_RESTART_DELAY_MS = 60_000;

type LiveReads = Pick<K8sClient, "getCustomObject" | "listCustomObjects">;

function ownerSelector(owner?: string): string | undefined {
  return owner ? `${LABEL_OWNER}=${owner}` : undefined;
}

function noChangeSignal(): AgentChangeSubscription {
  return { changed: new Promise<void>(() => {}), cancel: () => {} };
}

export function createLiveAgentStateCache(live: LiveReads): AgentStateCache {
  return {
    get: (id) => live.getCustomObject(AGENTS_PLURAL, id),
    list: (owner) =>
      live.listCustomObjects(AGENTS_PLURAL, ownerSelector(owner)),
    whenChanged: noChangeSignal,
  };
}

export function startAgentStateCache(deps: {
  informer: AgentInformer;
  live: LiveReads;
  namespace: string;
  log: (message: string) => void;
}): RunningAgentStateCache {
  const waiters = new Map<string, Set<() => void>>();
  let synced = false;

  const release = (id: string) => {
    const pending = waiters.get(id);
    if (!pending) return;
    waiters.delete(id);
    for (const resolve of pending) resolve();
  };
  const releaseAll = () => {
    for (const id of [...waiters.keys()]) release(id);
  };
  const onObject = (obj: KubeObject) => {
    const id = obj.metadata?.name;
    if (id) release(id);
  };

  let stopped = false;
  let restartTimer: NodeJS.Timeout | undefined;
  let restartDelay = RESTART_DELAY_MS;
  let attempt = 0;

  async function connect(): Promise<void> {
    if (stopped) return;
    const mine = ++attempt;
    try {
      await deps.informer.start();
    } catch (err) {
      abandon(`agent cache could not start: ${String(err)}`);
      return;
    }
    if (stopped) {
      void deps.informer.stop();
      return;
    }
    if (mine !== attempt) return;
    synced = true;
    restartDelay = RESTART_DELAY_MS;
  }

  function abandon(reason: string): void {
    attempt += 1;
    synced = false;
    deps.log(`${reason} — serving live reads`);
    releaseAll();
    scheduleRestart();
  }

  function scheduleRestart(): void {
    if (stopped || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      void connect();
    }, restartDelay);
    restartTimer.unref();
    restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY_MS);
  }

  deps.informer.on("add", onObject);
  deps.informer.on("update", onObject);
  deps.informer.on("delete", onObject);
  deps.informer.on("error", (err) => {
    abandon(`agent cache desynced: ${String(err)}`);
  });

  void connect();

  return {
    async get(id) {
      if (!synced) return deps.live.getCustomObject(AGENTS_PLURAL, id);
      return deps.informer.get(id, deps.namespace) ?? null;
    },
    async list(owner) {
      if (!synced) {
        return deps.live.listCustomObjects(AGENTS_PLURAL, ownerSelector(owner));
      }
      const all = deps.informer.list(deps.namespace);
      return owner ? all.filter((obj) => agentIsOwnedBy(obj, owner)) : [...all];
    },
    whenChanged(id) {
      let resolve!: () => void;
      const changed = new Promise<void>((r) => {
        resolve = r;
      });
      const pending = waiters.get(id) ?? new Set<() => void>();
      pending.add(resolve);
      waiters.set(id, pending);
      return {
        changed,
        cancel() {
          const current = waiters.get(id);
          if (!current) return;
          current.delete(resolve);
          if (current.size === 0) waiters.delete(id);
        },
      };
    },
    async stop() {
      stopped = true;
      synced = false;
      attempt += 1;
      if (restartTimer) clearTimeout(restartTimer);
      releaseAll();
      await deps.informer.stop();
    },
  };
}
