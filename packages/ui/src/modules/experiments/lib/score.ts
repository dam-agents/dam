/** Render an opaque run score. The platform does not interpret scores (epic
 *  decision D3/D4), so the jsonb value is `unknown`: format the common numeric
 *  case nicely and fall back to a readable string for anything else. */
export function formatScore(score: unknown): string {
  if (typeof score === "number") {
    return Number.isInteger(score) ? String(score) : score.toFixed(2);
  }
  if (score == null) return "—";
  if (typeof score === "string") return score;
  return JSON.stringify(score);
}
