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

// Same openJsonFile backing as the other *-state-stores, but env is shared
// across subsystems (harness/ssh/terminal/git read it), so a single instance is
// created at the composition root and injected — consumers via the read-only
// RuntimeEnvReader port, the env driver via write(). The driver is the only
// writer, so the cached value is authoritative and reads never hit disk per
// spawn.
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
