import { describe, expect, it } from "vitest";
import {
  isSlackDirectMessageId,
  type SlackChannel,
  sharedChannels,
} from "api-server-api";

/**
 * TEST_OVERVIEW: Anyone a messenger admits to a conversation an Agent is bound
 * to steers the Agent with every connection and satellite it holds. The
 * contract package owns the one rule for which bound conversations share an
 * Agent this way, and the web app's sharing confirmations and the CLI's
 * sharing warning both read it. A 1:1 conversation is the binder's own and
 * shares nothing; every other one is shared.
 */

const slack = (
  slackChannelId: string,
  label?: SlackChannel["label"],
): Pick<SlackChannel, "slackChannelId" | "label"> => ({
  slackChannelId,
  ...(label && { label }),
});

describe("shared conversations", () => {
  /** TEST_SCENARIO: every kind of Slack conversation and Telegram chat goes through the rule once: only the 1:1 ones drop out, and each shared one keeps the name the warning shows. */
  it("shares an Agent with every conversation but a 1:1 one", () => {
    expect(
      sharedChannels(
        [
          slack("D0001"),
          slack("C0002", { kind: "direct-message", with: "ana" }),
          slack("C0003", { kind: "channel", name: "eng" }),
          slack("C0004"),
          slack("G0005", { kind: "group-direct-message", members: ["ana"] }),
          slack("C0006", { kind: "gone" }),
        ],
        [
          { title: "Ops", direct: false },
          { title: "ana", direct: true },
        ],
      ),
    ).toEqual([
      { kind: "slack-channel", name: "#eng" },
      { kind: "slack-channel", name: "C0004" },
      { kind: "slack-group-dm" },
      { kind: "slack-channel", name: "C0006" },
      { kind: "telegram-chat", name: "Ops" },
    ]);
  });

  /** TEST_SCENARIO: before a conversation is bound only its id is known, and Slack starts the id of a 1:1 DM with D. */
  it("tells a 1:1 Slack DM by its id", () => {
    expect(isSlackDirectMessageId("D0001")).toBe(true);
    expect(isSlackDirectMessageId("C0002")).toBe(false);
    expect(isSlackDirectMessageId("G0003")).toBe(false);
  });

  /** TEST_SCENARIO: an Agent bound nowhere shares with nobody. */
  it("shares with nobody when nothing is bound", () => {
    expect(sharedChannels([], [])).toEqual([]);
  });
});
