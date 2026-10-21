import { eq, sql, type Db, type DbTx, agents as agentsTable } from "db";
import {
  harnessConfigSnapshotSchema,
  type HarnessConfigSnapshot,
  type HarnessConfigSnapshotPatch,
} from "api-server-api";

export interface HarnessConfigSnapshotRepo {
  read(
    agentId: string,
    harness?: string,
    tx?: Db | DbTx,
  ): Promise<HarnessConfigSnapshot | null>;
  merge(
    agentId: string,
    patch: HarnessConfigSnapshotPatch,
    opts: { confirmed: boolean; harness?: string; tx?: Db | DbTx },
  ): Promise<void>;
  locked<T>(
    agentId: string,
    work: (tx: DbTx) => Promise<T>,
    opts?: { lockTimeoutMs?: number },
  ): Promise<T>;
}

const EMPTY: Omit<HarnessConfigSnapshot, "capturedAt" | "confirmed"> = {
  model: null,
  mode: null,
  configOptions: {},
  availableModels: null,
};

const NEVER_CAPTURED = new Date(0).toISOString();

export function createHarnessConfigSnapshotRepo(
  db: Db,
): HarnessConfigSnapshotRepo {
  async function readStored(
    agentId: string,
    q: Db | DbTx = db,
  ): Promise<HarnessConfigSnapshot | null> {
    const rows = await q
      .select({ snapshot: agentsTable.harnessConfigSnapshot })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    const raw = rows[0]?.snapshot;
    if (raw == null) return null;
    const parsed = harnessConfigSnapshotSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  const lock = (q: Db | DbTx, agentId: string) =>
    q.execute(
      sql`SELECT pg_advisory_xact_lock(pg_catalog.hashtext(${`harness-config-snapshot:${agentId}`}))`,
    );

  async function write(
    tx: Db | DbTx,
    agentId: string,
    patch: HarnessConfigSnapshotPatch,
    opts: { confirmed: boolean; harness?: string },
  ): Promise<void> {
    await lock(tx, agentId);
    const stored = await readStored(agentId, tx);
    const { harnesses: _others, ...ownStored } = stored ?? {};
    const current =
      opts.harness === undefined
        ? stored?.capturedAt === NEVER_CAPTURED
          ? null
          : stored && (ownStored as HarnessConfigSnapshot)
        : (stored?.harnesses?.[opts.harness] ?? null);
    const at = new Date().toISOString();
    const own: HarnessConfigSnapshot = {
      ...(current ?? EMPTY),
      ...patch,
      capturedAt: at,
      confirmed: opts.confirmed,
    };
    delete own.harnesses;
    if ("availableModels" in patch) own.modelAtDiscovery = own.model;
    if (
      current &&
      sameSnapshot(current, own) &&
      current.modelAtDiscovery === own.modelAtDiscovery
    ) {
      return;
    }
    const next: HarnessConfigSnapshot =
      opts.harness === undefined
        ? {
            ...own,
            ...(stored?.harnesses && { harnesses: stored.harnesses }),
          }
        : {
            ...(stored ?? {
              ...EMPTY,
              capturedAt: NEVER_CAPTURED,
              confirmed: false,
            }),
            harnesses: { ...stored?.harnesses, [opts.harness]: own },
          };
    await tx
      .update(agentsTable)
      .set({ harnessConfigSnapshot: next })
      .where(eq(agentsTable.id, agentId));
  }

  return {
    async read(agentId, harness, tx = db) {
      const stored = await readStored(agentId, tx);
      if (harness !== undefined) return stored?.harnesses?.[harness] ?? null;
      return stored?.capturedAt === NEVER_CAPTURED ? null : stored;
    },

    merge: (agentId, patch, opts) =>
      opts.tx
        ? write(opts.tx, agentId, patch, opts)
        : db.transaction((tx) => write(tx, agentId, patch, opts)),

    locked: (agentId, work, opts) =>
      db.transaction(async (tx) => {
        if (opts?.lockTimeoutMs !== undefined)
          await tx.execute(
            sql`SELECT set_config('lock_timeout', ${`${opts.lockTimeoutMs}ms`}, true)`,
          );
        await lock(tx, agentId);
        /* UNIT_BOUNDARY_DESCRIPTION: lock order — the Agent's row before any
         * outbox row the work queues, because hello takes those two in that
         * order and the reverse deadlocks the two transactions. */
        await tx
          .select({ id: agentsTable.id })
          .from(agentsTable)
          .where(eq(agentsTable.id, agentId))
          .for("update");
        return work(tx);
      }),
  };
}

function sameSnapshot(
  a: HarnessConfigSnapshot,
  b: HarnessConfigSnapshot,
): boolean {
  return (
    a.model === b.model &&
    a.mode === b.mode &&
    a.defaultModel === b.defaultModel &&
    a.confirmed === b.confirmed &&
    sameOptions(a.configOptions, b.configOptions) &&
    sameModels(a.availableModels, b.availableModels)
  );
}

function sameOptions(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

function sameModels(
  a: HarnessConfigSnapshot["availableModels"],
  b: HarnessConfigSnapshot["availableModels"],
): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const other = b[i]!;
    return (
      m.value === other.value &&
      m.name === other.name &&
      m.description === other.description
    );
  });
}
