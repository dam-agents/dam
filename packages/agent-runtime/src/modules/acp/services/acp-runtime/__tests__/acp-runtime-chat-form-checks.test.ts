import {
  A2UI_PLATFORM_CATALOG_ID,
  chatFormCapabilities,
  chatFormFixPrompt,
  checkChatForm,
} from "api-server-api/chat-forms";
import { describe, expect, it } from "vitest";
import { createWorld, frames } from "./acp-world.js";

/**
 * TEST_OVERVIEW: a reply whose chat form fails the check goes back to the
 * agent without the user acting. When a prompt turn that announced the
 * renderer capabilities ends, the runtime checks the reply's A2UI blocks,
 * marks the turn's end with the fix attempt, and hands the fix prompt on;
 * after the last attempt the prompt asks for plain text instead.
 */

const SESSION = "sess-forms";

const BROKEN_REPLY = `Pick one:\n<a2ui-json>\n${JSON.stringify([
  {
    version: "v1.0",
    createSurface: {
      surfaceId: "pick",
      catalogId: A2UI_PLATFORM_CATALOG_ID,
      components: [{ id: "root", component: "NoSuchComponent" }],
    },
  },
])}\n</a2ui-json>`;

function answerWithBrokenForm(prompt: string) {
  const fixes: { sessionId: string; prompt: string }[] = [];
  const world = createWorld({
    onChatFormFix: (sessionId, fix) => fixes.push({ sessionId, prompt: fix }),
  });
  const client = world.connect();
  client.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  client.send(frames.prompt(2, SESSION, prompt));
  world.harness().emit(frames.agentMessage(SESSION, BROKEN_REPLY, "m-1"));
  world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
  const turnEnded = client
    .saw("platform/turnEnded")
    .map((frame) => (frame.params as { chatFormFix?: number }).chatFormFix);
  return { fixes, turnEnded };
}

describe("acp-runtime: chat form checks", () => {
  /**
   * TEST_SCENARIO: the user's prompt announced the capabilities and the agent
   * answered with a form the chat cannot render. The user must not have to
   * forward the errors: the turn's end says a fix is coming and the fix
   * prompt carries the errors and the capabilities again.
   */
  it("should send a broken form back to the agent as the first fix attempt", () => {
    const { fixes, turnEnded } = answerWithBrokenForm(
      `Set it up\n\n${chatFormCapabilities()}`,
    );

    expect(turnEnded).toEqual([1]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].sessionId).toBe(SESSION);
    expect(fixes[0].prompt).toContain('<chat-form-check attempt="1">');
    expect(fixes[0].prompt).toContain(
      "/0/createSurface/components/0/component",
    );
    expect(fixes[0].prompt).toContain("<a2ui-capabilities>");
  });

  /**
   * TEST_SCENARIO: the agent failed the last allowed fix too. The loop must
   * end: the next prompt asks for plain text and announces no capabilities,
   * so the reply to it is never checked.
   */
  it("should ask for plain text once the fix attempts are used up", () => {
    const lastFix = chatFormFixPrompt(checkChatForm(BROKEN_REPLY), 2);

    const { fixes, turnEnded } = answerWithBrokenForm(lastFix);

    expect(turnEnded).toEqual([3]);
    expect(fixes[0].prompt).toContain('<chat-form-check attempt="3">');
    expect(fixes[0].prompt).toContain("plain text");
    expect(fixes[0].prompt).not.toContain("<a2ui-capabilities>");
  });

  /**
   * TEST_SCENARIO: the prompt with the capabilities waited in the queue and
   * started the moment the turn ahead of it ended. The end of the turn ahead
   * must not drop the check of the queued one.
   */
  it("should check a queued turn that starts as the turn ahead ends", () => {
    const fixes: string[] = [];
    const world = createWorld({ onChatFormFix: (_, fix) => fixes.push(fix) });
    const client = world.connect();
    client.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(frames.prompt(2, SESSION, "First"));
    client.send(
      frames.prompt(3, SESSION, `Set it up\n\n${chatFormCapabilities()}`),
    );
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    world.harness().emit(frames.agentMessage(SESSION, BROKEN_REPLY, "m-2"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toContain('<chat-form-check attempt="1">');
  });

  /**
   * TEST_SCENARIO: a channel turn never announces the capabilities, so a
   * block in its reply is only text there and must not be sent back.
   */
  it("should leave a reply alone when its prompt announced no capabilities", () => {
    const { fixes, turnEnded } = answerWithBrokenForm("Set it up");

    expect(turnEnded).toEqual([undefined]);
    expect(fixes).toEqual([]);
  });
});
