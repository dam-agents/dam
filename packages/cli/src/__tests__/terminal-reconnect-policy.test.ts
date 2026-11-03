// TEST_OVERVIEW: the rules `dam chat` and the web terminal follow after a lost terminal connection: which drops connect again to the same Session, how long they wait between attempts, when they give up, and which relay path a reconnect uses.
import {
  nextReconnectDelay,
  planReconnect,
  RECONNECT_BACKOFF_MS,
  RECONNECT_GIVE_UP_MS,
  terminalDropRetries,
  type TerminalDrop,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import { terminalPath } from "../modules/chat/domain/terminal-path.js";

describe("terminalDropRetries", () => {
  const retried: [string, TerminalDrop][] = [
    ["a lost socket", { kind: "lost", reason: "read ECONNRESET" }],
    ["a missed keepalive", { kind: "lost", reason: "no keepalive" }],
    [
      "a relay going away",
      { kind: "closed", code: 1001, reason: "server shutting down" },
    ],
    ["an abnormal close", { kind: "closed", code: 1006, reason: "" }],
    ["a service restart", { kind: "closed", code: 1012, reason: "" }],
    [
      "a try-again-later",
      { kind: "closed", code: 1013, reason: "buffer full" },
    ],
    ["a bad gateway close", { kind: "closed", code: 1014, reason: "" }],
    [
      "the agent's socket dropping",
      { kind: "closed", code: 1011, reason: "upstream closed" },
    ],
    [
      "the agent's socket failing",
      { kind: "closed", code: 1011, reason: "upstream error" },
    ],
    [
      "the agent refusing the relay",
      { kind: "closed", code: 1011, reason: "failed to connect to agent" },
    ],
    ["a gateway 502 on upgrade", { kind: "refused", status: 502 }],
    ["an auth backend 503 on upgrade", { kind: "refused", status: 503 }],
  ];
  const ended: [string, TerminalDrop][] = [
    ["the PTY exiting", { kind: "exited", code: 0 }],
    [
      "the PTY closing its socket",
      { kind: "closed", code: 1000, reason: "pty exited" },
    ],
    [
      "a newer viewer on another replica",
      { kind: "closed", code: 1000, reason: "superseded" },
    ],
    [
      "a newer viewer on the runtime",
      { kind: "closed", code: 1000, reason: "replaced by new connection" },
    ],
    [
      "a protocol error",
      { kind: "closed", code: 1002, reason: "first frame must be RESIZE" },
    ],
    [
      "a refused lease",
      { kind: "closed", code: 1008, reason: "provider-removed" },
    ],
    ["a close without a code", { kind: "closed", code: 1005, reason: "" }],
    [
      "an agent put to sleep",
      { kind: "closed", code: 1011, reason: "agent not ready: stopped" },
    ],
    [
      "a disabled agent",
      { kind: "closed", code: 1011, reason: "agent not ready: disabled" },
    ],
    [
      "a hibernated agent nobody woke",
      {
        kind: "closed",
        code: 1011,
        reason: "agent not ready: hibernated-not-scaled",
      },
    ],
    [
      "a deleted agent",
      { kind: "closed", code: 1011, reason: "agent not ready: not-found" },
    ],
    ["a bad token", { kind: "refused", status: 401 }],
    ["a missing scope", { kind: "refused", status: 403 }],
    ["an agent of someone else", { kind: "refused", status: 404 }],
    ["terms not accepted", { kind: "refused", status: 412 }],
  ];

  it.each(retried)("connects again after %s", (_, drop) => {
    expect(terminalDropRetries(drop)).toBe(true);
  });

  it.each(ended)("ends the attach after %s", (_, drop) => {
    expect(terminalDropRetries(drop)).toBe(false);
  });
});

describe("nextReconnectDelay", () => {
  it("steps through the backoff dam run uses and stays at its last step", () => {
    expect(RECONNECT_BACKOFF_MS).toEqual([1_000, 2_000, 5_000, 10_000, 30_000]);
    const delays = [0, 1, 2, 3, 4, 5, 6].map((attempt) =>
      nextReconnectDelay(attempt, 0),
    );
    expect(delays).toEqual([
      1_000, 2_000, 5_000, 10_000, 30_000, 30_000, 30_000,
    ]);
  });

  // TEST_SCENARIO: an attempt whose wait would end past the give-up time is not made, so the user gets the resume command within two minutes of the drop instead of an endless retry.
  it("gives up when the next wait would pass the give-up time", () => {
    expect(RECONNECT_GIVE_UP_MS).toBe(120_000);
    expect(nextReconnectDelay(5, 90_000)).toBe(30_000);
    expect(nextReconnectDelay(5, 90_001)).toBeNull();
    expect(nextReconnectDelay(0, 120_000)).toBeNull();
  });

  it("follows a policy it is given", () => {
    const policy = { backoffMs: [10, 20], giveUpMs: 50 };
    expect(nextReconnectDelay(0, 0, policy)).toBe(10);
    expect(nextReconnectDelay(3, 30, policy)).toBe(20);
    expect(nextReconnectDelay(3, 31, policy)).toBeNull();
  });
});

describe("planReconnect", () => {
  const lost: TerminalDrop = { kind: "lost", reason: "read ECONNRESET" };
  const start = { attempt: 0, since: 0 };

  it("reports a first connection that never carried a frame", () => {
    expect(
      planReconnect({
        drop: lost,
        everLive: false,
        live: false,
        clock: start,
        now: 1_000,
      }),
    ).toEqual({ kind: "end", reason: "read ECONNRESET" });
  });

  it("ends on a drop that does not retry", () => {
    expect(
      planReconnect({
        drop: { kind: "closed", code: 1000, reason: "superseded" },
        everLive: true,
        live: true,
        clock: start,
        now: 1_000,
      }),
    ).toEqual({ kind: "end", reason: "superseded" });
  });

  it("starts the clock over at the drop of a connection that carried frames", () => {
    expect(
      planReconnect({
        drop: lost,
        everLive: true,
        live: true,
        clock: { attempt: 4, since: 0 },
        now: 500_000,
      }),
    ).toEqual({
      kind: "retry",
      delayMs: 1_000,
      reason: "read ECONNRESET",
      clock: { attempt: 1, since: 500_000 },
    });
  });

  // TEST_SCENARIO: while the agent restarts, each new connection opens and is closed again before the agent's end answers. Those attempts carried no frame, so they must not start the give-up clock over, or the viewer would retry forever.
  it("keeps the clock across attempts that carried no frame, then gives up", () => {
    const policy = { backoffMs: [10], giveUpMs: 100 };
    expect(
      planReconnect({
        drop: { kind: "closed", code: 1011, reason: "upstream closed" },
        everLive: true,
        live: false,
        clock: { attempt: 3, since: 0 },
        now: 50,
        policy,
      }),
    ).toMatchObject({
      kind: "retry",
      delayMs: 10,
      clock: { attempt: 4, since: 0 },
    });
    expect(
      planReconnect({
        drop: lost,
        everLive: true,
        live: false,
        clock: { attempt: 4, since: 0 },
        now: 95,
        policy,
      }),
    ).toEqual({
      kind: "end",
      reason: "could not reconnect within 0 s: read ECONNRESET",
    });
  });
});

describe("terminalPath", () => {
  it("asks for a fresh PTY only on the user's reset", () => {
    expect(terminalPath("a/1", "s-1", "attach")).toBe(
      "/api/agents/a%2F1/terminal?sessionId=s-1",
    );
    expect(terminalPath("a/1", "s-1", "reset")).toBe(
      "/api/agents/a%2F1/terminal?sessionId=s-1&reset=1",
    );
  });

  // TEST_SCENARIO: `reset=1` kills the Session's PTY. A reconnect after an attach with `--reset` must reach the PTY that reset started, not kill it again, and must not wake an Agent its owner put to sleep while the connection was down.
  it("never resets and never wakes on a reconnect", () => {
    const path = terminalPath("a1", "s-1", "reconnect");
    expect(path).toBe("/api/agents/a1/terminal?sessionId=s-1&wake=0");
    expect(path).not.toContain("reset");
  });
});
