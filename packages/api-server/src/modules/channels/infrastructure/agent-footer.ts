import type { SlackBlock, SlackMessage } from "./slack-gateway.js";

/** The UI route that deep-links to an agent's chat, optionally at one session.
 *  The agent id rides in this path so the footer doubles as a machine-readable
 *  author marker: humans click the name, the api-server parses the id back out
 *  of injected history. Keep in step with the UI router
 *  (`/chat/:agent/:session?`). */
const CHAT_PATH = "/chat/";

/** Footers minted before the link carried a session pointed at the agent's
 *  configuration page. Those messages still sit in channel history, so the
 *  author parse below has to recognize the older shape too. */
const LEGACY_AGENT_PATH = "/sandboxes/";

/** Agent identity needed to render (and later recover) an attribution footer. */
export interface AgentFooter {
  uiBaseUrl: string;
  agentId: string;
  /** Human-readable agent name; falls back to the id when unset. */
  agentName: string;
  /** The session this message belongs to, when the post is part of a turn: the
   *  link then opens that conversation in the UI rather than the agent's chat
   *  at large. Absent on proactive posts, which belong to no turn. */
  sessionId?: string;
}

/** Slack mrkdwn escapes: `&`, `<`, `>` are the only chars special in link text.
 *  A `|` would prematurely end the URL portion of `<url|label>`, so it is
 *  dropped along with newlines rather than escaped. */
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

/** The footer mrkdwn: the agent's name rendered as a link into the UI, with the
 *  stable, unique agent id carried in the URL. A turn's reply links to the
 *  session it was written in, so following it continues the same conversation in
 *  the UI; without a session the link opens the agent's chat. */
export function agentFooterMrkdwn(footer: AgentFooter): string {
  const label = escapeLinkLabel(footer.agentName || footer.agentId);
  const session = footer.sessionId
    ? `/${encodeURIComponent(footer.sessionId)}`
    : "";
  return `<${footer.uiBaseUrl}${CHAT_PATH}${footer.agentId}${session}|${label || footer.agentId}>`;
}

/** The Slack `context` block crediting the responding agent — the visible
 *  footer under every message the agent posts. */
export function agentContextBlock(footer: AgentFooter): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: agentFooterMrkdwn(footer) }],
  };
}

// `<…/chat/<id>[/<session>]|<label>>` — the id is anchored to the path so a
// name containing "/chat/" can't be mistaken for it (labels sit after the `|`),
// and the trailing segment is optional so both a turn's session link and a
// bare agent link parse. The legacy agent-page path is accepted alongside it.
const FOOTER_RE = new RegExp(
  `<[^>|]*(?:${CHAT_PATH}|${LEGACY_AGENT_PATH})(agent-[A-Za-z0-9]+)(?:/[^>|]*)?\\|([^>]*)>`,
);

/** Recover the authoring agent from a Slack message's footer block, or null if
 *  the message carries no agent footer (a human, or another app). This is the
 *  inverse of {@link agentContextBlock}: because one install-wide bot posts for
 *  every agent, the footer — not the Slack user id — is what distinguishes them. */
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

/** Legend that explains the attribution prefixes below, injected before thread
 *  history whenever that history contains agent-authored messages. Omits the
 *  describe_channel_users pointer when that tool isn't registered on this
 *  Agent's MCP session (the app's Slack scopes don't support a lookup). */
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

/** Render a Slack `ts` (seconds.microseconds since the epoch) as a human
 *  string, e.g. "Mon 2026-07-27 14:32 UTC" — Slack's history and mention
 *  payloads carry only the raw epoch, which an agent would otherwise have to
 *  parse by hand. Always UTC, never a message's sender's local time:
 *  resolving that would cost a directory lookup per message, and an agent
 *  that needs a specific person's local time can already get it via
 *  describe_channel_users. Falls back to the raw string on anything unparseable. */
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

/** Render one history message as a `label [timestamp]: text` line, resolving
 *  the author from its footer: the reading agent's own posts become "you
 *  (this agent)", other agents' posts name that agent, and everyone else
 *  keeps their Slack id. A trailing "(edited)" marks a message Slack reports
 *  as changed since it was first posted. */
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
