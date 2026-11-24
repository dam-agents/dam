import { slackLinkDestination } from "./slack-link-destination.js";

export type SlackInline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: readonly SlackInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; url: string; label: string; destination: string | null }
  | { kind: "mention"; label: string };

export type SlackLine = readonly SlackInline[];

export type SlackBlock =
  | { kind: "paragraph"; lines: readonly SlackLine[] }
  | { kind: "quote"; lines: readonly SlackLine[] }
  | {
      kind: "list";
      ordered: boolean;
      start: number;
      items: readonly SlackLine[];
    }
  | { kind: "code"; text: string };

interface Mark {
  node: SlackInline;
  end: number;
}

type EmphasisMark = "*" | "_" | "**" | "__" | "~~";

interface LineIndex {
  text: string;
  closers: Readonly<Record<EmphasisMark, readonly number[]>>;
  backticks: readonly number[];
  lessThan: readonly number[];
  greaterThan: readonly number[];
  openBrackets: readonly number[];
  closeBrackets: readonly number[];
  closeParens: readonly number[];
}

const FENCE = "```";
const MAX_NESTING = 6;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;
const ESCAPABLE = /[\\`*_~[\]()<>#>-]/;
const SAFE_URL = /^(?:https?:\/\/|mailto:)[^\s|<>]+$/;

const USER_MENTION = /^@([UW][A-Z0-9]+)(?:\|[^|]+)?$/;
const CHANNEL_MENTION = /^#(C[A-Z0-9]+)(?:\|[^|]*)?$/;
const SPECIAL_MENTION = /^!(here|channel|everyone)(?:\|[^|]*)?$/;
const GROUP_MENTION = /^!subteam\^([A-Z0-9]+)(?:\|[^|]+)?$/;
const ANGLE_LINK = /^([^|\s]+)(?:\|([^|]+))?$/;

const isWord = (char: string | undefined): boolean =>
  char !== undefined && WORD.test(char);
const isSpace = (char: string | undefined): boolean =>
  char === undefined || SPACE.test(char);

function nextAt(positions: readonly number[], from: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positions[middle]! < from) low = middle + 1;
    else high = middle;
  }
  return positions[low] ?? -1;
}

function isSingleCloser(text: string, at: number, char: string): boolean {
  if (text[at] !== char) return false;
  if (text[at - 1] === char || text[at + 1] === char) return false;
  if (isSpace(text[at - 1])) return false;
  return char !== "_" || !isWord(text[at + 1]);
}

function indexLine(text: string): LineIndex {
  const closers: Record<EmphasisMark, number[]> = {
    "*": [],
    _: [],
    "**": [],
    __: [],
    "~~": [],
  };
  const backticks: number[] = [];
  const lessThan: number[] = [];
  const greaterThan: number[] = [];
  const openBrackets: number[] = [];
  const closeBrackets: number[] = [];
  const closeParens: number[] = [];
  const byChar: Readonly<Partial<Record<string, number[]>>> = {
    "`": backticks,
    "<": lessThan,
    ">": greaterThan,
    "[": openBrackets,
    "]": closeBrackets,
    ")": closeParens,
  };
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    byChar[char]?.push(at);
    if ((char === "*" || char === "_") && isSingleCloser(text, at, char))
      closers[char].push(at);
    const pair = text.slice(at, at + 2);
    if (
      (pair === "**" || pair === "__" || pair === "~~") &&
      !isSpace(text[at - 1])
    )
      closers[pair].push(at);
  }
  return {
    text,
    closers,
    backticks,
    lessThan,
    greaterThan,
    openBrackets,
    closeBrackets,
    closeParens,
  };
}

const linkNode = (url: string, label: string): SlackInline => ({
  kind: "link",
  url,
  label,
  destination: slackLinkDestination(url, label),
});

function angleNode(inner: string): SlackInline | null {
  const user = USER_MENTION.exec(inner);
  if (user) return { kind: "mention", label: `@${user[1]!}` };
  const channel = CHANNEL_MENTION.exec(inner);
  if (channel) return { kind: "mention", label: `#${channel[1]!}` };
  const special = SPECIAL_MENTION.exec(inner);
  if (special) return { kind: "mention", label: `@${special[1]!}` };
  const group = GROUP_MENTION.exec(inner);
  if (group) return { kind: "mention", label: `@${group[1]!}` };
  const link = ANGLE_LINK.exec(inner);
  if (!link || !SAFE_URL.test(link[1]!)) return null;
  return linkNode(link[1]!, link[2] ?? link[1]!.replace(/^mailto:/, ""));
}

