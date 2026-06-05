import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";

const skillInstallStateSchema = z.object({
  installed: z.array(z.string()).catch([]).default([]),
});

export type SkillInstallState = z.infer<typeof skillInstallStateSchema>;

export interface SkillInstallStateStore {
  getInstalled(): string[];
  setInstalled(names: string[]): void;
}

export function createSkillInstallStateStore(
  stateDir: string,
): SkillInstallStateStore {
  const store = openJsonFile(join(stateDir, "skill-install-state.json"), {
    schema: skillInstallStateSchema,
    initial: () => ({ installed: [] }),
  });

  return {
    getInstalled() {
      return store.read().installed;
    },
    setInstalled(names) {
      store.write({ installed: [...names].sort() });
    },
  };
}
