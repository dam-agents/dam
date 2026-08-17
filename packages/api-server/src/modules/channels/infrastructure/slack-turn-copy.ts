import { channelNetworkAccessGuidance } from "./network-access-copy.js";
import { formatSlackTs } from "./agent-footer.js";

const TOOL = "mcp__platform-outbound__";

export interface SlackBotIdentity {
  brand: { name: string; short: string };
  botUserId: string | null;
  agentName: string | null;
}

export interface SlackTurnReach {
  isDirectMessage: boolean;
  ambient: boolean;
}

export function botHistoryLabel(brand: { name: string }): string {
  return `the ${brand.name} bot (unattributed)`;
}

function identitySentences(
  identity: SlackBotIdentity,
  reach: SlackTurnReach,
): string {
  const { brand, botUserId, agentName } = identity;
  const tagged = botUserId ? ` (${botUserId} in the text)` : "";
  const untaggedNameReaches = reach.ambient || reach.isDirectMessage;
  const forms = [`by tagging the bot${tagged}`];
  if (untaggedNameReaches) forms.push(`by typing "${brand.short}" with no tag`);
  forms.push(
    agentName
      ? `by the name your posts here are signed with, "${agentName}", or by ` +
          "any other name you know yourself by"
      : "by the name your posts are signed with, the one you know yourself by",
  );
  const list = `${forms.slice(0, -1).join(", ")}, or ${forms.at(-1)}`;
  const reachNote = untaggedNameReaches
    ? ""
    : " In this channel only a tag reaches you — a message that just types " +
      "a name is never delivered, so there is nothing for you to miss.";
  return (
    `You appear in this Slack workspace as the bot "${brand.name}" ` +
    `(mentioned as @${brand.short}` +
    (botUserId ? `, Slack user id ${botUserId}` : "") +
    `). People address you ${forms.length === 3 ? "three" : "two"} ways, all ` +
    `equivalent: ${list}.${reachNote} Authorship runs the other way: every ` +
    "agent here posts through this one bot, so a post from it is yours only " +
    (agentName
      ? `if its footer reads "${agentName}".`
      : "if its footer names you.")
  );
}

export function slackTurnContract(ctx: {
  replyThreadTs: string;
  eventTs: string;
  canLookupUsers: boolean;
  batch?: { count: number; inThread: boolean };
  permalink: string | null;
  identity: SlackBotIdentity;
  reach: SlackTurnReach;
}): string {
  const batchCount = ctx.batch?.count ?? 1;
  const multi = batchCount > 1;
  const where = ctx.reach.isDirectMessage
    ? "a 1:1 direct message"
    : "a shared channel or group DM";
  const replyBullet =
    multi && ctx.batch?.inThread === false
      ? `• ${TOOL}reply — post a message threaded under the batched message ` +
        "you are answering: pass its [ts …] tag as threadTs (several messages " +
        "share this turn, so an id-less reply is refused). Pass " +
        "alsoSendToChannel when that message is old enough that people " +
        "watching the channel would miss a thread-only reply."
      : `• ${TOOL}reply — post a message into this thread ` +
        `(threadTs="${ctx.replyThreadTs}"). Pass alsoSendToChannel when this ` +
        "thread is old enough that people watching the channel would miss a " +
        "thread-only reply.";
  const reactIds = multi
    ? "messageTs = the [ts …] tag of the message you are reacting to"
    : `messageTs="${ctx.eventTs}"`;
  return [
    "<how-to-respond>",
    identitySentences(ctx.identity, ctx.reach),
    "Nothing you write as plain text is delivered to Slack — only tool " +
      "calls reach the channel. To respond, call one of:",
    replyBullet,
    `• ${TOOL}react — add a fitting emoji reaction to the message you're ` +
      "answering: a quiet acknowledgement that notifies no one — pick an " +
      "emoji that suits the message (e.g. eyes on a bug report, tada on good " +
      `news) (${reactIds}). Pass the Slack emoji short name, no colons.`,
    `• ${TOOL}no_reply_needed — end your turn without posting anything, when ` +
      "the message doesn't call for a response.",
    ...(ctx.canLookupUsers
      ? [
          "People appear here as bare Slack ids like U024BE7LH, in speaker " +
            `labels and inside message text — call ${TOOL}describe_channel_users ` +
            'with channel="slack" to learn who they are before naming someone, ' +
            "attributing work, or reasoning about their local time.",
        ]
      : []),
    multi
      ? `You're reading ${batchCount} messages from ${where}. Each [ts …] tag ` +
        "above is that message's own send time, in seconds since the Unix epoch."
      : `You're answering a message sent ${formatSlackTs(ctx.eventTs)}, in ${where}` +
        (ctx.permalink ? ` (permalink: ${ctx.permalink})` : "") +
        ".",
    "These instructions apply to the message they arrive with, not to this " +
      "conversation as a whole — a later message carries its own. A message " +
      "that arrives with no such block didn't come from Slack: answer it " +
      "where it arrived, in plain text, and post to Slack for it only if " +
      "you're asked to.",
    "If a tool is deferred, load it via ToolSearch first.",
    "</how-to-respond>",
    channelNetworkAccessGuidance(ctx.identity.brand.name),
  ].join("\n");
}

export function addressedGuidance(ctx: {
  isDirectMessage: boolean;
  botUserId: string | null;
}): string {
  return [
    "<addressed-to-you>",
    ctx.isDirectMessage
      ? "This is a 1:1 direct message with you — every message here is " +
        "addressed to you."
      : "You were @-mentioned: this message is addressed to you" +
        (ctx.botUserId
          ? `, and the mention of ${ctx.botUserId} in it is you.`
          : "."),
    `Answer it. Only call ${TOOL}no_reply_needed when it genuinely needs no ` +
      "response — one you have already handled, for instance.",
    "</addressed-to-you>",
  ].join("\n");
}

export function ambientGuidance(
  brand: { name: string; short: string },
  agentName: string | null,
): string {
  return [
    "<reading-along>",
    "You are reading along in a shared Slack channel; the following " +
      "message(s) were not @-mentions. A message that calls you by name — " +
      `"${brand.name}", "${brand.short}", ` +
      (agentName ? `"${agentName}", ` : "") +
      "or the name you know yourself by — " +
      "is addressed to you: answer it as you would a mention. People often " +
      "drop the @ and just type the name. Otherwise chime in only when " +
      "you can clearly help — answer a question you know the answer to, pick " +
      "up a task someone described, or flag a clear mistake. If in doubt, " +
      `stay silent by calling ${TOOL}no_reply_needed.`,
    "When a message is worth engaging with, open with a fitting emoji " +
      "reaction before you do anything else — it notifies no one and is a " +
      "quiet signal that you have picked it up. Choose an emoji that suits " +
      "the message rather than a rote one, and let the reaction stand alone " +
      "as your whole response when a full reply isn't warranted. Don't react " +
      "to messages you would otherwise stay silent on.",
    "</reading-along>",
  ].join("\n");
}
