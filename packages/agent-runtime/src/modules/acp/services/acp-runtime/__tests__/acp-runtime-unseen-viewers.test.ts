import { describe, it, expect } from "vitest";
import {
  createSessionMetadata,
  createWorld,
  frames,
  transcriptOf,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: viewers who do not mark a session seen.
 *
 * Read state is kept per session, not per person. An Agent Editor works in a
 * Shared Agent's sessions, but whether a session is unread belongs to the
 * owner. So the editor's channel is a full viewer, which gets every update
 * and keeps the turn company, but it never stamps the session seen.
 */

const SESSION = "sess-shared";

describe("acp-runtime: viewers who do not mark a session seen", () => {
  /**
   * TEST_SCENARIO: A session holds work the owner has not read. An editor
   * opens it, reads it and sends a turn of their own. The editor sees the
   * whole conversation, but the session is still unread for the owner until
   * the owner opens it.
   */
  it("should leave a session unread when an editor reads and uses it", () => {
    const meta = createSessionMetadata();
    const world = createWorld({ sessionMetadata: meta.store });

    const machine = world.connect({ viewer: false });
    machine.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    machine.send(frames.prompt(2, SESSION, "triage the new issues"));
    machine.disconnect();
    world.harness().emit(frames.agentMessage(SESSION, "labelled three"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(meta.unread(SESSION)).toBe(true);

    const editor = world.connect({ marksSeen: false });
    editor.send(frames.loadSession(1, SESSION));
    editor.send(frames.prompt(2, SESSION, "label the rest too"));
    world.harness().emit(frames.agentMessage(SESSION, "labelled two more"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(transcriptOf(editor).join("")).toContain("labelled two more");
    expect(meta.unread(SESSION)).toBe(true);

    const owner = world.connect();
    owner.send(frames.loadSession(1, SESSION));
    expect(meta.unread(SESSION)).toBe(false);
  });
});
