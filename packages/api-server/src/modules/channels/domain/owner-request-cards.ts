export type SlackBlock = Record<string, unknown>;

export const OWNER_REQUEST_METADATA = "owner_request";
export const OWNER_REQUEST_ACTION_PREFIX = "owner-request:";
export const OWNER_REQUEST_OPEN_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}open`;
export const OWNER_REQUEST_RELEASE_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}release`;
export const OWNER_REQUEST_APPROVE_ONCE_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}approve-once`;
export const OWNER_REQUEST_DENY_ONCE_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}deny-once`;

export const MAX_CARD_ROWS = 10;
export const SUMMARY_MAX = 200;
export const ARGUMENTS_MAX = 2500;

export type OwnerCardKind = "turn" | "background" | "call";

export type OwnerAnswer = "approve-once" | "deny-once";

export function answerOfAction(actionId: string): OwnerAnswer | null {
  if (actionId === OWNER_REQUEST_APPROVE_ONCE_ACTION) return "approve-once";
  if (actionId === OWNER_REQUEST_DENY_ONCE_ACTION) return "deny-once";
  return null;
}

// UNIT_BOUNDARY_DESCRIPTION: what a card shows of one held request, built on the server from the approval row: its type, whether it still waits for the owner, the agent by its display name, the route, a one-line summary in the platform's words (method, host and path; the search; the tool and the Connection), the host its row groups under, and when it expires.
export interface OwnerRequestView {
  id: string;
  kind: string;
  status: "pending" | "resolved" | "expired";
  agentId: string;
  agentName: string;
  ownerSub: string;
  route: "turn" | "background" | null;
  summary: string;
  host: string | null;
  expiresAt: string;
  verdict: "allow_once" | "allow" | "deny_once" | "deny" | null;
  decidedBy: string | null;
  call: {
    tool: string;
    connectionName: string;
    targetLabel: string | null;
    arguments: string | null;
  } | null;
}

// UNIT_BOUNDARY_DESCRIPTION: a Slack thread a turn card holds requests from: where it is, who started the turn, the people whose messages the turn carried, the line the app posted there, and when its person pressed "Don't wait" or the line last said that the agent went on without the step.
export interface OwnerCardThread {
  channelId: string;
  threadTs: string;
  teamId: string;
  startedBy: string | null;
  startedByName: string | null;
  askers: string[];
  lineTs: string | null;
  releasedAt: string | null;
  wentOnAt: string | null;
}

export interface CardRow {
  view: OwnerRequestView;
  nobodyWaits: boolean;
}

