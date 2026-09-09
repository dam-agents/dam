import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";

export const SKILL_INSTALL_PLUGIN_NAME = "skill-install";

const STATE_FILE = "skill-install-state.json";

const skillInstallStateSchema = z.object({
  installed: z.array(z.string()).catch([]).default([]),
});

const strictSkillInstallStateSchema = z.object({
  installed: z.array(z.string()),
});

export type SkillInstallState = z.infer<typeof skillInstallStateSchema>;

export interface SkillInstallStateStore {
  getInstalled(): string[];
  setInstalled(names: string[]): void;
}

export function createSkillInstallStateStore(
  stateDir: string,
): SkillInstallStateStore {
  const store = openJsonFile(join(stateDir, STATE_FILE), {
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

export type SkillInstallBootState =
  | { kind: "ok"; installed: string[] }
  | { kind: "absent" }
  | { kind: "corrupt" };

export function readSkillInstallBootState(
  pluginStateRoot: string,
): SkillInstallBootState {
  const file = join(pluginStateRoot, SKILL_INSTALL_PLUGIN_NAME, STATE_FILE);
  if (!existsSync(file)) return { kind: "absent" };
  try {
    const parsed = strictSkillInstallStateSchema.safeParse(
      JSON.parse(readFileSync(file, "utf8")),
    );
    return parsed.success
      ? { kind: "ok", installed: parsed.data.installed }
      : { kind: "corrupt" };
  } catch {
    return { kind: "corrupt" };
  }
}
