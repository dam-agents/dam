// TEST_OVERVIEW: the mode a `dam` running inside an assistant uses. It finds the install through its own harness path, sends no Authorization header, resolves the host without reading the user's config, refuses the verbs that need the owner's own doors (chat, run, session, ssh, file, import) with a plain reason, and reports the CLI this install serves rather than chasing npm.
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveActiveHost } from "../modules/shared/preflight.js";
import {
  cliTrpcUrl,
  cliVersionUrl,
  harnessUnavailableVerbs,
  readHarnessMode,
  refuseInHarnessMode,
} from "../modules/shared/harness-mode.js";
import { createTrpcClient } from "../modules/shared/trpc/trpc-client.js";
import { EXIT_RUNTIME_FAILURE } from "../modules/shared/exit-codes.js";

const HARNESS = {
  DAM_HARNESS_URL: "http://harness.svc.cluster.local:8080/",
  DAM_AGENT_ID: "agent-a",
};

function withEnv<T>(env: NodeJS.ProcessEnv, run: () => T): T {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try {
    return run();
  } finally {
    for (const key of Object.keys(env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

describe("harness mode", () => {
  it("is on when both variables are set, and never otherwise", () => {
    expect(withEnv(HARNESS, () => readHarnessMode())).toEqual({
      baseUrl: "http://harness.svc.cluster.local:8080",
      agentId: "agent-a",
    });
    expect(
      withEnv({ DAM_HARNESS_URL: "http://harness" }, () => readHarnessMode()),
    ).toBeNull();
    expect(withEnv({}, () => readHarnessMode())).toBeNull();
  });

  it("addresses the install's own path for this Agent", () => {
    expect(
      cliTrpcUrl({ baseUrl: "http://harness:8080", agentId: "agent-a" }),
    ).toBe("http://harness:8080/api/agents/agent-a/cli/trpc");
    expect(
      cliVersionUrl({ baseUrl: "http://harness:8080", agentId: "agent-a" }),
    ).toBe("http://harness:8080/api/agents/agent-a/cli/version");
  });

  it("takes the harness base as the host, without asking the config", async () => {
    const config = vi.fn();
    const compat = vi.fn();
    const host = await withEnv(HARNESS, () =>
      resolveActiveHost(
        {
          compatService: { check: compat },
          configService: { getResolved: config, set: vi.fn() },
        } as never,
        undefined,
      ),
    );
    expect(host).toBe("http://harness.svc.cluster.local:8080");
    expect(config).not.toHaveBeenCalled();
    expect(compat).not.toHaveBeenCalled();
  });

  it("sends no credentials and no sign-in", async () => {
    let called: { url: string; headers: Record<string, string> } | null = null;
    const recordingFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      called = {
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      return new Response(JSON.stringify({ result: { data: { json: [] } } }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await withEnv(HARNESS, async () => {
      const client = createTrpcClient({
        host: "http://ignored.example",
        tokenProvider: {
          getValidAccessToken: async () => {
            throw new Error("the CLI must not ask for a credential here");
          },
        },
        fetch: recordingFetch,
      });
      await client.agents.runtimeFleet.query().catch(() => {});
    });

    expect(called).not.toBeNull();
    expect(
      called!.url.startsWith("http://harness.svc.cluster.local:8080"),
    ).toBe(true);
    expect(Object.keys(called!.headers)).toEqual([]);
  });

  it("refuses the verbs that need the owner's own doors, and names them", () => {
    expect(harnessUnavailableVerbs()).toEqual(
      expect.arrayContaining([
        "chat",
        "run",
        "session",
        "ssh",
        "file",
        "import",
      ]),
    );
    for (const verb of harnessUnavailableVerbs()) {
      const write = vi
        .spyOn(process.stderr, "write")
        .mockImplementation((() => true) as never);
      const exit = vi.spyOn(process, "exit").mockImplementation(((
        code?: number,
      ) => {
        throw new Error(`exit ${String(code)}`);
      }) as never);
      expect(() => withEnv(HARNESS, () => refuseInHarnessMode(verb))).toThrow(
        `exit ${String(EXIT_RUNTIME_FAILURE)}`,
      );
      expect(String(write.mock.calls[0]![0])).toContain(`dam ${verb}`);
      write.mockRestore();
      exit.mockRestore();
    }
  });

  it("does nothing outside an assistant", () => {
    const exit = vi.spyOn(process, "exit");
    withEnv({}, () => refuseInHarnessMode("chat"));
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});

describe("a refusal reaches the verb itself", () => {
  // UNIT_BOUNDARY_DESCRIPTION: the guard hangs off the command tree, so a subcommand of a refused module refuses too — this is the mechanism the modules use.
  let stderr = "";
  beforeEach(() => {
    stderr = "";
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${String(code)}`);
    }) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses a subcommand of a guarded module", async () => {
    const parent = new Command("session");
    parent.addCommand(
      new Command("list").action(() => {
        throw new Error("the verb must not run");
      }),
    );
    parent.hook("preAction", () => refuseInHarnessMode("session"));

    await withEnv(HARNESS, async () => {
      await expect(
        parent.parseAsync(["list"], { from: "user" }),
      ).rejects.toThrow(`exit ${String(EXIT_RUNTIME_FAILURE)}`);
    });
    expect(stderr).toContain("dam session");
  });
});
