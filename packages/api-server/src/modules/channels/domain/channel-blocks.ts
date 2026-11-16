import { match } from "ts-pattern";

export type ChannelBlock = { type: string } & Record<string, unknown>;

export interface ChannelLinkButton {
  label: string;
  url: string;
}

export interface ChannelBlockCheck {
  agentId: string;
}

const AGENT_BUTTON_PREFIX = "agent-button:";

const AGENT_LINK_PREFIX = "agent-link:";

const AGENT_FIELD_PREFIX = "agent-field:";

const ACTION_ID_CHARS = 255;

export type AgentAction =
  | { kind: "button"; agentId: string }
  | { kind: "field"; agentId: string; name: string };

export function agentActionOf(actionId: string): AgentAction | null {
  const kind = actionId.startsWith(AGENT_BUTTON_PREFIX)
    ? "button"
    : actionId.startsWith(AGENT_FIELD_PREFIX)
      ? "field"
      : null;
  if (kind === null) return null;
  const rest = actionId.slice(actionId.indexOf(":") + 1);
  const end = rest.indexOf(":");
  if (end <= 0) return null;
  const agentId = rest.slice(0, end);
  return match(kind)
    .with("button", (): AgentAction => ({ kind: "button", agentId }))
    .with("field", (): AgentAction => ({
      kind: "field",
      agentId,
      name: rest.slice(end + 1),
    }))
    .exhaustive();
}

const FIELD_ELEMENTS = new Set([
  "static_select",
  "external_select",
  "users_select",
  "conversations_select",
  "channels_select",
  "multi_static_select",
  "multi_external_select",
  "multi_users_select",
  "multi_conversations_select",
  "multi_channels_select",
  "overflow",
  "datepicker",
  "timepicker",
  "datetimepicker",
  "checkboxes",
  "radio_buttons",
  "plain_text_input",
  "number_input",
  "email_text_input",
  "url_text_input",
  "rich_text_input",
  "file_input",
  "workflow_button",
  "feedback_buttons",
  "icon_button",
]);

const TEXT_KEYS = new Set([
  "text",
  "title",
  "subtitle",
  "body",
  "subtext",
  "description",
  "alt_text",
  "label",
]);

const UNREAD_KEYS = new Set([
  "fallback",
  "confirm",
  "placeholder",
  "hint",
  "accessibility_label",
]);

const SLACK_LINK = /<([a-z][a-z0-9+.-]*:[^>|\s]+)\|([^>]+)>/gi;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlock(value: unknown): value is ChannelBlock {
  return isRecord(value) && typeof value.type === "string" && value.type !== "";
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  return isRecord(value) && typeof value.text === "string" ? value.text : "";
}

function isButton(node: Json): boolean {
  return node.type === "button";
}

function isLinkButton(node: Json): boolean {
  return isButton(node) && typeof node.url === "string" && node.url !== "";
}

function isChoiceButton(node: unknown): node is Json {
  return isRecord(node) && isButton(node) && !isLinkButton(node);
}

function isField(node: Json): boolean {
  return (
    !isButton(node) &&
    typeof node.type === "string" &&
    (FIELD_ELEMENTS.has(node.type) || "action_id" in node)
  );
}

export function checkChannelBlocks(
  input: unknown,
  check: ChannelBlockCheck,
): { blocks: ChannelBlock[] } | { issues: string[] } {
  if (!Array.isArray(input) || input.length === 0 || !input.every(isBlock))
    return {
      issues: [
        'blocks must be a non-empty list of Slack Block Kit blocks, each an object with a "type", such as { "type": "section", "text": { "type": "mrkdwn", "text": "…" } }',
      ],
    };
  let buttons = 0;
  let fields = 0;
  const button = (node: Json): Json => {
    const id = `${check.agentId}:${buttons++}`;
    if (!isLinkButton(node))
      return { ...node, action_id: `${AGENT_BUTTON_PREFIX}${id}` };
    const { value: _value, ...link } = node;
    return { ...link, action_id: `${AGENT_LINK_PREFIX}${id}` };
  };
  const names = new Set<string>();
  const field = (node: Json): Json => {
    const position = fields++;
    const wanted =
      typeof node.action_id === "string" && node.action_id !== ""
        ? node.action_id
        : `${String(node.type)}-${position}`;
    let name = wanted;
    for (let copy = 2; names.has(name); copy++) name = `${wanted}-${copy}`;
    names.add(name);
    return {
      ...node,
      action_id: `${AGENT_FIELD_PREFIX}${check.agentId}:${name}`.slice(
        0,
        ACTION_ID_CHARS,
      ),
    };
  };
  const checked = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(checked);
    if (!isRecord(node)) return node;
    const inner = Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, checked(value)]),
    );
    if (isButton(inner)) return button(inner);
    return isField(inner) ? field(inner) : inner;
  };
  return { blocks: input.map(checked) as ChannelBlock[] };
}

