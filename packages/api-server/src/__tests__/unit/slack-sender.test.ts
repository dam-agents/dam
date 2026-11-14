/**
 * TEST_OVERVIEW: classifySlackSender decides who wrote an inbound Slack post,
 * or that the post must never start a turn. A person has a user id and no bot
 * id. This app's own posts are an Agent only when they carry an Agent Footer.
 * A post with an Agent Footer from a listed companion app is a companion: an
 * Agent of another install. Any other bot or webhook is an app. Edits, joins
 * and other subtypes are dropped, and so is every bot post while this app's
 * own ids are unknown.
 */
import { describe, expect, it } from "vitest";
import { classifySlackSender } from "../../modules/channels/infrastructure/slack-sender.js";

const self = {
  userId: "UBOT",
  botId: "BSELF",
  companionAppIds: new Set(["A-STAGING"]),
};

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
    ).toEqual({ kind: "agent", agentId: "agent-abc123", ambientRound: false });
  });

  /** TEST_SCENARIO: A reply made in an ambient round says so in its footer
   *  link, so the readers of that round are not handed it twice. */
  it("reads the ambient-round mark from the footer", () => {
    const marked = [
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "<http://ui/a/agent-abc123?s=sess-1&via=ambient|Alpha>",
          },
        ],
      },
    ];
    expect(
      classifySlackSender(
        { user: "UBOT", bot_id: "BSELF", blocks: marked },
        self,
      ),
    ).toEqual({ kind: "agent", agentId: "agent-abc123", ambientRound: true });
  });

  /** TEST_SCENARIO: A post with a custom username can arrive as bot_message
   *  without the bot's user id. The bot id still marks it as this app's. */
  it("recognises this app's post by bot id alone", () => {
    expect(
      classifySlackSender(
        { subtype: "bot_message", bot_id: "BSELF", blocks: footer },
        self,
      ),
    ).toEqual({ kind: "agent", agentId: "agent-abc123", ambientRound: false });
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
   *  still an app, because a footer is read only on this app's own posts and
   *  on a listed companion app's. */
  it("does not let another app pass as an agent", () => {
    expect(
      classifySlackSender(
        { user: "U-CI", bot_id: "B-CI", blocks: footer },
        self,
      ),
    ).toEqual({ kind: "app", botId: "B-CI", name: "" });
  });

  /** TEST_SCENARIO: A second install of the platform posts through its own
   *  Slack app, which an operator listed as a companion. Its Agent's post is
   *  named as Slack shows it. The Agent id in its footer belongs to the other
   *  install, so it is not carried. */
  it("reads a footed post from a companion app as a companion", () => {
    expect(
      classifySlackSender(
        {
          subtype: "bot_message",
          bot_id: "B-STAGING",
          app_id: "A-STAGING",
          username: "Rex",
          blocks: footer,
        },
        self,
      ),
    ).toEqual({ kind: "companion", botId: "B-STAGING", name: "Rex" });
  });

  it("finds a companion app by the app id in its bot profile", () => {
    expect(
      classifySlackSender(
        {
          user: "U-STAGING",
          bot_id: "B-STAGING",
          bot_profile: { name: "Staging", app_id: "A-STAGING" },
          blocks: footer,
        },
        self,
      ),
    ).toEqual({ kind: "companion", botId: "B-STAGING", name: "Staging" });
  });

  /** TEST_SCENARIO: The other install marks a reply made in one of its ambient
   *  rounds. The readers here were not in that round, so the mark is not read
   *  and the post reaches them like any companion post. */
  it("does not read a companion's ambient round mark", () => {
    expect(
      classifySlackSender(
        {
          bot_id: "B-STAGING",
          app_id: "A-STAGING",
          username: "Rex",
          blocks: [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: "<http://staging/a/agent-abc123?s=sess-1&via=ambient|Rex>",
                },
              ],
            },
          ],
        },
        self,
      ),
    ).toEqual({ kind: "companion", botId: "B-STAGING", name: "Rex" });
  });

  /** TEST_SCENARIO: A companion app also posts notices that no Agent wrote.
   *  Without an Agent Footer the post is an app's, as it was before the app
   *  was listed. */
  it("reads a companion app's post without a footer as an app", () => {
    expect(
      classifySlackSender(
        { bot_id: "B-STAGING", app_id: "A-STAGING", username: "Staging" },
        self,
      ),
    ).toEqual({ kind: "app", botId: "B-STAGING", name: "Staging" });
  });

  /** TEST_SCENARIO: An operator lists this install's own app as a companion by
   *  mistake. Its posts stay this install's own, so an Agent's post still
   *  carries its Agent id. */
  it("keeps this app's own post an agent's when its app id is listed", () => {
    expect(
      classifySlackSender(
        { bot_id: "BSELF", app_id: "A-STAGING", blocks: footer },
        self,
      ),
    ).toEqual({ kind: "agent", agentId: "agent-abc123", ambientRound: false });
  });

  /** TEST_SCENARIO: Until auth.test has named this app's bot, an Agent's reply
   *  cannot be told from an app's post, so every bot post is dropped. */
  it("drops every bot post while this app's ids are unknown", () => {
    const unknown = {
      userId: null,
      botId: null,
      companionAppIds: new Set(["A-STAGING"]),
    };
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
