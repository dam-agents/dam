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
    ["0.2.24-rc9", "0.2.24-rc10", -1],
    ["0.2.24-rc10", "0.2.24-rc9", 1],
    ["0.2.24-rc10", "0.2.24-rc10", 0],
    ["0.2.24-rc10", "0.2.24", -1],
    // TEST_SCENARIO: the same candidates spelled `-rc.N`, which a release branch cut after the spelling change carries. Two identifiers give the number its own field, so this already compares by value; the rows pin it beside the legacy spelling.
    ["0.2.24-rc.9", "0.2.24-rc.10", -1],
    ["0.2.24-rc.10", "0.2.24-rc.9", 1],
    ["0.2.25-rc.1", "0.2.25-rc.10", -1],
    ["0.2.24-rc.10", "0.2.25-rc.1", -1],
    ["0.2.24-rc.10", "0.2.24", -1],
    // TEST_SCENARIO: the two spellings are not aliases at the same core version: `rc.10` sorts below `rc9`, because a dotted identifier compares below an alphanumeric one. That is why a branch never changes spelling mid-release, and why the core version, not the candidate, carries the migration.
    ["0.2.24-rc.10", "0.2.24-rc9", -1],
    ["0.2.24-rc.1", "0.2.24-rc9", -1],
  ])("compareVersions(%j, %j) = %d", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it("throws on invalid input", () => {
    expect(() => compareVersions("not.a.version", "1.0.0")).toThrow(
      /invalid semver/,
    );
    expect(() => compareVersions("1.0", "1.0.0")).toThrow(/invalid semver/);
  });

  // TEST_SCENARIO: this repository publishes its release candidates as `rc9`, `rc10`, … without a dot, so each is one alphanumeric identifier. SemVer compares those lexically, which puts rc9 above rc10 and hides the newer recommendation from `dam version` and `dam update`. A numeric-suffix special case alone is not transitive (`rc2 < rc10`, `rc10 < rc1a` lexically, `rc1a < rc2`), so sorting and an is-newer check would disagree. Word runs compare digits by value and letters lexically, digits before letters.
  it("orders a mixed set of candidates as a total order", () => {
    expect(compareVersions("0.2.24-rc9", "0.2.24-rc10")).toBe(-1);
    expect(compareVersions("0.2.24-rc2", "0.2.24-rc02")).toBe(0);
    expect(compareVersions("0.2.24-rc1", "0.2.24-beta9")).toBe(1);
    expect(compareVersions("0.2.24-rc1a", "0.2.24-rc10")).toBe(-1);
    expect(compareVersions("0.2.24-rc2", "0.2.24-rc1a")).toBe(1);

    const order = [
      "0.2.24-beta1",
      "0.2.24-rc1",
      "0.2.24-rc1a",
      "0.2.24-rc2",
      "0.2.24-rc10",
      "0.2.24",
    ];
    expect([...order].reverse().sort(compareVersions)).toEqual(order);
    for (const a of order)
      for (const b of order) {
        const ab = compareVersions(a, b);
        expect(compareVersions(b, a), `${a} vs ${b}`).toBe(ab === 0 ? 0 : -ab);
        for (const c of order)
          if (ab < 0 && compareVersions(b, c) < 0)
            expect(compareVersions(a, c), `${a} < ${b} < ${c}`).toBe(-1);
      }
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

  // TEST_SCENARIO: what a user sees follows the same ordering on either spelling: a client on the candidate the server recommends is current, and the one before it is told to upgrade, in `dam version`, `dam ping` and the command preflight.
  it.each([
    ["0.2.24-rc9", "0.2.24-rc10", "behind-current"],
    ["0.2.24-rc10", "0.2.24-rc10", "ok"],
    ["0.2.24-rc10", "0.2.24-rc9", "ok"],
    ["0.2.25-rc.9", "0.2.25-rc.10", "behind-current"],
    ["0.2.25-rc.10", "0.2.25-rc.10", "ok"],
  ])(
    "verdictFor(local %s, recommended %s) = %s",
    (localCli, serverRecommendedClient, kind) => {
      expect(
        verdictFor({
          localCli,
          serverVersion: serverRecommendedClient,
          serverMinClient: "0.2.0",
          serverRecommendedClient,
        }).kind,
      ).toBe(kind);
    },
  );

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