export function cut(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

export function plainText(text: string) {
  return { type: "plain_text", text: text.length > 0 ? text : " " };
}

export function escapeMrkdwn(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function codeBlock(text: string, max: number): string {
  return `\`\`\`${cut(text, max).replaceAll("`", "ˋ")}\`\`\``;
}

function slackDate(iso: string): string {
  const seconds = Math.floor(new Date(iso).getTime() / 1000);
  return `<!date^${seconds}^{time}|${new Date(iso).toISOString().slice(11, 16)} UTC>`;
}

function openInAppButton(appUrl: string) {
  return {
    type: "button",
    action_id: OWNER_REQUEST_OPEN_ACTION,
    text: plainText("Open in app"),
    url: appUrl,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the fallback row of a request whose type has no renderer of its own yet: its one-line summary as plain text, when it expires, the note when nobody waits for it any more, and "Open in app".
export function fallbackRow(row: CardRow, appUrl: string): SlackBlock[] {
  return [
    { type: "section", text: plainText(cut(row.view.summary, SUMMARY_MAX)) },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: row.nobodyWaits
            ? "Nobody waits for this now. Your answer counts for the next try."
            : `Answer by ${slackDate(row.view.expiresAt)}`,
        },
      ],
    },
    { type: "actions", elements: [openInAppButton(appUrl)] },
  ];
}

// UNIT_BOUNDARY_DESCRIPTION: the outcome line of a settled request, in the owner's words: what the answer was and who gave it, or that the request expired, or that the card could not reach the owner.
export function outcomeLine(view: OwnerRequestView): string {
  if (view.status === "expired") return "Expired: the call was refused";
  if (view.decidedBy === "system:owner-unreachable")
    return "Refused: the card could not reach you";
  const who = view.decidedBy === view.ownerSub ? "by you" : "in the app";
  const answer = {
    allow_once: "Allowed once",
    allow: "Always allowed",
    deny_once: "Denied",
    deny: "Always denied",
  }[view.verdict ?? "deny_once"];
  return `${answer} ${who}`;
}

function answerButtons(view: OwnerRequestView) {
  const value = JSON.stringify({ request: view.id });
  return [
    {
      type: "button",
      action_id: OWNER_REQUEST_APPROVE_ONCE_ACTION,
      text: plainText("Approve once"),
      style: "primary",
      value,
    },
    {
      type: "button",
      action_id: OWNER_REQUEST_DENY_ONCE_ACTION,
      text: plainText("Deny once"),
      style: "danger",
      value,
    },
  ];
}

function callTitle(view: OwnerRequestView): string {
  return view.call
    ? `${view.agentName} wants to call ${view.call.tool} on ${view.call.connectionName}`
    : cut(view.summary, SUMMARY_MAX);
}

// UNIT_BOUNDARY_DESCRIPTION: the row of a held MCP tool call: the agent, the tool and the Connection, the target the Template named, the arguments as a code block cut at about 2,500 characters with "Open in app" when cut, the expiry, and Approve once and Deny once. Every part the agent wrote shows as plain text or inside the code block, never as Slack markup.
export function callRow(row: CardRow, appUrl: string): SlackBlock[] {
  const { view } = row;
  const call = view.call;
  const args = call?.arguments ?? null;
  const argsCut = args !== null && [...args].length > ARGUMENTS_MAX;
  return [
    { type: "section", text: plainText(cut(callTitle(view), 300)) },
    ...(call?.targetLabel
      ? [
          {
            type: "context",
            elements: [plainText(`To: ${cut(call.targetLabel, 200)}`)],
          },
        ]
      : []),
    ...(args !== null
      ? [
          {
            type: "section",
            text: { type: "mrkdwn", text: codeBlock(args, ARGUMENTS_MAX) },
          },
        ]
      : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: row.nobodyWaits
            ? "Nobody waits for this now. Your answer counts for the next try."
            : `Answer by ${slackDate(view.expiresAt)}${argsCut ? ". The arguments are cut: open the request in the app to read them all." : ""}`,
        },
      ],
    },
    {
      type: "actions",
      elements: [...answerButtons(view), openInAppButton(appUrl)],
    },
  ];
}

function settledRow(row: CardRow): SlackBlock[] {
  return [
    {
      type: "section",
      text: plainText(cut(callTitle(row.view), SUMMARY_MAX)),
    },
    {
      type: "context",
      elements: [plainText(outcomeLine(row.view))],
    },
  ];
}

function rowBlocks(row: CardRow, appUrl: string): SlackBlock[] {
  if (row.view.status !== "pending") return settledRow(row);
  return row.view.kind === "mcp_tool_call"
    ? callRow(row, appUrl)
    : fallbackRow(row, appUrl);
}

