import { afterEach, beforeEach, expect, it, vi } from "vitest";

// TEST_OVERVIEW: setEgress hands the driver what the platform did with the rules it may not give itself: those waiting for the owner, and those the owner blocked on the sub-agent.

beforeEach(() => {
  vi.stubEnv("PLATFORM_MCP_URL", "http://api.test/api/agents/driver-1/mcp");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// TEST_SCENARIO: the platform names one rule waiting and one blocked; setEgress posts the rules and returns both lists as the platform sent them.
it("returns the rules that wait for the owner and those the owner blocked", async () => {
  const outcome = {
    waiting: [{ host: "pypi.org", id: "req-1" }],
    blocked: [{ host: "evil.example" }],
  };
  const sent: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify(outcome), { status: 200 });
    }),
  );
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.resetModules();
  const { subAgent } = await import("../../index.js");
  const rules = [
    { host: "pypi.org", verdict: "allow" as const },
    { host: "evil.example", verdict: "allow" as const },
  ];

  expect(await subAgent("sub-1").setEgress(rules)).toEqual(outcome);
  expect(sent).toEqual([
    {
      url: "http://api.test/api/agents/driver-1/invocations/sub-1/egress",
      body: { rules },
    },
  ]);
});
