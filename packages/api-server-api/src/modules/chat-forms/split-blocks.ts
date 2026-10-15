export type Segment =
  | { kind: "markdown"; text: string }
  | { kind: "a2ui"; source: string; closed: boolean };

const OPEN_TAG = /^[ \t]*<a2ui-json(?:\s[^>]*)?>/im;
const CLOSE_TAG = /<\/a2ui-json\s*>/i;
const PARTIAL_OPEN_TAG = /(?:^|\n)[ \t]*(<[a-z0-9-]*)$/i;
const TAG_NAME = "<a2ui-json";
const MIN_PARTIAL_TAG = 3;

function withoutPartialOpenTag(text: string): string {
  const partial = PARTIAL_OPEN_TAG.exec(text)?.[1];
  if (partial === undefined || partial.length < MIN_PARTIAL_TAG) return text;
  return TAG_NAME.startsWith(partial.toLowerCase())
    ? text.slice(0, text.length - partial.length)
    : text;
}

export function hasA2uiBlock(text: string): boolean {
  return text.toLowerCase().includes(TAG_NAME);
}

export function splitA2uiBlocks(text: string): Segment[] {
  const segments: Segment[] = [];
  const pushMarkdown = (chunk: string) => {
    if (chunk.trim()) segments.push({ kind: "markdown", text: chunk });
  };
  let rest = text;
  for (;;) {
    const open = OPEN_TAG.exec(rest);
    if (!open) {
      pushMarkdown(withoutPartialOpenTag(rest));
      return segments;
    }
    pushMarkdown(rest.slice(0, open.index));
    const body = rest.slice(open.index + open[0].length);
    const close = CLOSE_TAG.exec(body);
    if (!close) {
      segments.push({ kind: "a2ui", source: body, closed: false });
      return segments;
    }
    segments.push({
      kind: "a2ui",
      source: body.slice(0, close.index),
      closed: true,
    });
    rest = body.slice(close.index + close[0].length);
  }
}
