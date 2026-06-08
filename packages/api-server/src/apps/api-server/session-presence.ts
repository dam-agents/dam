import { ACTIVE_SESSION_KEY } from "../../modules/agents/infrastructure/labels.js";

export interface SessionPresence {
  acquire(agentId: string): () => void;
}

export function createSessionPresence(repo: {
  patchAnnotation(id: string, key: string, value: string): Promise<void>;
}): SessionPresence {
  const open = new Map<string, number>();
  const set = (agentId: string, active: boolean) =>
    repo
      .patchAnnotation(agentId, ACTIVE_SESSION_KEY, active ? "true" : "")
      .catch(() => {});

  return {
    acquire(agentId) {
      const before = open.get(agentId) ?? 0;
      open.set(agentId, before + 1);
      if (before === 0) set(agentId, true);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        const n = (open.get(agentId) ?? 1) - 1;
        if (n > 0) open.set(agentId, n);
        else {
          open.delete(agentId);
          set(agentId, false);
        }
      };
    },
  };
}
