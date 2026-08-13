import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";
import type { RuntimeEnvReader } from "../../../core/runtime-env.js";

const RUNTIME_ENV_NOTE =
  "Managed by the platform runtime. Do not edit — overwritten on the next sync.";

const runtimeEnvSchema = z.object({
  _note: z.string().optional(),
  env: z.record(z.string(), z.string()).catch({}).default({}),
});

export interface EnvStateStore extends RuntimeEnvReader {
  write(env: Record<string, string>): void;
}

export function createEnvStateStore(agentHome: string): EnvStateStore {
  const path = join(agentHome, ".platform", "runtime-env.json");
  const doc = openJsonFile(path, {
    schema: runtimeEnvSchema,
    initial: () => ({ _note: RUNTIME_ENV_NOTE, env: {} }),
  });
  return {
    current: () => doc.read().env,
    write: (env) => doc.write({ _note: RUNTIME_ENV_NOTE, env }),
    ready: () => existsSync(path),
  };
}
