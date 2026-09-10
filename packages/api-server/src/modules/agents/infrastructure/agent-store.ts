import { EventEmitter } from "node:events";
import { agentRecords, eq, type Db } from "db";
import type { AgentSpecCR } from "api-server-api";

/**
 * Observed sandbox state. Written by the sandbox supervisor and by nothing
 * else — this is what the Kubernetes status subresource used to enforce
 * structurally, and `writeStatus` is now the only path that touches it.
 */
export interface AgentStatus {
  ready?: boolean;
  hibernated?: boolean;
  hibernatedSince?: string;
  overBudget?: boolean;
  overBudgetMessage?: string;
  /** Reconcile failure: the supervisor could not realize the spec. */
  error?: string;
  errorReason?: string;
  /** Address the api-server dials the agent-runtime on, e.g. `10.64.0.2`. */
  address?: string;
  sandboxReady?: boolean;
  sandboxNotReadyReason?: string;
  /** Why the sandbox process last exited, when it exited abnormally. */
  sandboxTerminationReason?: string;
  sandboxRestarts?: number;
  sandboxRestartReason?: string;
  gatewayReady?: boolean;
  gatewayNotReadyReason?: string;
}

export interface AgentRecord {
  id: string;
  owner: string;
  templateId?: string;
  annotations: Record<string, string>;
  spec: AgentSpecCR;
  status: AgentStatus;
}

export interface AgentChangeSubscription {
  changed: Promise<void>;
  cancel(): void;
}

export type AgentChange =
  | { type: "upsert"; id: string; record: AgentRecord }
  | { type: "delete"; id: string };

export interface AgentStore {
  get(id: string): Promise<AgentRecord | null>;
  list(owner?: string): Promise<AgentRecord[]>;
  create(rec: {
    id: string;
    owner: string;
    templateId?: string;
    annotations: Record<string, string>;
    spec: AgentSpecCR;
  }): Promise<AgentRecord>;
  patchSpec(id: string, patch: Record<string, unknown>): Promise<AgentRecord | null>;
  patchAnnotations(
    id: string,
    patch: Record<string, string>,
  ): Promise<AgentRecord | null>;
  writeStatus(id: string, patch: AgentStatus): Promise<AgentRecord | null>;
  delete(id: string): Promise<boolean>;
  /** Resolves the next time this agent changes; cancel to drop the waiter. */
  whenChanged(id: string): AgentChangeSubscription;
  onChange(listener: (change: AgentChange) => void): () => void;
}

/**
 * RFC 7386 JSON merge patch — the semantics the K8s API applied to spec
 * patches, which callers still rely on: nested objects merge, arrays replace,
 * null deletes.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return patch;
  }
  const base: Record<string, unknown> =
    target && typeof target === "object" && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key];
    else base[key] = mergePatch(base[key], value);
  }
  return base;
}

export function createAgentStore(db: Db): AgentStore {
  const events = new EventEmitter();
  events.setMaxListeners(0);

  const toRecord = (row: typeof agentRecords.$inferSelect): AgentRecord => ({
    id: row.id,
    owner: row.owner,
    ...(row.templateId ? { templateId: row.templateId } : {}),
    annotations: row.annotations,
    spec: row.spec as AgentSpecCR,
    status: row.status as AgentStatus,
  });

  const announce = (change: AgentChange) => events.emit("change", change);

  async function update(
    id: string,
    set: Partial<typeof agentRecords.$inferInsert>,
  ): Promise<AgentRecord | null> {
    const [row] = await db
      .update(agentRecords)
      .set(set)
      .where(eq(agentRecords.id, id))
      .returning();
    if (!row) return null;
    const record = toRecord(row);
    announce({ type: "upsert", id, record });
    return record;
  }

  return {
    async get(id) {
      const [row] = await db
        .select()
        .from(agentRecords)
        .where(eq(agentRecords.id, id));
      return row ? toRecord(row) : null;
    },

    async list(owner) {
      const rows = await (owner
        ? db.select().from(agentRecords).where(eq(agentRecords.owner, owner))
        : db.select().from(agentRecords));
      return rows.map(toRecord);
    },

    async create(rec) {
      const [row] = await db
        .insert(agentRecords)
        .values({
          id: rec.id,
          owner: rec.owner,
          templateId: rec.templateId ?? null,
          annotations: rec.annotations,
          spec: rec.spec,
          status: {},
        })
        .returning();
      const record = toRecord(row!);
      announce({ type: "upsert", id: record.id, record });
      return record;
    },

    async patchSpec(id, patch) {
      const current = await this.get(id);
      if (!current) return null;
      return update(id, {
        spec: mergePatch(current.spec, patch) as AgentSpecCR,
      });
    },

    async patchAnnotations(id, patch) {
      const current = await this.get(id);
      if (!current) return null;
      return update(id, { annotations: { ...current.annotations, ...patch } });
    },

    async writeStatus(id, patch) {
      const current = await this.get(id);
      if (!current) return null;
      return update(id, { status: { ...current.status, ...patch } });
    },

    async delete(id) {
      const deleted = await db
        .delete(agentRecords)
        .where(eq(agentRecords.id, id))
        .returning({ id: agentRecords.id });
      if (deleted.length === 0) return false;
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
      return {
        changed,
        cancel: () => events.off("change", listener),
      };
    },

    onChange(listener) {
      events.on("change", listener);
      return () => events.off("change", listener);
    },
  };
}
