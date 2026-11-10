import { describe, expect, it } from "vitest";
import { buildChannelCard } from "../../modules/channels/infrastructure/channel-card.js";
import {
  slackCardBlocks,
  slackRefusedBlocks,
} from "../../modules/channels/infrastructure/slack-card-blocks.js";

/**
 * TEST_OVERVIEW: How a Channel Card becomes Slack blocks. Chat SDK's converter
 * builds the blocks, and the platform first turns the card's Markdown into
 * mrkdwn so links read as links, splits a text Slack would cut at 3000
 * characters, and keeps the converter from trimming a card to 50 blocks, so
 * the post's own block cap counts the card's real size. It also pins which
 * Slack refusals send the card again as its text form.
 */

function card(children: Record<string, unknown>[]) {
  const built = buildChannelCard({
    type: "Card",
    props: { title: "Status" },
    children,
  });
  if (!("card" in built)) throw new Error(built.issues.join("; "));
  return built.card;
}

const texts = (blocks: Record<string, unknown>[]) =>
  JSON.stringify(blocks.map((block) => block.text ?? block.fields));

describe("slackCardBlocks", () => {
  it("turns Markdown links in a text and a field value into Slack links", () => {
    const blocks = slackCardBlocks(
      card([
        {
          type: "Text",
          props: { content: "See [the PR](https://x.example/1)" },
        },
        {
          type: "Fields",
          props: {},
          children: [
            {
              type: "Field",
              props: { label: "Build", value: "[green](https://ci.example/9)" },
            },
          ],
        },
      ]),
    );
    expect(texts(blocks)).toContain("<https://x.example/1|the PR>");
    expect(texts(blocks)).toContain("<https://ci.example/9|green>");
  });

  // TEST_SCENARIO: Slack cuts a section at 3000 characters, so a long text would lose its end without any error.
  it("splits a long text across blocks instead of cutting it", () => {
    const paragraph = "word ".repeat(400).trim();
    const content = `${paragraph}\n\n${paragraph}\n\nThe end.`;
    const blocks = slackCardBlocks(
      card([{ type: "Text", props: { content } }]),
    );
    expect(blocks.length).toBeGreaterThan(2);
    expect(texts(blocks)).toContain("The end.");
  });

  it("keeps every block of a long card, so the post can count its real size", () => {
    const blocks = slackCardBlocks(
      card(
        Array.from({ length: 60 }, (_, i) => ({
          type: "Text",
          props: { content: `Check ${i + 1} passed` },
        })),
      ),
    );
    expect(blocks.length).toBeGreaterThan(60);
  });
});

describe("slackRefusedBlocks", () => {
  it("sends the card again as text for Slack's block refusals only", () => {
    const refusal = (error: string) => ({ data: { error } });
    expect(slackRefusedBlocks(refusal("invalid_blocks"))).toBe(true);
    expect(slackRefusedBlocks(refusal("msg_blocks_too_long"))).toBe(true);
    expect(slackRefusedBlocks(refusal("channel_not_found"))).toBe(false);
    expect(slackRefusedBlocks(new Error("network down"))).toBe(false);
  });
});
