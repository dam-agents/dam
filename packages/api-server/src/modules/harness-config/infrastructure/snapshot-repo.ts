import { eq, type Db, agents as agentsTable } from "db";
import {
  harnessConfigSnapshotSchema,
  type HarnessConfigSnapshot,
  type HarnessConfigSnapshotPatch,
} from "api-server-api";

/** The only code that touches `agents.harness_config_snapshot`. */
export interface HarnessConfigSnapshotRepo {
  read(agentId: string): Promise<HarnessConfigSnapshot | null>;
  /** Shallow-merges `patch` over what's stored and re-stamps `capturedAt`.
   *  Merge rather than replace so a report carrying no `availableModels` can't
   *  null out a list an earlier one established. */
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
    // A shape written by an older build degrades to "no snapshot" rather than
    // breaking the page it feeds.
    const parsed = harnessConfigSnapshotSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  return {
    read,

    async merge(agentId, patch, opts): Promise<void> {
      const stored = await read(agentId);
      const next: HarnessConfigSnapshot = {
        ...(stored ?? EMPTY),
        ...patch,
        capturedAt: new Date().toISOString(),
        confirmed: opts.confirmed,
      };
      // Skip the no-op write: `hello` and every apply report the same values on
      // an unchanged sandbox, and 04's read path is poll-driven.
      if (stored && sameSnapshot(stored, next)) return;
      await db
        .update(agentsTable)
        .set({ harnessConfigSnapshot: next })
        .where(eq(agentsTable.id, agentId));
    },
  };
}

// Everything but `capturedAt` — a re-stamped timestamp alone is not a change.
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
