export type PageCursor =
  | { kind: "log"; generation: string; seq: number }
  | { kind: "beforeLog"; generation: string; seq: number }
  | { kind: "history"; generation: string; index: number };

const BEFORE_LOG_MARK = ":before-log";
const HISTORY_MARK = ":history";

function cursorText(cursor: PageCursor): string {
  switch (cursor.kind) {
    case "log":
      return `${cursor.generation}:${cursor.seq}`;
    case "beforeLog":
      return `${cursor.generation}${BEFORE_LOG_MARK}:${cursor.seq}`;
    case "history":
      return `${cursor.generation}${HISTORY_MARK}:${cursor.index}`;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The opaque cursor a replay hands back for the
 * older range it cut: a position in the Session Transcript's log, the prompt
 * at which the log hands over to the harness's own history, or a line of
 * that history. Each names the log generation it was minted for, so a caller
 * can refuse a cursor from a log that was rebuilt since. The log kind keeps
 * the encoding cursors had before the history kinds existed.
 */
export function encodePageCursor(cursor: PageCursor): string {
  return Buffer.from(cursorText(cursor), "utf8").toString("base64url");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads a cursor encodePageCursor made back into
 * its kind, generation and position; anything else, or a position that is
 * not a positive integer, is null.
 */
export function decodePageCursor(cursor: string): PageCursor | null {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const at = text.lastIndexOf(":");
  if (at <= 0) return null;
  const n = Number(text.slice(at + 1));
  const head = text.slice(0, at);
  if (head.endsWith(HISTORY_MARK)) {
    if (!Number.isInteger(n) || n <= 0) return null;
    const generation = head.slice(0, -HISTORY_MARK.length);
    return generation ? { kind: "history", generation, index: n } : null;
  }
  if (!Number.isInteger(n) || n <= 0) return null;
  if (head.endsWith(BEFORE_LOG_MARK)) {
    const generation = head.slice(0, -BEFORE_LOG_MARK.length);
    return generation ? { kind: "beforeLog", generation, seq: n } : null;
  }
  return { kind: "log", generation: head, seq: n };
}
