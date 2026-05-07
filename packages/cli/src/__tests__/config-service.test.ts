import { describe, expect, it, vi } from "vitest";
import type { Config } from "../modules/cli/domain/config.js";
import { ok, type Result } from "../modules/cli/domain/result.js";
import type {
  FileWriteError,
  MalformedConfigError,
} from "../modules/cli/domain/errors.js";
import type { ConfigStore } from "../modules/cli/infrastructure/config-store.js";
import type { EnvReader } from "../modules/cli/infrastructure/env-reader.js";
import { createConfigService } from "../modules/cli/services/config-service.js";

function makeFakeStore(initial: Partial<Config> = {}): {
  store: ConfigStore;
  written: Partial<Config>[];
} {
  let current = { ...initial };
  const written: Partial<Config>[] = [];
  return {
    written,
    store: {
      async read(): Promise<Result<Partial<Config>, MalformedConfigError>> {
        return ok({ ...current });
      },
      async write(partial): Promise<Result<void, FileWriteError>> {
        written.push({ ...partial });
        current = { ...current, ...partial };
        return ok(undefined);
      },
    },
  };
}

function makeFakeEnv(values: Record<string, string> = {}): EnvReader {
  return { get: (name) => values[name] };
}

const ENV_VARS = { server: "DAM_SERVER" } as const;

// Precedence + missing-config behavior is covered by resolve-config.test.ts.
// These cases cover the service-only seams: it reads env using the
// registered name, validates before writing, and never writes on bad input.

describe("ConfigService", () => {
  it("getResolved reads env using the var name from the envVars registry", async () => {
    const { store } = makeFakeStore();
    const svc = createConfigService({
      store,
      envReader: makeFakeEnv({ DAM_SERVER: "https://env" }),
      envVars: ENV_VARS,
    });

    const r = await svc.getResolved({});
    expect(r).toEqual({ ok: true, value: { server: "https://env" } });
  });

  it("set with an invalid value returns InvalidValueError without touching the store", async () => {
    const writeSpy = vi.fn();
    const svc = createConfigService({
      store: {
        async read() {
          return ok({});
        },
        async write(partial) {
          writeSpy(partial);
          return ok(undefined);
        },
      },
      envReader: makeFakeEnv(),
      envVars: ENV_VARS,
    });

    const r = await svc.set("server", "not-a-url");
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "invalid-value") {
      expect(r.error.key).toBe("server");
      expect(r.error.input).toBe("not-a-url");
    }
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
