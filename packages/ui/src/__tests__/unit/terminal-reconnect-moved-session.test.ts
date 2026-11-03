// TEST_OVERVIEW: after the harness moves its PTY to a new Session (Claude Code's /clear posts a new Session ID and the runtime answers with an OP_SESSION frame), the next connection names the moved Session and asks for no reset, so an automatic reconnect reaches the PTY that moved instead of starting a second one in the Session it left.
import { OP_EXIT, OP_OUTPUT, OP_SESSION, planReconnect } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  followedSession,
  freshPty,
  terminalCloseDrop,
  terminalSocketUrl,
} from "../../modules/sessions/lib/terminal-socket.js";

const base = {
  location: { protocol: "https:", host: "platform.example" },
  agentId: "a1",
  token: "t/1",
};

describe("followedSession", () => {
  it("takes the Session the runtime moved the PTY to", () => {
    expect(followedSession("A", { op: OP_SESSION, sessionId: "B" })).toBe("B");
  });

  it("leaves the Session alone on output and exit frames", () => {
    expect(followedSession("A", { op: OP_OUTPUT })).toBe("A");
    expect(followedSession("A", { op: OP_EXIT })).toBe("A");
  });

  // TEST_SCENARIO: a terminal is opened with reset=1; a connection carries a frame, so its PTY exists; the harness then moves that PTY to a new Session on /clear, and the socket drops. The automatic retry must name the moved Session, carry no reset=1 (that would kill the moved PTY), and not wake the Agent — reconnect to the old Session would have spawned a second harness there.
  it("reconnects to the moved Session without resetting the PTY", () => {
    const pty = freshPty();
    expect(
      terminalSocketUrl({
        ...base,
        sessionId: "A",
        reset: pty.reset(true),
        wakes: true,
      }),
    ).toBe(
      "wss://platform.example/api/agents/a1/terminal?token=t%2F1&sessionId=A&reset=1",
    );

    pty.attached();
    const attachedTo = followedSession("A", { op: OP_SESSION, sessionId: "B" });

    expect(
      planReconnect({
        drop: terminalCloseDrop(1006, ""),
        everLive: true,
        live: true,
        clock: { attempt: 0, since: 0 },
        now: 1_000,
      }).kind,
    ).toBe("retry");

    const retry = terminalSocketUrl({
      ...base,
      sessionId: attachedTo,
      reset: pty.reset(true),
      wakes: false,
    });
    expect(retry).toContain("sessionId=B");
    expect(retry).not.toContain("reset=1");
    expect(retry).toContain("wake=0");
  });
});
