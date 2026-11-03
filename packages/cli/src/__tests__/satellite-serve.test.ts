import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompatService, ConfigService } from "../modules/cli/index.js";
import type { CompatVerdict } from "../modules/cli/domain/compat.js";
import type {
  MissingConfigError,
  ProbeError,
} from "../modules/cli/domain/errors.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
} from "../modules/shared/exit-codes.js";
import { serve } from "../modules/satellite/commands/shared.js";
import { runTool } from "../modules/satellite/services/command-backend.js";
import { parseCommandSurface } from "../modules/satellite/domain/command-surface.js";
import { resolveActiveHost } from "../modules/shared/preflight.js";
import type { Result } from "../result.js";

/**
 * TEST_OVERVIEW: What a worker does before it has one. `dam satellite mcp` runs
 * as a service, often before the network is up, so an unreachable platform is
 * the ordinary case rather than the end of the process: the startup probe is
 * waited out. A server that answers and refuses, or a configuration that is
 * missing or malformed, still ends the process, since no amount of waiting
 * changes those.
 *
 * The probe is asked once per attempt and its verdict is carried through
 * startup: asking again after a successful check would let a drop between the
 * two reads end a service that had already started.
 *
 * The backoff waits are shortened to milliseconds here; the arithmetic is
 * pinned in the worker suite.
 */

const FAST = { baseMs: 1, capMs: 2 };
const EXIT_SUCCESS_CODE = 0;
const HOST = "http://platform.test";

function config(): ConfigService {
  return {
    getResolved: async () => ({
      ok: true,
      value: { server: HOST } as never,
    }),
  } as never;
}

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
  results: Result<CompatVerdict, ProbeError | MissingConfigError>[],
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
  } as never;
}

function withRetry(seen: number[]) {
  return {
    backoff: FAST,
    onWait: (_reason: string) => seen.push(-1),
  };
}

