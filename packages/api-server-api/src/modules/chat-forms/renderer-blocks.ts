const RENDERER_TAGS = ["message", "data-model", "capabilities"] as const;

export type RendererTag = (typeof RENDERER_TAGS)[number];

export interface RendererBlock {
  tag: RendererTag;
  body: string;
  start: number;
  end: number;
}

// UNIT_BOUNDARY_DESCRIPTION: scans with indexOf instead of a lazy regex, and stops looking for a tag once one of its blocks has no closing tag, so agent-controlled text costs linear time.
export function findRendererBlocks(text: string): RendererBlock[] {
  const blocks: RendererBlock[] = [];
  const unclosed = new Set<RendererTag>();
  let from = 0;
  for (;;) {
    const start = text.indexOf("<a2ui-", from);
    if (start === -1) return blocks;
    const tag = RENDERER_TAGS.find((name) =>
      text.startsWith(`<a2ui-${name}>`, start),
    );
    if (!tag || unclosed.has(tag)) {
      from = start + 1;
      continue;
    }
    const open = `<a2ui-${tag}>`;
    const close = `</a2ui-${tag}>`;
    const closeAt = text.indexOf(close, start + open.length);
    if (closeAt === -1) {
      unclosed.add(tag);
      from = start + open.length;
      continue;
    }
    blocks.push({
      tag,
      body: text.slice(start + open.length, closeAt),
      start,
      end: closeAt + close.length,
    });
    from = closeAt + close.length;
  }
}

export function separateRendererBlocks(text: string): {
  text: string;
  blocks: string;
} {
  const found = findRendererBlocks(text);
  let rest = "";
  let cursor = 0;
  for (const block of found) {
    rest += text.slice(cursor, block.start);
    cursor = block.end;
  }
  rest += text.slice(cursor);
  return {
    text: rest.trim(),
    blocks: found
      .map((block) => text.slice(block.start, block.end))
      .join("\n\n"),
  };
}

export function joinRendererBlocks(text: string, blocks: string): string {
  if (!blocks) return text;
  return text ? `${text}\n\n${blocks}` : blocks;
}
