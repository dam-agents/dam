import { describe, expect, it } from "vitest";
import { compareVersions, verdictFor } from "../modules/cli/domain/compat.js";

describe("compareVersions", () => {
  it.each([
    ["1.0.0", "1.0.0", 0],
    ["1.0.1", "1.0.0", 1],
    ["1.0.0", "1.0.1", -1],
    ["2.0.0", "1.99.99", 1],
    ["1.10.0", "1.9.0", 1],
    ["v1.2.3", "1.2.3", 0],
    ["1.0.0+build.7", "1.0.0", 0],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0-rc.1", "1.0.0-rc.2", -1],
    ["1.0.0-alpha", "1.0.0-beta", -1],
    ["1.0.0-rc.1", "1.0.0-rc.1", 0],
    ["1.0.0-1", "1.0.0-rc.1", -1],
  ])("compareVersions(%j, %j) = %d", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it("throws on invalid input", () => {
    expect(() => compareVersions("not.a.version", "1.0.0")).toThrow(
      /invalid semver/,
    );
    expect(() => compareVersions("1.0", "1.0.0")).toThrow(/invalid semver/);
  });
});

describe("verdictFor", () => {
  it.each([
    {
      name: "Ok when local matches the recommended CLI and is at/above floor",
      inputs: {
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: "0.0.0",
        serverRecommendedClient: "1.0.0",
      },
      kind: "ok",
    },
    {
      name: "Ok when local is ahead of the recommended CLI",
      inputs: {
        localCli: "2.0.0",
        serverVersion: "1.0.0",
        serverMinClient: "0.0.0",
        serverRecommendedClient: "1.0.0",
      },
      kind: "ok",
    },
    {
      name: "BehindCurrent when local lags the recommended CLI but is at/above floor",
      inputs: {
        localCli: "1.0.0",
        serverVersion: "1.2.0",
        serverMinClient: "1.0.0",
        serverRecommendedClient: "1.2.0",
      },
      kind: "behind-current",
    },
    {
      name: "BelowFloor when local is below floor (regardless of the recommended CLI)",
      inputs: {
        localCli: "0.0.1",
        serverVersion: "1.0.0",
        serverMinClient: "1.0.0",
        serverRecommendedClient: "1.0.0",
      },
      kind: "below-floor",
    },
    {
      name: "Ok when local equals floor exactly",
      inputs: {
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: "1.0.0",
        serverRecommendedClient: "1.0.0",
      },
      kind: "ok",
    },
    {
      name: "BelowFloor takes precedence over BehindCurrent",
      inputs: {
        localCli: "0.0.1",
        serverVersion: "2.0.0",
        serverMinClient: "1.0.0",
        serverRecommendedClient: "2.0.0",
      },
      kind: "below-floor",
    },
    {
      name: "Ok when no floor is advertised and local matches the recommended CLI",
      inputs: {
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: "1.0.0",
      },
      kind: "ok",
    },
    {
      name: "BehindCurrent when no floor is advertised and local lags the recommended CLI",
      inputs: {
        localCli: "1.0.0",
        serverVersion: "2.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: "2.0.0",
      },
      kind: "behind-current",
    },
  ])("$name", ({ inputs, kind }) => {
    const v = verdictFor(inputs);
    expect(v.kind).toBe(kind);
    expect(v.localCli).toBe(inputs.localCli);
    expect(v.serverVersion).toBe(inputs.serverVersion);
    expect(v.serverMinClient).toBe(inputs.serverMinClient);
    expect(v.serverRecommendedClient).toBe(inputs.serverRecommendedClient);
  });

  // TEST_SCENARIO: a build from main reports `<version>-dev-<sha>` and recommends no CLI. The verdict must not compare the CLI with the server's own version: no CLI release carries it, so the check would pass every old CLI or fail every current one.
  it("Ok when the server recommends no CLI, whatever its own version", () => {
    const v = verdictFor({
      localCli: "0.2.3",
      serverVersion: "0.2.24-dev-db35e8abf4bd",
      serverMinClient: undefined,
      serverRecommendedClient: undefined,
    });
    expect(v.kind).toBe("ok");
  });
});
