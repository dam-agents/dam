import { footerMarksAmbientRound, parseAgentFooter } from "./agent-footer.js";
import type { SlackMessage } from "./slack-gateway.js";
import {
  slackPostOrigin,
  type SlackPostIdentity,
  type SlackSelf,
} from "./slack-post-origin.js";

export type { SlackSelf } from "./slack-post-origin.js";

export type SlackSender =
  | { kind: "person"; user: string }
  | { kind: "agent"; agentId: string; ambientRound: boolean }
  | { kind: "companion"; botId: string; name: string }
  | { kind: "app"; botId: string; name: string };

export interface SlackInboundPost extends SlackPostIdentity {
  subtype?: string;
  username?: string;
  bot_profile?: { name?: string; app_id?: string };
  blocks?: unknown;
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
 * names which Agent it was; it also marks a reply made in an ambient round.
 * A companion is a post with an Agent Footer from a companion app: an Agent of
 * another install wrote it. Its footer names an Agent id of that install, which
 * means nothing here, so the sender carries only the name Slack shows. Its
 * ambient mark is not read, because the readers here were not in that round.
 * Any other bot or incoming webhook is an app, and so is a companion app's
 * post without a footer. This
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
  const origin = slackPostOrigin(post, self);
  const message = { blocks: post.blocks as SlackMessage["blocks"] };
  if (origin === "own") {
    const footer = parseAgentFooter(message);
    if (!footer) return null;
    return {
      kind: "agent",
      agentId: footer.agentId,
      ambientRound: footerMarksAmbientRound(message),
    };
  }
  if (isBotPost) {
    if (!post.bot_id || (!self.userId && !self.botId)) return null;
    const app = {
      botId: post.bot_id,
      name: post.username ?? post.bot_profile?.name ?? "",
    };
    return origin === "companion"
      ? { kind: "companion", ...app }
      : { kind: "app", ...app };
  }
  return post.user ? { kind: "person", user: post.user } : null;
}