function readAngle(line: LineIndex, at: number, end: number): Mark | null {
  const close = nextAt(line.greaterThan, at + 1);
  if (close === -1 || close >= end) return null;
  const nextOpen = nextAt(line.lessThan, at + 1);
  if (nextOpen !== -1 && nextOpen < close) return null;
  const node = angleNode(line.text.slice(at + 1, close));
  return node ? { node, end: close + 1 } : null;
}

function readMarkdownLink(
  line: LineIndex,
  at: number,
  end: number,
): Mark | null {
  const close = nextAt(line.closeBrackets, at + 1);
  if (close === -1 || close === at + 1 || close >= end) return null;
  const nextOpen = nextAt(line.openBrackets, at + 1);
  if (nextOpen !== -1 && nextOpen < close) return null;
  if (line.text[close + 1] !== "(") return null;
  const paren = nextAt(line.closeParens, close + 2);
  if (paren === -1 || paren >= end) return null;
  const nextClose = nextAt(line.closeBrackets, close + 1);
  if (nextClose !== -1 && nextClose < paren) return null;
  const url = line.text.slice(close + 2, paren);
  if (!SAFE_URL.test(url)) return null;
  return {
    node: linkNode(url, line.text.slice(at + 1, close)),
    end: paren + 1,
  };
}

function readCode(line: LineIndex, at: number, end: number): Mark | null {
  const close = nextAt(line.backticks, at + 1);
  if (close <= at + 1 || close >= end) return null;
  return {
    node: { kind: "code", text: line.text.slice(at + 1, close) },
    end: close + 1,
  };
}

function readEmphasis(
  line: LineIndex,
  at: number,
  end: number,
  mark: EmphasisMark,
  depth: number,
): Mark | null {
  const { text } = line;
  const start = at + mark.length;
  if (start >= end || isSpace(text[start])) return null;
  if (mark === "_" && isWord(text[at - 1])) return null;
  const close = nextAt(line.closers[mark], start + 1);
  if (close === -1 || close + mark.length > end) return null;
  const kind = mark === "~~" ? "strike" : mark.length === 2 ? "bold" : "italic";
  const children =
    depth >= MAX_NESTING
      ? [{ kind: "text" as const, text: text.slice(start, close) }]
      : parseRange(line, start, close, depth + 1);
  return { node: { kind, children }, end: close + mark.length };
}

function readMark(
  line: LineIndex,
  at: number,
  end: number,
  depth: number,
): Mark | null {
  const char = line.text[at];
  const pair = line.text.slice(at, at + 2);
  if (char === "`") return readCode(line, at, end);
  if (char === "<") return readAngle(line, at, end);
  if (char === "[") return readMarkdownLink(line, at, end);
  if (pair === "**" || pair === "__" || pair === "~~")
    return readEmphasis(line, at, end, pair, depth);
  if (char === "*" || char === "_")
    return readEmphasis(line, at, end, char, depth);
  return null;
}

function parseRange(
  line: LineIndex,
  from: number,
  end: number,
  depth: number,
): SlackInline[] {
  const { text } = line;
  const nodes: SlackInline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) nodes.push({ kind: "text", text: plain });
    plain = "";
  };
  let at = from;
  while (at < end) {
    const mark = readMark(line, at, end, depth);
    if (mark) {
      flush();
      nodes.push(mark.node);
      at = mark.end;
      continue;
    }
    const next = at + 1 < end ? text[at + 1] : undefined;
    if (text[at] === "\\" && next !== undefined && ESCAPABLE.test(next)) {
      plain += next;
      at += 2;
      continue;
    }
    plain += text[at]!;
    at++;
  }
  flush();
  return nodes;
}

const parseInline = (text: string): SlackInline[] =>
  parseRange(indexLine(text), 0, text.length, 0);

interface Lines {
  lines: readonly string[];
  fences: readonly number[];
}

