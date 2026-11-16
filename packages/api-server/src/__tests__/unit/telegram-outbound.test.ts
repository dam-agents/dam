import { describe, expect, it } from "vitest";
import {
  channelBlocksText,
  type ChannelBlock,
} from "../../modules/channels/domain/channel-blocks.js";
import {
  telegramCardTooLong,
  telegramPayload,
} from "../../modules/channels/infrastructure/telegram.js";

/**
 * TEST_OVERVIEW: What an Agent post sends to Telegram through the Chat SDK
 * adapter. Plain text goes as it is, and a file goes with its text as
 * Markdown. Telegram has no Block Kit, so a Channel Card goes as its text
 * form under the Agent's text.
 */

const blocks: ChannelBlock[] = [
  { type: "header", text: { type: "plain_text", text: "Deploys" } },
  {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open" },
        url: "https://example.com",
      },
    ],
  },
];

const card = { blocks, text: channelBlocksText(blocks) };

describe("telegramPayload", () => {
  it("sends plain text as it is", () => {
    expect(telegramPayload("hello")).toBe("hello");
  });

  /**
   * TEST_SCENARIO: The answer must not depend on where the person asked. In
   * Telegram the card's content arrives as Markdown text under the Agent's
   * text, in the same order as in Slack.
   */
  it("puts the agent's text first, then the card's text form", () => {
    expect(telegramPayload("This week", { card })).toEqual({
      markdown: "This week\n\nDeploys\n[Open](https://example.com)",
    });
  });

  it("sends a card without text as its text form, with its file", () => {
    const payload = telegramPayload("", {
      card,
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    if (typeof payload === "string") throw new Error("expected Markdown");
    expect(payload.markdown).toBe("Deploys\n[Open](https://example.com)");
    expect(payload.files?.[0]?.filename).toBe("report.md");
  });
});

describe("telegramCardTooLong", () => {
  // TEST_SCENARIO: the adapter cuts a message at Telegram's length limit instead of splitting it, so a card whose text would lose its end is refused before it posts.
  it("refuses text and card longer than one Telegram message, and a shorter limit beside a file", () => {
    const long = "x".repeat(3000);
    expect(telegramCardTooLong(long, { card })).toBeNull();
    expect(telegramCardTooLong(`${long}${long}`, { card })).toMatchObject({
      error: expect.stringContaining("4096"),
    });
    expect(
      telegramCardTooLong(long, {
        card,
        attachment: { filename: "report.md", data: Buffer.from("x") },
      }),
    ).toMatchObject({ error: expect.stringContaining("1024") });
    expect(telegramCardTooLong(`${long}${long}`)).toBeNull();
  });

  // TEST_SCENARIO: the adapter sends the text escaped for Telegram's Markdown, so punctuation counts twice against the limit.
  it("counts the characters Telegram's Markdown escapes", () => {
    expect(telegramCardTooLong(".".repeat(2100), { card })).toMatchObject({
      error: expect.stringContaining("4096"),
    });
  });
});
