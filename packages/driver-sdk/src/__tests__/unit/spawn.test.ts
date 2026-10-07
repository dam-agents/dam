import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TEST_OVERVIEW: spawn sends the kit-shaped setup to the platform and, when the sub-agent fails, raises with the platform's reason, which is all the driver gets once the sub-agent is deleted.

type Sent = { method: string; url: string; body: unknown };

function fakePlatform(views: unknown[]) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({
        method: init.method ?? "GET",
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const payload =
        init.method === "POST" ? { id: "inv-1" } : (views.shift() ?? {});
      return new Response(JSON.stringify(payload), { status: 200 });
    }),
  );
  return sent;
}

async function loadSdk() {
  vi.resetModules();
  return import("../../index.js");
}

describe("spawn", () => {
  beforeEach(() => {
    vi.stubEnv("PLATFORM_MCP_URL", "http://api.test/api/agents/driver-1/mcp");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the setup and returns the result", async () => {
    const sent = fakePlatform([{ status: "done", result: 7 }]);
    const { spawn } = await loadSdk();

    const result = await spawn({
      prompt: "run one cell",
      schema: "integer",
      harness: "claude-code",
      label: "cell:one",
      seed: { url: "https://github.example/acme/tool" },
      install: { command: "make" },
      env: [{ name: "A", value: "1" }],
      resources: { cpu: "2", memory: "4Gi" },
      pollMs: 0,
    });

    expect(result).toBe(7);
    expect(sent[0]).toMatchObject({
      method: "POST",
      url: "http://api.test/api/agents/driver-1/invocations",
      body: {
        harness: "claude-code",
        label: "cell:one",
        seed: { url: "https://github.example/acme/tool" },
        install: { command: "make" },
        env: [{ name: "A", value: "1" }],
        resources: { cpu: "2", memory: "4Gi" },
      },
    });
  });

  it("raises with the platform's failure reason", async () => {
    fakePlatform([{ status: "failed", errorReason: "install failed: exit 1" }]);
    const { spawn, InvocationFailed } = await loadSdk();

    const failure = await spawn({
      prompt: "go",
      schema: "integer",
      harness: "claude-code",
      pollMs: 0,
    }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(InvocationFailed);
    expect((failure as InstanceType<typeof InvocationFailed>).reason).toBe(
      "install failed: exit 1",
    );
    expect(String(failure)).toContain("install failed: exit 1");
  });

  it("needs a harness or an image", async () => {
    fakePlatform([]);
    const { spawn } = await loadSdk();

    await expect(spawn({ prompt: "go", schema: "integer" })).rejects.toThrow(
      /pass `harness`/,
    );
  });
});
