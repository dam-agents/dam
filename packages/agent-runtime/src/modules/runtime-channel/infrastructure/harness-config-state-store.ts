import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";

// Tracks the dot-paths the harness-config driver last wrote into the harness's
// config file, so a field cleared by the user removes its key cleanly instead
// of leaving a stale value behind. User-authored keys are never recorded here
// and so are never touched on removal.
const harnessConfigStateSchema = z.object({
  managedKeyPaths: z.array(z.string()).catch([]).default([]),
});

export type HarnessConfigState = z.infer<typeof harnessConfigStateSchema>;

export interface HarnessConfigStateStore {
  getManaged(): string[];
  setManaged(keyPaths: string[]): void;
}

export function createHarnessConfigStateStore(
  stateDir: string,
): HarnessConfigStateStore {
  const store = openJsonFile(join(stateDir, "harness-config-state.json"), {
    schema: harnessConfigStateSchema,
    initial: () => ({ managedKeyPaths: [] }),
  });

  return {
    getManaged() {
      return store.read().managedKeyPaths;
    },
    setManaged(keyPaths) {
      store.write({ managedKeyPaths: [...keyPaths].sort() });
    },
  };
}
