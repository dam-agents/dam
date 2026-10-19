import { parseAgentFooter } from "./agent-footer.js";
import type { SlackBlock } from "./slack-gateway.js";

export interface SlackLegacyAttachment {
  fallback?: string;
  pretext?: string;
  author_name?: string;
  title?: string;
  text?: string;
  fields?: Array<{ title?: string; value?: string }>;
  footer?: string;
  from_url?: string;
  original_url?: string;
}

export interface SlackPostContent {
  text?: string;
  attachments?: unknown;
  blocks?: unknown;
}

const FLATTENED_CHARS = 2000;

type TextObject = { text?: unknown };

function textOf(value: unknown): string {
  return typeof (value as TextObject | null)?.text === "string"
    ? ((value as TextObject).text as string)
    : "";
}

function richTextOf(element: unknown): string {
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

function blockText(block: SlackBlock, textIsEmpty: boolean): string {
  switch (block.type) {
    case "header":
      return textOf(block.text);
    case "markdown":
      return textIsEmpty && typeof block.text === "string" ? block.text : "";
    case "section":
      return [
        textOf(block.text),
        ...(Array.isArray(block.fields) ? block.fields.map(textOf) : []),
      ]
        .filter(Boolean)
        .join("\n");
    case "context":
      if (parseAgentFooter({ blocks: [block] })) return "";
      return Array.isArray(block.elements)
        ? block.elements.map(textOf).filter(Boolean).join(" ")
        : "";
    case "rich_text":
      return textIsEmpty && Array.isArray(block.elements)
        ? block.elements.map(richTextOf).join("\n")
        : "";
    default:
      return "";
  }
}

function attachmentText(a: SlackLegacyAttachment): string[] {
  if (a.from_url || a.original_url) return [];
  const fields = (a.fields ?? []).flatMap((f) =>
    f.value ? [f.title ? `${f.title}: ${f.value}` : f.value] : [],
  );
  const parts = [a.pretext, a.author_name, a.title, a.text, ...fields, a.footer]
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map((p) => p.trim());
  return parts.length > 0 ? parts : a.fallback?.trim() ? [a.fallback] : [];
}

function comparable(text: string): string {
  return text
    .replace(/<([^>|]*)\|([^>]*)>/g, "$2")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The readable text of a Slack post, the same for
 * history lines, `read_thread` and the live turn payload. Apps and incoming
 * webhooks (the GitHub app, CI, alerts) often leave top-level `text` empty or
 * a short fallback, and put the content in legacy `attachments[]` or in
 * `blocks`. This joins `text` with that content and drops a part that only
 * repeats what is already there. `rich_text` and `markdown` blocks are read
 * only when `text` is empty, because a person's post carries a `rich_text`
 * copy of its `text` and an Agent's post a `markdown` copy. A link preview
 * Slack unfurled into `attachments` repeats a link already in the post, and
 * an Agent Footer is not content, so neither is read. Only the flattened part
 * is capped; `text` is never shortened.
 */
export function renderSlackPostText(post: SlackPostContent): string {
  const text = post.text?.trim() ?? "";
  const attachments = Array.isArray(post.attachments)
    ? (post.attachments as SlackLegacyAttachment[])
    : [];
  const blocks = Array.isArray(post.blocks)
    ? (post.blocks as SlackBlock[])
    : [];
  const candidates = [
    ...blocks.map((b) => blockText(b, text === "").trim()),
    ...attachments.flatMap(attachmentText),
  ];
  const seen = [comparable(text)];
  const extra: string[] = [];
  for (const part of candidates) {
    const key = comparable(part);
    if (!key || seen.some((s) => s.includes(key))) continue;
    seen.push(key);
    extra.push(part);
  }
  if (extra.length === 0) return post.text ?? "";
  const joined = extra.join("\n");
  const flattened =
    joined.length > FLATTENED_CHARS
      ? `${joined.slice(0, FLATTENED_CHARS)}… (truncated)`
      : joined;
  return text ? `${post.text}\n${flattened}` : flattened;
}
