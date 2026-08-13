import type { SlackBlock, SlackMessage } from "./slack-gateway.js";

const CHAT_PATH = "/chat/";

const LEGACY_AGENT_PATH = "/sandboxes/";

export interface AgentFooter {
  uiBaseUrl: string;
  agentId: string;
  agentName: string;
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

function unescapeLinkLabel(label: string): string {
  return label
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

export function agentFooterMrkdwn(footer: AgentFooter): string {
  const label = escapeLinkLabel(footer.agentName || footer.agentId);
  const session = footer.sessionId
    ? `/${encodeURIComponent(footer.sessionId)}`
    : "";
  return `<${footer.uiBaseUrl}${CHAT_PATH}${footer.agentId}${session}|${label || footer.agentId}>`;
}

export function agentContextBlock(footer: AgentFooter): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: agentFooterMrkdwn(footer) }],
  };
}

const FOOTER_RE = new RegExp(
  `<[^>|]*(?:${CHAT_PATH}|${LEGACY_AGENT_PATH})(agent-[A-Za-z0-9]+)(?:/[^>|]*)?\\|([^>]*)>`,
);

export function parseAgentFooter(
  message: SlackMessage,
): { agentId: string; agentName: string } | null {
  for (const block of message.blocks ?? []) {
    if ((block as { type?: unknown }).type !== "context") continue;
    const elements = (block as { elements?: Array<{ text?: unknown }> })
      .elements;
    for (const element of elements ?? []) {
      const text = element?.text;
      if (typeof text !== "string") continue;
      const match = text.match(FOOTER_RE);
      if (match) {
        return { agentId: match[1], agentName: unescapeLinkLabel(match[2]) };
      }
    }
  }
  return null;
}

export function historyLegend(canLookupUsers: boolean): string {
  const base =
    'In the conversation history below, a line prefixed "you (this agent):" is ' +
    'your own earlier post in this channel; "<name> (another agent):" is a ' +
    "different agent that posted here; everyone else is a human Slack user, " +
    "prefixed with their Slack id";
  return canLookupUsers
    ? `${base} — call describe_channel_users to find out who they are.`
    : `${base}.`;
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
  footer: { agentId: string; agentName: string } | null,
  readingAgentId: string,
): string {
  const label = footer
    ? footer.agentId === readingAgentId
      ? "you (this agent)"
      : `${footer.agentName || footer.agentId} (another agent)`
    : (message.user ?? "unknown");
  const when = message.ts ? ` [${formatSlackTs(message.ts)}]` : "";
  const edited = message.edited ? " (edited)" : "";
  return `${label}${when}: ${message.text ?? ""}${edited}`;
}
