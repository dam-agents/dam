import { hasArtifactReference } from "../../artifact-library/channel-links.js";

import type { ChannelCard } from "../services/worker-contract.js";
import { cardIssues } from "./channel-card.js";

export interface LinkOutboundInput {
  agentId: string;
  owner: string | null;
  surface: string;
  ownerDirectMessage: boolean;
  text: string;
}

export type LinkOutboundArtifacts = (
  input: LinkOutboundInput,
) => Promise<{ text: string } | { error: string }>;

export type LinkArtifactText = (
  text: string,
) => Promise<{ text: string } | { error: string }>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Every channel worker applies the artifact-link rule to what it is about to send, against the one destination it resolved, so the link and the send cannot disagree. A send carries text and, beside it, a card whose strings hold links too, so both go through the same rule and either refuses the whole send. Only a string that names an artifact reference reaches the rule at all, so an ordinary message asks nothing of its destination. A rewritten card is checked against the card limits again, because a rewritten link can be longer than the one the agent wrote and Slack would cut or flatten the card without saying so.
 */
export async function linkOutboundArtifacts(
  payload: { text: string; card?: ChannelCard | undefined },
  link: LinkArtifactText,
): Promise<{ text: string; card?: ChannelCard } | { error: string }> {
  const text = hasArtifactReference(payload.text)
    ? await link(payload.text)
    : { text: payload.text };
  if ("error" in text) return text;
  if (!payload.card) return { text: text.text };
  const card = await mapStringsDeep(payload.card, link);
  if ("error" in card) return card;
  const issues = cardIssues(card.value.card);
  if (issues.length > 0)
    return {
      error: `The card was not sent: ${issues.join("; ")}. Nothing was posted — its artifact links grew when rewritten. Shorten the card, or send the message without them.`,
    };
  return { text: text.text, card: card.value };
}

async function mapStringsDeep<T>(
  value: T,
  link: LinkArtifactText,
): Promise<{ value: T } | { error: string }> {
  if (typeof value === "string") {
    if (!hasArtifactReference(value)) return { value };
    const linked = await link(value);
    return "error" in linked ? linked : { value: linked.text as T };
  }
  if (value === null || typeof value !== "object") return { value };
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  const mapped: [string, unknown][] = [];
  for (const [key, item] of entries) {
    const result = await mapStringsDeep(item, link);
    if ("error" in result) return result;
    mapped.push([key, result.value]);
  }
  return {
    value: (Array.isArray(value)
      ? mapped.map(([, item]) => item)
      : Object.fromEntries(mapped)) as T,
  };
}
