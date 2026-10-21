import type { MessagePart } from "../../../types.js";
import { PLUMBING_TAGS } from "../../acp/plumbing-tags.js";

type TextLike = { kind: "text" | "thought"; text: string };

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const MARKUP_RE = new RegExp(
  `^[ \\t]*<(thinking|${PLUMBING_TAGS.join("|")})(?:\\s[^>]*)?>([\\s\\S]*?)(?:<\\/\\1>[ \\t]*\\n?|(?![\\s\\S]))`,
  "gm",
);

function fencedChunks(text: string): { code: boolean; text: string }[] {
  const chunks: { code: boolean; text: string }[] = [];
  let fence: string | null = null;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = FENCE_RE.exec(line)?.[1];
    const code = fence !== null || marker !== undefined;
    if (fence === null) fence = marker ?? null;
    else if (marker?.[0] === fence[0] && marker.length >= fence.length)
      fence = null;
    const last = chunks[chunks.length - 1];
    if (last?.code === code) last.text += line;
    else chunks.push({ code, text: line });
  }
  return chunks;
}

function markupPieces(text: string): TextLike[] {
  const pieces: TextLike[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP_RE)) {
    pieces.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] === "thinking") pieces.push({ kind: "thought", text: m[2] });
    last = m.index + m[0].length;
  }
  pieces.push({ kind: "text", text: text.slice(last) });
  return pieces;
}

function splitAgentText(text: string): TextLike[] {
  const pieces = fencedChunks(text).flatMap((chunk) =>
    chunk.code
      ? [{ kind: "text" as const, text: chunk.text }]
      : markupPieces(chunk.text),
  );
  const merged: TextLike[] = [];
  for (const piece of pieces) {
    const prev = merged[merged.length - 1];
    if (prev?.kind === "text" && piece.kind === "text") prev.text += piece.text;
    else merged.push({ ...piece });
  }
  return merged
    .map((p) => ({ ...p, text: p.text.trim() }))
    .filter((p) => p.text !== "");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Splits a reply's text parts where the agent wrote
 * markup into them: a `<thinking>` passage becomes a thought, and a framing
 * tag the agent echoed is dropped. Markup counts only when it opens a line
 * outside a code fence, so a reply that quotes a tag inline or in code shows
 * it as written. A tag still open at the end runs to the end, as it does
 * while the reply streams.
 */
export function withoutAgentMarkup(
  parts: readonly MessagePart[],
): MessagePart[] {
  return parts.flatMap((part): MessagePart[] => {
    if (part.kind !== "text" || !part.text.includes("<")) return [part];
    const split = splitAgentText(part.text);
    if (
      split.length === 1 &&
      split[0].kind === "text" &&
      split[0].text === part.text.trim()
    )
      return [part];
    return split.map((p) => ({ ...part, ...p }));
  });
}
