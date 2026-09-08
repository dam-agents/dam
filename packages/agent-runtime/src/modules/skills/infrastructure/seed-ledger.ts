import { z } from "zod";
import type { DocumentStoreBackend } from "../../../core/document-store.js";

const seedLedgerSchema = z.object({
  seeded: z.array(z.string()).catch([]).default([]),
});

export interface SeedLedger {
  has(name: string): boolean;
  addAll(names: readonly string[]): void;
  remove(name: string): void;
}

export function createSeedLedger(backend: DocumentStoreBackend): SeedLedger {
  const store = backend.open("skill-seed-ledger", {
    schema: seedLedgerSchema,
    initial: () => ({ seeded: [] }),
  });
  return {
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
  };
}
