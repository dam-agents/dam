export type SlackBlock = Record<string, unknown>;

export const OWNER_REQUEST_METADATA = "owner_request";
export const OWNER_REQUEST_ACTION_PREFIX = "owner-request:";
export const OWNER_REQUEST_OPEN_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}open`;
export const OWNER_REQUEST_RELEASE_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}release`;
export const OWNER_REQUEST_APPROVE_ONCE_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}approve-once`;
export const OWNER_REQUEST_DENY_ONCE_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}deny-once`;
export const OWNER_REQUEST_APPROVE_PATH_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}approve-path`;
export const OWNER_REQUEST_APPROVE_HOST_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}approve-host`;
export const OWNER_REQUEST_DENY_FOREVER_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}deny-forever`;
export const OWNER_REQUEST_DISMISS_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}dismiss`;

export const MAX_CARD_ROWS = 10;
export const SLACK_MAX_BLOCKS = 50;
export const SUMMARY_MAX = 200;
export const ARGUMENTS_MAX = 2500;
export const QUERY_MAX = 200;
export const HOST_ROW_PATHS = 5;
export const DISMISS_DAYS = 7;
export const MANY_HOSTS = 10;

export type OwnerCardKind = "turn" | "background" | "call" | "question";

export type OwnerAnswer =
  | "approve-once"
  | "deny-once"
  | "approve-path"
  | "approve-host"
  | "deny-forever"
  | "dismiss";

const ANSWER_OF_ACTION: Record<string, OwnerAnswer> = {
  [OWNER_REQUEST_APPROVE_ONCE_ACTION]: "approve-once",
  [OWNER_REQUEST_DENY_ONCE_ACTION]: "deny-once",
  [OWNER_REQUEST_APPROVE_PATH_ACTION]: "approve-path",
  [OWNER_REQUEST_APPROVE_HOST_ACTION]: "approve-host",
  [OWNER_REQUEST_DENY_FOREVER_ACTION]: "deny-forever",
  [OWNER_REQUEST_DISMISS_ACTION]: "dismiss",
};

export function answerOfAction(actionId: string): OwnerAnswer | null {
  return ANSWER_OF_ACTION[actionId] ?? null;
}

