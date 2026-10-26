import { describe, it, expect } from "vitest";
import { createSessionMetadata, createWorld, frames } from "./acp-world.js";

/**
 * TEST_OVERVIEW: the automatic title a Session gets when it starts.
 *
 * A Session with no title takes one from the text of its first prompt. A
 * channel turn's prompt opens with the platform's instructions to the agent,
 * not with what the person wrote, so the channel names the person's message
 * as the title on `session/new` (`_meta.platform.title`), and the first
 * prompt then leaves that title alone. Either way the title is one line,
 * cut to a length the session list can show.
 */

const SESSION = "sess-titled";

function start(platform?: Record<string, unknown>) {
  const metadata = createSessionMetadata().store;
  const world = createWorld({ sessionMetadata: metadata });
  const client = world.connect({ viewer: false });
  const open = frames.newSession(1);
  client.send(
    platform
      ? { ...open, params: { ...open.params, _meta: { platform } } }
      : open,
  );
  world.harness().replyTo("session/new", { sessionId: SESSION });
  return { client, title: () => metadata.get(SESSION)?.meta.title };
}

describe("acp-runtime: session titles", () => {
  /**
   * TEST_SCENARIO: A chat Session starts with no title. Its first prompt
   * gives it one, on a single line.
   */
  it("should take the title from the first prompt", () => {
    const { client, title } = start();

    client.send(frames.prompt(2, SESSION, "fix the\n  login page"));

    expect(title()).toBe("fix the login page");
  });

  /**
   * TEST_SCENARIO: A Slack turn starts a Session and names the person's
   * message as its title. The prompt opens with the platform's instructions,
   * and the Session keeps the person's message as its title.
   */
  it("should keep the title the new Session names over its first prompt", () => {
    const { client, title } = start({
      type: "channel-slack",
      title: "who owns\nyou?",
    });

    client.send(
      frames.prompt(2, SESSION, "<how-to-respond> You appear in this Slack…"),
    );

    expect(title()).toBe("who owns you?");
  });

  /**
   * TEST_SCENARIO: A channel names a long message as the title. The runtime
   * cuts it as it cuts a long first prompt.
   */
  it("should cut a long title the new Session names", () => {
    const { title } = start({ title: "a".repeat(200) });

    expect(title()).toBe(`${"a".repeat(79)}…`);
  });

  /**
   * TEST_SCENARIO: A channel names a blank message, one with only an
   * attachment, as the title. The Session keeps no blank title and takes one
   * from its first prompt.
   */
  it("should ignore a blank title the new Session names", () => {
    const { client, title } = start({ title: "  \n " });

    expect(title()).toBeUndefined();
    client.send(frames.prompt(2, SESSION, "summarise the attachment"));
    expect(title()).toBe("summarise the attachment");
  });
});
