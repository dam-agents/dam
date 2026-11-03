import { describe, expect, it } from "vitest";
import type { CompatService } from "../modules/cli/index.js";
import type { CompatVerdict } from "../modules/cli/domain/compat.js";
import type { ProbeError } from "../modules/cli/domain/errors.js";
import { waitForServer } from "../modules/satellite/commands/shared.js";
import type { Result } from "../result.js";

/**
 * TEST_OVERVIEW: What a worker does before it has one. `dam satellite mcp` runs
 * as a service, often before the network is up, so an unreachable platform is
 * the ordinary case rather than the end of the process: the version probe is
 * retried with backoff until the server answers. A server that answers and
 * refuses, or a configuration that is missing or malformed, still ends the
 * process, since no amount of waiting changes those.
 *
 * The backoff waits are shortened to milliseconds here; the arithmetic is
 * pinned in the worker suite.
 */

const FAST = { baseMs: 1, capMs: 2 };

function verdict(): CompatVerdict {
  return {
    kind: "ok",
    localCli: "1.0.0",
    serverVersion: "1.0.0",
    serverMinClient: undefined,
    serverRecommendedClient: undefined,
  };
}

function probeError(code: ProbeError["code"], message = "boom"): ProbeError {
  return { kind: "probe-error", code, message };
}

function compat(
  results: Result<CompatVerdict, ProbeError | { kind: "missing-config" }>[],
  seen: number[],
): CompatService {
  let at = 0;
  return {
    check: async () => {
      seen.push(at);
      const result = results[Math.min(at, results.length - 1)];
      at += 1;
      return result as never;
    },
  };
}

describe("waiting for the server to answer", () => {
  /**
   * TEST_SCENARIO: A laptop's worker starts before its network does. The probe
   * fails with a network error, and nothing about the machine or the platform
   * has changed, so the wait repeats until the probe answers.
   */
  it("retries a probe that cannot reach the server", async () => {
    const seen: number[] = [];
    const service = compat(
      [
        { ok: false, error: probeError("network", "getaddrinfo ENOTFOUND") },
        { ok: false, error: probeError("timeout", "the probe timed out") },
        { ok: true, value: verdict() },
      ],
      seen,
    );
    await waitForServer({ compatService: service }, {}, FAST);
    expect(seen).toHaveLength(3);
  });

  /**
   * TEST_SCENARIO: A version the CLI is too old for is what a probe is for.
   * Retrying it would hide the one verdict the user has to act on, so the
   * caller is handed back to the shared preflight, which exits.
   */
  it("does not retry a server that answered and refused", async () => {
    const seen: number[] = [];
    const service = compat(
      [
        {
          ok: true,
          value: {
            kind: "below-floor",
            localCli: "0.1.0",
            serverVersion: "2.0.0",
            serverMinClient: "1.0.0",
            serverRecommendedClient: undefined,
          },
        },
      ],
      seen,
    );
    await waitForServer({ compatService: service }, {}, FAST);
    expect(seen).toHaveLength(1);
  });

  it("does not retry a server that answers with an error status", async () => {
    const seen: number[] = [];
    const service = compat(
      [{ ok: false, error: probeError("non-ok-status", "404 Not Found") }],
      seen,
    );
    await waitForServer({ compatService: service }, {}, FAST);
    expect(seen).toHaveLength(1);
  });

  it("does not retry a configuration that is missing", async () => {
    const seen: number[] = [];
    const service = compat(
      [{ ok: false, error: { kind: "missing-config" } }],
      seen,
    );
    await waitForServer({ compatService: service }, {}, FAST);
    expect(seen).toHaveLength(1);
  });
});
