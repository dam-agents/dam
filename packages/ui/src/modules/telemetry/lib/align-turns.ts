import type { TurnSummary } from "api-server-api";

export interface ReplyLike {
  id: string;
  role: string;
  streaming: boolean;
  notice?: boolean;
  at?: string;
  telemetryPromptId?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a prompt sent and the reply it produced. Once the
 * session has been loaded the reply carries the harness's own name for the
 * prompt, and that name is the join. The prompt's time is kept for the
 * exchanges that have not learned it — the prompt's, not the reply's, because
 * a user message carries one from the moment it is sent while a reply gains
 * one only as it streams — together with the time of the next prompt sent,
 * which is where this exchange's claim on the timeline ends.
 */
interface Exchange {
  replyId: string;
  key: string | null;
  promptAt: number | null;
  nextPromptAt: number | null;
  pending: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the slack the time fallback allows at either edge
 * of an exchange. A prompt's stamp and a turn's start both come from the pod's
 * clock except the sender's own bubble, which keeps the browser's stamp until
 * the session is reloaded and may run a few seconds ahead. The lower edge
 * therefore tolerates a prompt stamped just after its turn began; the upper
 * edge is tightened by the same amount, so a turn that began just before the
 * next prompt's stamp is left unmatched rather than handed to the exchange it
 * only appears to fall inside.
 */
const PROMPT_ORDER_SLACK_MS = 5_000;

const ms = (iso: string | undefined): number | null => {
  if (iso === undefined || iso === "") return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
};

const isReply = (m: ReplyLike): boolean => m.role === "assistant" && !m.notice;

function exchangesOf(messages: readonly ReplyLike[]): Exchange[] {
  const exchanges: Exchange[] = [];
  const awaitingNextPrompt: Exchange[] = [];
  let promptAt: number | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      promptAt = ms(m.at);
      if (promptAt !== null) {
        for (const e of awaitingNextPrompt) e.nextPromptAt = promptAt;
        awaitingNextPrompt.length = 0;
      }
      continue;
    }
    if (!isReply(m)) continue;
    const exchange: Exchange = {
      replyId: m.id,
      key: m.telemetryPromptId ?? null,
      promptAt,
      nextPromptAt: null,
      pending: m.streaming,
    };
    exchanges.push(exchange);
    awaitingNextPrompt.push(exchange);
    promptAt = null;
  }
  return exchanges;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a turn belongs to the reply that carries its
 * prompt id. A turn no keyed reply has claimed — a turn that just ended live,
 * before the load that would key its reply — falls back to the reply whose
 * prompt it followed: the latest prompt sent at or before the turn began, and
 * only while the turn also began before the next prompt was sent, so the reply
 * to one prompt can never claim the turn the next prompt started while that
 * turn's own reply is still on its way. The owning exchange is chosen over
 * every exchange, keyed or not, so a keyed reply still streaming is recognised
 * as the owner and the turn waits for it rather than sliding onto the earlier
 * reply. The timed match is taken only when the owner carries no id of its own
 * or the very id this turn was keyed by, one turn is chosen per reply, and it
 * is written only to a reply no other match has claimed — so a keyed match is
 * never displaced and a reply keyed to another turn is left alone.
 */
export function matchTurnsToReplies(
  turns: readonly TurnSummary[],
  messages: readonly ReplyLike[],
): Map<string, TurnSummary> {
  const matched = new Map<string, TurnSummary>();
  const exchanges = exchangesOf(messages);
  if (turns.length === 0 || exchanges.length === 0) return matched;

  const byKey = new Map<string, TurnSummary>();
  for (const turn of turns) {
    if (turn.promptId !== null) byKey.set(turn.promptId, turn);
  }

  const claimed = new Set<string>();
  for (const exchange of exchanges) {
    if (exchange.key === null || exchange.pending) continue;
    const turn = byKey.get(exchange.key);
    if (turn === undefined) continue;
    matched.set(exchange.replyId, turn);
    claimed.add(turn.turnId);
  }

  const timed = exchanges.filter(
    (e): e is Exchange & { promptAt: number } => e.promptAt !== null,
  );
  if (timed.length === 0) return matched;

  const timedMatches = new Map<string, TurnSummary>();
  for (const turn of turns) {
    if (claimed.has(turn.turnId)) continue;
    const startedAt = ms(turn.startedAt);
    if (startedAt === null) continue;
    const owner = timed.reduce<(Exchange & { promptAt: number }) | null>(
      (best, e) =>
        e.promptAt <= startedAt + PROMPT_ORDER_SLACK_MS &&
        (best === null || e.promptAt > best.promptAt)
          ? e
          : best,
      null,
    );
    if (owner === null || owner.pending) continue;
    if (
      owner.nextPromptAt !== null &&
      startedAt + PROMPT_ORDER_SLACK_MS > owner.nextPromptAt
    ) {
      continue;
    }
    if (owner.key !== null && owner.key !== turn.promptId) continue;
    timedMatches.set(owner.replyId, turn);
  }
  for (const [replyId, turn] of timedMatches) {
    if (!matched.has(replyId)) matched.set(replyId, turn);
  }
  return matched;
}
