import { match } from "ts-pattern";

export type ChannelBlock = { type: string } & Record<string, unknown>;

export interface ChannelLinkButton {
  label: string;
  url: string;
}

export interface ChannelBlockCheck {
  agentId: string;
  choiceButtons: "allow" | "refuse";
}

export const AGENT_BUTTON_PREFIX = "agent-button:";

const INPUT_ELEMENTS = new Set([
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

const MRKDWN_LINK = /<((?:https?|mailto):[^>|\s]+)\|([^>]+)>/g;

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
  const issues = new Set<string>();
  const instead = match(check.choiceButtons)
    .with("allow", () => "use a button")
    .with("refuse", () => "use a button with a url")
    .exhaustive();
  let buttons = 0;
  const button = (node: Json): Json => {
    const actionId = `${AGENT_BUTTON_PREFIX}${check.agentId}:${buttons++}`;
    if (isLinkButton(node)) {
      const { value: _value, ...link } = node;
      return { ...link, action_id: actionId };
    }
    return match(check.choiceButtons)
      .with("allow", () => ({ ...node, action_id: actionId }))
      .with("refuse", () => {
        issues.add(
          `the blocks hold the button "${textOf(node.text)}", which has no url and needs a click to reach you, and a channel cannot carry one yet: give it a url, or ask in the text`,
        );
        return node;
      })
      .exhaustive();
  };
  const checked = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(checked);
    if (!isRecord(node)) return node;
    const inner = Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, checked(value)]),
    );
    if (isButton(inner)) return button(inner);
    const type = typeof node.type === "string" ? node.type : "unnamed";
    if (type === "input")
      issues.add(
        `the blocks hold an "input" block, which needs an answer to reach you, and a channel cannot carry one yet: ${instead}, or ask in the text`,
      );
    else if (INPUT_ELEMENTS.has(type) || "action_id" in node)
      issues.add(
        `the blocks hold a "${type}" element, which needs an answer to reach you, and a channel cannot carry one yet: ${instead}, or ask in the text`,
      );
    return inner;
  };
  const blocks = input.map(checked) as ChannelBlock[];
  return issues.size > 0 ? { issues: [...issues] } : { blocks };
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
  return isLinkButton(node) ? `[${label}](${String(node.url)})` : label;
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

export function channelBlocksText(blocks: readonly ChannelBlock[]): string {
  return lines(blocks)
    .map((line) => line.replace(MRKDWN_LINK, "[$2]($1)").trim())
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
