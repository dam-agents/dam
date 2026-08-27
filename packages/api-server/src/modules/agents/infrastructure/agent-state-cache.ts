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

type LiveReads = Pick<K8sClient, "getCustomObject" | "listCustomObjects">;

function ownerSelector(owner?: string): string | undefined {
  return owner ? `${LABEL_OWNER}=${owner}` : undefined;
}

export function createLiveAgentStateCache(live: LiveReads): AgentStateCache {
  return {
    get: (id) => live.getCustomObject(AGENTS_PLURAL, id),
    list: (owner) =>
      live.listCustomObjects(AGENTS_PLURAL, ownerSelector(owner)),
    whenChanged: () => ({
      changed: new Promise<void>(() => {}),
      cancel: () => {},
    }),
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

  deps.informer.on("add", onObject);
  deps.informer.on("update", onObject);
  deps.informer.on("delete", onObject);
  deps.informer.on("connect", () => {
    synced = true;
  });
  deps.informer.on("error", (err) => {
    synced = false;
    deps.log(
      `agent cache desynced, falling back to live reads: ${String(err)}`,
    );
    releaseAll();
  });

  void deps.informer.start().catch((err) => {
    synced = false;
    deps.log(`agent cache failed to start: ${String(err)}`);
  });

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
      synced = false;
      releaseAll();
      await deps.informer.stop();
    },
  };
}
