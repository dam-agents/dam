import { EventEmitter } from "node:events";
import type {
  AgentChange,
  AgentRecord,
  AgentStore,
} from "../../modules/agents/infrastructure/agent-store.js";
import type { AgentSpecCR } from "api-server-api";

export function fakeAgentStore(initial: Partial<AgentRecord>[] = []) {
  const records = new Map<string, AgentRecord>();
  for (const r of initial) records.set(r.id ?? "", normalize(r));
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const announce = (change: AgentChange) => events.emit("change", change);
  const upsert = (record: AgentRecord) => {
    records.set(record.id, record);
    announce({ type: "upsert", id: record.id, record });
    return record;
  };

  const store: AgentStore = {
    async get(id) {
      return records.get(id) ?? null;
    },
    async list(owner) {
      const all = [...records.values()];
      return owner ? all.filter((r) => r.owner === owner) : all;
    },
    async listAssignedTo(nodeId) {
      return [...records.values()].filter((r) => r.assignedNode === nodeId);
    },
    async assign(id, nodeId) {
      const record = records.get(id);
      if (!record) return null;
      return upsert({ ...record, assignedNode: nodeId });
    },
    async noteWorkspaceAt(id, nodeId) {
      const record = records.get(id);
      if (!record) return null;
      return upsert({ ...record, lastNode: nodeId });
    },
    async create(rec) {
      return upsert(normalize(rec));
    },
    async patchSpec(id, patch) {
      const current = records.get(id);
      if (!current) return null;
      return upsert({
        ...current,
        spec: Object.fromEntries(
          Object.entries({ ...current.spec, ...patch }).filter(
            ([, value]) => value !== null,
          ),
        ) as unknown as AgentSpecCR,
      });
    },
    async patchAnnotations(id, patch) {
      const current = records.get(id);
      if (!current) return null;
      return upsert({
        ...current,
        annotations: { ...current.annotations, ...patch },
      });
    },
    async writeStatus(id, patch) {
      const current = records.get(id);
      if (!current) return null;
      return upsert({ ...current, status: { ...current.status, ...patch } });
    },
    async delete(id) {
      if (!records.delete(id)) return false;
      announce({ type: "delete", id });
      return true;
    },
    whenChanged(id) {
      let resolve!: () => void;
      const changed = new Promise<void>((r) => {
        resolve = r;
      });
      const listener = (change: AgentChange) => {
        if (change.id === id) resolve();
      };
      events.on("change", listener);
      void changed.then(() => events.off("change", listener));
      return { changed, cancel: () => events.off("change", listener) };
    },
    onChange(listener) {
      events.on("change", listener);
      return () => events.off("change", listener);
    },
  };

  return { store, records };
}

function normalize(r: Partial<AgentRecord>): AgentRecord {
  return {
    id: r.id ?? "",
    owner: r.owner ?? "owner",
    ...(r.templateId ? { templateId: r.templateId } : {}),
    annotations: r.annotations ?? {},
    spec: r.spec ?? ({ image: "test:latest" } as AgentSpecCR),
    status: r.status ?? {},
    assignedNode: r.assignedNode ?? null,
    lastNode: r.lastNode ?? null,
  };
}
