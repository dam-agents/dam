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
    ? `${base} — call mcp__platform-outbound__describe_channel_users to find ` +
        `out who they are.${bot}`
    : `${base}.${bot}`;
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

export function labelHistoryMessage(
  message: SlackMessage,
  author: { agentId: string; name: string } | null,
  readingAgentId: string,
  bot: { userId: string | null; label: string },
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
  return `${label}${when}: ${message.text ?? ""}${edited}`;
}