function exitThatThrows(): void {
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${String(code)}`);
  }) as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the startup probe", () => {
  /**
   * TEST_SCENARIO: The check succeeded and the network went away a moment
   * later. Startup already has its answer, so it must not ask again: a second
   * probe would exit the process on a drop the worker exists to survive.
   */
  it("asks the server once and carries the answer through startup", async () => {
    const seen: number[] = [];
    const service = compat(
      [
        { ok: true, value: verdict() },
        { ok: false, error: probeError("network", "getaddrinfo ENOTFOUND") },
      ],
      seen,
    );
    await expect(
      resolveActiveHost(
        { compatService: service, configService: config() },
        undefined,
        withRetry(seen),
      ),
    ).resolves.toBe(HOST);
    expect(
      seen.filter((at) => at >= 0),
      "one probe, no second",
    ).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A laptop's worker starts before its network does. The probe
   * fails with a network error, and nothing about the machine or the platform
   * has changed, so the wait repeats until the probe answers.
   */
  it("waits out a probe that cannot reach the server", async () => {
    const seen: number[] = [];
    const service = compat(
      [
        { ok: false, error: probeError("network", "getaddrinfo ENOTFOUND") },
        { ok: false, error: probeError("timeout", "the probe timed out") },
        { ok: true, value: verdict() },
      ],
      seen,
    );
    await expect(
      resolveActiveHost(
        { compatService: service, configService: config() },
        undefined,
        withRetry(seen),
      ),
    ).resolves.toBe(HOST);
    expect(seen.filter((at) => at >= 0)).toHaveLength(3);
    expect(
      seen.filter((at) => at === -1),
      "each wait is reported",
    ).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: A version the CLI is too old for is what a probe is for.
   * Waiting would hide the one verdict the user has to act on.
   */
  it("ends on a server that answered and refused the CLI", async () => {
    exitThatThrows();
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
    await expect(
      resolveActiveHost(
        { compatService: service, configService: config() },
        undefined,
        withRetry(seen),
      ),
    ).rejects.toThrow(`exit ${String(EXIT_BELOW_FLOOR)}`);
    expect(seen.filter((at) => at >= 0)).toHaveLength(1);
  });

  it("ends on a server that answers with an error status", async () => {
    exitThatThrows();
    const seen: number[] = [];
    const service = compat(
      [{ ok: false, error: probeError("non-ok-status", "404 Not Found") }],
      seen,
    );
    await expect(
      resolveActiveHost(
        { compatService: service, configService: config() },
        undefined,
        withRetry(seen),
      ),
    ).rejects.toThrow(`exit ${String(EXIT_RUNTIME_FAILURE)}`);
    expect(seen.filter((at) => at >= 0)).toHaveLength(1);
  });

  it("ends on a configuration that is missing", async () => {
    exitThatThrows();
    const seen: number[] = [];
    const service = compat(
      [
        {
          ok: false,
          error: {
            kind: "missing-config",
            key: "server",
          } as MissingConfigError,
        },
      ],
      seen,
    );
    await expect(
      resolveActiveHost(
        { compatService: service, configService: config() },
        undefined,
        withRetry(seen),
      ),
    ).rejects.toThrow(`exit ${String(EXIT_RUNTIME_FAILURE)}`);
    expect(seen.filter((at) => at >= 0)).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Every other command still asks once and exits on a drop. The
   * wait belongs to the service, not to the CLI as a whole.
   */
  it("does not wait when nothing asked it to", async () => {
    exitThatThrows();
    const seen: number[] = [];
    const service = compat(
      [{ ok: false, error: probeError("network", "getaddrinfo ENOTFOUND") }],
      seen,
    );
    await expect(
      resolveActiveHost(
        { compatService: service, configService: config() },
        undefined,
      ),
    ).rejects.toThrow(`exit ${String(EXIT_RUNTIME_FAILURE)}`);
    expect(seen).toHaveLength(1);
  });
});

describe("starting the worker", () => {
  /**
   * TEST_SCENARIO: The whole startup a service performs, not just its probe.
   * The platform answers once and then goes away, which is what a rollout looks
   * like from the machine. Startup must carry the answer it already has into the
   * worker: probing again would exit the process on a drop the worker exists to
   * survive.
   */
  it("probes once and hands the worker its host", async () => {
    const seen: number[] = [];
    const service = compat(
      [
        { ok: true, value: verdict() },
        { ok: false, error: probeError("network", "getaddrinfo ENOTFOUND") },
      ],
      seen,
    );
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${String(code)}`);
    }) as never);
    const claims: number[] = [];
    const client = {
      satellites: {
        connect: { mutate: async () => ({ incarnation: "reg-1" }) },
        claim: {
          mutate: async () => {
            claims.push(1);
            if (claims.length === 1) return [];
            await new Promise((resolve) => setTimeout(resolve, 500));
            return [];
          },
        },
        heartbeat: { mutate: async () => {} },
        report: { mutate: async () => {} },
        drain: { mutate: async () => {} },
      },
    };

    const backend = {
      get tools() {
        return [runToolFixture()];
      },
      ensureReady: async () => ({ restarted: false }),
      call: async () => ({
        status: "done" as const,
        isError: false,
        exitCode: 0,
        output: "ok",
        truncated: false,
      }),
      describeCall: () => "run",
      cancel: () => {},
      killAll: () => {},
      close: async () => {},
    };

    const serving = serve(
      {
        compatService: service,
        configService: config(),
        createTrpc: () => client as never,
      } as never,
      { server: HOST },
      backend,
      { name: "test-box", maxConcurrent: 2 },
    );
    serving.catch(() => {});
    await vi.waitFor(() => expect(claims.length).toBeGreaterThan(1), {
      timeout: 5000,
    });
    process.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled(), { timeout: 5000 });
    expect(exit).toHaveBeenCalledWith(EXIT_SUCCESS_CODE);
    expect(
      seen.filter((at) => at >= 0),
      "one probe, no second",
    ).toHaveLength(1);
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  }, 15_000);
});

function runToolFixture() {
  const parsed = parseCommandSurface("./echo *", {
    name: "test-box",
    maxConcurrent: 2,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return runTool(parsed.value);
}
