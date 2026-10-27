import { defaultFilter } from "cmdk";

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

export function fuzzyScore(text: string, query: string): number {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  let product = 1;
  for (const token of tokens) {
    const score = defaultFilter(text, token);
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
  const match = fuzzyScore(command.text, query);
  if (match === 0) return 0;
  const uses = ctx.frecency(command.id);
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
