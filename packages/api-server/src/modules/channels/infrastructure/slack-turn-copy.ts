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

export interface SlackTurnRoster {
  peers: { name: string; isDefault: boolean }[];
  selfIsDefault: boolean;
}

export function botHistoryLabel(brand: { name: string }): string {
  return `the ${brand.name} bot (unattributed)`;
}

function joinNames(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

function rosterSentences(
  roster: SlackTurnRoster,
  agentName: string | null,
): string {
  const defaultPeer = roster.peers.find((peer) => peer.isDefault);
  const bare = roster.selfIsDefault
    ? "A mention with no name after it reaches you — you are this " +
      "conversation's default agent, so unaddressed questions land with you."
    : defaultPeer
      ? `A mention with no name after it reaches "${defaultPeer.name}", this ` +
        "conversation's default agent — not you."
      : "A mention with no name after it reaches this conversation's default " +
        "agent.";
  const self = agentName ? `"${agentName}"` : "your own name";
  return (
    `You are not the only agent here: ${joinNames(roster.peers.map((p) => p.name))} ` +
    `${roster.peers.length === 1 ? "is" : "are"} also connected to this ` +
    "conversation. A mention that starts with an agent's name reaches that " +
    `agent, so a mention starting with ${self} reaches you. ${bare} When a ` +
    "message would be better answered by one of the others, hand it to them " +
    `with ${TOOL}hand_off_to_agent rather than answering outside what you know.`
  );
}

function identitySentences(
  identity: SlackBotIdentity,
  reach: SlackTurnReach,
  roster?: SlackTurnRoster,
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
      : "if its footer names you.") +
    (roster && roster.peers.length > 0
      ? ` ${rosterSentences(roster, agentName)}`
      : "")
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
  roster?: SlackTurnRoster;
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
    identitySentences(ctx.identity, ctx.reach, ctx.roster),
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
  forwardedFrom?: string;
  ambiguousName?: string | null;
}): string {
  const opening = ctx.forwardedFrom
    ? `"${ctx.forwardedFrom}", another agent connected to this conversation, ` +
      "handed this message to you because it judged you the better one to " +
      "answer it. Treat it as addressed to you."
    : ctx.isDirectMessage
      ? "This is a 1:1 direct message with you — every message here is " +
        "addressed to you."
      : "You were @-mentioned: this message is addressed to you" +
        (ctx.botUserId
          ? `, and the mention of ${ctx.botUserId} in it is you.`
          : ".");
  return [
    "<addressed-to-you>",
    opening,
    ...(ctx.ambiguousName
      ? [
          `The message opens with the name "${ctx.ambiguousName}", but more ` +
            "than one agent connected here answers to it, so it came to you " +
            "as this conversation's default agent. Say that plainly rather " +
            "than guessing which one was meant.",
        ]
      : []),
    ...(ctx.forwardedFrom
      ? [
          "This message was already handed on once, so you cannot hand it on " +
            "again — answer it, or say why you can't.",
        ]
      : []),
    `Answer it. Only call ${TOOL}no_reply_needed when it genuinely needs no ` +
      "response — one you have already handled, for instance.",
    "</addressed-to-you>",
  ].join("\n");
}

export function ambientGuidance(
  brand: { name: string; short: string },
  agentName: string | null,
  roster?: SlackTurnRoster,
  answeredAlready: string[] = [],
): string {
  const peers = roster?.peers ?? [];
  return [
    "<reading-along>",
    ...(peers.length > 0
      ? [
          `${joinNames(peers.map((p) => p.name))} ` +
            `${peers.length === 1 ? "is" : "are"} also connected to this ` +
            "channel and read along here too. Agents take these messages one " +
            "at a time, so you are seeing this after the ones before you " +
            "finished — but which of them came before you is not fixed, so " +
            "never reason about your position in the order. A message that " +
            "names one of them is addressed to them, not to you — stay " +
            "silent on it.",
        ]
      : []),
    ...(answeredAlready.length > 0
      ? [
          `${joinNames(answeredAlready)} already replied to this in the ` +
            "channel, before you. Read what they said before deciding: add " +
            "something only if you have something they did not cover, and " +
            "stay silent rather than repeating or contradicting them for the " +
            "sake of it.",
        ]
      : [
          ...(peers.length > 0
            ? [
                "Nobody before you has replied to this, so it is still " +
                  "unanswered — do not assume one of the others will take it.",
              ]
            : []),
        ]),
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
