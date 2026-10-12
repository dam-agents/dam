/**
 * TEST_OVERVIEW: classifySlackSender decides who wrote an inbound Slack post,
 * or that the post must never start a turn. A person has a user id and no bot
 * id. This app's own posts are an Agent only when they carry an Agent Footer.
 * Any other bot or webhook is an app. Edits, joins and other subtypes are
 * dropped, and so is every bot post while this app's own ids are unknown.
 */
import { describe, expect, it } from "vitest";
import { classifySlackSender } from "../../modules/channels/infrastructure/slack-sender.js";

const self = { userId: "UBOT", botId: "BSELF" };

const footer = [
  {
    type: "context",
    elements: [{ type: "mrkdwn", text: "<http://ui/a/agent-abc123|Alpha>" }],
  },
];

describe("classifySlackSender", () => {
  it("reads a person's post", () => {
    expect(classifySlackSender({ user: "U1" }, self)).toEqual({
      kind: "person",
      user: "U1",
    });
  });

  it("keeps a person's file share", () => {
    expect(
      classifySlackSender({ user: "U1", subtype: "file_share" }, self),
    ).toEqual({ kind: "person", user: "U1" });
  });

  /** TEST_SCENARIO: Every Agent posts as the one bot user, so the footer is
   *  the only thing that says which Agent wrote the post. */
  it("reads an agent's post from its footer", () => {
    expect(
      classifySlackSender(
        { user: "UBOT", bot_id: "BSELF", blocks: footer },
        self,
      ),
    ).toEqual({ kind: "agent", agentId: "agent-abc123" });
  });

  /** TEST_SCENARIO: A post with a custom username can arrive as bot_message
   *  without the bot's user id. The bot id still marks it as this app's. */
  it("recognises this app's post by bot id alone", () => {
    expect(
      classifySlackSender(
        { subtype: "bot_message", bot_id: "BSELF", blocks: footer },
        self,
      ),
    ).toEqual({ kind: "agent", agentId: "agent-abc123" });
  });

  /** TEST_SCENARIO: Platform notices and whisper roots come from this app
   *  without a footer. They are not any Agent's words and start no turn. */
  it("drops this app's post without a footer", () => {
    expect(
      classifySlackSender({ user: "UBOT", bot_id: "BSELF" }, self),
    ).toBeNull();
  });

  it("reads an incoming webhook as an app", () => {
    expect(
      classifySlackSender(
        { subtype: "bot_message", bot_id: "B-FLUX", username: "FluxCD" },
        self,
      ),
    ).toEqual({ kind: "app", botId: "B-FLUX", name: "FluxCD" });
  });

  it("names an app by its bot profile when it sets no username", () => {
    expect(
      classifySlackSender(
        { user: "U-CI", bot_id: "B-CI", bot_profile: { name: "CI" } },
        self,
      ),
    ).toEqual({ kind: "app", botId: "B-CI", name: "CI" });
  });

  /** TEST_SCENARIO: Another app may copy an Agent Footer into its post. It is
   *  still an app, because only this app's own posts are read for a footer. */
  it("does not let another app pass as an agent", () => {
    expect(
      classifySlackSender(
        { user: "U-CI", bot_id: "B-CI", blocks: footer },
        self,
      ),
    ).toEqual({ kind: "app", botId: "B-CI", name: "" });
  });

  /** TEST_SCENARIO: Until auth.test has named this app's bot, an Agent's reply
   *  cannot be told from an app's post, so every bot post is dropped. */
  it("drops every bot post while this app's ids are unknown", () => {
    const unknown = { userId: null, botId: null };
    expect(
      classifySlackSender({ subtype: "bot_message", bot_id: "B1" }, unknown),
    ).toBeNull();
    expect(classifySlackSender({ user: "U1" }, unknown)).toEqual({
      kind: "person",
      user: "U1",
    });
  });

  it.each(["message_changed", "message_deleted", "channel_join"])(
    "drops the %s subtype",
    (subtype) => {
      expect(classifySlackSender({ user: "U1", subtype }, self)).toBeNull();
    },
  );

  it("drops a bot_message with no bot id", () => {
    expect(classifySlackSender({ subtype: "bot_message" }, self)).toBeNull();
  });
});
