import {
  renderSlackPostText,
  type SlackPostContent,
} from "./slack-post-text.js";
import {
  classifySlackSender,
  type SlackInboundPost,
  type SlackSelf,
  type SlackSender,
} from "./slack-sender.js";

export interface SlackChangedPost extends SlackInboundPost, SlackPostContent {
  ts?: string;
  thread_ts?: string;
}

export interface SlackMessageChanged {
  message?: SlackChangedPost;
  previous_message?: SlackPostContent;
}

export interface SlackEdit {
  sender: SlackSender;
  ts: string;
  threadTs?: string;
  text: string;
  mentionAdded: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a changed Slack post is an edit of its
 * text, and by whom. Slack reports a change for many things that are not an
 * edit — a link preview arriving, a pin, a reply count, a deleted post left as
 * a tombstone — so only a post whose rendered text differs from what it was
 * counts. The writer is read from the post as it is now, by the rule a new
 * post is read with, so an edit to a post that could never start a turn is
 * dropped too. A post that opened a thread names itself as its thread; that is
 * dropped, so a top-level post stays one. The edit also says whether it is
 * what first tagged the bot, since such a post was never sent to it as a
 * mention.
 */
export function classifySlackEdit(
  event: SlackMessageChanged,
  self: SlackSelf,
): SlackEdit | null {
  const { message, previous_message: previous } = event;
  if (!message?.ts || !previous) return null;
  const sender = classifySlackSender(message, self);
  if (!sender) return null;
  const text = renderSlackPostText(message);
  if (text === renderSlackPostText(previous)) return null;
  const tag = self.userId ? `<@${self.userId}>` : null;
  const inThread = message.thread_ts && message.thread_ts !== message.ts;
  return {
    sender,
    ts: message.ts,
    ...(inThread ? { threadTs: message.thread_ts } : {}),
    text,
    mentionAdded:
      tag !== null &&
      (message.text ?? "").includes(tag) &&
      !(previous.text ?? "").includes(tag),
  };
}
