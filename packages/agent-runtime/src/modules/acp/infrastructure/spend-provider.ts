import { z } from "zod";

import { describeFailure, runOnce } from "../../../core/run-once.js";
import type { SessionSpendRow } from "../domain/session-spend.js";

export interface SpendProvider {
  unit: string;
  read(): Promise<SessionSpendRow[] | null>;
}

const TIMEOUT_MS = 3_000;

const CACHE_TTL_MS = 30_000;

const spendRowsSchema = z.array(
  z.object({
    sessionId: z.string().min(1),
    cost: z.number(),
    startedAt: z.number(),
  }),
);

function parseRows(stdout: string): SessionSpendRow[] | null {
  if (!stdout.trim()) return [];
  try {
    const parsed = spendRowsSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs the harness image's declared session-spend command (runtime-manifest `sessionSpend.command`) and reads what each harness session cost, in the unit the manifest names. The command prints one JSON array of `{ sessionId, cost, startedAt }`, where `startedAt` is epoch milliseconds; no output means no sessions. A failed or malformed run resolves to null so a caller can tell it from "nothing spent". Reads are reused for a short while, since every session list asks.
 */
export function createExecSpendProvider(deps: {
  command: readonly string[];
  unit: string;
  cwd: string;
  log: (msg: string) => void;
  now?: () => number;
}): SpendProvider {
  const now = deps.now ?? Date.now;
  let cached:
    { readAt: number; rows: Promise<SessionSpendRow[] | null> } | undefined;

  async function run(): Promise<SessionSpendRow[] | null> {
    const result = await runOnce({
      command: deps.command,
      cwd: deps.cwd,
      timeoutMs: TIMEOUT_MS,
    });
    if (!result.ok) {
      deps.log(
        `session spend: ${describeFailure(deps.command.join(" "), result.error)}`,
      );
      return null;
    }
    const rows = parseRows(result.value.stdout);
    if (rows === null)
      deps.log("session spend: the command printed invalid rows");
    return rows;
  }

  return {
    unit: deps.unit,
    read() {
      if (cached && now() - cached.readAt < CACHE_TTL_MS) return cached.rows;
      const entry = { readAt: now(), rows: run() };
      void entry.rows.then((rows) => {
        if (rows === null && cached === entry) cached = undefined;
      });
      cached = entry;
      return entry.rows;
    },
  };
}
