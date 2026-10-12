import { parseAgentFooter } from "./agent-footer.js";
import type { SlackMessage } from "./slack-gateway.js";

export type SlackSender =
  | { kind: "person"; user: string }
  | { kind: "agent"; agentId: string }
  | { kind: "app"; botId: string; name: string };

export interface SlackInboundPost {
  subtype?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  bot_profile?: { name?: string };
  blocks?: unknown;
}

export interface SlackSelf {
  userId: string | null;
  botId: string | null;
}

const ADMITTED_SUBTYPES = new Set<string | undefined>([
  undefined,
  "file_share",
  "bot_message",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Who wrote an inbound Slack post, or null when the
 * post must never start a turn. A person is a Slack user with no bot id. An
 * agent is a post by this app's own bot that carries an Agent Footer, because
 * every Agent posts through the one bot and the footer is the only place that
 * names which Agent it was. Any other bot or incoming webhook is an app. This
 * app's posts without a footer (platform notices, whisper roots), edits,
 * joins and other subtypes are dropped. While this app's own bot ids are not
 * known yet, every bot post is dropped, so an Agent's reply can never pass for
 * an app's post.
 */
export function classifySlackSender(
  post: SlackInboundPost,
  self: SlackSelf,
): SlackSender | null {
  if (!ADMITTED_SUBTYPES.has(post.subtype)) return null;
  const isBotPost = !!post.bot_id || post.subtype === "bot_message";
  const isOwnPost =
    (!!self.userId && post.user === self.userId) ||
    (!!self.botId && post.bot_id === self.botId);
  if (isOwnPost) {
    const footer = parseAgentFooter({
      blocks: post.blocks as SlackMessage["blocks"],
    });
    return footer ? { kind: "agent", agentId: footer.agentId } : null;
  }
  if (isBotPost) {
    if (!post.bot_id || (!self.userId && !self.botId)) return null;
    return {
      kind: "app",
      botId: post.bot_id,
      name: post.username ?? post.bot_profile?.name ?? "",
    };
  }
  return post.user ? { kind: "person", user: post.user } : null;
}
