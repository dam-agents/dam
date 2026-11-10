import {
  cardToSlackBlocks,
  cardToSlackFallbackText,
  type SlackCardElement,
} from "@chat-adapter/slack/blocks";
import type { CardChild } from "chat";
import type { ChannelCard } from "../services/worker-contract.js";
import type { SlackBlock } from "./slack-gateway.js";
import { escapeMrkdwn, markdownToSections } from "./slack-mrkdwn.js";

const REFUSED_BLOCKS = new Set([
  "invalid_blocks",
  "invalid_blocks_format",
  "msg_blocks_too_long",
]);

function mrkdwnSections(markdown: string): string[] {
  return markdownToSections(markdown).map(
    (section) => (section.text as { text: string }).text,
  );
}

function inMrkdwn(children: readonly CardChild[]): CardChild[] {
  return children.flatMap((child): CardChild[] => {
    switch (child.type) {
      case "text":
        return mrkdwnSections(child.content).map((content) => ({
          ...child,
          content,
        }));
      case "fields":
        return [
          {
            ...child,
            children: child.children.map((field) => ({
              ...field,
              label: escapeMrkdwn(field.label),
              value: mrkdwnSections(field.value).join("\n\n"),
            })),
          },
        ];
      case "section":
        return [{ ...child, children: inMrkdwn(child.children) }];
      default:
        return [child];
    }
  });
}

function slackCard(card: ChannelCard): SlackCardElement {
  return card.card as SlackCardElement;
}

export function slackCardBlocks(card: ChannelCard): SlackBlock[] {
  return cardToSlackBlocks(
    {
      ...slackCard(card),
      children: inMrkdwn(card.card.children) as SlackCardElement["children"],
    },
    { maxBlocks: Number.MAX_SAFE_INTEGER },
  );
}

export function slackCardText(card: ChannelCard): string {
  return cardToSlackFallbackText(slackCard(card));
}

export function slackRefusedBlocks(err: unknown): boolean {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === "string" && REFUSED_BLOCKS.has(data.error);
}
