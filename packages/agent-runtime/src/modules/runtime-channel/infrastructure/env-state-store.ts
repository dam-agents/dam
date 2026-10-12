import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";
import type { LeaseEnvReader } from "../../../core/runtime-env.js";

const RUNTIME_ENV_NOTE =
  "Managed by the platform runtime. Do not edit — overwritten on the next sync.";

const envRecord = z.record(z.string(), z.string());
const layers = z
  .array(z.object({ id: z.string(), env: envRecord }))
  .catch([])
  .default([]);

const runtimeEnvSchema = z.object({
  _note: z.string().optional(),
  env: envRecord.catch({}).default({}),
  providers: layers,
  harnesses: layers,
});

export interface EnvLayer {
  id: string;
  env: Record<string, string>;
}

export interface RuntimeEnvState {
  env: Record<string, string>;
  providers: EnvLayer[];
  harnesses: EnvLayer[];
}

export interface EnvStateStore extends LeaseEnvReader {
  state(): RuntimeEnvState;
  write(state: RuntimeEnvState): void;
}

export function leaseEnvOf(
  state: RuntimeEnvState,
  lease: { harness: string | null; provider: string | null },
): Record<string, string> {
  const of = (list: EnvLayer[], id: string | null): Record<string, string> =>
    list.find((l) => l.id === id)?.env ?? {};
  const harnessOwned = new Set(
    state.harnesses.flatMap((l) => Object.keys(l.env)),
  );
  return {
    ...of(state.providers, lease.provider),
    ...of(state.harnesses, lease.harness),
    ...Object.fromEntries(
      Object.entries(state.env).filter(([name]) => !harnessOwned.has(name)),
    ),
  };
}

export function createEnvStateStore(
  agentHome: string,
  defaultHarness: string,
): EnvStateStore {
  const path = join(agentHome, ".platform", "runtime-env.json");
  const doc = openJsonFile(path, {
    schema: runtimeEnvSchema,
    initial: () => ({
      _note: RUNTIME_ENV_NOTE,
      env: {},
      providers: [],
      harnesses: [],
    }),
  });
  const state = (): RuntimeEnvState => {
    const { env, providers, harnesses } = doc.read();
    return { env, providers, harnesses };
  };
  return {
    state,
    current: () => {
      const s = state();
      return leaseEnvOf(s, {
        harness: defaultHarness,
        provider: s.providers[0]?.id ?? null,
      });
    },
    providers: () => state().providers.map((p) => p.id),
    forLease: (lease) => leaseEnvOf(state(), lease),
    write: (next) => doc.write({ _note: RUNTIME_ENV_NOTE, ...next }),
    ready: () => existsSync(path),
  };
}
