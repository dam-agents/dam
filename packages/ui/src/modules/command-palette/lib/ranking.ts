const DAY_MS = 86_400_000;

export const RANKING = {
  FUZZY_EXPONENT: 2,
  W_PRIOR: 1,
  W_FRECENCY: 1,
  W_RECENCY: 0.5,
  W_CONTEXT: 0.6,
  W_CROSS: 0.8,
  FRECENCY_HALF_LIFE_MS: 7 * DAY_MS,
  FRECENCY_SATURATION: 3,
  RECENCY_HALF_LIFE_MS: 2 * DAY_MS,
  MAX_RESULTS: 50,
  MAX_FRECENCY_ENTRIES: 300,
  MATCH_AT_START: 1,
  MATCH_CONTINUED: 1,
  MATCH_AT_WORD_START: 0.9,
  MATCH_MID_WORD: 0.17,
  MATCH_SKIP_PENALTY: 0.999,
  MATCH_INCOMPLETE_PENALTY: 0.99,
  PRIOR: {
    newSession: 0.7,
    navigate: 0.6,
    openSession: 0.6,
    toggle: 0.6,
    createAgent: 0.6,
    configure: 0.5,
    openArtifact: 0.5,
    settings: 0.5,
    approvalsPanel: 0.5,
    browseKits: 0.5,
    wake: 0.5,
    openKit: 0.4,
    terminal: 0.4,
    rename: 0.4,
    theme: 0.4,
    minorSettings: 0.3,
    docs: 0.3,
    copy: 0.3,
    restart: 0.3,
    denyAll: 0.3,
    rare: 0.3,
    disable: 0.25,
    logOut: 0.15,
    destructive: 0.1,
  },
} as const;

export interface Rankable {
  id: string;
  text: string;
  prior: number;
  agentId?: string;
  action?: string;
  activityAt?: number;
  destructive?: boolean;
}

export interface RankingContext {
  now: number;
  agentId: string | null;
  action: string | null;
  frecency: (id: string) => number;
}

export function halfLifeDecay(ageMs: number, halfLifeMs: number): number {
  return 2 ** (-Math.max(0, ageMs) / halfLifeMs);
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;

function startsWord(text: string, at: number): boolean {
  if (at === 0) return true;
  const before = text[at - 1]!;
  const here = text[at]!;
  if (!LETTER_OR_DIGIT.test(before)) return true;
  if (!UPPER.test(here)) return false;
  return (
    LOWER.test(before) || (UPPER.test(before) && LOWER.test(text[at + 1] ?? ""))
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how well one typed word matches a command's
 * text, from 0 (no match) to 1 (the whole text). Every typed character must
 * appear in order. A character that starts a word in the text (the text's
 * start, after any character that is not a letter or digit, or a camelCase
 * hump) scores far above one that starts a run mid-word, and a character
 * right after the previous match continues its run at full score. So "ar"
 * picks the initials of "agent: remove" over the "ar" inside "start", a run
 * inside a word still beats letters scattered through it, and an exact prefix
 * scores highest. Of all the ways to place the characters, the best counts.
 */
export function matchScore(text: string, word: string): number {
  const lower = Array.from({ length: text.length }, (_, at) =>
    text[at]!.toLowerCase(),
  );
  const needle = word.toLowerCase();
  const memo = new Map<number, number>();
  const best = (i: number, from: number): number => {
    if (i === needle.length)
      return from === text.length ? 1 : RANKING.MATCH_INCOMPLETE_PENALTY;
    const key = i * (text.length + 1) + from;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let score = 0;
    for (let at = from; at < text.length; at++) {
      if (lower[at] !== needle[i]) continue;
      const weight =
        i > 0 && at === from
          ? RANKING.MATCH_CONTINUED
          : at === 0
            ? RANKING.MATCH_AT_START
            : startsWord(text, at)
              ? RANKING.MATCH_AT_WORD_START
              : RANKING.MATCH_MID_WORD;
      const skipped = RANKING.MATCH_SKIP_PENALTY ** (at - from);
      score = Math.max(score, weight * skipped * best(i + 1, at + 1));
    }
    memo.set(key, score);
    return score;
  };
  return best(0, 0);
}

export function fuzzyScore(text: string, query: string): number {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  let product = 1;
  for (const token of tokens) {
    const score = matchScore(text, token);
    if (score <= 0) return 0;
    product *= score;
  }
  return tokens.length === 0 ? 1 : product ** (1 / tokens.length);
}

export function scoreCommand(
  command: Rankable,
  query: string,
  ctx: RankingContext,
): number {
  if (command.destructive && query.trim() === "") return 0;
  const match = fuzzyScore(command.text, query);
  if (match === 0) return 0;
  const uses = command.destructive ? 0 : ctx.frecency(command.id);
  const frecency = uses / (uses + RANKING.FRECENCY_SATURATION);
  const recency =
    command.activityAt === undefined
      ? 0
      : halfLifeDecay(
          ctx.now - command.activityAt,
          RANKING.RECENCY_HALF_LIFE_MS,
        );
  const own = command.agentId !== undefined && command.agentId === ctx.agentId;
  const cross =
    !own &&
    command.agentId !== undefined &&
    command.action !== undefined &&
    command.action === ctx.action;
  const boost =
    1 +
    RANKING.W_PRIOR * (command.prior - 0.5) +
    RANKING.W_FRECENCY * frecency +
    RANKING.W_RECENCY * recency +
    (own ? RANKING.W_CONTEXT : 0) +
    (cross ? RANKING.W_CROSS : 0);
  return match ** RANKING.FUZZY_EXPONENT * boost;
}

export function rankCommands<T extends Rankable>(
  commands: readonly T[],
  query: string,
  ctx: RankingContext,
): T[] {
  return commands
    .map((command) => ({ command, score: scoreCommand(command, query, ctx) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.command.text.localeCompare(b.command.text),
    )
    .slice(0, RANKING.MAX_RESULTS)
    .map(({ command }) => command);
}