const FIELD_VALUE_KEYS = [
  "value",
  "selected_option",
  "selected_options",
  "selected_user",
  "selected_users",
  "selected_conversation",
  "selected_conversations",
  "selected_channel",
  "selected_channels",
  "selected_date",
  "selected_time",
  "selected_date_time",
];

function optionValue(option: unknown): unknown {
  return isRecord(option) && "value" in option ? option.value : option;
}

function held(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function fileName(file: unknown): unknown {
  return isRecord(file) ? (file.name ?? file.title ?? file.id ?? null) : null;
}

export function channelFieldValue(state: unknown): unknown {
  if (!isRecord(state)) return null;
  if (isRecord(state.rich_text_value))
    return richTextLines(state.rich_text_value).join("\n");
  if (Array.isArray(state.files)) return state.files.map(fileName);
  const key = FIELD_VALUE_KEYS.find((candidate) => held(state[candidate]));
  if (key === undefined) {
    const {
      type: _type,
      action_id: _id,
      block_id: _block,
      action_ts: _at,
      ...rest
    } = state;
    return Object.values(rest).some(held) ? rest : null;
  }
  const value = state[key];
  return Array.isArray(value) ? value.map(optionValue) : optionValue(value);
}

export function channelFieldValues(
  state: unknown,
  agentId: string,
): Record<string, unknown> {
  if (!isRecord(state)) return {};
  const seen = new Set<string>();
  const values: [string, unknown][] = [];
  for (const [blockId, fields] of Object.entries(state)) {
    if (!isRecord(fields)) continue;
    for (const [actionId, element] of Object.entries(fields)) {
      const action = agentActionOf(actionId);
      if (action?.kind !== "field" || action.agentId !== agentId) continue;
      const name = seen.has(action.name)
        ? `${blockId}.${action.name}`
        : action.name;
      seen.add(name);
      values.push([name, channelFieldValue(element)]);
    }
  }
  return Object.fromEntries(values);
}

export function richTextOf(element: unknown): string {
  const e = element as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return "";
  const nested = (): string =>
    Array.isArray(e.elements) ? e.elements.map(richTextOf).join("") : "";
  switch (e.type) {
    case "text":
      return typeof e.text === "string" ? e.text : "";
    case "link":
      return typeof e.text === "string" && e.text
        ? `<${String(e.url)}|${e.text}>`
        : String(e.url ?? "");
    case "user":
      return `<@${String(e.user_id)}>`;
    case "channel":
      return `<#${String(e.channel_id)}>`;
    case "usergroup":
      return `<!subteam^${String(e.usergroup_id)}>`;
    case "broadcast":
      return `<!${String(e.range)}>`;
    case "emoji":
      return `:${String(e.name)}:`;
    case "rich_text_section":
    case "rich_text_preformatted":
    case "rich_text_quote":
      return nested();
    case "rich_text_list":
      return Array.isArray(e.elements)
        ? e.elements.map((item) => `• ${richTextOf(item)}`).join("\n")
        : "";
    default:
      return nested();
  }
}

function richTextLines(node: Json): string[] {
  return Array.isArray(node.elements) ? node.elements.map(richTextOf) : [];
}

function cellText(cell: unknown): string {
  if (!isRecord(cell)) return "";
  if (cell.type === "rich_text") return richTextLines(cell).join(" ");
  if (typeof cell.text === "string") return cell.text;
  return typeof cell.value === "number" || typeof cell.value === "string"
    ? String(cell.value)
    : "";
}

function tableLines(table: Json): string[] {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  return rows.map((row) =>
    Array.isArray(row) ? row.map(cellText).join(" | ") : "",
  );
}

function pointText(point: unknown): string {
  if (!isRecord(point)) return "";
  const value = typeof point.value === "number" ? String(point.value) : "";
  return [textOf(point.label), value].filter(Boolean).join(" ");
}

function chartLines(block: Json): string[] {
  const chart = isRecord(block.chart) ? block.chart : {};
  const segments = Array.isArray(chart.segments) ? chart.segments : [];
  const series = Array.isArray(chart.series) ? chart.series : [];
  return [
    textOf(block.title),
    ...segments.map(pointText),
    ...series.filter(isRecord).map((one) => {
      const points = Array.isArray(one.data) ? one.data.map(pointText) : [];
      return [textOf(one.name), points.filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(": ");
    }),
  ];
}

function buttonText(node: Json): string {
  const label = textOf(node.text);
  return isLinkButton(node) ? `<${String(node.url)}|${label}>` : label;
}

function listLines(items: readonly unknown[]): string[] {
  const out: string[] = [];
  let choices: string[] = [];
  const flush = () => {
    if (choices.length > 0) out.push(choices.join(" / "));
    choices = [];
  };
  for (const item of items) {
    if (isChoiceButton(item)) {
      choices.push(buttonText(item));
      continue;
    }
    flush();
    out.push(...lines(item));
  }
  flush();
  return out;
}

function lines(node: unknown): string[] {
  if (Array.isArray(node)) return listLines(node);
  if (!isRecord(node)) return [];
  switch (node.type) {
    case "rich_text":
      return richTextLines(node);
    case "table":
      return tableLines(node);
    case "data_visualization":
      return chartLines(node);
    case "button":
      return [buttonText(node)];
    case "layout":
      return [
        ...(node.is_label_visible === true ? [textOf(node.label)] : []),
        ...lines(node.rows),
      ];
    default:
      return Object.entries(node).flatMap(([key, value]): string[] => {
        if (UNREAD_KEYS.has(key)) return [];
        if (typeof value === "string") return TEXT_KEYS.has(key) ? [value] : [];
        return lines(value);
      });
  }
}

export function channelBlocksText(
  blocks: readonly ChannelBlock[],
  links: "markdown" | "slack" = "markdown",
): string {
  const shown = match(links)
    .with(
      "markdown",
      () => (line: string) => line.replace(SLACK_LINK, "[$2]($1)"),
    )
    .with("slack", () => (line: string) => line)
    .exhaustive();
  return lines(blocks)
    .map((line) => shown(line).trim())
    .filter(Boolean)
    .join("\n");
}

export function channelBlockLinkButtons(
  blocks: readonly ChannelBlock[],
): ChannelLinkButton[] {
  const found = (node: unknown): ChannelLinkButton[] => {
    if (Array.isArray(node)) return node.flatMap(found);
    if (!isRecord(node)) return [];
    if (isLinkButton(node))
      return [{ label: textOf(node.text), url: String(node.url) }];
    return Object.entries(node).flatMap(([key, value]) =>
      UNREAD_KEYS.has(key) ? [] : found(value),
    );
  };
  return found(blocks);
}

export function channelBlockInteractive(
  blocks: readonly ChannelBlock[],
): string[] {
  const found = (node: unknown): string[] => {
    if (Array.isArray(node)) return node.flatMap(found);
    if (!isRecord(node)) return [];
    if (isButton(node) && !isLinkButton(node))
      return [`the button "${textOf(node.text)}"`];
    return [
      ...(isField(node) ? [`a "${String(node.type)}" element`] : []),
      ...Object.values(node).flatMap(found),
    ];
  };
  return found(blocks);
}

function nestedBlocks(block: Json): unknown[] {
  switch (block.type) {
    case "layout":
      return (Array.isArray(block.rows) ? block.rows : []).flatMap((row) =>
        isRecord(row) && Array.isArray(row.items)
          ? row.items.map((item) => (isRecord(item) ? item.block : undefined))
          : [],
      );
    case "container":
      return Array.isArray(block.child_blocks) ? block.child_blocks : [];
    case "carousel":
      return Array.isArray(block.elements) ? block.elements : [];
    default:
      return [];
  }
}

export function countChannelBlocks(blocks: readonly unknown[]): number {
  return blocks
    .filter(isRecord)
    .reduce(
      (count, block) => count + 1 + countChannelBlocks(nestedBlocks(block)),
      0,
    );
}