// UNIT_BOUNDARY_DESCRIPTION: the requests a card button answers, from its value: one request, or every request of a host row or of the turn card's "Allow all once" and "Deny all". Null for a value the platform did not write.
export function requestsOfValue(value: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { request, requests } = parsed as {
    request?: unknown;
    requests?: unknown;
  };
  if (typeof request === "string") return [request];
  if (
    Array.isArray(requests) &&
    requests.length > 0 &&
    requests.every((id) => typeof id === "string")
  )
    return requests as string[];
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
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  verdict: "allow_once" | "allow" | "deny_once" | "deny" | null;
  decidedBy: string | null;
  call: {
    tool: string;
    connectionName: string;
    targetLabel: string | null;
    arguments: string | null;
  } | null;
  network: {
    method: string;
    host: string;
    port: number | null;
    path: string;
    query: string | null;
  } | null;
  search: { query: string | null; followUps: number } | null;
  from: { kind: "environment"; name: string } | { kind: "sub-agent" } | null;
  refusedIn: "slack" | "telegram" | "artifact" | "unknown" | null;
  timesToday: number;
  restart: { path: boolean; host: boolean };
  cardAgentId: string;
  launch: {
    reason: string;
    driverName: string | null;
    wider: boolean;
    allowLabel: string;
    hostWideLabel: string | null;
    deadline: string | null;
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
  dismissed: boolean;
  answeredHere: boolean;
  deciderName: string | null;
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

// UNIT_BOUNDARY_DESCRIPTION: the outcome line of a settled request, in the owner's words: what the answer was and who gave it, "by you" for the owner's click on a card and "in the app by <name>" for any other answer; that the owner dismissed its host; that the request expired; or that the card could not reach the owner.
export function outcomeLine(
  row: Pick<CardRow, "view"> & Partial<Omit<CardRow, "view">>,
): string {
  const { view } = row;
  if (row.dismissed) return `Dismissed for ${DISMISS_DAYS} days`;
  if (view.status === "expired")
    return view.kind === "mcp_tool_call"
      ? "Expired: the call was refused"
      : view.kind === "web_search"
        ? "Expired: the search was refused"
        : "Expired: the request was refused";
  if (view.decidedBy === "system:owner-unreachable")
    return "Refused: the card could not reach you";
  const answer = {
    allow_once: "Allowed once",
    allow: "Always allowed",
    deny_once: "Denied",
    deny: "Always denied",
  }[view.verdict ?? "deny_once"];
  if (row.answeredHere) return `${answer} by you`;
  if (view.decidedBy?.startsWith("system:")) return `${answer} automatically`;
  const who =
    view.decidedBy === view.ownerSub ? "you" : (row.deciderName ?? "an editor");
  return `${answer} in the app by ${who}`;
}

export function rowWaits(view: OwnerRequestView): boolean {
  return view.status === "pending" && view.refusedIn === null;
}

// UNIT_BOUNDARY_DESCRIPTION: whether a row still offers a rule button: a network or web-search request that expired or that the gate refused at once, and that the owner neither answered nor dismissed.
export function rowOffersRule(row: CardRow): boolean {
  return (
    !row.dismissed &&
    row.view.status !== "resolved" &&
    (row.view.kind === "ext_authz" || row.view.kind === "web_search") &&
    !rowWaits(row.view)
  );
}

const REFUSED_IN: Record<NonNullable<OwnerRequestView["refusedIn"]>, string> = {
  slack: "Refused at once in a Slack channel",
  telegram: "Refused at once in a Telegram chat",
  artifact: "Refused at once in an artifact's viewer",
  unknown: "Refused at once in a chat",
};

const NOBODY_WAITS =
  "Nobody waits for this now. Your answer counts for the next try.";

function isWaiting(view: OwnerRequestView): boolean {
  return rowWaits(view);
}

export function isRuleKind(view: OwnerRequestView): boolean {
  return view.kind === "ext_authz" || view.kind === "web_search";
}

function confirmOf(input: {
  title: string;
  text: string;
  confirm: string;
  danger?: boolean;
}) {
  return {
    title: plainText(cut(input.title, 100)),
    text: plainText(cut(input.text, 300)),
    confirm: plainText(cut(input.confirm, 30)),
    deny: plainText("Cancel"),
    ...(input.danger ? { style: "danger" } : {}),
  };
}

function button(input: {
  label: string;
  actionId: string;
  requests: readonly string[];
  style?: "primary" | "danger";
  confirm?: ReturnType<typeof confirmOf>;
}) {
  return {
    type: "button",
    action_id: input.actionId,
    text: plainText(input.label),
    value: JSON.stringify({ requests: input.requests }),
    ...(input.style ? { style: input.style } : {}),
    ...(input.confirm ? { confirm: input.confirm } : {}),
  };
}

function hostLabel(network: NonNullable<OwnerRequestView["network"]>): string {
  return network.port && network.port !== 443
    ? `${network.host}:${String(network.port)}`
    : network.host;
}

function requestLine(view: OwnerRequestView): string {
  const { network } = view;
  if (network) {
    const host = hostLabel(network);
    return network.method === "*"
      ? `HTTPS to ${host}`
      : `${network.method} ${host}${network.path}`;
  }
  if (view.kind === "web_search") return "Web search";
  return callTitle(view);
}

function searchLine(view: OwnerRequestView): string {
  return `Web search: ${view.search?.query ?? "the model chooses the query"}`;
}

function fromLine(view: OwnerRequestView): string | null {
  if (!view.from) return null;
  return view.from.kind === "environment"
    ? `From its Environment ${view.from.name}`
    : `From its sub-agent ${view.agentName}`;
}

const RESTART_NOTE =
  "This restarts the agent's network access, so its outbound requests stop for a moment.";

function allowOnceButtons(requests: readonly string[]) {
  return [
    button({
      label: "Allow once",
      actionId: OWNER_REQUEST_APPROVE_ONCE_ACTION,
      requests,
      style: "primary",
    }),
    button({
      label: "Deny",
      actionId: OWNER_REQUEST_DENY_ONCE_ACTION,
      requests,
      style: "danger",
    }),
  ];
}

// UNIT_BOUNDARY_DESCRIPTION: the rule buttons of network requests to one host: "Always allow this path" when they share one real path, "Allow whole host", and "Always deny…", which writes the web's deny rule for each path; a rule that restarts the agent's network access, and every deny, asks Slack to confirm first. "Dismiss" comes last when the row may offer it.
function networkRuleButtons(input: {
  views: readonly OwnerRequestView[];
  dismiss: boolean;
}) {
  const ids = input.views.map((view) => view.id);
  const [first] = input.views;
  const network = first?.network;
  if (!first || !network) return [];
  const host = hostLabel(network);
  const paths = new Set(
    input.views.map(
      (view) =>
        `${view.network?.method} ${view.network?.path}${view.network?.query ?? ""}`,
    ),
  );
  const onePath = paths.size === 1 && network.path !== "*";
  const restartsPath = input.views.some((view) => view.restart.path);
  const target = onePath
    ? `${host}${network.path}${network.query ?? ""}`
    : network.path === "*" && paths.size === 1
      ? host
      : `these ${String(paths.size)} paths on ${host}`;
  return [
    ...(onePath
      ? [
          button({
            label: "Always allow this path",
            actionId: OWNER_REQUEST_APPROVE_PATH_ACTION,
            requests: ids,
            ...(first.restart.path
              ? {
                  confirm: confirmOf({
                    title: "Restart network access?",
                    text: `Every later request to ${target} goes through. ${RESTART_NOTE}`,
                    confirm: "Allow and restart",
                  }),
                }
              : {}),
          }),
        ]
      : []),
    button({
      label: "Allow whole host",
      actionId: OWNER_REQUEST_APPROVE_HOST_ACTION,
      requests: ids,
      ...(first.restart.host
        ? {
            confirm: confirmOf({
              title: "Restart network access?",
              text: `Every later request to ${host} goes through. ${RESTART_NOTE}`,
              confirm: "Allow and restart",
            }),
          }
        : {}),
    }),
    button({
      label: "Always deny…",
      actionId: OWNER_REQUEST_DENY_FOREVER_ACTION,
      requests: ids,
      confirm: confirmOf({
        title: "Always deny?",
        text: `Every later request to ${target} is refused at once, and you get no card for it.${restartsPath ? ` ${RESTART_NOTE}` : ""}`,
        confirm: restartsPath ? "Deny and restart" : "Always deny",
        danger: true,
      }),
    }),
    ...(input.dismiss ? [dismissButton(ids)] : []),
  ];
}

function searchRuleButtons(input: {
  views: readonly OwnerRequestView[];
  dismiss: boolean;
}) {
  const ids = input.views.map((view) => view.id);
  const agent = input.views[0]?.agentName ?? "the agent";
  return [
    button({
      label: "Always allow web search",
      actionId: OWNER_REQUEST_APPROVE_PATH_ACTION,
      requests: ids,
    }),
    button({
      label: "Always deny web search…",
      actionId: OWNER_REQUEST_DENY_FOREVER_ACTION,
      requests: ids,
      confirm: confirmOf({
        title: "Always deny web search?",
        text: `Every later web search of ${agent} is refused at once, and you get no card for it. Change it under Web search in the agent's network settings.`,
        confirm: "Always deny",
        danger: true,
      }),
    }),
    ...(input.dismiss ? [dismissButton(ids)] : []),
  ];
}

function dismissButton(requests: readonly string[]) {
  return button({
    label: "Dismiss",
    actionId: OWNER_REQUEST_DISMISS_ACTION,
    requests,
  });
}

function ruleButtons(input: {
  views: readonly OwnerRequestView[];
  dismiss: boolean;
}) {
  return input.views[0]?.kind === "web_search"
    ? searchRuleButtons(input)
    : networkRuleButtons(input);
}

function contextOf(lines: readonly string[]): SlackBlock[] {
  return infoContext(lines, null);
}

// UNIT_BOUNDARY_DESCRIPTION: a row's quiet lines as one context block, plain text first and the expiry or the nobody-waits note last, so a row costs few of the 50 blocks a Slack message holds.
function infoContext(
  lines: readonly string[],
  wait: string | null,
): SlackBlock[] {
  const elements = [
    ...lines.map((line) => plainText(line)),
    ...(wait ? [{ type: "mrkdwn", text: wait }] : []),
  ];
  return elements.length === 0
    ? []
    : [{ type: "context", elements: elements.slice(0, 10) }];
}

function waitText(rows: readonly CardRow[]): string {
  const waiting = rows.filter((row) => isWaiting(row.view));
  const until = waiting
    .map((row) => row.view.expiresAt)
    .sort()
    .at(-1);
  return waiting.every((row) => row.nobodyWaits) || !until
    ? NOBODY_WAITS
    : `Answer by ${slackDate(until)}`;
}

function followUpLine(view: OwnerRequestView): string {
  return `If you allow it, the search can also run up to ${String(view.search?.followUps ?? 0)} more queries that the model writes after it reads the first results.`;
}

// UNIT_BOUNDARY_DESCRIPTION: the row of one network request or web search on a turn card. While it waits: the request without its query string as the title, the query string or the search under it as plain text cut at about 200 characters, the sub-agent or Environment it came from, the expiry, and the web's verdicts for its type. A row whose request expired or was refused at once offers only the rule buttons.
export function networkRow(row: CardRow, appUrl: string): SlackBlock[] {
  const { view } = row;
  const search = view.kind === "web_search";
  const title = search ? searchLine(view) : requestLine(view);
  if (!isWaiting(view))
    return [
      { type: "section", text: plainText(cut(requestLine(view), SUMMARY_MAX)) },
      ...contextOf([
        view.refusedIn ? REFUSED_IN[view.refusedIn] : outcomeLine(row),
      ]),
      {
        type: "actions",
        elements: [
          ...ruleButtons({ views: [view], dismiss: true }),
          openInAppButton(appUrl),
        ],
      },
    ];
  const query = search ? null : view.network?.query;
  const from = fromLine(view);
  return [
    { type: "section", text: plainText(cut(title, 300)) },
    ...infoContext(
      [
        ...(query ? [`Query: ${cut(query, QUERY_MAX)}`] : []),
        ...(search ? [followUpLine(view)] : []),
        ...(from ? [from] : []),
      ],
      waitText([row]),
    ),
    {
      type: "actions",
      elements: [
        ...allowOnceButtons([view.id]),
        ...ruleButtons({ views: [view], dismiss: false }),
        openInAppButton(appUrl),
      ],
    },
  ];
}

function pathLine(view: OwnerRequestView): string {
  const network = view.network;
  if (!network) return view.search?.query ?? "the model chooses the query";
  const path = `${network.method === "*" ? "" : `${network.method} `}${network.path}`;
  return isWaiting(view) && network.query
    ? `${path}${cut(network.query, QUERY_MAX)}`
    : path;
}

// UNIT_BOUNDARY_DESCRIPTION: the row of every network request to one host, or every web search, on a background card: "Blocked on <host>", its paths with their query strings while they wait (up to five, then how many more), how many times the agent was blocked there today, the sub-agent or Environment, and the expiry of the newest waiting request. While a request waits it offers Allow once and Deny for every waiting request of the host; it always offers the rule buttons and "Dismiss" until every request settled. A row whose requests the gate refused at once says so and where, and offers no Allow once.
export function hostRow(
  rows: readonly CardRow[],
  appUrl: string,
): SlackBlock[] {
  const views = rows.map((row) => row.view);
  const [first] = views;
  if (!first) return [];
  const search = first.kind === "web_search";
  const title = search
    ? `Web search blocked`
    : `Blocked on ${first.network ? hostLabel(first.network) : (first.host ?? "a host")}`;
  const open = rows.filter(
    (row) => row.view.status !== "resolved" && !row.dismissed,
  );
  if (open.length === 0) {
    const last = rows.at(-1)!;
    return [
      { type: "section", text: plainText(cut(title, SUMMARY_MAX)) },
      ...contextOf([outcomeLine(last)]),
    ];
  }
  const waiting = open.filter((row) => isWaiting(row.view));
  const paths = [
    ...new Set(
      (search ? open.filter((row) => isWaiting(row.view)) : open).map((row) =>
        pathLine(row.view),
      ),
    ),
  ];
  const shown = paths.slice(0, HOST_ROW_PATHS);
  const more = paths.length - shown.length;
  const refused = open.find((row) => row.view.refusedIn !== null)?.view
    .refusedIn;
  const from = fromLine(first);
  const timesToday = Math.max(...views.map((view) => view.timesToday));
  const listed =
    shown.length > 0 && !(paths.length === 1 && paths[0] === "*")
      ? [...shown, ...(more > 0 ? [`and ${String(more)} more`] : [])]
      : [];
  return [
    {
      type: "section",
      text: plainText(
        cut([cut(title, SUMMARY_MAX), ...listed].join("\n"), 2900),
      ),
    },
    ...infoContext(
      [
        `${String(timesToday)} ${timesToday === 1 ? "time" : "times"} today`,
        ...(search && waiting.length > 0 ? [followUpLine(first)] : []),
        ...(from ? [from] : []),
        ...(waiting.length === 0
          ? [refused ? REFUSED_IN[refused] : outcomeLine(open.at(-1)!)]
          : []),
      ],
      waiting.length > 0 ? waitText(waiting) : null,
    ),
    {
      type: "actions",
      elements: [
        ...(waiting.length > 0
          ? allowOnceButtons(waiting.map((row) => row.view.id))
          : []),
        ...ruleButtons({
          views: open.map((row) => row.view),
          dismiss: true,
        }),
        openInAppButton(appUrl),
      ],
    },
  ];
}

function answerButtons(view: OwnerRequestView) {
  return allowOnceButtons([view.id]);
}

function callTitle(view: OwnerRequestView): string {
  return view.call
    ? `${view.agentName} wants to call ${view.call.tool} on ${view.call.connectionName}`
    : cut(view.summary, SUMMARY_MAX);
}

// UNIT_BOUNDARY_DESCRIPTION: the row of a held MCP tool call: the agent, the tool and the Connection, the target the Template named, the arguments as a code block cut at about 2,500 characters with "Open in app" when cut, the expiry, and Allow once and Deny. Every part the agent wrote shows as plain text or inside the code block, never as Slack markup.
export function callRow(
  row: CardRow,
  appUrl: string,
  argumentsMax = ARGUMENTS_MAX,
): SlackBlock[] {
  const { view } = row;
  const call = view.call;
  const args = call?.arguments ?? null;
  const argsCut = args !== null && [...args].length > argumentsMax;
  return [
    { type: "section", text: plainText(cut(callTitle(view), 300)) },
    ...(args !== null
      ? [
          {
            type: "section",
            text: { type: "mrkdwn", text: codeBlock(args, argumentsMax) },
          },
        ]
      : []),
    ...infoContext(
      call?.targetLabel ? [`To: ${cut(call.targetLabel, 200)}`] : [],
      row.nobodyWaits
        ? NOBODY_WAITS
        : `Answer by ${slackDate(view.expiresAt)}${argsCut ? ". The arguments are cut: open the request in the app to read them all." : ""}`,
    ),
    {
      type: "actions",
      elements: [...answerButtons(view), openInAppButton(appUrl)],
    },
  ];
}

// UNIT_BOUNDARY_DESCRIPTION: the row of a network rule a Driver set at a one-off sub-agent's launch, which holds the sub-agent's task until the owner answers: the rule in the platform's words, whether it is wider than the Driver's own rules, until when the sub-agent waits, and the web's verdicts for it. Letting the Driver widen every later launch on its own stays in the app.
export function launchRow(row: CardRow, appUrl: string): SlackBlock[] {
  const { view } = row;
  const launch = view.launch;
  if (!launch) return fallbackRow(row, appUrl);
  const ids = [view.id];
  const restartConfirm = confirmOf({
    title: "Restart network access?",
    text: `The sub-agent's network access restarts to apply the rule, so its outbound requests stop for a moment.`,
    confirm: "Allow and restart",
  });
  return [
    { type: "section", text: plainText(cut(launch.reason, 600)) },
    ...infoContext(
      launch.wider && launch.driverName
        ? [`This is wider than ${launch.driverName}'s own network rules.`]
        : [],
      launch.deadline
        ? `The sub-agent waits until ${slackDate(launch.deadline)}, then stops.`
        : `Answer by ${slackDate(view.expiresAt)}`,
    ),
    {
      type: "actions",
      elements: [
        button({
          label: launch.allowLabel,
          actionId: OWNER_REQUEST_APPROVE_PATH_ACTION,
          requests: ids,
          style: "primary",
          ...(view.restart.path ? { confirm: restartConfirm } : {}),
        }),
        ...(launch.hostWideLabel
          ? [
              button({
                label: launch.hostWideLabel,
                actionId: OWNER_REQUEST_APPROVE_HOST_ACTION,
                requests: ids,
                ...(view.restart.host ? { confirm: restartConfirm } : {}),
              }),
            ]
          : []),
        button({
          label: "Decline",
          actionId: OWNER_REQUEST_DENY_ONCE_ACTION,
          requests: ids,
          style: "danger",
        }),
        openInAppButton(appUrl),
      ],
    },
  ];
}

function settledRow(row: CardRow): SlackBlock[] {
  return [
    {
      type: "section",
      text: plainText(cut(requestLine(row.view), SUMMARY_MAX)),
    },
    {
      type: "context",
      elements: [plainText(outcomeLine(row))],
    },
  ];
}

export function rowBlocks(
  row: CardRow,
  appUrl: string,
  argumentsMax = ARGUMENTS_MAX,
): SlackBlock[] {
  if (row.dismissed || row.view.status === "resolved") return settledRow(row);
  if (isRuleKind(row.view)) return networkRow(row, appUrl);
  if (row.view.status !== "pending") return settledRow(row);
  if (row.view.launch) return launchRow(row, appUrl);
  return row.view.kind === "mcp_tool_call"
    ? callRow(row, appUrl, argumentsMax)
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

type CardUnit = { rows: CardRow[]; host: boolean };

function unitsOf(kind: OwnerCardKind, rows: readonly CardRow[]): CardUnit[] {
  if (kind !== "background")
    return rows.map((row) => ({ rows: [row], host: false }));
  const units: CardUnit[] = [];
  const byHost = new Map<string, CardUnit>();
  for (const row of rows) {
    const key = isRuleKind(row.view) ? row.view.host : null;
    if (key === null) {
      units.push({ rows: [row], host: false });
      continue;
    }
    const known = byHost.get(key);
    if (known) {
      known.rows.push(row);
      continue;
    }
    const unit = { rows: [row], host: true };
    byHost.set(key, unit);
    units.push(unit);
  }
  return units;
}

function rankOf(unit: CardUnit): number {
  const open = unit.rows.filter(
    (row) => !row.dismissed && row.view.status !== "resolved",
  );
  if (open.length === 0) return 3;
  const waiting = open.filter((row) => isWaiting(row.view));
  if (waiting.length === 0)
    return open.some((row) => isRuleKind(row.view)) ? 2 : 3;
  return waiting.every((row) => row.nobodyWaits) ? 1 : 0;
}

function unitBlocks(unit: CardUnit, appUrl: string): SlackBlock[] {
  return unit.host
    ? hostRow(unit.rows, appUrl)
    : rowBlocks(unit.rows[0]!, appUrl);
}

// UNIT_BOUNDARY_DESCRIPTION: "Allow all once" and "Deny all" of a turn card that names one thread, for the network and web-search rows the card shows that still wait; an MCP call or a row the card does not show keeps waiting for its own click. None when fewer than two such rows show.
function allButtons(units: readonly CardUnit[]): SlackBlock[] {
  const ids = units
    .flatMap((unit) => unit.rows)
    .filter((row) => isRuleKind(row.view) && isWaiting(row.view))
    .map((row) => row.view.id);
  if (ids.length < 2) return [];
  return [
    {
      type: "actions",
      elements: [
        button({
          label: "Allow all once",
          actionId: OWNER_REQUEST_APPROVE_ONCE_ACTION,
          requests: ids,
          style: "primary",
        }),
        button({
          label: "Deny all",
          actionId: OWNER_REQUEST_DENY_ONCE_ACTION,
          requests: ids,
          style: "danger",
        }),
      ],
    },
  ];
}

// UNIT_BOUNDARY_DESCRIPTION: the rows a card shows, most urgent first: at most ten, and never more than fit in the 50 blocks a Slack message holds beside the blocks above them, keeping one block for "Allow all once" and one for the count of rows that did not fit.
function rowsOf(input: {
  kind: OwnerCardKind;
  threads: readonly OwnerCardThread[];
  rows: readonly CardRow[];
  appUrl: string;
  blocksAbove: number;
}): SlackBlock[] {
  const ordered = unitsOf(input.kind, input.rows).sort(
    (a, b) => rankOf(a) - rankOf(b),
  );
  const budget = SLACK_MAX_BLOCKS - input.blocksAbove - 2;
  const shown: { unit: CardUnit; blocks: SlackBlock[] }[] = [];
  let used = 0;
  for (const unit of ordered) {
    if (shown.length >= MAX_CARD_ROWS) break;
    const blocks = [{ type: "divider" }, ...unitBlocks(unit, input.appUrl)];
    if (used + blocks.length > budget) break;
    shown.push({ unit, blocks });
    used += blocks.length;
  }
  const more = ordered.length - shown.length;
  return [
    ...(input.kind === "turn" && input.threads.length === 1
      ? allButtons(shown.map((entry) => entry.unit))
      : []),
    ...shown.flatMap((entry) => entry.blocks),
    ...(more > 0
      ? [
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `<${input.appUrl}|${String(more)} more: Open in app>`,
              },
            ],
          },
        ]
      : []),
  ];
}

