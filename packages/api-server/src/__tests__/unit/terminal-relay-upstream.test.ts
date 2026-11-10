// TEST_OVERVIEW: the path the terminal relay opens on the agent-runtime for one viewer. It names the Session, a reset when the viewer asked for one, and what a new Session starts with: a harness pair, or a shell, which asks for no harness, provider or model. The viewer's token and anything else it sent stay on the api-server.
import { describe, expect, it } from "vitest";
import { terminalUpstreamPath } from "../../apps/api-server/agent-proxies/terminal-relay.js";

const upstream = (query: Record<string, string>) =>
  new URL(terminalUpstreamPath(new URLSearchParams(query)), "http://agent");

describe("terminalUpstreamPath", () => {
  // TEST_SCENARIO: the web terminal opens Shell: the relay hands the runtime `shell=1` with the Session and the reset, and no harness, provider or model, so the runtime starts a login shell and has nothing to refuse it for.
  it("carries a shell request with no harness or model", () => {
    const url = upstream({
      token: "secret",
      sessionId: "s1",
      reset: "1",
      shell: "1",
    });
    expect(url.pathname).toBe("/api/terminal");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sessionId: "s1",
      reset: "1",
      shell: "1",
    });
  });

  // TEST_SCENARIO: a harness terminal keeps its pair on the way to the runtime, and the viewer's token never reaches the agent.
  it("carries a harness pair and drops the token", () => {
    const url = upstream({
      token: "secret",
      sessionId: "s1",
      harness: "codex",
      provider: "o",
      model: "openai/gpt-5",
      wake: "0",
    });
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sessionId: "s1",
      harness: "codex",
      provider: "o",
      model: "openai/gpt-5",
    });
  });

  // TEST_SCENARIO: a reconnect sends no lease and no reset, so the runtime reattaches the Session's PTY as it is; a connection without a Session id reaches the default one.
  it("sends only the Session on a reconnect", () => {
    expect(
      Object.fromEntries(upstream({ sessionId: "s1" }).searchParams),
    ).toEqual({ sessionId: "s1" });
    expect(upstream({}).searchParams.get("sessionId")).toBe("default");
  });
});
