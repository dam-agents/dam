import { OUTBOUND_TOOL_PREFIX } from "../../../core/platform-mcp.js";

import type { SlackBlock, SlackMessage } from "./slack-gateway.js";

const PUBLIC_AGENT_PATH = "/a/";

const CHAT_PATH = "/chat/";

const LEGACY_AGENT_PATH = "/sandboxes/";

export interface AgentFooter {
  uiBaseUrl: string;
  agentId: string;
  label: string;
  sessionId?: string;
}

function escapeLinkLabel(name: string): string {
  return name
    .replace(/[|\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\s+/g, " ")
    .trim();
}

export function agentFooterLabel(
  brand: { name: string },
  agentName?: string,
): string {
  const poweredBy = `Powered by ${brand.name}`;
  const name = agentName?.trim();
  return name ? `${name} - ${poweredBy}` : poweredBy;
}

export function agentFooterMrkdwn(footer: AgentFooter): string {
  const label = escapeLinkLabel(footer.label);
  const session = footer.sessionId
    ? `?s=${encodeURIComponent(footer.sessionId)}`
    : "";
  return `<${footer.uiBaseUrl}${PUBLIC_AGENT_PATH}${footer.agentId}${session}|${label || footer.agentId}>`;
}

export function agentContextBlock(footer: AgentFooter): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: agentFooterMrkdwn(footer) }],
  };
}

const FOOTER_RE = new RegExp(
  `<[^>|]*(?:${PUBLIC_AGENT_PATH}|${CHAT_PATH}|${LEGACY_AGENT_PATH})(agent-[A-Za-z0-9]+)(?:[/?][^>|]*)?\\|[^>]*>`,
);

export function parseAgentFooter(
  message: SlackMessage,
): { agentId: string } | null {
  for (const block of message.blocks ?? []) {
    if ((block as { type?: unknown }).type !== "context") continue;
    const elements = (block as { elements?: Array<{ text?: unknown }> })
      .elements;
    for (const element of elements ?? []) {
      const text = element?.text;
      if (typeof text !== "string") continue;
      const match = text.match(FOOTER_RE);
      if (match) {
        return { agentId: match[1] };
      }
    }
  }
  return null;
}

const THREAD_MARKER_NOTE =
  "A line ending in a [thread: ...] tag opened a thread: the tag gives how " +
  "many replies it has, when it last moved, and the ts that reads it. Those " +
  "replies are not shown here — read them with " +
  `${OUTBOUND_TOOL_PREFIX}read_thread, passing that ts as threadTs, ` +
  "before treating the line as unanswered.";

export type HistoryShape = "thread" | "direct-message" | "channel";

export function historyPreamble(
  shape: HistoryShape,
  opts: { hasThreadMarker?: boolean } = {},
): string {
  if (shape === "thread") {
    return (
      "The conversation history below is the thread this turn was posted " +
      "into: one conversation, and the context for answering it. Answer " +
      "what follows the history, not the history itself."
    );
  }
  if (shape === "direct-message") {
    return (
      "The conversation history below is your earlier exchange with this " +
      "person: one conversation, and the context for answering what " +
      "follows. " +
      (opts.hasThreadMarker ? `${THREAD_MARKER_NOTE} ` : "") +
      "Answer what follows the history, not the history itself."
    );
  }
  return (
    "The conversation history below is this conversation's recent messages " +
    "as the channel itself shows them, not a single discussion: people " +
    "raise unrelated things outside threads, so several separate topics may " +
    "be interleaved here, and the time on each line is the cue for where " +
    "one ends and the next begins. " +
    (opts.hasThreadMarker ? `${THREAD_MARKER_NOTE} ` : "") +
    "It is background — it tells you what has been going on here. Answer " +
    "what follows the history, not the history itself, and leave an older " +
    "topic alone unless what follows asks about it."
  );
}

export function historyLegend(
  canLookupUsers: boolean,
  opts: { botLabel: string | null },
): string {
  const base =
    'In the conversation history below, a line prefixed "you (this agent):" is ' +
    'your own earlier post in this channel; "<name> (another agent):" is a ' +
    "different agent that posted here; everyone else is a human Slack user, " +
    "prefixed with their Slack id";
  const bot = opts.botLabel
    ? ` A line prefixed "${opts.botLabel}:" came from the bot but carries no ` +
      "footer, so it is not yours unless you recognise it as your own."
    : "";
  return canLookupUsers
    ? `${base} — call ${OUTBOUND_TOOL_PREFIX}describe_channel_users to find ` +
        `out who they are.${bot}`
    : `${base}.${bot}`;
}

export function catchUpLegend(
  canLookupUsers: boolean,
  opts: {
    botLabel: string | null;
    someOmitted?: boolean;
    hasThreadMarker?: boolean;
  },
): string {
  const omitted = opts.someOmitted
    ? "Some messages from this gap were left out, so this is not everything " +
      "you missed. "
    : "";
  return (
    "You were away. The messages below arrived while you were not reading " +
    "them, and each line carries the time it was sent. " +
    omitted +
    "Read them all, then act only on what is still open and still worth " +
    "acting on. A question someone else has since answered, or a " +
    "conversation that has moved on, needs nothing from you — staying silent " +
    "on it is the right outcome, not a failure. Don't repeat or contradict " +
    "what another agent already said. " +
    (opts.hasThreadMarker === true ? `${THREAD_MARKER_NOTE} ` : "") +
    historyLegend(canLookupUsers, opts)
  );
}

export function formatSlackTs(ts: string): string {
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return ts;
  const date = new Date(seconds * 1000);
  const [datePart, timePart] = date.toISOString().split("T");
  const weekday = date.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${weekday} ${datePart} ${timePart.slice(0, 5)} UTC`;
}

export function marksThread(message: SlackMessage): boolean {
  return (message.replyCount ?? 0) >= 1 && !!message.ts;
}

export function labelHistoryMessage(
  message: SlackMessage,
  author: { agentId: string; name: string } | null,
  readingAgentId: string,
  bot: { userId: string | null; label: string },
  opts: { showThreadMarkers: boolean },
): string {
  const label = author
    ? author.agentId === readingAgentId
      ? "you (this agent)"
      : `${author.name || author.agentId} (another agent)`
    : bot.userId && message.user === bot.userId
      ? bot.label
      : (message.user ?? "unknown");
  const when = message.ts ? ` [${formatSlackTs(message.ts)}]` : "";
  const edited = message.edited ? " (edited)" : "";
  const marker = opts.showThreadMarkers ? threadMarker(message) : "";
  return `${label}${when}: ${message.text ?? ""}${edited}${marker}`;
}

function threadMarker(message: SlackMessage): string {
  if (!marksThread(message)) return "";
  const replies = message.replyCount ?? 0;
  const plural = replies === 1 ? "reply" : "replies";
  const latest = message.latestReplyTs
    ? `, latest ${formatSlackTs(message.latestReplyTs)}`
    : "";
  return ` [thread: ${replies} ${plural}${latest}, ts ${message.ts}]`;
}
