import { SessionType } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  conversationLabel,
  type ConversationNames,
} from "../../modules/sessions/lib/conversation-label.js";

// TEST_OVERVIEW: the label that names the Slack channel or Telegram chat a session came from. The sessions sidebar and the Home feed both show it, so the thread-key rules are pinned here once.

const names: ConversationNames = {
  slackByChannelId: new Map([["C123", "#code-review"]]),
  telegramByConversationId: new Map([["-100", "Ops chat"]]),
};

describe("conversationLabel", () => {
  it("names a Slack thread by its channel", () => {
    expect(
      conversationLabel(
        { type: SessionType.ChannelSlack, threadTs: "C123:1700000000.000100" },
        names,
      ),
    ).toBe("#code-review");
  });

  // TEST_SCENARIO: an ambient session has no thread; the label says so next to the channel so it is not mistaken for a reply thread.
  it("marks an ambient Slack session", () => {
    expect(
      conversationLabel(
        { type: SessionType.ChannelSlack, threadTs: "ambient:C123" },
        names,
      ),
    ).toBe("#code-review · ambient");
  });

  // TEST_SCENARIO: the channel was disconnected since, so there is no name for it; the row shows nothing rather than a raw id.
  it("gives no label for a Slack channel the user no longer has", () => {
    expect(
      conversationLabel(
        { type: SessionType.ChannelSlack, threadTs: "C999:1700000000.000100" },
        names,
      ),
    ).toBeUndefined();
  });

  it("names a Telegram session by its chat title", () => {
    expect(
      conversationLabel(
        { type: SessionType.ChannelTelegram, threadTs: "-100" },
        names,
      ),
    ).toBe("Ops chat");
  });

  it("gives no label to a session that did not come from a channel", () => {
    expect(
      conversationLabel({ type: SessionType.Regular, threadTs: null }, names),
    ).toBeUndefined();
  });
});