function threadContext(threads: readonly OwnerCardThread[]): SlackBlock[] {
  if (threads.length === 0) return [];
  const named = threads.map((thread) => {
    const link = `<https://slack.com/app_redirect?channel=${thread.channelId}&message_ts=${thread.threadTs}|a thread>`;
    return thread.startedBy
      ? `${link} started by <@${thread.startedBy}>`
      : link;
  });
  return [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Asked in ${named.join(", ")}. The card cannot tell which thread sent which request.`,
        },
      ],
    },
  ];
}

function rowsOf(rows: readonly CardRow[], appUrl: string): SlackBlock[] {
  const rank = (row: CardRow) =>
    row.view.status !== "pending" ? 2 : row.nobodyWaits ? 1 : 0;
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b));
  const shown = ordered.slice(0, MAX_CARD_ROWS);
  const more = ordered.length - shown.length;
  return [
    ...shown.flatMap((row) => [{ type: "divider" }, ...rowBlocks(row, appUrl)]),
    ...(more > 0
      ? [
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: `<${appUrl}|${more} more: Open in app>` },
            ],
          },
        ]
      : []),
  ];
}

function requestCount(n: number): string {
  return n === 1 ? "1 request" : `${n} requests`;
}

// UNIT_BOUNDARY_DESCRIPTION: a card in the owner's DM, as text and blocks: the turn card holds the requests of the agent's addressed Slack turns and names each thread with the person who started it; the background card holds the agent's other requests. Rows that still wait come first, at most ten, then a count with "Open in app". Agent-written text never appears as Slack markup.
export function ownerCard(input: {
  kind: OwnerCardKind;
  agentName: string;
  threads: readonly OwnerCardThread[];
  rows: readonly CardRow[];
  appUrl: string;
}): { text: string; blocks: SlackBlock[] } {
  const waiting = input.rows.filter((row) => row.view.status === "pending");
  if (input.kind === "call") {
    const [row] = input.rows;
    const text = row ? callTitle(row.view) : `${input.agentName} wants a call`;
    return {
      text,
      blocks: row ? rowBlocks(row, input.appUrl) : [],
    };
  }
  const header =
    input.kind === "turn"
      ? `${input.agentName} waits in Slack: ${requestCount(waiting.length)}`
      : `${input.agentName} needs you: ${requestCount(waiting.length)}`;
  return {
    text: header,
    blocks: [
      { type: "header", text: plainText(cut(header, 150)) },
      ...(input.kind === "turn" ? threadContext(input.threads) : []),
      ...rowsOf(input.rows, input.appUrl),
    ],
  };
}

export type ThreadLineState =
  { kind: "asked" } | { kind: "went-on"; until: string } | { kind: "ended" };

// UNIT_BOUNDARY_DESCRIPTION: the visible line the app posts in a thread whose turn waits on its owner. While a request waits it says that the agent asked its owner and offers "Don't wait"; when nobody waits any more but a request is still pending it says that the agent went on without the step and until when the owner can approve it; when every request settled it says that the wait ended. It never gives a wait time, names no host, path or command, and names the owner without a mention, so the owner gets no second notice.
export function threadLine(input: {
  agentName: string;
  ownerName: string;
  state: ThreadLineState;
  release: { teamId: string; channelId: string; threadTs: string };
}): { text: string; blocks: SlackBlock[] } {
  const agent = escapeMrkdwn(input.agentName);
  const owner = escapeMrkdwn(input.ownerName);
  if (input.state.kind === "asked") {
    const text = `${input.agentName} asked its owner, ${input.ownerName}, to approve a step.`;
    return {
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${agent} asked its owner, ${owner}, to approve a step.`,
          },
          accessory: {
            type: "button",
            action_id: OWNER_REQUEST_RELEASE_ACTION,
            text: plainText("Don't wait"),
            value: JSON.stringify(input.release),
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "The person who asked can go on without the step.",
            },
          ],
        },
      ],
    };
  }
  if (input.state.kind === "went-on") {
    const text = `${input.agentName} went on without the step. ${input.ownerName} can still approve it.`;
    return {
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${agent} went on without the step. ${owner} can still approve it until ${slackDate(input.state.until)}.`,
          },
        },
      ],
    };
  }
  return {
    text: "The wait ended.",
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "The wait ended." } },
    ],
  };
}

export function cardMetadata(cardId: string) {
  return { eventType: OWNER_REQUEST_METADATA, payload: { card: cardId } };
}
