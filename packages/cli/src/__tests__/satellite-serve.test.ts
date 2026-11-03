import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
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
import { serve, transportFor } from "../modules/satellite/commands/shared.js";
import { FenceUnsupportedError } from "../modules/satellite/services/worker.js";
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
        connectFenced: { mutate: async () => ({ incarnation: "reg-1" }) },
        claim: {
          mutate: async () => {
            claims.push(1);
            if (claims.length === 1) return [];
            await new Promise((resolve) => setTimeout(resolve, 500));
            return [];
          },
        },
        claimFenced: {
          mutate: async () => {
            claims.push(1);
            if (claims.length === 1) return [];
            await new Promise((resolve) => setTimeout(resolve, 500));
            return [];
          },
        },
        heartbeat: { mutate: async () => {} },
        heartbeatFenced: { mutate: async () => {} },
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

describe("a platform that does not enforce registrations", () => {
  const registrationId = "22222222-2222-4222-8222-222222222222";

  function noProcedure(): Error {
    return TRPCClientError.from({
      error: {
        code: -32004,
        message: 'No procedure found on path "satellites.reportFenced"',
        data: { code: "NOT_FOUND" },
      },
    } as never);
  }

  function clientWith(overrides: {
    report?: (input: unknown) => Promise<void>;
    reportFenced?: (input: unknown) => Promise<void>;
    drain?: (input: unknown) => Promise<void>;
    drainFenced?: (input: unknown) => Promise<void>;
  }) {
    const calls: { procedure: string; input: unknown }[] = [];
    const record =
      (procedure: string, work?: (input: unknown) => Promise<void>) =>
      async (input: unknown) => {
        calls.push({ procedure, input });
        if (work !== undefined) return work(input);
      };
    const client = {
      satellites: {
        connect: { mutate: async () => ({ incarnation: registrationId }) },
        claim: { mutate: async () => [] },
        heartbeat: { mutate: async () => {} },
        report: { mutate: record("report", overrides.report) },
        reportFenced: {
          mutate: record("reportFenced", overrides.reportFenced),
        },
        drain: { mutate: record("drain", overrides.drain) },
        drainFenced: { mutate: record("drainFenced", overrides.drainFenced) },
      },
    };
    return { client: client as never, calls };
  }

  const outcome = {
    satellite: "gpu-box",
    sequence: 1,
    incarnation: registrationId,
    outcome: {
      status: "done" as const,
      isError: false,
      exitCode: 0,
      output: "ok",
      images: [],
      truncated: false,
    },
  };

  /**
   * TEST_SCENARIO: A report that names its registration goes to the procedure
   * that requires one, so the endpoint performing the write is the one that
   * enforces the fence. A rolling deployment cannot answer the connect with one
   * version and then quietly read and ignore the identity here.
   */
  it("sends a fenced report to the fenced procedure", async () => {
    const { client, calls } = clientWith({});
    await transportFor(client).report(outcome);
    expect(calls.map((call) => call.procedure)).toEqual(["reportFenced"]);
  });

  /**
   * TEST_SCENARIO: An older server has no fenced procedure and refuses the call
   * by name. Refusing is the point: the worker is told the platform cannot
   * enforce a registration, and nothing unfenced is sent in its place — that
   * would settle whichever machine holds the name now.
   */
  it("refuses a fenced report rather than sending an unfenced one", async () => {
    const { client, calls } = clientWith({
      reportFenced: async () => {
        throw noProcedure();
      },
    });
    await expect(transportFor(client).report(outcome)).rejects.toBeInstanceOf(
      FenceUnsupportedError,
    );
    expect(
      calls.filter((call) => call.procedure === "report"),
      "no unfenced report is sent while an identity is in hand",
    ).toEqual([]);
  });

  it("sends a fenced drain to the fenced procedure", async () => {
    const { client, calls } = clientWith({});
    await transportFor(client).drain({
      satellite: "gpu-box",
      incarnation: registrationId,
    });
    expect(calls.map((call) => call.procedure)).toEqual(["drainFenced"]);
  });

  /**
   * TEST_SCENARIO: The older drain answers that it does not exist. Falling back
   * to the bare-name drain would drain a registration that replaced this one, so
   * the refusal is what the worker sees and it never sends the unfenced form.
   */
  it("refuses a fenced drain rather than draining unfenced", async () => {
    const { client, calls } = clientWith({
      drainFenced: async () => {
        throw noProcedure();
      },
    });
    await expect(
      transportFor(client).drain({
        satellite: "gpu-box",
        incarnation: registrationId,
      }),
    ).rejects.toBeInstanceOf(FenceUnsupportedError);
    expect(
      calls.filter((call) => call.procedure === "drain"),
      "no unfenced drain is sent while an identity is in hand",
    ).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A worker that never learned a registration — one talking to
   * the platform as it was before any of this — keeps the legacy call it has
   * always made. The fenced procedures are for what can be fenced; the plain
   * ones are the compatibility path.
   */
  it("keeps the legacy calls for a worker that names no registration", async () => {
    const { client, calls } = clientWith({});
    await transportFor(client).report({
      ...outcome,
      incarnation: undefined,
    } as never);
    await transportFor(client).drain({ satellite: "gpu-box" });
    expect(calls.map((call) => call.procedure)).toEqual(["report", "drain"]);
    expect(
      calls.map((call) => (call.input as { incarnation?: string }).incarnation),
    ).toEqual([undefined, undefined]);
  });
});

describe("a worker that knows the registration it serves", () => {
  const registrationId = "22222222-2222-4222-8222-222222222222";
  const manifest = {
    name: "gpu-box",
    maxConcurrent: 2,
    tools: [{ name: "run", inputSchema: {} }],
  };

  function noProcedure(path: string): Error {
    return TRPCClientError.from({
      error: {
        code: -32004,
        message: `No procedure found on path "${path}"`,
        data: { code: "NOT_FOUND" },
      },
    } as never);
  }

  function clientWith(
    overrides: Record<string, (input: never) => Promise<never>>,
  ) {
    const calls: { procedure: string; input: unknown }[] = [];
    const record = (procedure: string) => async (input: unknown) => {
      calls.push({ procedure, input });
      const work = overrides[procedure];
      if (work !== undefined) return work(input as never);
      return undefined as never;
    };
    return {
      calls,
      client: {
        satellites: {
          connect: { mutate: record("connect") },
          connectFenced: { mutate: record("connectFenced") },
          claim: { mutate: record("claim") },
          claimFenced: { mutate: record("claimFenced") },
          heartbeat: { mutate: record("heartbeat") },
          heartbeatFenced: { mutate: record("heartbeatFenced") },
          report: { mutate: record("report") },
          reportFenced: { mutate: record("reportFenced") },
          drain: { mutate: record("drain") },
          drainFenced: { mutate: record("drainFenced") },
        },
      } as never,
    };
  }

  /**
   * TEST_SCENARIO: A resumed registration names the one it served, so it goes to
   * the procedure that requires that name. An older replica would drop the field
   * and register a removed name again, which is the opposite of what a reconnect
   * after a removal must do; the refusal is reported as a fence it cannot
   * enforce, and no plain connect is made in its place.
   */
  it("resumes through the fenced procedure, never the plain one", async () => {
    const { client, calls } = clientWith({
      connectFenced: async () => {
        throw noProcedure("satellites.connectFenced");
      },
    });
    await expect(
      transportFor(client).connect({
        manifest,
        host: "gpu-box.internal",
        resume: registrationId,
      }),
    ).rejects.toBeInstanceOf(FenceUnsupportedError);
    expect(calls.map((call) => call.procedure)).toEqual(["connectFenced"]);
  });

  it("registers for the first time through the plain procedure", async () => {
    const { client, calls } = clientWith({});
    await transportFor(client).connect({ manifest, host: "gpu-box.internal" });
    expect(calls.map((call) => call.procedure)).toEqual(["connect"]);
  });

  /**
   * TEST_SCENARIO: A claim that names its registration goes to the procedure
   * that requires one, so an old replica cannot lease the Jobs of a machine that
   * replaced this one. Its refusal is a fence it cannot enforce, and nothing is
   * claimed through the plain procedure.
   */
  it("claims and renews through the fenced procedures, never the plain ones", async () => {
    const { client, calls } = clientWith({
      claimFenced: async () => {
        throw noProcedure("satellites.claimFenced");
      },
      heartbeatFenced: async () => {
        throw noProcedure("satellites.heartbeatFenced");
      },
    });
    const transport = transportFor(client);
    await expect(
      transport.claim({
        satellite: "gpu-box",
        capacity: 1,
        waitMs: 0,
        incarnation: registrationId,
      }),
    ).rejects.toBeInstanceOf(FenceUnsupportedError);
    await expect(
      transport.heartbeat({
        satellite: "gpu-box",
        running: [1],
        incarnation: registrationId,
      }),
    ).rejects.toBeInstanceOf(FenceUnsupportedError);
    expect(calls.map((call) => call.procedure)).toEqual([
      "claimFenced",
      "heartbeatFenced",
    ]);
  });

  it("claims and renews through the plain procedures when it names nothing", async () => {
    const { client, calls } = clientWith({});
    const transport = transportFor(client);
    await transport.claim({ satellite: "gpu-box", capacity: 1, waitMs: 0 });
    await transport.heartbeat({ satellite: "gpu-box", running: [] });
    expect(calls.map((call) => call.procedure)).toEqual(["claim", "heartbeat"]);
  });
});
