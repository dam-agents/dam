import { eq, type Db, agents as agentsTable } from "db";
import {
  harnessConfigSnapshotSchema,
  type HarnessConfigSnapshot,
  type HarnessConfigSnapshotPatch,
} from "api-server-api";

export interface HarnessConfigSnapshotRepo {
  read(agentId: string): Promise<HarnessConfigSnapshot | null>;
  merge(
    agentId: string,
    patch: HarnessConfigSnapshotPatch,
    opts: { confirmed: boolean },
  ): Promise<void>;
}

const EMPTY: Omit<HarnessConfigSnapshot, "capturedAt" | "confirmed"> = {
  model: null,
  mode: null,
  configOptions: {},
  availableModels: null,
};

export function createHarnessConfigSnapshotRepo(
  db: Db,
): HarnessConfigSnapshotRepo {
  async function read(agentId: string): Promise<HarnessConfigSnapshot | null> {
    const rows = await db
      .select({ snapshot: agentsTable.harnessConfigSnapshot })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    const raw = rows[0]?.snapshot;
    if (raw == null) return null;
    const parsed = harnessConfigSnapshotSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  return {
    read,

    async merge(agentId, patch, opts): Promise<void> {
      const stored = await read(agentId);
      const at = new Date().toISOString();
      const next: HarnessConfigSnapshot = {
        ...(stored ?? EMPTY),
        ...patch,
        capturedAt: at,
        confirmed: opts.confirmed,
      };
      if ("availableModels" in patch) next.modelAtDiscovery = next.model;
      if (
        stored &&
        sameSnapshot(stored, next) &&
        stored.modelAtDiscovery === next.modelAtDiscovery
      ) {
        return;
      }
      await db
        .update(agentsTable)
        .set({ harnessConfigSnapshot: next })
        .where(eq(agentsTable.id, agentId));
    },
  };
}

function sameSnapshot(
  a: HarnessConfigSnapshot,
  b: HarnessConfigSnapshot,
): boolean {
  return (
    a.model === b.model &&
    a.mode === b.mode &&
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
