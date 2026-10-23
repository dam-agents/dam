// TEST_OVERVIEW: how the web terminal connects again after a lost connection. A browser sees a lost socket and a refused upgrade as close 1006, and both reconnect; a close the relay or the runtime sends on purpose (the PTY exited, a newer viewer, an agent that will not wake) does not. A reconnect never asks for a fresh PTY and never wakes the Agent.
import { planReconnect, terminalDropRetries } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  freshPty,
  terminalCloseDrop,
  terminalSocketUrl,
} from "../../modules/sessions/lib/terminal-socket.js";

const base = {
  location: { protocol: "https:", host: "platform.example" },
  agentId: "a1",
  sessionId: "s-1",
  token: "t/1",
  lease: null,
};

describe("terminalCloseDrop", () => {
  it("reconnects after a socket the browser lost", () => {
    expect(terminalDropRetries(terminalCloseDrop(1006, ""))).toBe(true);
  });

  it("reconnects after the relay restarts", () => {
    expect(
      terminalDropRetries(terminalCloseDrop(1001, "server shutting down")),
    ).toBe(true);
  });

  it.each([
    [1000, "pty exited"],
    [1000, "superseded"],
    [1008, "provider-removed"],
    [1011, "agent not ready: stopped"],
  ])("does not reconnect after %i %s", (code, reason) => {
    expect(terminalDropRetries(terminalCloseDrop(code, reason))).toBe(false);
  });

  // TEST_SCENARIO: the first connect of a terminal fails before any frame. The terminal shows "Session disconnected" with its Reconnect button at once, as before, instead of retrying a connect that never worked.
  it("does not reconnect a terminal that never carried a frame", () => {
    expect(
      planReconnect({
        drop: terminalCloseDrop(1006, ""),
        everLive: false,
        live: false,
        clock: { attempt: 0, since: 0 },
        now: 0,
      }).kind,
    ).toBe("end");
  });
});

describe("terminalSocketUrl", () => {
  it("names the session and the token, and waits for a wake it did not ask for", () => {
    expect(terminalSocketUrl({ ...base, reset: false, wakes: false })).toBe(
      "wss://platform.example/api/agents/a1/terminal?token=t%2F1&sessionId=s-1&wake=0",
    );
  });

  it("asks for a fresh PTY and a wake when told to, with the lease", () => {
    expect(
      terminalSocketUrl({
        ...base,
        location: { protocol: "http:", host: "localhost" },
        reset: true,
        wakes: true,
        lease: { harness: "claude-code" },
      }),
    ).toBe(
      "ws://localhost/api/agents/a1/terminal?token=t%2F1&sessionId=s-1&reset=1&harness=claude-code",
    );
  });
});

describe("freshPty", () => {
  // TEST_SCENARIO: a new terminal is opened with reset=1. Once a connection has carried a frame, the runtime has started the fresh PTY, so a reconnect must not send reset=1 again, or it would kill the Session the user is working in.
  it("asks for a reset until a connection carries a frame, then never again", () => {
    const pty = freshPty();
    expect(pty.reset(true)).toBe(true);
    expect(pty.reset(true)).toBe(true);
    pty.attached();
    expect(pty.reset(true)).toBe(false);
  });

  it("never asks for a reset on a terminal that is not fresh", () => {
    expect(freshPty().reset(false)).toBe(false);
  });
});
