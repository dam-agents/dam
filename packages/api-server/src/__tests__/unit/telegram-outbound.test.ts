import { describe, expect, it } from "vitest";
import { buildChannelCard } from "../../modules/channels/infrastructure/channel-card.js";
import {
  telegramCardTooLong,
  telegramPayload,
} from "../../modules/channels/infrastructure/telegram.js";

/**
 * TEST_OVERVIEW: What an Agent post sends to Telegram through the Chat SDK
 * adapter. Plain text goes as it is, a file goes with its text as Markdown,
 * and a Channel Card goes as a card whose first element is the agent's text,
 * so the adapter shows the text above the card's text form and turns each
 * link button into a Telegram button.
 */

function channelCard(tree: Record<string, unknown>) {
  const built = buildChannelCard(tree);
  if (!("card" in built)) throw new Error(built.issues.join("; "));
  return built.card;
}

const card = channelCard({
  type: "Card",
  props: { title: "Deploys" },
  children: [
    {
      type: "Actions",
      props: {},
      children: [
        {
          type: "LinkButton",
          props: { label: "Open", url: "https://example.com" },
        },
      ],
    },
  ],
});

describe("telegramPayload", () => {
  it("sends plain text as it is", () => {
    expect(telegramPayload("hello")).toBe("hello");
  });

  // TEST_SCENARIO: the adapter shows a card's title above its children, so the title moves under the agent's text to keep the text first, as in Slack.
  it("puts the agent's text first, then the card's title, and keeps its link buttons", () => {
    const payload = telegramPayload("This week", { card });
    if (typeof payload === "string" || !("card" in payload))
      throw new Error("expected a card");
    expect(payload.card.title).toBeUndefined();
    expect(payload.card.children.slice(0, 2)).toEqual([
      { type: "text", content: "This week" },
      { type: "text", content: "Deploys", style: "bold" },
    ]);
    expect(payload.card.children[2]).toMatchObject({
      type: "actions",
      children: [{ type: "link-button", url: "https://example.com" }],
    });
  });

  it("sends a card without text as the card alone, with its file", () => {
    const payload = telegramPayload("", {
      card,
      attachment: { filename: "report.md", data: Buffer.from("x") },
    });
    if (typeof payload === "string" || !("card" in payload))
      throw new Error("expected a card");
    expect(payload.card.children.map((child) => child.type)).toEqual([
      "actions",
    ]);
    expect(payload.files?.[0]?.filename).toBe("report.md");
  });
});

describe("telegramCardTooLong", () => {
  // TEST_SCENARIO: the adapter cuts a card message at Telegram's length limit instead of splitting it, so a card that would lose its end is refused before it posts.
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
});
