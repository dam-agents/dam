/**
 * UNIT_BOUNDARY_DESCRIPTION: exchanges are matched to replies by position, and
 * the two counts can disagree — the harness emits no prompt event for a
 * session's opening exchanges, so several replies can land in one turn. Lining
 * up from the newest end keeps the most recent reply correct and leaves the
 * oldest unlabelled, rather than shifting every reply onto the next one's
 * telemetry.
 */
export function turnIndexForReply(
  turnCount: number,
  replyCount: number,
  replyIndex: number,
): number | null {
  if (replyIndex < 0 || replyIndex >= replyCount) return null;
  const index = turnCount - replyCount + replyIndex;
  return index >= 0 && index < turnCount ? index : null;
}