// UNIT_BOUNDARY_DESCRIPTION: the hint of a background card whose agent was blocked on many different hosts today: a rule for each host will not stop it, so the card links to the agent's network settings and never suggests a rule for every host. None below ten hosts.
function manyHostsHint(
  agentName: string,
  hint: { hosts: number; settingsUrl: string },
): SlackBlock[] {
  if (hint.hosts < MANY_HOSTS) return [];
  return [
    {
      type: "section",
      text: plainText(
        `${cut(agentName, 100)} was blocked on ${String(hint.hosts)} different hosts today. A rule for each host will not stop this.`,
      ),
      accessory: {
        type: "button",
        action_id: OWNER_REQUEST_OPEN_ACTION,
        text: plainText("Open network settings"),
        url: hint.settingsUrl,
      },
    },
  ];
}

function requestCount(n: number): string {
  return n === 1 ? "1 request" : `${n} requests`;
}

// UNIT_BOUNDARY_DESCRIPTION: a card in the owner's DM, as text and blocks: the turn card holds the requests of the agent's addressed Slack turns, one row per request, and names each thread with the person who started it; the background card holds the agent's other requests, with one row per host for network requests and one for web searches. Rows that still wait come first, then rule rows, then settled rows, at most ten, then a count with "Open in app". Agent-written text never appears as Slack markup.
export function ownerCard(input: {
  kind: OwnerCardKind;
  agentName: string;
  threads: readonly OwnerCardThread[];
  rows: readonly CardRow[];
  appUrl: string;
  manyHosts?: { hosts: number; settingsUrl: string } | null;
}): { text: string; blocks: SlackBlock[] } {
  const waiting = input.rows.filter((row) => isWaiting(row.view));
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
  const above = [
    { type: "header", text: plainText(cut(header, 150)) },
    ...(input.kind === "turn" ? threadContext(input.threads) : []),
    ...(input.kind === "background" && input.manyHosts
      ? manyHostsHint(input.agentName, input.manyHosts)
      : []),
  ];
  return {
    text: header,
    blocks: [...above, ...rowsOf({ ...input, blocksAbove: above.length })],
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

// UNIT_BOUNDARY_DESCRIPTION: the reply the app posts in a thread after the owner allowed a request that nobody waited for any more, because Slack sends no notice for an edit: it mentions the people whose messages the turn carried and says by when to ask again for an approve once, or to ask again for a rule.
export function lateAllowReply(input: {
  ownerName: string;
  askers: readonly string[];
  askBy: string | null;
}): { text: string; blocks: SlackBlock[] } {
  const mentions = input.askers.map((user) => `<@${user}>`).join(" ");
  const owner = escapeMrkdwn(input.ownerName);
  const next = input.askBy
    ? `Ask again by ${slackDate(input.askBy)}.`
    : "Ask again to use it.";
  const text = `${input.ownerName} allowed it. ${input.askBy ? "Ask again soon." : "Ask again to use it."}`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${mentions ? `${mentions} ` : ""}${owner} allowed it. ${next}`,
        },
      },
    ],
  };
}

// UNIT_BOUNDARY_DESCRIPTION: what an owner's card becomes when it closes before its requests ended, because they unlinked Slack in its workspace or turned the cards off: its header, why it closed, and that they answer its requests in the app from now on.
export function closedCard(input: {
  kind: OwnerCardKind;
  agentName: string;
  appUrl: string;
  why: "unlinked" | "cards-off";
}): { text: string; blocks: SlackBlock[] } {
  const header =
    input.kind === "turn"
      ? `${input.agentName} waits in Slack`
      : `${input.agentName} needs you`;
  const line =
    input.why === "unlinked"
      ? "Slack was unlinked: answer in the app"
      : "You turned cards off: answer in the app";
  return {
    text: line,
    blocks: [
      { type: "header", text: plainText(cut(header, 150)) },
      { type: "section", text: plainText(line) },
      { type: "actions", elements: [openInAppButton(input.appUrl)] },
    ],
  };
}

export function cardMetadata(cardId: string) {
  return { eventType: OWNER_REQUEST_METADATA, payload: { card: cardId } };
}
