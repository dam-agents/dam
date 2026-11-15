import { describe, expect, it } from "vitest";

import {
  createSessionMetadata,
  createWorld,
  frames,
  type Client,
  type World,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: a run start is what the chat draws a "Scheduled run" divider
 * for. An unattended turn starts one. A turn boot recovery resumes after an
 * abnormal death carries no unattended flag, and a chat Session starts no run
 * of its own for it, so the chat draws no divider over the resume — while a
 * Session a schedule owns keeps its run, which is data about that fire.
 */

const SESSION = "sess-run-starts";

function promptOn(
  id: number,
  text: string,
  promptId: string,
  surface?: string,
): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId: SESSION,
      prompt: [{ type: "text", text }],
      _meta: {
        platform: { promptId, ...(surface !== undefined && { surface }) },
      },
    },
  };
}

function openSession(world: World, type?: string): Client {
  const machine = world.connect({ viewer: false });
  machine.send(
    type === undefined
      ? frames.newSession(1)
      : {
          jsonrpc: "2.0",
          id: 1,
          method: "session/new",
          params: { cwd: ".", _meta: { platform: { mode: "chat", type } } },
        },
  );
  world.harness().replyTo("session/new", { sessionId: SESSION });
  return machine;
}

describe("acp-runtime: run starts", () => {
  /**
   * TEST_SCENARIO: a scheduled fire and then the resume of a turn a restart
   * cut short run in the same chat session. The fire starts the one run; the
   * resume, which carries no surface, continues the agent's turn and starts
   * none, so a viewer hears one run start, not two.
   */
  it("should start no run for a resumed turn of a chat session", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });
    const machine = openSession(world);
    const viewer = world.connect();
    viewer.send(frames.loadSession(2, SESSION));

    machine.send(promptOn(3, "nightly summary", "p-fire", "schedule"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    machine.send(promptOn(4, "<turn-interrupted>carry on", "p-resume"));

    expect(meta.store.runStartsOf(SESSION)).toHaveLength(1);
    expect(viewer.saw("platform/runStarted")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: the same resume in a session a schedule owns counts as an
   * unattended run whatever surface it carries, so the fire keeps the run its
   * session row, its run totals and its billing read.
   */
  it("should keep the run of a resumed turn of a scheduled session", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });
    const machine = openSession(world, "schedule_cron");

    machine.send(promptOn(3, "<turn-interrupted>carry on", "p-resume"));

    expect(meta.store.runStartsOf(SESSION)).toHaveLength(1);
  });
});
