import type { TurnSummary } from "api-server-api";

export interface ReplyLike {
  id: string;
  role: string;
  streaming: boolean;
  notice?: boolean;
  at?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a prompt sent and the reply it produced. The
 * prompt's own time is the anchor, because a user message carries one from the
 * moment it is sent while a reply gains one only once the session is reloaded —
 * anchoring on the reply would fall back to guessing for exactly the turns
 * being watched live.
 */
interface Exchange {
  replyId: string;
  promptAt: number | null;
  pending: boolean;
}

const CLOCK_SKEW_MS = 5_000;

const ms = (iso: string | undefined): number | null => {
  if (iso === undefined || iso === "") return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
};

const isReply = (m: ReplyLike): boolean => m.role === "assistant" && !m.notice;

export function exchangesOf(messages: readonly ReplyLike[]): Exchange[] {
  const exchanges: Exchange[] = [];
  let promptAt: number | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      promptAt = ms(m.at);
      continue;
    }
    if (!isReply(m)) continue;
    exchanges.push({ replyId: m.id, promptAt, pending: m.streaming });
    promptAt = null;
  }
  return exchanges;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a turn belongs to the exchange whose prompt it
 * followed — the latest prompt sent at or before the turn began. A turn that
 * followed no prompt yet recorded belongs to an exchange that has not finished,
 * so it waits rather than attaching to the previous reply and moving later,
 * which is what made a span appear under one turn and then jump to the next.
 */
export function matchTurnsToReplies(
  turns: readonly TurnSummary[],
  messages: readonly ReplyLike[],
): Map<string, TurnSummary> {
  const matched = new Map<string, TurnSummary>();
  const exchanges = exchangesOf(messages);
  if (turns.length === 0 || exchanges.length === 0) return matched;

  const anchored = exchanges.filter(
    (e): e is Exchange & { promptAt: number } => e.promptAt !== null,
  );
  if (anchored.length === 0) return positionally(turns, exchanges, matched);

  for (const turn of turns) {
    const startedAt = ms(turn.startedAt);
    if (startedAt === null) continue;
    const owner = anchored.reduce<(Exchange & { promptAt: number }) | null>(
      (best, e) =>
        e.promptAt <= startedAt + CLOCK_SKEW_MS &&
        (best === null || e.promptAt > best.promptAt)
          ? e
          : best,
      null,
    );
    if (owner !== null && !owner.pending) matched.set(owner.replyId, turn);
  }
  return matched;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the fallback for a transcript whose prompts carry
 * no time. Lining up from the newest end keeps the most recent reply right and
 * leaves the oldest unlabelled, rather than shifting every reply onto the next
 * one's telemetry.
 */
function positionally(
  turns: readonly TurnSummary[],
  exchanges: readonly Exchange[],
  matched: Map<string, TurnSummary>,
): Map<string, TurnSummary> {
  exchanges.forEach((exchange, index) => {
    const turnIndex = turns.length - exchanges.length + index;
    const turn = turnIndex >= 0 ? turns[turnIndex] : undefined;
    if (turn !== undefined && !exchange.pending) {
      matched.set(exchange.replyId, turn);
    }
  });
  return matched;
}

export function turnIndexForReply(
  turnCount: number,
  replyCount: number,
  replyIndex: number,
): number | null {
  if (replyIndex < 0 || replyIndex >= replyCount) return null;
  const index = turnCount - replyCount + replyIndex;
  return index >= 0 && index < turnCount ? index : null;
}
