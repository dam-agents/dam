/**
 * TEST_OVERVIEW: slackPostOrigin says whether a Slack post came from an app
 * whose Agent Footer may be read. This install's own app is known by its bot
 * user id or its bot id. A companion app, the app of another install of the
 * platform, is known by a Slack app id an operator listed. Every other author
 * has no origin, so a footer on its post names nobody. A companion app's post
 * has an origin only when a bot sent it with an Agent Footer.
 */
import { describe, expect, it } from "vitest";
import { slackPostOrigin } from "../../modules/channels/infrastructure/slack-post-origin.js";

const self = {
  userId: "UBOT",
  botId: "BSELF",
  companionAppIds: new Set(["A-STAGING"]),
};

const blocks = [
  {
    type: "context",
    elements: [{ type: "mrkdwn", text: "<http://ui/a/agent-abc123|Alpha>" }],
  },
];

describe("slackPostOrigin", () => {
  it("knows this install's post by its bot user id", () => {
    expect(slackPostOrigin({ user: "UBOT" }, self)).toBe("own");
  });

  /** TEST_SCENARIO: A post sent under an Agent's own name and icon carries no
   *  user id, only the bot id. */
  it("knows this install's post by its bot id", () => {
    expect(slackPostOrigin({ bot_id: "BSELF" }, self)).toBe("own");
  });

  it("knows a companion app by the app id on the post", () => {
    expect(
      slackPostOrigin(
        { bot_id: "B-STAGING", app_id: "A-STAGING", blocks },
        self,
      ),
    ).toBe("companion");
  });

  it("knows a companion app by the app id in the bot profile", () => {
    expect(
      slackPostOrigin(
        { bot_id: "B-STAGING", bot_profile: { app_id: "A-STAGING" }, blocks },
        self,
      ),
    ).toBe("companion");
  });

  /** TEST_SCENARIO: A companion app also posts notices that no Agent wrote,
   *  and it can post for a person with that person's token. Neither is an
   *  Agent's post, with or without a footer-shaped link. */
  it("gives a companion app's post no origin unless a bot sent it with a footer", () => {
    expect(
      slackPostOrigin({ bot_id: "B-STAGING", app_id: "A-STAGING" }, self),
    ).toBeNull();
    expect(
      slackPostOrigin({ user: "U1", app_id: "A-STAGING", blocks }, self),
    ).toBeNull();
  });

  it("gives an unlisted app, a webhook and a person no origin", () => {
    expect(
      slackPostOrigin({ bot_id: "B-CI", app_id: "A-CI", blocks }, self),
    ).toBeNull();
    expect(slackPostOrigin({ bot_id: "B-HOOK", blocks }, self)).toBeNull();
    expect(slackPostOrigin({ user: "U1" }, self)).toBeNull();
  });

  /** TEST_SCENARIO: An operator lists this install's own app as a companion by
   *  mistake. The post stays this install's own, so its Agent ids keep their
   *  meaning. */
  it("keeps this install's own post its own when its app id is listed", () => {
    expect(
      slackPostOrigin({ bot_id: "BSELF", app_id: "A-STAGING" }, self),
    ).toBe("own");
  });

  /** TEST_SCENARIO: Until auth.test has named this install's bot, none of its
   *  ids are known. A post is then nobody's own, and a companion is still
   *  known by its app id. */
  it("calls no post its own while this install's ids are unknown", () => {
    const unknown = { ...self, userId: null, botId: null };
    expect(
      slackPostOrigin({ user: "UBOT", bot_id: "BSELF" }, unknown),
    ).toBeNull();
    expect(
      slackPostOrigin(
        { bot_id: "B-STAGING", app_id: "A-STAGING", blocks },
        unknown,
      ),
    ).toBe("companion");
  });
});