const closingFence = ({ fences }: Lines, from: number): number =>
  nextAt(fences, from + 1);

function oneLineCode(line: string): string | null {
  const trimmed = line.trim();
  return trimmed.length > FENCE.length * 2 &&
    trimmed.startsWith(FENCE) &&
    trimmed.endsWith(FENCE)
    ? trimmed.slice(FENCE.length, -FENCE.length)
    : null;
}

function startsBlock(source: Lines, at: number): boolean {
  const line = source.lines[at]!;
  return (
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    oneLineCode(line) !== null ||
    (line.startsWith(FENCE) && closingFence(source, at) !== -1)
  );
}

function readList(
  { lines }: Lines,
  at: number,
): { block: SlackBlock; next: number } {
  const ordered = !BULLET.test(lines[at]!);
  const pattern = ordered ? NUMBERED : BULLET;
  const items: SlackLine[] = [];
  let next = at;
  for (; next < lines.length; next++) {
    const item = pattern.exec(lines[next]!);
    if (!item) break;
    items.push(parseInline(item[ordered ? 2 : 1]!));
  }
  const start = ordered ? Number(NUMBERED.exec(lines[at]!)![1]) : 1;
  return { block: { kind: "list", ordered, start, items }, next };
}

function readQuote(
  { lines }: Lines,
  at: number,
): { block: SlackBlock; next: number } {
  const quoted: SlackLine[] = [];
  let next = at;
  for (; next < lines.length; next++) {
    const line = QUOTE.exec(lines[next]!);
    if (!line) break;
    quoted.push(parseInline(line[1]!));
  }
  return { block: { kind: "quote", lines: quoted }, next };
}

function readParagraph(
  source: Lines,
  at: number,
): { block: SlackBlock; next: number } {
  const { lines } = source;
  const paragraph: SlackLine[] = [parseInline(lines[at]!)];
  let next = at + 1;
  for (; next < lines.length; next++) {
    if (lines[next]!.trim() === "" || startsBlock(source, next)) break;
    paragraph.push(parseInline(lines[next]!));
  }
  return { block: { kind: "paragraph", lines: paragraph }, next };
}

function readBlock(
  source: Lines,
  at: number,
): { block: SlackBlock; next: number } {
  const line = source.lines[at]!;
  const single = oneLineCode(line);
  if (single !== null)
    return { block: { kind: "code", text: single }, next: at + 1 };
  if (line.startsWith(FENCE)) {
    const close = closingFence(source, at);
    if (close !== -1)
      return {
        block: {
          kind: "code",
          text: source.lines.slice(at + 1, close).join("\n"),
        },
        next: close + 1,
      };
  }
  if (BULLET.test(line) || NUMBERED.test(line)) return readList(source, at);
  if (QUOTE.test(line)) return readQuote(source, at);
  return readParagraph(source, at);
}

// UNIT_BOUNDARY_DESCRIPTION: reads the text of a Slack message that a held tool call would send into blocks and marks, so the approval card can show it as Slack shows it. The Slack message tools take standard markdown (`**bold**`, `_italic_` or `*italic*`, `~~strike~~`, code, code blocks, `- ` and `1. ` lists, `> ` quotes, `[text](url)` links) and Slack's own `<...>` references: links, user and channel mentions, and @here. A link shows only for an http, https or mailto address, and keeps where it really goes next to its label. A mention shows the Slack id, because Slack ignores the label written in the text and notifies the id. Any other mark, or a mark that is not closed, stays as typed text, so nothing in the message is lost or read as HTML. The parse time grows about in step with the length of the text: each closing mark is looked up in an index built once per line, not searched for again from every opening mark, and marks nest at most six deep, so a hostile 64 KiB message cannot freeze the page.
export function parseSlackMarkup(text: string): SlackBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const source: Lines = {
    lines,
    fences: lines.flatMap((line, at) => (line.trim() === FENCE ? [at] : [])),
  };
  const blocks: SlackBlock[] = [];
  let at = 0;
  while (at < lines.length) {
    if (lines[at]!.trim() === "") {
      at++;
      continue;
    }
    const { block, next } = readBlock(source, at);
    blocks.push(block);
    at = next;
  }
  return blocks;
}
