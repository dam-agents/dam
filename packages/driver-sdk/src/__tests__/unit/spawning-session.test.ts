import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TEST_OVERVIEW: a spawn names the Driver's Session the script runs in, read from the environment its harness gave the script, so the platform shows the sub-agent only in that Session's chat. A script run outside any Session names none.

const SESSION_VARS = [
  "PLATFORM_SESSION_REF",
  "HARNESS_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
  "PI_SESSION_ID",
];

function fakePlatform() {
  const posted: Array<Record<string, string>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") {
        posted.push(init.headers as Record<string, string>);
        return new Response(JSON.stringify({ id: "inv-1" }), { status: 201 });
      }
      return new Response(
        JSON.stringify({ status: "done", result: 1, exitCode: 0, output: {} }),
        { status: 200 },
      );
    }),
  );
  return posted;
}

async function loadSdk() {
  vi.resetModules();
  return import("../../index.js");
}

describe("the spawning Session", () => {
  beforeEach(() => {
    vi.stubEnv("PLATFORM_MCP_URL", "http://api.test/api/agents/driver-1/mcp");
    for (const name of SESSION_VARS) vi.stubEnv(name, undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // TEST_SCENARIO: Pi hands each chat Session a ref, and also sets its own id on shell commands; both go, and the platform resolves the ref.
  it("sends Pi's Session ref with the spawn and the script spawn", async () => {
    vi.stubEnv("PLATFORM_SESSION_REF", "ref-a");
    vi.stubEnv("PI_SESSION_ID", "pi-1");
    const posted = fakePlatform();
    const { spawn, spawnScript } = await loadSdk();

    await spawn({ prompt: "go", schema: "integer", harness: "pi", pollMs: 0 });
    await spawnScript({ script: "make", harness: "pi", pollMs: 0 });

    for (const headers of posted)
      expect(headers).toMatchObject({
        "x-platform-session-ref": "ref-a",
        "x-platform-session-id": "pi-1",
      });
  });

  // TEST_SCENARIO: another harness sets only its Session id; a terminal sets the platform's own, which comes first.
  it("sends the first Session id the environment sets", async () => {
    vi.stubEnv("CLAUDE_CODE_SESSION_ID", "cc-1");
    vi.stubEnv("HARNESS_SESSION_ID", "terminal-1");
    const posted = fakePlatform();
    const { spawn } = await loadSdk();

    await spawn({ prompt: "go", schema: "integer", harness: "pi", pollMs: 0 });

    expect(posted[0]).toMatchObject({
      "x-platform-session-id": "terminal-1",
    });
    expect(posted[0]).not.toHaveProperty("x-platform-session-ref");
  });

  // TEST_SCENARIO: outside a chat Session, Pi's ref is blank and no harness sets an id; the spawn names nothing and shows in every chat.
  it("names no Session when the environment has none", async () => {
    vi.stubEnv("PLATFORM_SESSION_REF", " ");
    const posted = fakePlatform();
    const { spawn } = await loadSdk();

    await spawn({ prompt: "go", schema: "integer", harness: "pi", pollMs: 0 });

    expect(posted[0]).not.toHaveProperty("x-platform-session-ref");
    expect(posted[0]).not.toHaveProperty("x-platform-session-id");
  });
});
