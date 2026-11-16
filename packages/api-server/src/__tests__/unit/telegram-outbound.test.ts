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
 * form under the Agent's text, and each of its link buttons as a Telegram
 * button.
 */

const header: ChannelBlock = {
  type: "header",
  text: { type: "plain_text", text: "Deploys" },
};

const blocks: ChannelBlock[] = [
  header,
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
   * Telegram the card's content arrives as text under the Agent's text, and
   * its link button as a Telegram button, so the link is not also a line of
   * the text.
   */
  it("puts the agent's text first, then the card's text, and keeps its link buttons", () => {
    const payload = telegramPayload("This week", { card });
    if (typeof payload === "string" || !("card" in payload))
      throw new Error("expected a card");
    expect(payload.card.children).toMatchObject([
      { type: "text", content: "This week\n\nDeploys" },
      {
        type: "actions",
        children: [
          { type: "link-button", label: "Open", url: "https://example.com" },
        ],
      },
    ]);
  });

  it("sends a card without text as its text and buttons, with its file", () => {
    const payload = telegramPayload("", {
      card,
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    if (typeof payload === "string" || !("card" in payload))
      throw new Error("expected a card");
    expect(payload.card.children.map((child) => child.type)).toEqual([
      "text",
      "actions",
    ]);
    expect(payload.files?.[0]?.filename).toBe("report.md");
  });

  // TEST_SCENARIO: blocks with no link button need no Telegram card, so the message goes as Markdown text.
  it("sends blocks without a link button as Markdown text", () => {
    expect(
      telegramPayload("This week", {
        card: { blocks: [header], text: channelBlocksText([header]) },
      }),
    ).toEqual({ markdown: "This week\n\nDeploys" });
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
