import {
  type AnyMessage,
  client,
  type ClientConnection,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";

import { withCloseRace } from "../../modules/acp/close-race.js";
import {
  agentHoldFailure,
  agentHoldFailureCopy,
  sessionOpenWaitLabel,
} from "../../modules/sessions/lib/agent-hold.js";

/**
 * TEST_OVERVIEW: while a session open waits for its agent, the chat says what
 * it waits for, and when the api-server's hold on the agent ends without it,
 * the chat reads that close as the agent's failure with its cause, not as a
 * conversation that would not load.
 *
 * The relay closes the socket with 1011 and `agent not ready: <cause>` or
 * `agent unavailable`; every request in flight then fails with that close.
 */

async function closedWith(code: number, reason: string): Promise<unknown> {
  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      queueMicrotask(() => controller.close());
    },
  });
  const connection: ClientConnection = client().connect({
    readable,
    writable: new WritableStream<AnyMessage>(),
  });
  const raced = withCloseRace(
    connection,
    () => reason,
    () => code,
  );
  return raced.agent
    .request("session/load", { sessionId: "s", cwd: ".", mcpServers: [] })
    .then(
      () => null,
      (e: unknown) => e,
    );
}

describe("agentHoldFailure", () => {
  // TEST_SCENARIO: a hold that timed out names its cause, and the chat shows that cause rather than "it wouldn't load".
  it("reads the hold's cause from a 1011 close", async () => {
    const e = await closedWith(1011, "agent not ready: gateway-not-ready");
    const held = agentHoldFailure(e);
    expect(held).toEqual({ cause: "gateway-not-ready" });
    expect(agentHoldFailureCopy(held!)).toEqual({
      cause: expect.stringContaining("gateway"),
      ownInstruction: false,
    });
  });

  // TEST_SCENARIO: a full budget is not cured by retrying, so its sentence says what to do and where, and the card adds no generic "retry" beside it.
  it("gives a full budget its own instruction", async () => {
    const copy = agentHoldFailureCopy(
      agentHoldFailure(await closedWith(1011, "agent not ready: over-budget"))!,
    );
    expect(copy.ownInstruction).toBe(true);
    expect(copy.cause).toContain("disable it on its page");
  });

  it("reads an agent the relay could not reach at all", async () => {
    expect(
      agentHoldFailure(await closedWith(1011, "agent unavailable")),
    ).toEqual({ cause: "unknown" });
  });

  // TEST_SCENARIO: an agent that is gone is a question about the session, which the not-found path answers by asking the session list.
  it("leaves an agent that was not found to the not-found path", async () => {
    expect(
      agentHoldFailure(await closedWith(1011, "agent not ready: not-found")),
    ).toBeNull();
  });

  it("ignores closes that are not the hold's", async () => {
    expect(
      agentHoldFailure(await closedWith(1011, "failed to connect to agent")),
    ).toBeNull();
    expect(
      agentHoldFailure(await closedWith(1001, "agent not ready")),
    ).toBeNull();
    expect(agentHoldFailure(new Error("agent not ready"))).toBeNull();
  });
});

describe("sessionOpenWaitLabel", () => {
  // TEST_SCENARIO: a session of a sleeping agent opens only after the open wakes it, so the wait says so instead of "Loading session…".
  it("names the wake while the agent sleeps", () => {
    expect(sessionOpenWaitLabel("hibernated")).toBe("Waking the agent…");
    expect(sessionOpenWaitLabel("hibernating")).toBe("Waking the agent…");
  });

  // TEST_SCENARIO: waking a sleeping agent and one still starting are the same wait to the reader, and a message sent meanwhile reads "Waking the agent" too, so the open says the same.
  it("says the same while the agent comes up", () => {
    expect(sessionOpenWaitLabel("starting")).toBe("Waking the agent…");
    expect(sessionOpenWaitLabel("preparing_workspace")).toBe(
      "Waking the agent…",
    );
  });

  it("is the session's own wait while the agent runs", () => {
    expect(sessionOpenWaitLabel("running")).toBe("Loading session…");
    expect(sessionOpenWaitLabel(undefined)).toBe("Loading session…");
  });
});
