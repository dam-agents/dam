import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";

const LEDGER_FILE = "skill-seed-ledger.json";

const seedLedgerSchema = z.object({
  seeded: z.array(z.string()),
});

export interface SeedLedger {
  has(name: string): boolean;
  addAll(names: readonly string[]): void;
  remove(name: string): void;
}

export type SeedLedgerOpenResult =
  | { kind: "ok"; ledger: SeedLedger }
  | { kind: "corrupt"; file: string };

export function openSeedLedger(stateDir: string): SeedLedgerOpenResult {
  const file = join(stateDir, LEDGER_FILE);
  if (existsSync(file)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return { kind: "corrupt", file };
    }
    if (!seedLedgerSchema.safeParse(raw).success) {
      return { kind: "corrupt", file };
    }
  }
  const store = openJsonFile(file, {
    schema: seedLedgerSchema,
    initial: () => ({ seeded: [] }),
  });
  return {
    kind: "ok",
    ledger: {
      has(name) {
        return store.read().seeded.includes(name);
      },
      addAll(names) {
        if (names.length === 0) return;
        const seeded = new Set(store.read().seeded);
        for (const name of names) seeded.add(name);
        store.write({ seeded: [...seeded].sort() });
      },
      remove(name) {
        const seeded = store.read().seeded;
        if (!seeded.includes(name)) return;
        store.write({ seeded: seeded.filter((n) => n !== name) });
      },
    },
  };
}
