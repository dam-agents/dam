const INLINE_BINARY_RE = /"data"\s*:\s*"/;

export type HashOf = (data: string) => string;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a frame may hold inline image or audio
 * bytes, by the raw text alone, so the Session Transcript parses only the
 * frames that might.
 */
export function mayHoldInlineMedia(line: string): boolean {
  return INLINE_BINARY_RE.test(line);
}

type MediaBlock = Record<string, unknown> & { type: "image" | "audio" };

export interface DroppedMedia {
  sha256: string;
  length: number;
}

function mapMediaBlocks(
  value: unknown,
  visit: (block: MediaBlock) => unknown,
): unknown {
  if (Array.isArray(value))
    return value.map((inner) => mapMediaBlocks(inner, visit));
  if (typeof value !== "object" || value === null) return value;
  const block = value as Record<string, unknown>;
  if (block.type === "image" || block.type === "audio")
    return visit(block as MediaBlock);
  return Object.fromEntries(
    Object.entries(block).map(([key, inner]) => [
      key,
      mapMediaBlocks(inner, visit),
    ]),
  );
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function rewriteMedia(
  line: string,
  visit: (block: MediaBlock) => unknown,
): string {
  const frame = parsed(line);
  return frame === undefined
    ? line
    : JSON.stringify(mapMediaBlocks(frame, visit));
}

function droppedOf(block: MediaBlock): DroppedMedia | null {
  const dropped = block.dropped as Partial<DroppedMedia> | undefined;
  return typeof dropped?.sha256 === "string" &&
    typeof dropped.length === "number"
    ? { sha256: dropped.sha256, length: dropped.length }
    : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Drops the bytes of every inline image or audio
 * block of a frame, and leaves on the block a reference to them — their hash
 * and length — so a later replay can find the same bytes in the harness's
 * own history.
 */
export function dropInlineMedia(line: string, hashOf: HashOf): string {
  return rewriteMedia(line, (block) => {
    if (typeof block.data !== "string") return block;
    const { data, ...rest } = block;
    return {
      ...rest,
      dropped: { sha256: hashOf(data), length: data.length },
    };
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The references dropInlineMedia left in these
 * frames.
 */
export function droppedIn(lines: readonly string[]): DroppedMedia[] {
  const found: DroppedMedia[] = [];
  for (const line of lines) {
    rewriteMedia(line, (block) => {
      const dropped = droppedOf(block);
      if (dropped) found.push(dropped);
      return block;
    });
  }
  return found;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The bytes of the wanted references, read from
 * the harness's own history by hash; only a block of a wanted length is
 * hashed, so a long history with many images costs little.
 */
export function mediaOfHistory(
  history: readonly string[],
  wanted: readonly DroppedMedia[],
  hashOf: HashOf,
): Map<string, string> {
  const media = new Map<string, string>();
  const lengths = new Set(wanted.map((w) => w.length));
  const hashes = new Set(wanted.map((w) => w.sha256));
  for (const line of history) {
    if (!INLINE_BINARY_RE.test(line)) continue;
    mapMediaBlocks(parsed(line), (block) => {
      const data = block.data;
      if (typeof data !== "string" || !lengths.has(data.length)) return block;
      const sha256 = hashOf(data);
      if (hashes.has(sha256)) media.set(sha256, data);
      return block;
    });
  }
  return media;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Puts the bytes back into every referenced block
 * of a frame; a block whose bytes were not found becomes the text
 * placeholder `[image not kept in history]` (or `audio`).
 */
export function restoreMedia(
  line: string,
  media: ReadonlyMap<string, string>,
): string {
  return rewriteMedia(line, (block) => {
    const dropped = droppedOf(block);
    if (dropped === null) return block;
    const data = media.get(dropped.sha256);
    if (data === undefined)
      return { type: "text", text: `[${block.type} not kept in history]` };
    const { dropped: _dropped, ...rest } = block;
    return { ...rest, data };
  });
}
