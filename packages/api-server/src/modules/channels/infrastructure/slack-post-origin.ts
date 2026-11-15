import { parseAgentFooter } from "./agent-footer.js";
import type { SlackMessage } from "./slack-gateway.js";

export interface SlackSelf {
  userId: string | null;
  botId: string | null;
  companionAppIds: ReadonlySet<string>;
}

export type SlackPostOrigin = "own" | "companion";

export interface SlackPostIdentity {
  user?: string;
  bot_id?: string;
  app_id?: string;
  bot_profile?: { app_id?: string };
  blocks?: unknown;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a Slack post is one whose Agent Footer may
 * be read. "own" is any post of this install's app, known by its bot user id or
 * its bot id; its footer, when it has one, names an Agent of this install.
 * "companion" is a bot post that carries an Agent Footer and comes from the app
 * of another install of the platform, which an operator lists by Slack app id:
 * an Agent of that install wrote it. Every other post gives null, and so does a
 * companion app's post without a footer, or one it sent for a person: any app
 * can post a link shaped like an
 * Agent Footer, so a footer on such a post names nobody. A new post and a post
 * read back from history are both decided here, so the two agree on who wrote
 * a post.
 */
export function slackPostOrigin(
  post: SlackPostIdentity,
  self: SlackSelf,
): SlackPostOrigin | null {
  const isOwn =
    (!!self.userId && post.user === self.userId) ||
    (!!self.botId && post.bot_id === self.botId);
  if (isOwn) return "own";
  const appId = post.app_id ?? post.bot_profile?.app_id;
  if (!post.bot_id || appId === undefined) return null;
  if (!self.companionAppIds.has(appId)) return null;
  const footed = parseAgentFooter({
    blocks: post.blocks as SlackMessage["blocks"],
  });
  return footed ? "companion" : null;
}
