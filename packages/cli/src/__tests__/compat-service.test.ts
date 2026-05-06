import { describe, expect, it } from "vitest";
import { err, ok } from "../modules/cli/domain/result.js";
import { createCompatService } from "../modules/cli/services/compat-service.js";
import type { ConfigService } from "../modules/cli/services/config-service.js";
import type {
  VersionInfo,
  VersionProbe,
} from "../modules/cli/infrastructure/version-probe.js";
import type { Config } from "../modules/cli/domain/config.js";

function fakeConfigService(value: Config | { error: "missing" }): ConfigService {
  return {
    async getResolved() {
      if ("error" in value) {
        return err({ kind: "missing-config", key: "server" });
      }
      return ok(value);
    },
    async set() {
      return ok(undefined);
    },
  };
}

function fakeProbe(
  result:
    | { ok: true; value: VersionInfo }
    | { ok: false; code: "network" | "timeout" | "non-ok-status" | "malformed-response" },
): VersionProbe {
  return {
    async probe() {
      if (result.ok) return ok(result.value);
      return err({ kind: "probe-error", code: result.code, message: "stub" });
    },
  };
}

// Verdict logic is covered by compat.test.ts. These cases cover the
// service-only seams: error propagation from each upstream port, and the
// flag override flowing through to ConfigService.

describe("CompatService.check", () => {
  it("happy path: passes localCliVersion + probe values into verdictFor and returns its result", async () => {
    const svc = createCompatService({
      config: fakeConfigService({ server: "http://x" }),
      probe: fakeProbe({
        ok: true,
        value: { serverVersion: "1.0.0", minClientVersion: "0.0.0" },
      }),
      localCliVersion: "1.0.0",
    });

    const r = await svc.check({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("ok");
      expect(r.value.localCli).toBe("1.0.0");
      expect(r.value.serverVersion).toBe("1.0.0");
    }
  });

  it("propagates MissingConfigError from ConfigService", async () => {
    const svc = createCompatService({
      config: fakeConfigService({ error: "missing" }),
      probe: fakeProbe({
        ok: true,
        value: { serverVersion: "1.0.0", minClientVersion: "0.0.0" },
      }),
      localCliVersion: "1.0.0",
    });

    const r = await svc.check({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("missing-config");
  });

  it("propagates ProbeError from VersionProbe", async () => {
    const svc = createCompatService({
      config: fakeConfigService({ server: "http://x" }),
      probe: fakeProbe({ ok: false, code: "network" }),
      localCliVersion: "1.0.0",
    });

    const r = await svc.check({});
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "probe-error") {
      expect(r.error.code).toBe("network");
    }
  });

  it("forwards the flag override to ConfigService.getResolved", async () => {
    let resolveCalledWithFlag: Partial<Config> | undefined = undefined;
    const svc = createCompatService({
      config: {
        async getResolved({ flag }) {
          resolveCalledWithFlag = flag;
          return ok({ server: flag?.server ?? "http://default" });
        },
        async set() {
          return ok(undefined);
        },
      },
      probe: fakeProbe({
        ok: true,
        value: { serverVersion: "1.0.0", minClientVersion: "0.0.0" },
      }),
      localCliVersion: "1.0.0",
    });

    await svc.check({ flag: { server: "http://override" } });
    expect(resolveCalledWithFlag).toEqual({ server: "http://override" });
  });
});
