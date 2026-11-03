import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../result.js";
import type { NpmInstaller } from "../modules/cli/infrastructure/npm-installer.js";
import type { NpmLatestProbe } from "../modules/cli/infrastructure/npm-latest-probe.js";
import { createUpdateService } from "../modules/cli/services/update-service.js";

function latest(result: string): NpmLatestProbe {
  return { latest: async () => ok(result) };
}

describe("UpdateService", () => {
  it("does not run npm when the CLI is current", async () => {
    const install = vi.fn(async () => ok(undefined));
    const service = createUpdateService({
      latest: latest("1.2.3"),
      installer: { install },
      localCliVersion: "1.2.3",
    });

    await expect(service.update()).resolves.toEqual({
      ok: true,
      value: { kind: "current", version: "1.2.3" },
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the exact latest stable version", async () => {
    const install = vi.fn(async () => ok(undefined));
    const service = createUpdateService({
      latest: latest("1.3.0"),
      installer: { install },
      localCliVersion: "1.2.3",
    });

    await expect(service.update()).resolves.toEqual({
      ok: true,
      value: { kind: "updated", from: "1.2.3", to: "1.3.0" },
    });
    expect(install).toHaveBeenCalledWith("1.3.0");
  });

  it("returns a version-discovery failure without running npm", async () => {
    const install = vi.fn(async () => ok(undefined));
    const probeError = {
      kind: "probe-error" as const,
      code: "network" as const,
      message: "offline",
    };
    const service = createUpdateService({
      latest: { latest: async () => err(probeError) },
      installer: { install },
      localCliVersion: "1.2.3",
    });

    await expect(service.update()).resolves.toEqual({
      ok: false,
      error: { kind: "latest-unavailable", cause: probeError },
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("returns the npm failure", async () => {
    const installer: NpmInstaller = {
      install: async () =>
        err({ kind: "npm-failed", exitCode: 13, signal: null }),
    };
    const service = createUpdateService({
      latest: latest("1.3.0"),
      installer,
      localCliVersion: "1.2.3",
    });

    await expect(service.update()).resolves.toEqual({
      ok: false,
      error: { kind: "npm-failed", exitCode: 13, signal: null },
    });
  });
});
